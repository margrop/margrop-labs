import { describe, expect, it } from "vitest";

import {
  buildTokenBudgetExport,
  calculateDailyBudget,
  chooseTask,
  explainTaskBand,
} from "./token-budget";

describe("chooseTask", () => {
  it("recommends a small task below 8k tokens", () => {
    expect(chooseTask(7_000, 7).label).toBe("S");
  });

  it("recommends a medium task at the 8k boundary", () => {
    expect(chooseTask(8_000, 7).label).toBe("M");
  });

  it("recommends a large task when total and daily budgets are sufficient", () => {
    expect(chooseTask(25_000, 7).label).toBe("L");
  });

  it("keeps a long-running 25k budget at medium scope", () => {
    expect(chooseTask(25_000, 30).label).toBe("M");
  });

  it("calculates a stable integer daily budget", () => {
    expect(calculateDailyBudget(12_000, 7)).toBe(1714);
    expect(calculateDailyBudget(12_000, 0)).toBe(12_000);
  });

  it("explains the visible rule threshold without relying on color", () => {
    expect(explainTaskBand(25_000, 7)).toContain("不少于 25,000");
    expect(explainTaskBand(7_000, 7)).toContain("少于 8,000");
  });

  it("exports only visible deterministic inputs and results", () => {
    const markdown = buildTokenBudgetExport(12_000, 7);

    expect(markdown).toContain("可用 Token：12,000");
    expect(markdown).toContain("建议规模：M");
    expect(markdown).toContain("未调用 AI");
    expect(markdown).not.toContain("system prompt");
    expect(markdown).not.toContain("github token");
  });
});
