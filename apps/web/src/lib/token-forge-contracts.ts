import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import inputSchema from "../../../../schemas/token-forge-input-v1.schema.json";
import planSchema from "../../../../schemas/token-forge-plan-v1.schema.json";

export type TokenForgeInput = {
  schema_version: "1.0";
  token_budget: number;
  expires_in_days: number;
  available_hours: number;
  tech_stack: string[];
  goal: string;
  repository_url?: string;
};

export type TokenForgeTaskSize = "S" | "M" | "L";

export type TokenForgeTask = {
  id: string;
  size: TokenForgeTaskSize;
  title: string;
  estimated_tokens: number;
  estimated_hours: number;
  dependencies: string[];
  scope: {
    included: string[];
    excluded: string[];
  };
  prompt: string;
  acceptance_criteria: string[];
};

export type TokenForgePlan = {
  schema_version: "1.0";
  mode: "template" | "ai-assisted";
  tasks: TokenForgeTask[];
  unknowns: string[];
  safety_notes: string[];
};

export class TokenForgeContractError extends Error {
  override name = "TokenForgeContractError";
}

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message ?? "is invalid"}`;
    })
    .join("; ");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const validateInputSchema = ajv.compile<TokenForgeInput>(
  inputSchema as AnySchema,
);
const validatePlanSchema = ajv.compile<TokenForgePlan>(planSchema as AnySchema);

const parseContract = <T>(
  candidate: unknown,
  contractName: string,
  validate: ValidateFunction<T>,
): T => {
  if (!validate(candidate)) {
    throw new TokenForgeContractError(
      `${contractName} validation failed: ${formatValidationErrors(validate.errors)}`,
    );
  }

  return candidate as T;
};

const assertDependencyGraph = (tasks: TokenForgeTask[]): void => {
  const taskIds = new Set(tasks.map((task) => task.id));

  if (taskIds.size !== tasks.length) {
    throw new TokenForgeContractError(
      "token-forge-plan-v1 task ids must be unique.",
    );
  }

  for (const task of tasks) {
    if (task.dependencies.includes(task.id)) {
      throw new TokenForgeContractError(
        "token-forge-plan-v1 tasks cannot depend on themselves.",
      );
    }

    if (task.dependencies.some((dependency) => !taskIds.has(dependency))) {
      throw new TokenForgeContractError(
        "token-forge-plan-v1 dependencies must reference tasks in the same plan.",
      );
    }
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (taskId: string): void => {
    if (visiting.has(taskId)) {
      throw new TokenForgeContractError(
        "token-forge-plan-v1 dependencies must not contain a cycle.",
      );
    }

    if (visited.has(taskId)) {
      return;
    }

    visiting.add(taskId);

    for (const dependency of tasksById.get(taskId)?.dependencies ?? []) {
      visit(dependency);
    }

    visiting.delete(taskId);
    visited.add(taskId);
  };

  for (const task of tasks) {
    visit(task.id);
  }
};

export const validateTokenForgeInput = (
  candidate: unknown,
): TokenForgeInput => {
  return parseContract(candidate, "token-forge-input-v1", validateInputSchema);
};

export const validateTokenForgePlan = (
  input: TokenForgeInput,
  candidate: unknown,
): TokenForgePlan => {
  validateTokenForgeInput(input);
  const plan = parseContract(
    candidate,
    "token-forge-plan-v1",
    validatePlanSchema,
  );
  assertDependencyGraph(plan.tasks);

  const estimatedTokens = plan.tasks.reduce(
    (total, task) => total + task.estimated_tokens,
    0,
  );
  if (estimatedTokens > input.token_budget) {
    throw new TokenForgeContractError(
      "token-forge-plan-v1 estimated tokens exceed the validated input budget.",
    );
  }

  const estimatedHours = plan.tasks.reduce(
    (total, task) => total + task.estimated_hours,
    0,
  );
  if (estimatedHours > input.available_hours) {
    throw new TokenForgeContractError(
      "token-forge-plan-v1 estimated hours exceed the validated available time.",
    );
  }

  return plan;
};
