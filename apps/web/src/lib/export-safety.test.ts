import { describe, expect, it } from "vitest";

import { normalizeMarkdownFileName } from "./export-safety";

describe("normalizeMarkdownFileName", () => {
  it.each([
    ["token-forge-plan.md", "token-forge-plan.md"],
    ["../../private-plan.md", "private-plan.md"],
    ["..\\..\\private-plan.md", "private-plan.md"],
    ["Plan 2026 / final?.txt", "final.md"],
    ["CON.md", "export-con.md"],
    [".env", "margrop-labs-export.md"],
    ["任务计划.md", "margrop-labs-export.md"],
    [undefined, "margrop-labs-export.md"],
  ])("normalizes %j to %s", (candidate, expected) => {
    expect(normalizeMarkdownFileName(candidate)).toBe(expected);
  });

  it("always returns a bounded Markdown filename without path separators", () => {
    const result = normalizeMarkdownFileName(
      `${"very-long-name-".repeat(20)}.html`,
    );

    expect(result.length).toBeLessThanOrEqual(75);
    expect(result).toMatch(/^[a-z0-9][a-z0-9_-]*\.md$/);
    expect(result).not.toMatch(/[\\/]/);
  });
});
