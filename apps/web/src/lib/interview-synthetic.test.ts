import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  InterviewSyntheticError,
  buildInterviewSyntheticLoop,
  renderInterviewSafeExportMarkdown,
  validateInterviewSafeExport,
  validateInterviewSyntheticLoop,
} from "./interview-synthetic";
import {
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "./interview-contracts";

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

describe("Interview Workbench P5-005 synthetic dual-role loop", () => {
  it("closes both interviewer and candidate roles without AI or network", async () => {
    const run = buildInterviewSyntheticLoop(await loadBundle());
    const loopFixture = await readFixture("loop.valid.json");
    const interviewerExport = await readFixture(
      "export-interviewer.valid.json",
    );
    const candidateExport = await readFixture("export-candidate.valid.json");

    expect(run.loop).toEqual(loopFixture);
    expect(run.roles.interviewer.plan.mode).toBe("interviewer");
    expect(run.roles.candidate.plan.mode).toBe("candidate");
    expect(run.roles.interviewer.plan.duration_minutes).toBe(45);
    expect(run.roles.candidate.plan.duration_minutes).toBe(45);
    expect(run.roles.interviewer.conclusion.overall.status).toBe("partial");
    expect(run.roles.candidate.conclusion.overall.status).toBe("partial");
    expect(run.roles.interviewer.export).toEqual(interviewerExport);
    expect(run.roles.candidate.export).toEqual(candidateExport);
    expect(validateInterviewSyntheticLoop(run.loop, run)).toEqual(run.loop);
  });

  it("keeps unknown requirements unknown and candidate preparation honest", async () => {
    const run = buildInterviewSyntheticLoop(await loadBundle());
    const candidate = run.roles.candidate;
    const unknownEntries = candidate.record.entries.filter(
      ({ response_status }) => response_status === "unknown",
    );

    expect(unknownEntries).toHaveLength(3);
    expect(unknownEntries.every(({ unknown_reason }) => unknown_reason)).toBe(
      true,
    );
    expect(candidate.plan.candidate_preparation).toEqual({
      real_evidence_only: true,
      unknown_allowed: true,
      fabrication_allowed: false,
    });
    expect(JSON.stringify(candidate.conclusion)).not.toContain("合成面试者");
  });

  it("keeps a synthetic conflict visible to the interviewer while the candidate stays unknown", async () => {
    const base = await loadBundle();
    const bundle = validateInterviewInputBundle({
      ...base,
      evidence: [
        ...base.evidence,
        {
          schema_version: "1.0",
          sensitivity: "sensitive",
          evidence_id: "evidence-conflict-synthetic",
          source: "interview_record",
          kind: "unknown",
          summary: "合成记录与现有材料需要人工核对。",
          requirement_ids: ["requirement-robotics-cloud"],
          support: "conflict",
        },
      ],
    });
    const run = buildInterviewSyntheticLoop(bundle, "loop-conflict-synthetic");

    expect(run.roles.interviewer.conclusion.overall).toMatchObject({
      status: "conflict",
      recommendation: "conflicted",
    });
    expect(run.roles.interviewer.export.conclusion.conflict_count).toBe(1);
    expect(run.roles.candidate.conclusion.overall.status).toBe("partial");
    expect(run.roles.candidate.export.conclusion.conflict_count).toBe(0);
  });

  it("exports only aggregate states and a deterministic privacy declaration", async () => {
    const run = buildInterviewSyntheticLoop(await loadBundle());
    const exported = validateInterviewSafeExport(run.roles.interviewer.export);
    const markdown = renderInterviewSafeExportMarkdown(exported);

    expect(exported.contains_personal_text).toBe(false);
    expect(exported.redacted_fields).toHaveLength(8);
    expect(markdown).toContain("仅包含结构化计数和状态");
    expect(markdown).not.toContain("operator@example.com");
    expect(markdown).not.toContain("合成面试记录观察");
    expect(JSON.stringify(exported)).not.toContain("candidate_statement");
  });

  it("rejects unsafe exports and mismatched role references without echoing sensitive values", async () => {
    const run = buildInterviewSyntheticLoop(await loadBundle());
    const unsafe = {
      ...run.roles.interviewer.export,
      contains_personal_text: true,
      internal_note: "operator@example.com",
    };
    let error: unknown;
    try {
      validateInterviewSafeExport(unsafe);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InterviewSyntheticError);
    expect(String(error)).not.toContain("operator@example.com");

    const mismatchedLoop = {
      ...run.loop,
      roles: {
        ...run.loop.roles,
        candidate: {
          ...run.loop.roles.candidate,
          export_id: run.loop.roles.interviewer.export_id,
        },
      },
    };
    expect(() => validateInterviewSyntheticLoop(mismatchedLoop)).toThrow(
      /IDs must be unique/,
    );
  });
});
