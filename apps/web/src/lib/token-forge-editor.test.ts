import { describe, expect, it, vi } from "vitest";

import type { TokenForgeInput, TokenForgePlan } from "./token-forge-contracts";
import {
  TokenForgeEditorError,
  autoOrderTokenForgeEditorSession,
  createTokenForgeEditorSession,
  deleteTokenForgeEditorTask,
  moveTokenForgeEditorTask,
  setTokenForgeEditorTaskLock,
  updateTokenForgeEditorBudget,
  updateTokenForgeEditorTask,
} from "./token-forge-editor";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const input: TokenForgeInput = {
  schema_version: "1.0",
  token_budget: 28_000,
  expires_in_days: 7,
  available_hours: 15,
  tech_stack: ["TypeScript", "Astro", "Vitest"],
  goal: "实现一个无需登录、可以本地编辑和重新验证的任务计划工具",
};

const buildPlan = (): TokenForgePlan => generateTokenForgeTemplatePlan(input);

const taskDraft = (plan: TokenForgePlan, taskId: string) => {
  const task = plan.tasks.find((candidate) => candidate.id === taskId);
  if (!task) {
    throw new Error(`Missing task ${taskId}`);
  }

  return {
    size: task.size,
    title: task.title,
    estimated_tokens: String(task.estimated_tokens),
    estimated_hours: String(task.estimated_hours),
    included: task.scope.included.join("\n"),
    excluded: task.scope.excluded.join("\n"),
    prompt: task.prompt,
    acceptance_criteria: task.acceptance_criteria.join("\n"),
  };
};

