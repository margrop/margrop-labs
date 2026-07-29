import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  InterviewRecordingError,
  buildInterviewConclusion,
  validateInterviewConclusion,
  validateInterviewRecord,
} from "./interview-recording";
import { validateInterviewPlan } from "./interview-planning";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/interview-workbench/fixtures/${name}`,
    import.meta.url,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadPlan = async () =>
  validateInterviewPlan(await readFixture("plan.valid.json"));

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("Interview Workbench P5-004 recording and conclusion", () => {
  it("reproduces the synthetic record and conclusion fixtures", async () => {
    const plan = await loadPlan();
    const expectedRecord = await readFixture("record.valid.json");
    const record = validateInterviewRecord(expectedRecord, plan);
    const expectedConclusion = await readFixture("conclusion.valid.json");

    expect(record.entries).toHaveLength(4);
    expect(record.local_only).toBe(true);
    expect(record.human_review).toEqual({
      required: true,
      confirmed: false,
      reasons: ["draft_requires_user_confirmation", "no_automatic_decision"],
    });
    expect(
      validateInterviewConclusion(expectedConclusion, record, plan),
    ).toEqual(expectedConclusion);
    expect(
      buildInterviewConclusion(record, plan, "conclusion-synthetic-001"),
    ).toEqual(expectedConclusion);
  });

  it("keeps facts, counterevidence, unknowns and inference codes separate", async () => {
    const plan = await loadPlan();
    const record = validateInterviewRecord(
      await readFixture("record.valid.json"),
      plan,
    );
    const conclusion = buildInterviewConclusion(record, plan);

    expect(conclusion.judgments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requirement_id: "requirement-java-go",
          status: "supported",
          inference_code: "fact_supported",
        }),
        expect.objectContaining({
          requirement_id: "requirement-distributed-systems",
          status: "partial",
          inference_code: "partial_facts",
        }),
        expect.objectContaining({
          requirement_id: "requirement-robotics-cloud",
          status: "unknown",
          inference_code: "not_enough_evidence",
        }),
        expect.objectContaining({
          requirement_id: "requirement-collaboration",
          status: "conflict",
          inference_code: "conflicting_facts",
        }),
      ]),
    );
    expect(conclusion.overall).toMatchObject({
      status: "conflict",
      recommendation: "conflicted",
    });
    expect(conclusion.automatic_decision).toBe(false);
    expect(JSON.stringify(conclusion)).not.toContain("合成候选人");
  });

  it("rejects unanswered entries without an explicit unknown reason", async () => {
    const plan = await loadPlan();
    const record = clone(await readFixture("record.valid.json")) as {
      entries: Array<{
        response_status: string;
        unknown_reason: string | null;
      }>;
    };
    const entry = record.entries[2];
    if (!entry) {
      throw new Error("fixture entry missing");
    }
    entry.unknown_reason = null;

    expect(() => validateInterviewRecord(record, plan)).toThrow(
      /unknown reason/,
    );
  });

  it("rejects answered entries without facts, duplicate evidence IDs and confirmed drafts", async () => {
    const plan = await loadPlan();
    const source = await readFixture("record.valid.json");
    const noFacts = clone(source) as {
      entries: Array<{
        response_status: string;
        facts: unknown[];
        counterevidence: unknown[];
      }>;
    };
    const firstEntry = noFacts.entries[0];
    if (!firstEntry) {
      throw new Error("fixture entry missing");
    }
    firstEntry.facts = [];
    firstEntry.counterevidence = [];
    expect(() => validateInterviewRecord(noFacts, plan)).toThrow(
      /fact or counterevidence/,
    );

    const duplicate = clone(source) as {
      entries: Array<{ facts: Array<{ fact_id: string }> }>;
    };
    const duplicateFact = duplicate.entries[1]?.facts[0];
    const firstFact = duplicate.entries[0]?.facts[0];
    if (!duplicateFact || !firstFact) {
      throw new Error("fixture fact missing");
    }
    duplicateFact.fact_id = firstFact.fact_id;
    expect(() => validateInterviewRecord(duplicate, plan)).toThrow(
      /fact ids must be unique/,
    );

    const confirmed = clone(source) as {
      status: "draft" | "confirmed";
      human_review: { confirmed: boolean };
    };
    confirmed.status = "confirmed";
    confirmed.human_review.confirmed = true;
    expect(() => validateInterviewRecord(confirmed, plan)).toThrow(
      /every entry/,
    );
  });

  it("rejects conclusions with broken citations or inconsistent overall state without echoing sensitive text", async () => {
    const plan = await loadPlan();
    const record = validateInterviewRecord(
      await readFixture("record.valid.json"),
      plan,
    );
    const source = (await readFixture("conclusion.valid.json")) as Record<
      string,
      unknown
    >;
    const broken = clone(source) as {
      judgments: Array<{ fact_ids: string[] }>;
    };
    const firstJudgment = broken.judgments[0];
    if (!firstJudgment) {
      throw new Error("fixture judgment missing");
    }
    firstJudgment.fact_ids = ["fact-not-in-record"];
    expect(() => validateInterviewConclusion(broken, record, plan)).toThrow(
      /exist in the source record/,
    );

    const inconsistent = clone(source) as {
      overall: { status: string; recommendation: string };
    };
    inconsistent.overall.status = "partial";
    expect(() =>
      validateInterviewConclusion(inconsistent, record, plan),
    ).toThrow(/overall status/);

    const inconsistentSummary = clone(source) as {
      unknown_requirement_ids: string[];
    };
    inconsistentSummary.unknown_requirement_ids = [];
    expect(() =>
      validateInterviewConclusion(inconsistentSummary, record, plan),
    ).toThrow(/summaries must match/);

    const withUnknownField = {
      ...clone(source),
      internal_note: "operator@example.com",
    };
    let error: unknown;
    try {
      validateInterviewConclusion(withUnknownField, record, plan);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InterviewRecordingError);
    expect(String(error)).not.toContain("operator@example.com");
  });
});
