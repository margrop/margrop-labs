import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type IncidentDetectiveHypothesisDraft,
  IncidentDetectiveSessionError,
  buildIncidentDetectiveAttempt,
  createIncidentDetectiveSession,
  getIncidentEvidenceStates,
  getVisibleIncidentTimeline,
  selectIncidentEvidence,
} from "./incident-detective-session";
import {
  type IncidentDetectiveScenario,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

const scenarioUrl = new URL(
  "../../../../labs/incident-detective/cases/mysql-leading-wildcard/scenario.json",
  import.meta.url,
);

const loadScenario = async (): Promise<IncidentDetectiveScenario> =>
  validateIncidentDetectiveScenario(
    JSON.parse(await readFile(scenarioUrl, "utf8")) as unknown,
  );

const hypothesisDraft = (
  override: Partial<IncidentDetectiveHypothesisDraft> = {},
): IncidentDetectiveHypothesisDraft => ({
  summary:
    "MySQL 仍然存活，但搜索查询的执行时间增长并导致连接堆积，最终触发结账接口超时。",
  suspected_service_ids: ["checkout-api", "orders-mysql"],
  supporting_evidence_ids: [
    "prometheus-checkout-latency",
    "loki-checkout-trace",
    "mysql-query-plan",
  ],
  contradicting_evidence_ids: ["prometheus-mysql-health"],
  confidence: "high",
  next_action:
    "先在合成环境验证查询改写和查询计划，再申请人工批准任何生产变更。",
  safety_actions: [
    "read_only_first",
    "preserve_evidence",
    "least_privilege",
    "request_approval",
  ],
  ...override,
});

const selectCanonicalEvidence = (
  scenario: IncidentDetectiveScenario,
): ReturnType<typeof createIncidentDetectiveSession> => {
  let session = createIncidentDetectiveSession(scenario);
  for (const evidenceId of [
    "stack-topology",
    "prometheus-mysql-health",
    "prometheus-checkout-latency",
    "prometheus-connection-pressure",
    "loki-checkout-trace",
    "mysql-query-plan",
  ]) {
    session = selectIncidentEvidence(scenario, session, evidenceId);
  }
  return session;
};

describe("Incident Detective evidence session", () => {
  it("starts with only prerequisite-free evidence available", async () => {
    const scenario = await loadScenario();
    const session = createIncidentDetectiveSession(scenario);
    const states = getIncidentEvidenceStates(scenario, session);

    expect(session).toEqual({
      scenario_id: "mysql-leading-wildcard",
      selected_evidence_ids: [],
      spent_budget: 0,
    });
    expect(
      states.find(({ evidence }) => evidence.id === "stack-topology"),
    ).toMatchObject({
      status: "available",
      remaining_budget: 9,
    });
    expect(
      states.find(({ evidence }) => evidence.id === "loki-checkout-trace"),
    ).toMatchObject({
      status: "locked",
      missing_prerequisite_ids: ["prometheus-checkout-latency"],
    });
    expect(
      states.find(({ evidence }) => evidence.id === "mysql-query-plan"),
    ).toMatchObject({
      status: "locked",
      missing_prerequisite_ids: ["loki-checkout-trace"],
    });
  });

  it("unlocks evidence step by step and never refunds acquired evidence", async () => {
    const scenario = await loadScenario();
    let session = createIncidentDetectiveSession(scenario);

    session = selectIncidentEvidence(
      scenario,
      session,
      "prometheus-checkout-latency",
    );
    expect(session.spent_budget).toBe(1);
    expect(
      getIncidentEvidenceStates(scenario, session).find(
        ({ evidence }) => evidence.id === "loki-checkout-trace",
      )?.status,
    ).toBe("available");

    session = selectIncidentEvidence(scenario, session, "loki-checkout-trace");
    expect(session.spent_budget).toBe(3);
    expect(
      getIncidentEvidenceStates(scenario, session).find(
        ({ evidence }) => evidence.id === "mysql-query-plan",
      )?.status,
    ).toBe("available");

    expect(() =>
      selectIncidentEvidence(scenario, session, "prometheus-checkout-latency"),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "already_selected",
      }),
    );
  });

  it("rejects unknown, locked and over-budget selections with stable errors", async () => {
    const scenario = await loadScenario();
    const initial = createIncidentDetectiveSession(scenario);

    expect(() =>
      selectIncidentEvidence(scenario, initial, "missing-evidence"),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "unknown_evidence",
      }),
    );
    expect(() =>
      selectIncidentEvidence(scenario, initial, "mysql-query-plan"),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "evidence_locked",
      }),
    );

    const exhausted = selectCanonicalEvidence(scenario);
    expect(exhausted.spent_budget).toBe(scenario.evidence_budget);
    expect(
      getIncidentEvidenceStates(scenario, exhausted).find(
        ({ evidence }) => evidence.id === "prometheus-host-cpu",
      )?.status,
    ).toBe("insufficient_budget");
    expect(() =>
      selectIncidentEvidence(scenario, exhausted, "prometheus-host-cpu"),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "insufficient_budget",
      }),
    );
  });

  it("reveals only initial and acquired-evidence timeline events", async () => {
    const scenario = await loadScenario();
    const initial = createIncidentDetectiveSession(scenario);

    expect(
      getVisibleIncidentTimeline(scenario, initial).map(({ id }) => id),
    ).toEqual(["application-release", "checkout-alert"]);

    const withTrace = selectIncidentEvidence(
      scenario,
      selectIncidentEvidence(scenario, initial, "prometheus-checkout-latency"),
      "loki-checkout-trace",
    );
    expect(
      getVisibleIncidentTimeline(scenario, withTrace).map(({ id }) => id),
    ).toEqual([
      "application-release",
      "checkout-alert",
      "latency-rise",
      "trace-slow-query",
      "trace-upstream-timeout",
    ]);
  });

  it("builds an Attempt v1 from visible evidence and timeline only", async () => {
    const scenario = await loadScenario();
    const session = selectCanonicalEvidence(scenario);
    const attempt = buildIncidentDetectiveAttempt(
      scenario,
      session,
      hypothesisDraft(),
    );

    expect(attempt.schema_version).toBe("1.0");
    expect(attempt.spent_budget).toBe(9);
    expect(attempt.selected_evidence_ids).toEqual(
      session.selected_evidence_ids,
    );
    expect(attempt.ordered_timeline_event_ids).toEqual([
      "topology-scope",
      "application-release",
      "checkout-alert",
      "mysql-still-up",
      "latency-rise",
      "connection-pressure-rise",
      "trace-slow-query",
      "trace-upstream-timeout",
      "query-plan-full-scan",
    ]);
  });

  it("rejects unselected, overlapping and sensitive hypothesis evidence", async () => {
    const scenario = await loadScenario();
    const session = selectCanonicalEvidence(scenario);

    expect(() =>
      buildIncidentDetectiveAttempt(
        scenario,
        session,
        hypothesisDraft({
          supporting_evidence_ids: ["prometheus-host-cpu"],
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "invalid_attempt",
      }),
    );

    expect(() =>
      buildIncidentDetectiveAttempt(
        scenario,
        session,
        hypothesisDraft({
          contradicting_evidence_ids: ["prometheus-checkout-latency"],
        }),
      ),
    ).toThrow(
      expect.objectContaining<Partial<IncidentDetectiveSessionError>>({
        code: "invalid_attempt",
      }),
    );

    const rawSecret = "synthetic-session-secret-must-not-echo";
    let error: unknown;
    try {
      buildIncidentDetectiveAttempt(
        scenario,
        session,
        hypothesisDraft({
          summary: `这段满足长度要求的假设错误地包含 access_token=${rawSecret}，必须在本地合同边界被拒绝。`,
        }),
      );
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(IncidentDetectiveSessionError);
    expect(error).toMatchObject({ code: "invalid_attempt" });
    expect(String(error)).not.toContain(rawSecret);
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
      const scenario = await loadScenario();
      const session = selectCanonicalEvidence(scenario);
      buildIncidentDetectiveAttempt(scenario, session, hypothesisDraft());

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });
});

describe("Incident Detective client data boundary", () => {
  it("does not import the internal answer, canonical attempt or scoring metadata", async () => {
    const sourceUrls = [
      new URL("./incident-detective-session.ts", import.meta.url),
      new URL("../components/IncidentDetectiveWorkbench.tsx", import.meta.url),
      new URL("../pages/incident-detective/index.astro", import.meta.url),
    ];
    const sources = await Promise.all(
      sourceUrls.map((url) => readFile(url, "utf8")),
    );

    expect(sources.join("\n")).not.toMatch(
      /answer\.internal|attempt\.canonical|root_cause|required_evidence_ids|evidence_weights/i,
    );
  });
});