describe("Token Forge local editor", () => {
  it("creates an isolated deterministic session from a validated plan", () => {
    const plan = buildPlan();
    const first = createTokenForgeEditorSession(input, plan);
    const second = createTokenForgeEditorSession(input, plan);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.plan).not.toBe(plan);
    expect(first).toMatchObject({
      schema_version: "1.0",
      revision: 0,
      locked_task_ids: [],
    });
  });

  it("updates a task locally and redacts identifiers before validation", () => {
    const session = createTokenForgeEditorSession(input, buildPlan());
    const taskId = session.plan.tasks[0]?.id ?? "";
    const rawEmail = "operator@example.com";
    const updated = updateTokenForgeEditorTask(session, taskId, {
      ...taskDraft(session.plan, taskId),
      title: "更新可重复验证的任务合同",
      included: `更新确定性任务合同\n为 ${rawEmail} 补齐失败路径测试`,
    });
    const task = updated.plan.tasks.find(
      (candidate) => candidate.id === taskId,
    );

    expect(updated.revision).toBe(1);
    expect(task?.title).toBe("更新可重复验证的任务合同");
    expect(JSON.stringify(updated)).not.toContain(rawEmail);
    expect(task?.scope.included.join(" ")).toContain("[REDACTED:EMAIL]");
    expect(session.revision).toBe(0);
  });

  it("rejects Secret edits without echoing their value", () => {
    const session = createTokenForgeEditorSession(input, buildPlan());
    const taskId = session.plan.tasks[0]?.id ?? "";
    const rawSecret = "synthetic-secret-that-must-not-cross";
    let error: unknown;

    try {
      updateTokenForgeEditorTask(session, taskId, {
        ...taskDraft(session.plan, taskId),
        prompt: `使用 api_key=${rawSecret} 完成任务，然后运行测试和构建验证所有输出。`,
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(TokenForgeEditorError);
    expect(error).toMatchObject({ code: "sensitive_input" });
    expect(String(error)).not.toContain(rawSecret);
  });

  it("prevents edits, deletion and movement while a task is locked", () => {
    const session = createTokenForgeEditorSession(input, buildPlan());
    const taskId = session.plan.tasks[0]?.id ?? "";
    const locked = setTokenForgeEditorTaskLock(session, taskId, true);

    expect(locked.locked_task_ids).toEqual([taskId]);
    expect(() =>
      updateTokenForgeEditorTask(
        locked,
        taskId,
        taskDraft(locked.plan, taskId),
      ),
    ).toThrow(expect.objectContaining({ code: "task_locked" }));
    expect(() => deleteTokenForgeEditorTask(locked, taskId)).toThrow(
      expect.objectContaining({ code: "task_locked" }),
    );
    expect(() => moveTokenForgeEditorTask(locked, taskId, "down")).toThrow(
      expect.objectContaining({ code: "task_locked" }),
    );

    const unlocked = setTokenForgeEditorTaskLock(locked, taskId, false);
    expect(unlocked.locked_task_ids).toEqual([]);
  });

  it("blocks deleting the last task or a dependency still in use", () => {
    const session = createTokenForgeEditorSession(input, buildPlan());
    const rootId = session.plan.tasks[0]?.id ?? "";

    expect(() => deleteTokenForgeEditorTask(session, rootId)).toThrow(
      expect.objectContaining({ code: "dependency_in_use" }),
    );

    const singleInput: TokenForgeInput = {
      ...input,
      token_budget: 8_000,
      available_hours: 3,
    };
    const single = createTokenForgeEditorSession(
      singleInput,
      generateTokenForgeTemplatePlan(singleInput),
    );
    const onlyId = single.plan.tasks[0]?.id ?? "";

    expect(() => deleteTokenForgeEditorTask(single, onlyId)).toThrow(
      expect.objectContaining({ code: "minimum_tasks" }),
    );
  });

  it("moves independent tasks but rejects dependency-unsafe order", () => {
    const base = buildPlan();
    const independentPlan: TokenForgePlan = {
      ...base,
      tasks: base.tasks.map((task) => ({ ...task, dependencies: [] })),
    };
    const independent = createTokenForgeEditorSession(input, independentPlan);
    const lastId = independent.plan.tasks.at(-1)?.id ?? "";
    const moved = moveTokenForgeEditorTask(independent, lastId, "up");

    expect(moved.plan.tasks.at(-2)?.id).toBe(lastId);
    expect(moved.revision).toBe(1);

    const dependent = createTokenForgeEditorSession(input, base);
    const rootId = dependent.plan.tasks[0]?.id ?? "";
    expect(() => moveTokenForgeEditorTask(dependent, rootId, "down")).toThrow(
      expect.objectContaining({ code: "dependency_order" }),
    );
  });

  it("updates the budget only when the current plan still fits", () => {
    const session = createTokenForgeEditorSession(input, buildPlan());
    const expanded = updateTokenForgeEditorBudget(session, {
      token_budget: "30000",
      available_hours: "16",
    });

    expect(expanded.input).toMatchObject({
      token_budget: 30_000,
      available_hours: 16,
    });
    expect(() =>
      updateTokenForgeEditorBudget(session, {
        token_budget: "2000",
        available_hours: "1",
      }),
    ).toThrow(expect.objectContaining({ code: "invalid_budget" }));
  });

  it("quality-orders an unlocked session and refuses to move locked work", () => {
    const base = buildPlan();
    const independentPlan: TokenForgePlan = {
      ...base,
      tasks: base.tasks.map((task, index) => ({
        ...task,
        dependencies: [],
        title: index === 0 ? "优化相关功能" : task.title,
      })),
    };
    const session = createTokenForgeEditorSession(input, independentPlan);
    const ordered = autoOrderTokenForgeEditorSession(session);

    expect(ordered.plan.tasks[0]?.id).not.toBe(independentPlan.tasks[0]?.id);
    expect(ordered.revision).toBe(1);

    const taskId = session.plan.tasks[0]?.id ?? "";
    const locked = setTokenForgeEditorTaskLock(session, taskId, true);
    expect(() => autoOrderTokenForgeEditorSession(locked)).toThrow(
      expect.objectContaining({ code: "locked_replan" }),
    );
  });

  it("does not use network, storage or console while editing", () => {
    const fetchMock = vi.fn();
    const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    try {
      const session = createTokenForgeEditorSession(input, buildPlan());
      const taskId = session.plan.tasks[0]?.id ?? "";
      setTokenForgeEditorTaskLock(session, taskId, true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      consoleMock.mockRestore();
    }
  });
});
