import { describe, expect, it } from "vitest";

import type {
  TokenForgeInput,
  TokenForgePlan,
  TokenForgeTask,
} from "./token-forge-contracts";
import { assessAndOrderTokenForgePlan } from "./token-forge-quality";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const input: TokenForgeInput = {
  schema_version: "1.0",
  token_budget: 30_000,
  expires_in_days: 7,
  available_hours: 20,
  tech_stack: ["TypeScript", "Vitest"],
  goal: "为公开演示项目生成范围清楚、可以验收的开发任务计划",
};

const strongTask = (
  id: string,
  dependencies: string[] = [],
): TokenForgeTask => ({
  id,
  size: "S",
  title: "实现可重复验证的质量规则",
  estimated_tokens: 5_000,
  estimated_hours: 3,
  dependencies,
  scope: {
    included: [
      "实现与页面分离的确定性评分函数",
      "覆盖正常、模糊和依赖排序测试",
    ],
    excluded: ["不调用模型、网络、存储或生产写操作"],
  },
  prompt:
    "实现一个无副作用的质量评分函数，先验证输入与计划合同，再为正常、模糊和依赖场景补齐单元测试，最后运行统一质量命令验证类型、测试与构建。",
  acceptance_criteria: [
    "相同输入重复运行会得到完全一致的分数、规则和任务顺序",
    "每个任务位置都包含依赖、质量优先或稳定顺序的规则编号",
    "统一质量命令通过类型检查、单元测试、构建和静态合同验证",
  ],
});

const vagueTask = (id: string): TokenForgeTask => ({
  id,
  size: "S",
  title: "优化相关功能",
  estimated_tokens: 4_000,
  estimated_hours: 2,
  dependencies: [],
  scope: {
    included: ["对相关功能做适当优化"],
    excluded: ["其他事项根据实际情况处理"],
  },
  prompt:
    "请对相关功能进行适当优化，根据实际情况处理发现的问题，并尽量让整体效果有所改善；完成后自行判断是否达到预期要求。",
  acceptance_criteria: ["整体效果有所改善并达到预期要求"],
});

const planWith = (tasks: TokenForgeTask[]): TokenForgePlan => ({
  schema_version: "1.0",
  mode: "ai-assisted",
  tasks,
  unknowns: ["当前测试不读取公开仓库，无法判断现有实现状态。"],
  safety_notes: ["只使用合成输入执行确定性质量规则。"],
});

