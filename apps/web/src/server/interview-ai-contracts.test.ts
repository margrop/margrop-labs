import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildInterviewAiConclusionInput,
  buildInterviewAiMatchInput,
  buildInterviewAiPlanInput,
  validateInterviewAiConclusionOutput,
  validateInterviewAiMatchOutput,
  validateInterviewAiPlanOutput,
  validateInterviewAiMatchInput,
} from "./interview-ai-contracts";
import {
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "../lib/interview-contracts";
import { buildInterviewMatchResult } from "../lib/interview-matching";
import {
  buildInterviewPlan,
  validateInterviewPlan,
} from "../lib/interview-planning";
import {
  validateInterviewConclusion,
  validateInterviewRecord,
} from "../lib/interview-recording";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/interview-workbench/fixtures/${name}`,
    import.meta.url,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadBundle = async () => {
  const resume = validateInterviewResume(
    await readFixture("resume.valid.json"),
  );
  const jd = validateInterviewJobDescription(
    await readFixture("jd.valid.json"),
  );
  const requirement = validateInterviewRequirement(
    await readFixture("requirement.valid.json"),
  );
  const evidence = validateInterviewEvidence(
    await readFixture("evidence.valid.json"),
  );
  return validateInterviewInputBundle({
    resume,
    jd,
    requirements: [
      requirement,
      ...jd.requirements.slice(1).map((item) => ({
        schema_version: "1.0" as const,
        sensitivity: "sensitive" as const,
        ...item,
      })),
    ],
    evidence: [evidence],
  });
};

describe("Interview AI operation contracts", () => {
  it("builds a minimal redacted boundary without narrative fields", async () => {
    const bundle = await loadBundle();
    const input = buildInterviewAiMatchInput(bundle);
    expect(validateInterviewAiMatchInput(input)).toEqual(input);
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain("负责任务调度");
    expect(serialized).not.toContain("能够使用 Java、Go");
    expect(serialized).not.toContain("姓名:");
    expect(serialized).not.toContain("email");
    expect(input.safeguards).toEqual({
      unknown_is_not_negative: true,
      protected_attribute_inference: false,
      automatic_decision: false,
    });
  });

  it("accepts deterministic match, plan and conclusion outputs", async () => {
    const bundle = await loadBundle();
    const match = buildInterviewMatchResult(bundle);
    const matchInput = buildInterviewAiMatchInput(bundle);
    expect(validateInterviewAiMatchOutput(match)).toEqual(match);

    const planInput = buildInterviewAiPlanInput(bundle, match, {
      mode: "interviewer",
      duration_minutes: 45,
    });
    const plan = buildInterviewPlan(bundle, match, {
      plan_id: "plan-ai-contract-test",
      mode: "interviewer",
      duration_minutes: 45,
    });
    expect(validateInterviewAiPlanOutput(plan, planInput)).toEqual(plan);

    const fixturePlan = validateInterviewPlan(
      await readFixture("plan.valid.json"),
    );
    const record = validateInterviewRecord(
      await readFixture("record.valid.json"),
      fixturePlan,
    );
    const conclusion = validateInterviewConclusion(
      await readFixture("conclusion.valid.json"),
      record,
      fixturePlan,
    );
    const conclusionInput = buildInterviewAiConclusionInput(
      fixturePlan,
      record,
    );
    expect(
      validateInterviewAiConclusionOutput(conclusion, conclusionInput),
    ).toEqual(conclusion);
    expect(matchInput.boundary.omitted_fields).toContain("evidence[].summary");
  });

  it("rejects selected early-gate drift and unsafe conclusion references", async () => {
    const bundle = await loadBundle();
    const match = buildInterviewMatchResult(bundle);
    const planInput = buildInterviewAiPlanInput(bundle, match, {
      early_gate_requirement_ids: ["requirement-java-go"],
    });
    const plan = buildInterviewPlan(bundle, match, {
      plan_id: "plan-ai-contract-test-gate",
    });
    expect(() => validateInterviewAiPlanOutput(plan, planInput)).toThrow(
      /early gate/i,
    );

    const fixturePlan = validateInterviewPlan(
      await readFixture("plan.valid.json"),
    );
    const record = validateInterviewRecord(
      await readFixture("record.valid.json"),
      fixturePlan,
    );
    const input = buildInterviewAiConclusionInput(fixturePlan, record);
    const conclusion = validateInterviewConclusion(
      await readFixture("conclusion.valid.json"),
      record,
      fixturePlan,
    );
    expect(() =>
      validateInterviewAiConclusionOutput(
        {
          ...conclusion,
          judgments: conclusion.judgments.map((judgment, index) =>
            index === 0
              ? { ...judgment, fact_ids: ["fact-does-not-exist"] }
              : judgment,
          ),
        },
        input,
      ),
    ).toThrow(/unknown record or evidence/i);
  });
});
