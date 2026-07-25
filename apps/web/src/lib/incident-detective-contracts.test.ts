import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  type IncidentEvidence,
  IncidentDetectiveContractError,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/fixtures/${name}`,
    import.meta.url,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadScenario = async (): Promise<IncidentDetectiveScenario> =>
  validateIncidentDetectiveScenario(await readFixture("scenario.valid.json"));

const loadAttempt = async (
  scenario: IncidentDetectiveScenario,
): Promise<IncidentDetectiveAttempt> =>
  validateIncidentDetectiveAttempt(
    scenario,
    await readFixture("attempt.valid.json"),
  );

const evidenceById = (
  scenario: IncidentDetectiveScenario,
  evidenceId: string,
): IncidentEvidence => {
  const evidence = scenario.evidence.find(({ id }) => id === evidenceId);
  if (!evidence) {
    throw new Error(`Test fixture requires evidence ${evidenceId}.`);
  }
  return evidence;
};

describe("Incident Detective scenario v1", () => {
  it("accepts the public synthetic scenario without an answer or rubric", async () => {
    const scenario = await loadScenario();

    expect(scenario.schema_version).toBe("1.0");
    expect(scenario.evidence.map(({ source }) => source)).toEqual([
      "prometheus",
      "loki",
      "mysql",
    ]);
    expect(scenario.timeline[0]?.visibility).toBe("initial");
    expect(JSON.stringify(scenario)).not.toMatch(
      /ground.?truth|rubric|answer/i,
    );
  });

  it("rejects answer and scoring fields from the public scenario", async () => {
    const scenario = await loadScenario();

    expect(() =>
      validateIncidentDetectiveScenario({
        ...scenario,
        ground_truth: {
          root_cause: "must-not-enter-the-public-contract",
        },
      }),
    ).toThrow(/additional properties/);
  });

  it("requires evidence source and payload kind to agree", async () => {
    const scenario = structuredClone(await loadScenario());
    evidenceById(scenario, "prometheus-latency").source = "mysql";

    expect(() => validateIncidentDetectiveScenario(scenario)).toThrow(
      /incident-detective-scenario-v1 validation failed/,
    );
  });

  it("rejects duplicate ids and missing service references", async () => {
    const duplicateServices = structuredClone(await loadScenario());
    duplicateServices.services[1]!.id = duplicateServices.services[0]!.id;

    expect(() => validateIncidentDetectiveScenario(duplicateServices)).toThrow(
      /service ids must be unique/,
    );

    const missingService = structuredClone(await loadScenario());
    evidenceById(missingService, "mysql-processlist").service_id =
      "missing-service";

    expect(() => validateIncidentDetectiveScenario(missingService)).toThrow(
      /service references must exist/,
    );
  });

  it("rejects missing, cyclic and over-budget evidence unlock paths", async () => {
    const missing = structuredClone(await loadScenario());
    evidenceById(missing, "loki-timeouts").unlocks_after = ["missing-evidence"];
    expect(() => validateIncidentDetectiveScenario(missing)).toThrow(
      /prerequisites must reference/,
    );

    const cyclic = structuredClone(await loadScenario());
    evidenceById(cyclic, "prometheus-latency").unlocks_after = [
      "loki-timeouts",
    ];
    expect(() => validateIncidentDetectiveScenario(cyclic)).toThrow(
      /must not contain a cycle/,
    );

    const overBudget = structuredClone(await loadScenario());
    overBudget.evidence_budget = 2;
    expect(() => validateIncidentDetectiveScenario(overBudget)).toThrow(
      /unlock path must fit/,
    );
  });

  it("keeps evidence timestamps inside the incident window and ordered", async () => {
    const outsideWindow = structuredClone(await loadScenario());
    const metric = evidenceById(outsideWindow, "prometheus-latency").data;
    if (metric.kind !== "metric") {
      throw new Error("Test fixture requires metric evidence.");
    }
    metric.series[0]!.points[0]!.timestamp = "2026-04-18T09:49:00Z";

    expect(() => validateIncidentDetectiveScenario(outsideWindow)).toThrow(
      /inside the incident window/,
    );

    const unordered = structuredClone(await loadScenario());
    unordered.timeline[1]!.occurred_at = "2026-04-18T09:54:00Z";
    expect(() => validateIncidentDetectiveScenario(unordered)).toThrow(
      /timeline must be in chronological order/i,
    );
  });

  it("requires table rows to match columns", async () => {
    const scenario = structuredClone(await loadScenario());
    const table = evidenceById(scenario, "mysql-processlist").data;
    if (table.kind !== "table") {
      throw new Error("Test fixture requires table evidence.");
    }
    table.rows[0]!.pop();

    expect(() => validateIncidentDetectiveScenario(scenario)).toThrow(
      /rows must match/,
    );
  });

  it("rejects real network identifiers and Secret material without echoing values", async () => {
    const realHost = "database.internal";
    const privateAddress = "10.20.30.40";
    const networkScenario = structuredClone(await loadScenario());
    networkScenario.summary = `这是一个满足字段长度要求的合成说明，但错误地引用 ${realHost} 和 ${privateAddress}。`;

    let networkError: unknown;
    try {
      validateIncidentDetectiveScenario(networkScenario);
    } catch (error) {
      networkError = error;
    }
    expect(networkError).toBeInstanceOf(IncidentDetectiveContractError);
    expect(String(networkError)).not.toContain(realHost);
    expect(String(networkError)).not.toContain(privateAddress);

    const rawSecret = "synthetic-secret-must-not-echo";
    const secretScenario = structuredClone(await loadScenario());
    secretScenario.summary = `这是一个满足字段长度要求的合成说明，但错误地包含 api_key=${rawSecret}。`;

    let secretError: unknown;
    try {
      validateIncidentDetectiveScenario(secretScenario);
    } catch (error) {
      secretError = error;
    }
    expect(secretError).toBeInstanceOf(IncidentDetectiveContractError);
    expect(String(secretError)).not.toContain(rawSecret);
  });
});

describe("Incident Detective attempt v1", () => {
  it("accepts the synthetic attempt and reconciles evidence budget", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);

    expect(attempt.spent_budget).toBe(4);
    expect(attempt.selected_evidence_ids).toHaveLength(3);
    expect(attempt.hypothesis.confidence).toBe("medium");
  });

  it("rejects a mismatched scenario or unknown evidence", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        scenario_id: "another-scenario",
      }),
    ).toThrow(/scenario id must match/);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        selected_evidence_ids: ["missing-evidence"],
        spent_budget: 1,
      }),
    ).toThrow(/must reference the validated scenario/);
  });

  it("enforces prerequisite order and exact budget", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        selected_evidence_ids: [
          "loki-timeouts",
          "prometheus-latency",
          "mysql-processlist",
        ],
      }),
    ).toThrow(/respect prerequisite order/);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        spent_budget: 3,
      }),
    ).toThrow(/budget must exactly match/);
  });

  it("only lets selected evidence support or contradict a hypothesis", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);
    const partialAttempt = {
      ...attempt,
      selected_evidence_ids: ["prometheus-latency"],
      spent_budget: 1,
      ordered_timeline_event_ids: [
        "config-change",
        "latency-alert",
        "metric-correlation",
      ],
      hypothesis: {
        ...attempt.hypothesis,
        supporting_evidence_ids: ["prometheus-latency"],
        contradicting_evidence_ids: ["loki-timeouts"],
      },
    };

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, partialAttempt),
    ).toThrow(/Contradicting evidence must reference/);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        hypothesis: {
          ...attempt.hypothesis,
          contradicting_evidence_ids: ["prometheus-latency"],
        },
      }),
    ).toThrow(/cannot both support and contradict/);
  });

  it("does not reveal timeline events from evidence the user did not select", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);

    expect(() =>
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        selected_evidence_ids: ["prometheus-latency"],
        spent_budget: 1,
        hypothesis: {
          ...attempt.hypothesis,
          supporting_evidence_ids: ["prometheus-latency"],
        },
      }),
    ).toThrow(/cannot reveal events from unselected evidence/);
  });

  it("rejects sensitive hypothesis text without returning it", async () => {
    const scenario = await loadScenario();
    const attempt = await loadAttempt(scenario);
    const rawSecret = "synthetic-user-secret-must-not-echo";

    let error: unknown;
    try {
      validateIncidentDetectiveAttempt(scenario, {
        ...attempt,
        hypothesis: {
          ...attempt.hypothesis,
          summary: `这是一段满足长度要求、但包含 access_token=${rawSecret} 的用户假设，必须被合同拒绝。`,
        },
      });
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(IncidentDetectiveContractError);
    expect(String(error)).not.toContain(rawSecret);
  });

  it("has no network, storage or logging side effects", async () => {
    const fetchMock = vi.fn();
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    try {
      const scenario = await loadScenario();
      await loadAttempt(scenario);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });
});