describe("Token Forge deterministic quality assessment", () => {
  it("gives the established template a deterministic explained score", () => {
    const templateInput: TokenForgeInput = {
      ...input,
      token_budget: 28_000,
      available_hours: 15,
    };
    const plan = generateTokenForgeTemplatePlan(templateInput);

    const first = assessAndOrderTokenForgePlan(templateInput, plan, {
      repository_status: "not-requested",
    });
    const second = assessAndOrderTokenForgePlan(templateInput, plan, {
      repository_status: "not-requested",
    });

    expect(first).toEqual(second);
    expect(first.quality.schema_version).toBe("1.0");
    expect(first.quality.status).toBe("ready");
    expect(first.quality.score).toBeGreaterThanOrEqual(80);
    expect(first.quality.tasks).toHaveLength(plan.tasks.length);
    expect(
      first.quality.tasks.every((task) =>
        task.rules.every((rule) => /^QF-Q0[1-6]$/.test(rule.rule_id)),
      ),
    ).toBe(true);
  });

  it("flags vague, low-evidence work for manual revision", () => {
    const result = assessAndOrderTokenForgePlan(
      input,
      planWith([vagueTask("vague-work")]),
      { repository_status: "fallback" },
    );
    const assessment = result.quality.tasks[0];

    expect(result.quality.status).toBe("review");
    expect(result.quality.review_task_count).toBe(1);
    expect(assessment?.status).toBe("review");
    expect(assessment?.score).toBeLessThan(80);
    expect(
      assessment?.rules
        .filter((rule) => rule.status === "warning")
        .map((rule) => rule.rule_id),
    ).toEqual(expect.arrayContaining(["QF-Q01", "QF-Q02", "QF-Q04", "QF-Q05"]));
    expect(result.quality.evidence.rule_id).toBe("QF-E03");
  });

  it("orders ready tasks by score without moving a task before its dependencies", () => {
    const result = assessAndOrderTokenForgePlan(
      input,
      planWith([
        vagueTask("vague-work"),
        strongTask("dependent-work", ["quality-core"]),
        strongTask("quality-core"),
      ]),
      { repository_status: "summarized" },
    );

    expect(result.quality.ordered_task_ids).toEqual([
      "quality-core",
      "dependent-work",
      "vague-work",
    ]);
    expect(result.plan.tasks.map((task) => task.id)).toEqual(
      result.quality.ordered_task_ids,
    );
    expect(
      result.quality.tasks.find((task) => task.task_id === "quality-core")
        ?.order.rule_id,
    ).toBe("QF-O02");
    expect(
      result.quality.tasks.find((task) => task.task_id === "dependent-work")
        ?.order.rule_id,
    ).toBe("QF-O01");
  });

  it("preserves input order when simultaneously ready tasks have equal scores", () => {
    const result = assessAndOrderTokenForgePlan(
      input,
      planWith([strongTask("second-label"), strongTask("first-label")]),
    );

    expect(result.quality.ordered_task_ids).toEqual([
      "second-label",
      "first-label",
    ]);
    expect(result.quality.tasks.map((task) => task.original_rank)).toEqual([
      1, 2,
    ]);
    expect(
      result.quality.tasks.every((task) => task.order.rule_id === "QF-O03"),
    ).toBe(true);
  });

  it("preserves an explicit dependency-safe manual order with a user rule", () => {
    const result = assessAndOrderTokenForgePlan(
      input,
      planWith([vagueTask("manual-first"), strongTask("manual-second")]),
      {
        ordering_mode: "manual",
      },
    );

    expect(result.quality.ordered_task_ids).toEqual([
      "manual-first",
      "manual-second",
    ]);
    expect(
      result.quality.tasks.every((task) => task.order.rule_id === "QF-O04"),
    ).toBe(true);
  });

  it("rejects a manual order that places a dependency after its consumer", () => {
    expect(() =>
      assessAndOrderTokenForgePlan(
        input,
        planWith([
          strongTask("dependent-work", ["quality-core"]),
          strongTask("quality-core"),
        ]),
        {
          ordering_mode: "manual",
        },
      ),
    ).toThrow(/dependencies must appear before/);
  });

  it("requires review when one task concentrates over 70% of both budgets", () => {
    const concentratedInput: TokenForgeInput = {
      ...input,
      token_budget: 60_000,
    };
    const concentratedTask: TokenForgeTask = {
      ...strongTask("concentrated-work"),
      size: "L",
      estimated_tokens: 43_000,
      estimated_hours: 15,
    };
    const supportingTask: TokenForgeTask = {
      ...strongTask("supporting-work"),
      estimated_tokens: 2_000,
      estimated_hours: 0.5,
    };
    const result = assessAndOrderTokenForgePlan(
      concentratedInput,
      planWith([concentratedTask, supportingTask]),
    );
    const assessment = result.quality.tasks.find(
      (task) => task.task_id === "concentrated-work",
    );
    const budgetRule = assessment?.rules.find(
      (rule) => rule.rule_id === "QF-Q06",
    );

    expect(assessment?.status).toBe("review");
    expect(budgetRule).toMatchObject({
      status: "warning",
      points: 0,
      max_points: 15,
    });
  });

  it("rejects an invalid dependency graph before scoring", () => {
    expect(() =>
      assessAndOrderTokenForgePlan(
        input,
        planWith([strongTask("blocked-work", ["missing-work"])]),
      ),
    ).toThrow(/dependencies must reference tasks/);
  });

  it("does not copy goals or repository URLs into quality explanations", () => {
    const privateContext = "must-not-cross-quality-boundary";
    const result = assessAndOrderTokenForgePlan(
      {
        ...input,
        goal: `为合成项目完成可验证功能，但不复制 ${privateContext}`,
        repository_url: `https://github.com/acme/${privateContext}`,
      },
      planWith([strongTask("quality-core")]),
      { repository_status: "summarized" },
    );

    expect(JSON.stringify(result.quality)).not.toContain(privateContext);
    expect(result.quality.evidence.rule_id).toBe("QF-E02");
  });
});
