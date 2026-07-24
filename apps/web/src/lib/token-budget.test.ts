import { describe, expect, it } from "vitest";

import { chooseTask } from "./token-budget";

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
});
