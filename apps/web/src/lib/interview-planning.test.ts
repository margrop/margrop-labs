import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "./interview-contracts";
import { buildInterviewMatchResult } from "./interview-matching";
import {
  InterviewPlanError,
  buildInterviewPlan,
  validateInterviewPlan,
} from "./interview-planning";

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
        schema_version: "1.0",
        sensitivity: "sensitive",
        ...item,
      })),
    ],
    evidence: [evidence],
  });
};

const loadMatch = async () => {
  const bundle = await loadBundle();
  return { bundle, match: buildInterviewMatchResult(bundle) };
};

describe("Interview Workbench P5-003 deterministic planning", () => {
  it("reproduces the 45-minute synthetic plan and closes every segment", async () => {
    const { bundle, match } = await loadMatch();
    const expected = await readFixture("plan.valid.json");
    const plan = buildInterviewPlan(bundle, match, {
      plan_id: "plan-synthetic-001",
    });

    expect(plan).toEqual(expected);
    expect(validateInterviewPlan(expected, bundle, match)).toEqual(expected);
    expect(
      plan.segments.reduce((total, segment) => total + segment.minutes, 0),
    ).toBe(45);
    for (const segment of plan.segments) {
      const minutes = segment.question_ids.reduce((total, questionId) => {
        const question = plan.questions.find(
          ({ question_id }) => question_id === questionId,
        );
        return total + (question?.minutes ?? 0);
      }, 0);
      expect(minutes).toBe(segment.minutes);
    }
  });

  it.each([30, 45, 60] as const)(
    "supports an exact %i-minute template without AI",
    async (duration) => {
      const { bundle, match } = await loadMatch();
      const plan = buildInterviewPlan(bundle, match, {
        duration_minutes: duration,
        mode: "candidate",
      });

      expect(plan.duration_minutes).toBe(duration);
      expect(plan.mode).toBe("candidate");
      expect(plan.candidate_preparation).toEqual({
        real_evidence_only: true,
        unknown_allowed: true,
        fabrication_allowed: false,
      });
      expect(
        plan.questions.every((question) => question.prompt.length >= 10),
      ).toBe(true);
      expect(plan.human_review.reasons).toContain("no_automatic_decision");
    },
  );

  it("allows an early gate only for explicitly selected must-have requirements", async () => {
    const base = await loadBundle();
    const firstRequirement = base.requirements[0]!;
    const requirements = base.requirements.map((requirement) =>
      requirement.requirement_id === firstRequirement.requirement_id
        ? {
            ...requirement,
            category: "must_have" as const,
            priority: "must" as const,
          }
        : requirement,
    );
    const jd = {
      ...base.jd,
      requirements: base.jd.requirements.map((requirement) =>
        requirement.requirement_id === firstRequirement.requirement_id
          ? {
              ...requirement,
              category: "must_have" as const,
              priority: "must" as const,
            }
          : requirement,
      ),
    };
    const bundle = validateInterviewInputBundle({ ...base, jd, requirements });
    const match = buildInterviewMatchResult(bundle);
    const plan = buildInterviewPlan(bundle, match, {
      duration_minutes: 60,
      early_gate_requirement_ids: [firstRequirement.requirement_id],
    });

    expect(plan.early_gate.enabled).toBe(true);
    expect(plan.early_gate.requirement_ids).toEqual([
      firstRequirement.requirement_id,
    ]);
    expect(plan.early_gate.question_ids.length).toBeGreaterThan(0);
    expect(plan.human_review.reasons).toContain("user_must_confirm_early_gate");
    expect(validateInterviewPlan(plan)).toEqual(plan);
  });

  it("rejects timing drift and unknown fields instead of silently changing the plan", async () => {
    const { bundle, match } = await loadMatch();
    const plan = buildInterviewPlan(bundle, match);
    expect(() =>
      validateInterviewPlan(
        {
          ...plan,
          segments: plan.segments.map((segment, index) =>
            index === 0
              ? { ...segment, minutes: segment.minutes + 1 }
              : segment,
          ),
        },
        bundle,
        match,
      ),
    ).toThrow(/question minutes|segment minutes/);
    expect(() =>
      validateInterviewPlan(
        { ...plan, internal_note: "operator@example.com" },
        bundle,
        match,
      ),
    ).toThrow(/additional properties/);
  });

  it("rejects a non-must-have early gate", async () => {
    const { bundle, match } = await loadMatch();
    expect(() =>
      buildInterviewPlan(bundle, match, {
        early_gate_requirement_ids: ["requirement-java-go"],
      }),
    ).toThrow(InterviewPlanError);
  });
});
