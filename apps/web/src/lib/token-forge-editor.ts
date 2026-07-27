import {
  type AllowedFieldMap,
  SanitizationError,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import {
  type TokenForgeInput,
  type TokenForgePlan,
  type TokenForgeTask,
  type TokenForgeTaskSize,
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";
import { assessAndOrderTokenForgePlan } from "./token-forge-quality";

export type TokenForgeTaskEditValues = {
  size: TokenForgeTaskSize;
  title: string;
  estimated_tokens: string;
  estimated_hours: string;
  included: string;
  excluded: string;
  prompt: string;
  acceptance_criteria: string;
};

export type TokenForgeBudgetEditValues = {
  token_budget: string;
  available_hours: string;
};

export type TokenForgeEditorSession = {
  schema_version: "1.0";
  input: TokenForgeInput;
  plan: TokenForgePlan;
  locked_task_ids: string[];
  revision: number;
};

export type TokenForgeEditorErrorCode =
  | "task_not_found"
  | "task_locked"
  | "invalid_task"
  | "sensitive_input"
  | "minimum_tasks"
  | "dependency_in_use"
  | "dependency_order"
  | "invalid_move"
  | "invalid_budget"
  | "locked_replan";

const editorErrorMessages: Record<TokenForgeEditorErrorCode, string> = {
  task_not_found: "没有找到要编辑的任务，请重新生成计划。",
  task_locked: "任务已锁定；请先解锁，再修改、删除或移动。",
  invalid_task: "任务没有通过字段、范围、验收或预算合同，请检查后重试。",
  sensitive_input: "检测到 Token、Cookie 或 Authorization，请移除后重试。",
  minimum_tasks: "计划必须至少保留一项任务。",
  dependency_in_use: "仍有后续任务依赖该任务；请先处理依赖任务。",
  dependency_order: "移动后会把任务排到它的依赖之前，因此没有应用。",
  invalid_move: "任务已经位于该方向的边界。",
  invalid_budget: "新预算无效，或当前任务总额已经超过新上限。",
  locked_replan: "存在锁定任务；为避免改变已确认位置，请先解锁再自动排序。",
};

export class TokenForgeEditorError extends Error {
  override name = "TokenForgeEditorError";

  constructor(readonly code: TokenForgeEditorErrorCode) {
    super(editorErrorMessages[code]);
  }
}

const taskPolicy = {
  id: {
    required: true,
    rule: { type: "text", maxLength: 100 },
  },
  size: {
    required: true,
    rule: { type: "enum", values: ["S", "M", "L"] },
  },
  title: {
    required: true,
    rule: { type: "text", maxLength: 100 },
  },
  estimated_tokens: {
    required: true,
    rule: {
      type: "number",
      integer: true,
      minimum: 2_000,
      maximum: 60_000,
    },
  },
  estimated_hours: {
    required: true,
    rule: { type: "number", minimum: 0.5, maximum: 80 },
  },
  dependencies: {
    required: true,
    rule: {
      type: "array",
      maxItems: 8,
      items: { type: "text", maxLength: 100 },
    },
  },
  scope: {
    required: true,
    rule: {
      type: "object",
      fields: {
        included: {
          required: true,
          rule: {
            type: "array",
            maxItems: 10,
            items: { type: "text", maxLength: 300 },
          },
        },
        excluded: {
          required: true,
          rule: {
            type: "array",
            maxItems: 10,
            items: { type: "text", maxLength: 300 },
          },
        },
      },
    },
  },
  prompt: {
    required: true,
    rule: { type: "text", maxLength: 4_000 },
  },
  acceptance_criteria: {
    required: true,
    rule: {
      type: "array",
      maxItems: 10,
      items: { type: "text", maxLength: 300 },
    },
  },
} as const satisfies AllowedFieldMap;

const nextSession = (
  session: TokenForgeEditorSession,
  update: Partial<
    Pick<TokenForgeEditorSession, "input" | "plan" | "locked_task_ids">
  >,
): TokenForgeEditorSession => ({
  schema_version: "1.0",
  input: structuredClone(update.input ?? session.input),
  plan: structuredClone(update.plan ?? session.plan),
  locked_task_ids: [...(update.locked_task_ids ?? session.locked_task_ids)],
  revision: session.revision + 1,
});

const requireTask = (
  session: TokenForgeEditorSession,
  taskId: string,
): TokenForgeTask => {
  const task = session.plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new TokenForgeEditorError("task_not_found");
  }
  return task;
};

const requireUnlocked = (
  session: TokenForgeEditorSession,
  taskId: string,
): void => {
  if (session.locked_task_ids.includes(taskId)) {
    throw new TokenForgeEditorError("task_locked");
  }
};

const parseNumber = (value: string): number => {
  if (value.trim().length === 0) {
    return Number.NaN;
  }
  return Number(value);
};

const splitLines = (value: string): string[] => [
  ...new Set(
    value
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

const buildEditedTask = (
  task: TokenForgeTask,
  values: TokenForgeTaskEditValues,
): TokenForgeTask => {
  const candidate = {
    id: task.id,
    size: values.size,
    title: values.title.trim(),
    estimated_tokens: parseNumber(values.estimated_tokens),
    estimated_hours: parseNumber(values.estimated_hours),
    dependencies: [...task.dependencies],
    scope: {
      included: splitLines(values.included),
      excluded: splitLines(values.excluded),
    },
    prompt: values.prompt.trim(),
    acceptance_criteria: splitLines(values.acceptance_criteria),
  };

  try {
    return sanitizeAllowedFields(candidate, taskPolicy)
      .value as unknown as TokenForgeTask;
  } catch (error) {
    if (
      error instanceof SanitizationError &&
      error.code === "sensitive-input"
    ) {
      throw new TokenForgeEditorError("sensitive_input");
    }
    throw new TokenForgeEditorError("invalid_task");
  }
};

const assertDependencyOrder = (tasks: TokenForgeTask[]): void => {
  const positionById = new Map(
    tasks.map((task, index) => [task.id, index] as const),
  );

  for (const [index, task] of tasks.entries()) {
    if (
      task.dependencies.some(
        (dependency) => (positionById.get(dependency) ?? index) >= index,
      )
    ) {
      throw new TokenForgeEditorError("dependency_order");
    }
  }
};

export const createTokenForgeEditorSession = (
  inputCandidate: unknown,
  planCandidate: unknown,
): TokenForgeEditorSession => {
  const input = validateTokenForgeInput(inputCandidate);
  const plan = validateTokenForgePlan(input, planCandidate);
  assertDependencyOrder(plan.tasks);

  return {
    schema_version: "1.0",
    input: structuredClone(input),
    plan: structuredClone(plan),
    locked_task_ids: [],
    revision: 0,
  };
};

export const setTokenForgeEditorTaskLock = (
  session: TokenForgeEditorSession,
  taskId: string,
  locked: boolean,
): TokenForgeEditorSession => {
  requireTask(session, taskId);
  const current = new Set(session.locked_task_ids);
  if (locked) {
    current.add(taskId);
  } else {
    current.delete(taskId);
  }

  return nextSession(session, {
    locked_task_ids: session.plan.tasks
      .map((task) => task.id)
      .filter((id) => current.has(id)),
  });
};

export const updateTokenForgeEditorTask = (
  session: TokenForgeEditorSession,
  taskId: string,
  values: TokenForgeTaskEditValues,
): TokenForgeEditorSession => {
  const task = requireTask(session, taskId);
  requireUnlocked(session, taskId);
  const editedTask = buildEditedTask(task, values);
  const candidatePlan = {
    ...session.plan,
    tasks: session.plan.tasks.map((candidate) =>
      candidate.id === taskId ? editedTask : candidate,
    ),
  };

  try {
    const plan = validateTokenForgePlan(session.input, candidatePlan);
    assertDependencyOrder(plan.tasks);
    return nextSession(session, { plan });
  } catch (error) {
    if (error instanceof TokenForgeEditorError) {
      throw error;
    }
    throw new TokenForgeEditorError("invalid_task");
  }
};

export const deleteTokenForgeEditorTask = (
  session: TokenForgeEditorSession,
  taskId: string,
): TokenForgeEditorSession => {
  requireTask(session, taskId);
  requireUnlocked(session, taskId);

  if (session.plan.tasks.length === 1) {
    throw new TokenForgeEditorError("minimum_tasks");
  }
  if (session.plan.tasks.some((task) => task.dependencies.includes(taskId))) {
    throw new TokenForgeEditorError("dependency_in_use");
  }

  const plan = validateTokenForgePlan(session.input, {
    ...session.plan,
    tasks: session.plan.tasks.filter((task) => task.id !== taskId),
  });

  return nextSession(session, {
    plan,
    locked_task_ids: session.locked_task_ids.filter((id) => id !== taskId),
  });
};

export const moveTokenForgeEditorTask = (
  session: TokenForgeEditorSession,
  taskId: string,
  direction: "up" | "down",
): TokenForgeEditorSession => {
  requireTask(session, taskId);
  requireUnlocked(session, taskId);
  const currentIndex = session.plan.tasks.findIndex(
    (task) => task.id === taskId,
  );
  const targetIndex = currentIndex + (direction === "up" ? -1 : 1);
  const target = session.plan.tasks[targetIndex];

  if (!target) {
    throw new TokenForgeEditorError("invalid_move");
  }
  requireUnlocked(session, target.id);

  const tasks = [...session.plan.tasks];
  [tasks[currentIndex], tasks[targetIndex]] = [
    tasks[targetIndex] as TokenForgeTask,
    tasks[currentIndex] as TokenForgeTask,
  ];
  assertDependencyOrder(tasks);

  const plan = validateTokenForgePlan(session.input, {
    ...session.plan,
    tasks,
  });
  return nextSession(session, { plan });
};

export const updateTokenForgeEditorBudget = (
  session: TokenForgeEditorSession,
  values: TokenForgeBudgetEditValues,
): TokenForgeEditorSession => {
  try {
    const input = validateTokenForgeInput({
      ...session.input,
      token_budget: parseNumber(values.token_budget),
      available_hours: parseNumber(values.available_hours),
    });
    validateTokenForgePlan(input, session.plan);
    return nextSession(session, { input });
  } catch {
    throw new TokenForgeEditorError("invalid_budget");
  }
};

export const autoOrderTokenForgeEditorSession = (
  session: TokenForgeEditorSession,
): TokenForgeEditorSession => {
  if (session.locked_task_ids.length > 0) {
    throw new TokenForgeEditorError("locked_replan");
  }

  const ordered = assessAndOrderTokenForgePlan(session.input, session.plan);
  return nextSession(session, { plan: ordered.plan });
};
