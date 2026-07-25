import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type IncidentDetectiveCaseBundle,
  IncidentDetectiveCaseError,
  validateIncidentDetectiveAnswerDraft,
  validateIncidentDetectiveCaseBundle,
} from "./incident-detective-case";
import {
  type IncidentDetectiveScenario,
  type IncidentEvidence,
} from "./incident-detective-contracts";

const caseUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
    import.meta.url,
  );

const readCaseFile = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(caseUrl(name), "utf8")) as T;

const loadCase = async (): Promise<IncidentDetectiveCaseBundle> =>
  validateIncidentDetectiveCaseBundle(
    await readCaseFile<unknown>("scenario.json"),
    await readCaseFile<unknown>("answer.internal.json"),
    await readCaseFile<unknown>("attempt.canonical.json"),
  );

const evidenceById = (
  scenario: IncidentDetectiveScenario,
  evidenceId: string,
): IncidentEvidence => {
  const evidence = scenario.evidence.find(({ id }) => id === evidenceId);
  if (!evidence) {
    throw new Error(`Case fixture requires evidence ${evidenceId}.`);
  }
  return evidence;
};

describe("Incident Detective first complete case", () => {
  it("validates the scenario, independent answer and canonical attempt", async () => {
    const bundle = await loadCase();
    const totalEvidenceCost = bundle.scenario.evidence.reduce(
      (total, evidence) => total + evidence.acquisition_cost,
      0,
    );

    expect(bundle.scenario.id).toBe("mysql-leading-wildcard");
    expect(bundle.scenario.evidence).toHaveLength(10);
    expect(bundle.scenario.evidence_budget).toBe(9);
    expect(totalEvidenceCost).toBe(13);
    expect(bundle.canonical_attempt.spent_budget).toBe(9);
    expect(
      new Set(bundle.scenario.evidence.map(({ source }) => source)),
    ).toEqual(new Set(["topology", "prometheus", "loki", "mysql", "runbook"]));
  });

  it("keeps the public scenario free of answers and scoring metadata", async () => {
    const scenario =
      await readCaseFile<IncidentDetectiveScenario>("scenario.json");
    const serialized = JSON.stringify(scenario);

    expect(serialized).not.toMatch(
      /"(?:answer|ground_truth|rubric|score|weight)"\s*:/i,
    );
    expect(scenario).not.toHaveProperty("root_cause");
    expect(scenario).not.toHaveProperty("required_evidence_ids");
  });

  it("correlates Prometheus, Loki and MySQL without high-cardinality labels or writes", async () => {
    const { scenario } = await loadCase();
    const lokiTrace = evidenceById(scenario, "loki-checkout-trace");
    if (lokiTrace.data.kind !== "log") {
      throw new Error("Case requires Loki log evidence.");
    }

    expect(lokiTrace.data.stream).toBe(
      '{service="checkout-api", environment="synthetic"}',
    );
    expect(lokiTrace.data.stream).not.toMatch(
      /trace|order|customer|email|user/i,
    );
    expect(
      lokiTrace.data.entries.filter(({ message }) =>
        message.includes("demo-trace-7f3a"),
      ),
    ).toHaveLength(lokiTrace.data.entries.length);

    const metricEvidence = scenario.evidence.filter(
      ({ data }) => data.kind === "metric",
    );
    for (const evidence of metricEvidence) {
      if (evidence.data.kind !== "metric") {
        continue;
      }
      for (const series of evidence.data.series) {
        expect(Object.keys(series.labels).join(" ")).not.toMatch(
          /trace|order|customer|email|user/i,
        );
        expect(Object.values(series.labels).join(" ")).not.toMatch(
          /demo-trace|@/i,
        );
      }
    }

    const mysqlEvidence = scenario.evidence.filter(
      ({ source }) => source === "mysql",
    );
    expect(mysqlEvidence).toHaveLength(2);
    for (const evidence of mysqlEvidence) {
      if (evidence.data.kind !== "table") {
        throw new Error("MySQL case evidence must be tabular.");
      }
      expect(evidence.data.query).toMatch(/^(?:SELECT|EXPLAIN)\b/i);
      expect(evidence.data.query).not.toMatch(
        /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i,
      );
    }

    const queryPlan = evidenceById(scenario, "mysql-query-plan");
    if (queryPlan.data.kind !== "table") {
      throw new Error("Case requires a tabular query plan.");
    }
    expect(queryPlan.data.query).toContain("LIKE ?");
    expect(queryPlan.data.query).not.toContain("@");
  });

  it("requires explicit counterevidence and keeps it disjoint from support", async () => {
    const { answer } = await loadCase();

    expect(answer.counterevidence_ids.length).toBeGreaterThanOrEqual(1);
    expect(
      answer.counterevidence_ids.filter((evidenceId) =>
        answer.supporting_evidence_ids.includes(evidenceId),
      ),
    ).toEqual([]);
    expect(answer.counterevidence_ids).toContain("prometheus-mysql-health");
    expect(answer.counterevidence_ids).toContain("prometheus-host-cpu");
  });

  it("fits the canonical evidence chain exactly into budget and preserves safety", async () => {
    const { answer, canonical_attempt: attempt, scenario } = await loadCase();
    const selectedCost = attempt.selected_evidence_ids.reduce(
      (total, evidenceId) =>
        total + evidenceById(scenario, evidenceId).acquisition_cost,
      0,
    );

    expect(selectedCost).toBe(scenario.evidence_budget);
    expect(attempt.selected_evidence_ids).toEqual(
      expect.arrayContaining(answer.required_evidence_ids),
    );
    expect(attempt.safety_actions).toEqual(
      expect.arrayContaining([
        "read_only_first",
        "preserve_evidence",
        "least_privilege",
        "request_approval",
      ]),
    );
    expect(attempt.safety_actions).not.toContain("production_write");
    expect(attempt.safety_actions).not.toContain("restart_service");
    expect(attempt.safety_actions).not.toContain("delete_data");
  });
});

