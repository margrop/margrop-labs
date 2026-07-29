import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "./interview-contracts";
import {
  InterviewMatchError,
  buildInterviewMatchResult,
  validateInterviewMatchResult,
} from "./interview-matching";

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

describe("Interview Workbench P5-002 deterministic matching", () => {
  it("reproduces the synthetic result fixture with complete references", async () => {
    const bundle = await loadBundle();
    const expected = await readFixture("match.valid.json");
    const result = buildInterviewMatchResult(bundle, "match-synthetic-001");

    expect(result).toEqual(expected);
    expect(validateInterviewMatchResult(expected, bundle)).toEqual(expected);
  });

  it("keeps unknown requirements out of numeric scores and requires human review", async () => {
    const result = buildInterviewMatchResult(await loadBundle());

    expect(result.requirement_results[0]).toMatchObject({
      status: "direct",
      score: 100,
      evidence_ids: ["evidence-platform-java"],
    });
    expect(result.requirement_results[1]).toMatchObject({
      status: "unknown",
      score: null,
      evidence_ids: [],
    });
    expect(result.overall).toMatchObject({
      match_band: "partial_match",
      unknown_requirement_count: 3,
      conflict_requirement_count: 0,
    });
    expect(result.human_review).toEqual({
      required: true,
      reasons: ["unknown_requirements", "no_automatic_decision"],
    });
  });

  it("gives conflict precedence and preserves partial evidence references", async () => {
    const bundle = await loadBundle();
    const result = buildInterviewMatchResult({
      ...bundle,
      evidence: [
        ...bundle.evidence,
        {
          schema_version: "1.0",
          sensitivity: "sensitive",
          evidence_id: "evidence-partial-distributed",
          source: "resume",
          kind: "project",
          summary: "合成项目记录部分覆盖协议、重试和服务治理实践。",
          requirement_ids: ["requirement-distributed-systems"],
          support: "partial",
        },
        {
          schema_version: "1.0",
          sensitivity: "sensitive",
          evidence_id: "evidence-conflict-robotics",
          source: "interview_record",
          kind: "unknown",
          summary: "合成面试记录与简历对机器人云平台经验的描述存在待核对冲突。",
          requirement_ids: ["requirement-robotics-cloud"],
          support: "conflict",
        },
      ],
    });

    expect(result.requirement_results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement_id: "requirement-distributed-systems",
          status: "partial",
          score: 60,
          evidence_ids: ["evidence-partial-distributed"],
        }),
        expect.objectContaining({
          requirement_id: "requirement-robotics-cloud",
          status: "conflict",
          score: null,
          evidence_ids: ["evidence-conflict-robotics"],
        }),
      ]),
    );
    expect(result.overall.match_band).toBe("conflicted");
    expect(result.human_review.reasons).toEqual(
      expect.arrayContaining(["conflicting_evidence", "no_automatic_decision"]),
    );
    expect(result.conflicts).toEqual([
      {
        requirement_id: "requirement-robotics-cloud",
        evidence_ids: ["evidence-conflict-robotics"],
      },
    ]);
  });

  it("rejects unknown fields and inconsistent references without echoing sensitive values", async () => {
    const bundle = await loadBundle();
    const result = buildInterviewMatchResult(bundle);
    expect(() =>
      validateInterviewMatchResult(
        { ...result, internal_note: "operator@example.com" },
        bundle,
      ),
    ).toThrow(/additional properties/);

    const inconsistent = {
      ...result,
      unknowns: [],
    };
    let error: unknown;
    try {
      validateInterviewMatchResult(inconsistent, bundle);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InterviewMatchError);
    expect(String(error)).not.toContain("operator@example.com");
    expect(String(error)).toMatch(/unknown references/);
  });
});
