import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  InterviewContractError,
  buildInterviewBoundaryProjection,
  redactInterviewLocalText,
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

describe("Interview Workbench P5-001 contracts", () => {
  it("accepts the four synthetic v1 contracts and reconciles bundle IDs", async () => {
    const bundle = await loadBundle();

    expect(bundle.resume.sensitivity).toBe("sensitive");
    expect(bundle.jd.requirements).toHaveLength(4);
    expect(bundle.evidence[0]?.requirement_ids).toEqual([
      "requirement-java-go",
    ]);
  });

  it("rejects unknown fields and dangling evidence references", async () => {
    const resume = await readFixture("resume.valid.json");
    expect(() =>
      validateInterviewResume({
        ...(resume as object),
        full_name: "Synthetic Person",
      }),
    ).toThrow(/additional properties/);

    const bundle = await loadBundle();
    expect(() =>
      validateInterviewInputBundle({
        ...bundle,
        evidence: [
          {
            ...bundle.evidence[0],
            requirement_ids: ["unknown-requirement"],
          },
        ],
      }),
    ).toThrow(/known requirement ID/);
  });

  it("keeps the cross-boundary projection free of local identity and narratives", async () => {
    const projection = buildInterviewBoundaryProjection(await loadBundle());
    const serialized = JSON.stringify(projection);

    expect(projection.omitted_fields).toContain("resume.headline");
    expect(projection.omitted_fields).toContain("evidence[].summary");
    expect(serialized).not.toContain("云平台与机器人系统工程师");
    expect(serialized).not.toContain("报告上传成功率");
    expect(projection.resume.experience_signals[0]).not.toHaveProperty(
      "summary",
    );
    expect(projection.evidence[0]).not.toHaveProperty("summary");
    expect(serialized).not.toMatch(/name|email|phone|address|token|cookie/i);
  });

  it("redacts personal and secret patterns for local-only previews without echoing values", () => {
    const raw =
      "姓名：合成候选人，手机：13812345678，邮箱：operator@example.com，身份证：11010519491231002X，api_key=synthetic-secret-value";
    const redacted = redactInterviewLocalText(raw);

    expect(redacted.text).not.toContain("合成候选人");
    expect(redacted.text).not.toContain("13812345678");
    expect(redacted.text).not.toContain("operator@example.com");
    expect(redacted.text).not.toContain("11010519491231002X");
    expect(redacted.text).not.toContain("synthetic-secret-value");
    expect(redacted.redaction_count).toBeGreaterThanOrEqual(5);
    expect(redacted.redaction_kinds).toEqual(
      expect.arrayContaining([
        "name",
        "contact",
        "national-id",
        "email",
        "token",
      ]),
    );
  });

  it("does not classify missing evidence as a negative fact", async () => {
    const bundle = await loadBundle();
    const unknownEvidence = {
      ...bundle.evidence[0],
      evidence_id: "evidence-unknown",
      support: "unknown",
      kind: "unknown",
      summary: "该项在当前材料中未被覆盖，需要面试进一步验证。",
    } as const;
    const validated = validateInterviewEvidence(unknownEvidence);

    expect(validated.support).toBe("unknown");
    expect(validated.kind).toBe("unknown");
  });

  it("does not echo raw sensitive values in contract errors", () => {
    const raw = "operator@example.com";
    let error: unknown;
    try {
      validateInterviewRequirement({
        schema_version: "1.0",
        sensitivity: "sensitive",
        requirement_id: "requirement-bad",
        category: "technical",
        priority: "must",
        statement: raw,
        evidence_signals: [],
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InterviewContractError);
    expect(String(error)).not.toContain(raw);
  });
});