describe("Incident Detective internal answer boundary", () => {
  it("rejects scenario mismatches, unknown references and ambiguous evidence roles", async () => {
    const { answer, scenario } = await loadCase();

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        scenario_id: "another-scenario",
      }),
    ).toThrow(/reference the validated scenario/);

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        required_evidence_ids: ["missing-evidence"],
        supporting_evidence_ids: ["missing-evidence"],
      }),
    ).toThrow(/Required evidence must exist/);

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        required_evidence_ids: ["prometheus-checkout-latency"],
        supporting_evidence_ids: ["loki-checkout-trace"],
      }),
    ).toThrow(/subset of supporting evidence/);

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        counterevidence_ids: [
          ...answer.counterevidence_ids,
          "prometheus-checkout-latency",
        ],
      }),
    ).toThrow(/must be disjoint/);
  });

  it("rejects scores and weights so the draft cannot silently become a rubric", async () => {
    const { answer, scenario } = await loadCase();

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        score: 100,
      }),
    ).toThrow(/repository-only schema/);

    expect(() =>
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        evidence_weights: {
          "mysql-query-plan": 10,
        },
      }),
    ).toThrow(/repository-only schema/);
  });

  it("rejects Secret material without echoing it", async () => {
    const { answer, scenario } = await loadCase();
    const rawSecret = "synthetic-case-secret-must-not-echo";
    let error: unknown;

    try {
      validateIncidentDetectiveAnswerDraft(scenario, {
        ...answer,
        root_cause: {
          ...answer.root_cause,
          summary: `这是长度足够的内部答案，但错误地包含 access_token=${rawSecret}，必须在边界处被拒绝。`,
        },
      });
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeDefined();
    expect(String(error)).not.toContain(rawSecret);
  });
});

describe("Incident Detective complete case invariants", () => {
  it("requires evidence tradeoffs beyond the available budget", async () => {
    const { answer, canonical_attempt: attempt, scenario } = await loadCase();
    const noTradeoff = structuredClone(scenario);
    noTradeoff.evidence_budget = 13;

    expect(() =>
      validateIncidentDetectiveCaseBundle(noTradeoff, answer, attempt),
    ).toThrow(/force at least one evidence tradeoff/);
  });

  it("requires the canonical attempt to include root-cause evidence", async () => {
    const { answer, canonical_attempt: attempt, scenario } = await loadCase();
    const incomplete = structuredClone(attempt);
    incomplete.selected_evidence_ids = incomplete.selected_evidence_ids.filter(
      (evidenceId) => evidenceId !== "mysql-query-plan",
    );
    incomplete.spent_budget = 7;
    incomplete.ordered_timeline_event_ids =
      incomplete.ordered_timeline_event_ids.filter(
        (eventId) => eventId !== "query-plan-full-scan",
      );
    incomplete.hypothesis.supporting_evidence_ids =
      incomplete.hypothesis.supporting_evidence_ids.filter(
        (evidenceId) => evidenceId !== "mysql-query-plan",
      );

    expect(() =>
      validateIncidentDetectiveCaseBundle(scenario, answer, incomplete),
    ).toThrow(/select every required evidence item/);
  });

  it("requires the complete read-only safety path", async () => {
    const { answer, canonical_attempt: attempt, scenario } = await loadCase();
    const unsafe = structuredClone(attempt);
    unsafe.safety_actions = unsafe.safety_actions.filter(
      (action) => action !== "request_approval",
    );

    expect(() =>
      validateIncidentDetectiveCaseBundle(scenario, answer, unsafe),
    ).toThrow(/complete read-only safety path/);
  });

  it("reports case invariant failures with the dedicated error type", async () => {
    const { answer, canonical_attempt: attempt, scenario } = await loadCase();
    const noTradeoff = structuredClone(scenario);
    noTradeoff.evidence_budget = 13;

    expect(() =>
      validateIncidentDetectiveCaseBundle(noTradeoff, answer, attempt),
    ).toThrow(IncidentDetectiveCaseError);
  });

  it("has no network, storage or logging side effects", async () => {
    const fetchMock = vi.fn();
    const storageMock = vi.fn();
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: storageMock,
      setItem: storageMock,
    });

    try {
      await loadCase();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });
});
