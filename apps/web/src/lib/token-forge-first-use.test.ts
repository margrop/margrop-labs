import { describe, expect, it } from "vitest";

import { buildTokenForgeAgentPackage } from "./token-forge-agent-package";
import { buildTokenForgeExports } from "./token-forge-exports";
import {
  getTokenForgeFirstUseSampleForm,
  tokenForgeFirstUseSamples,
  tokenForgeFirstUseSteps,
} from "./token-forge-first-use";
import { buildTokenForgeInputFromForm } from "./token-forge-page";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

describe("Token Forge first-use samples", () => {
  it("provides exactly three distinct Token tiers with one public repository example", () => {
    expect(tokenForgeFirstUseSamples.map((sample) => sample.id)).toEqual([
      "quick-local",
      "standard-public",
      "deep-local",
    ]);
    expect(
      tokenForgeFirstUseSamples.map((sample) =>
        Number(sample.form.token_budget),
      ),
    ).toEqual([6_000, 24_000, 40_000]);
    expect(
      tokenForgeFirstUseSamples.filter(
        (sample) => sample.form.repository_url.length > 0,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "standard-public",
        repository_mode: "public-read-only",
        form: expect.objectContaining({
          repository_url: "https://github.com/margrop/margrop-labs",
        }),
      }),
    ]);
  });

  it.each(tokenForgeFirstUseSamples)(
    "turns $id into a complete local template and all three exports",
    (sample) => {
      const input = buildTokenForgeInputFromForm(
        getTokenForgeFirstUseSampleForm(sample.id),
      );
      const plan = generateTokenForgeTemplatePlan(input);
      const exports = buildTokenForgeExports(input, plan);
      const agentPackage = buildTokenForgeAgentPackage(input, plan);
      const expectedTaskCount = {
        "quick-local": 1,
        "standard-public": 1,
        "deep-local": 3,
      }[sample.id];

      expect(sample.default_mode).toBe("template");
      expect(plan.mode).toBe("template");
      expect(plan.tasks).toHaveLength(expectedTaskCount);
      expect(exports.markdown.content.length).toBeGreaterThan(0);
      expect(exports.github_issues.issues).toHaveLength(plan.tasks.length);
      expect(agentPackage.stages).toHaveLength(plan.tasks.length);
    },
  );

  it("returns a fresh form copy so UI edits cannot mutate the sample catalog", () => {
    const first = getTokenForgeFirstUseSampleForm("quick-local");
    first.goal = "这是一段只修改调用方副本的合成测试目标";
    const second = getTokenForgeFirstUseSampleForm("quick-local");

    expect(second.goal).not.toBe(first.goal);
    expect(tokenForgeFirstUseSamples[0]?.form.goal).toBe(second.goal);
  });

  it("defines a short progressive path from sample to export", () => {
    expect(tokenForgeFirstUseSteps).toEqual([
      expect.objectContaining({ id: "choose", order: 1 }),
      expect.objectContaining({ id: "generate", order: 2 }),
      expect.objectContaining({ id: "export", order: 3 }),
    ]);
    expect(
      tokenForgeFirstUseSteps.every(
        (step) => step.title.length > 0 && step.description.length > 0,
      ),
    ).toBe(true);
  });
});
