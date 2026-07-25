import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type IncidentDetectiveScoringRules,
  IncidentDetectiveScoringError,
  scoreIncidentDetectiveAttempt,
  validateIncidentDetectiveScoreResult,
  validateIncidentDetectiveScoringRules,
} from "./incident-detective-scoring";
import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

const caseUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
    import.meta.url,
  );

const readCaseFile = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(caseUrl(name), "utf8")) as T;

const loadInputs = async (): Promise<{
  scenario: IncidentDetectiveScenario;
  attempt: IncidentDetectiveAttempt;
  rules: IncidentDetectiveScoringRules;
}> => {
  const scenario = validateIncidentDetectiveScenario(
    await readCaseFile<unknown>("scenario.json"),
  );
  const attempt = validateIncidentDetectiveAttempt(
    scenario,
    await readCaseFile<unknown>("attempt.canonical.json"),
  );
  const rules = validateIncidentDetectiveScoringRules(
    scenario,
    await readCaseFile<unknown>("score-rules.internal.json"),
  );

  return { scenario, attempt, rules };
};

const scoreByDimension = (
  result: ReturnType<typeof scoreIncidentDetectiveAttempt>,
): Record<string, number> =>
  Object.fromEntries(
    result.dimensions.map((dimension) => [dimension.id, dimension.score]),
  );

describe("Incident Detective deterministic scoring", () => {
  it("scores the canonical evidence-led path at 100 without reading answer prose", async () => {
    const { attempt, rules, scenario } = await loadInputs();
    const result = scoreIncidentDetectiveAttempt(scenario, attempt, rules);

    expect(result.total_score).toBe(100);
    expect(result.max_score).toBe(100);
    expect(result.band).toBe("excellent");
    expect(scoreByDimension(result)).toEqual({
      "evidence-coverage": 35,
      "evidence-order": 20,
      "conclusion-coverage": 20,
      counterevidence: 10,
      safety: 15,
    });
    expect(JSON.stringify(result)).not.toContain("客户搜索使用前置通配符形态");
  });

  it("distinguishes valid evidence selection from evidence-first ordering", async () => {
    const { attempt, rules, scenario } = await loadInputs();
    const reordered = validateIncidentDetectiveAttempt(scenario, {
      ...attempt,
      selected_evidence_ids: [
        "prometheus-checkout-latency",
        "loki-checkout-trace",
        "mysql-query-plan",
        "stack-topology",
        "prometheus-mysql-health",
        "prometheus-connection-pressure",
      ],
    });
    const result = scoreIncidentDetectiveAttempt(scenario, reordered, rules);

    expect(scoreByDimension(result)["evidence-coverage"]).toBe(35);
    expect(scoreByDimension(result)["evidence-order"]).toBe(5);
    expect(result.total_score).toBe(85);
    expect(result.band).toBe("evidence-led");
  });

  it("scores missing counterevidence and unsafe actions independently", async () => {
    const { attempt, rules, scenario } = await loadInputs();
    const withoutCounter = validateIncidentDetectiveAttempt(scenario, {
      ...attempt,
      hypothesis: {
        ...attempt.hypothesis,
        contradicting_evidence_ids: [],
      },
    });
    const counterResult = scoreIncidentDetectiveAttempt(
      scenario,
      withoutCounter,
      rules,
    );

    expect(scoreByDimension(counterResult).counterevidence).toBe(0);
    expect(counterResult.total_score).toBe(90);

    const withRestart = validateIncidentDetectiveAttempt(scenario, {
      ...attempt,
      safety_actions: [...attempt.safety_actions, "restart_service"],
    });
    const unsafeResult = scoreIncidentDetectiveAttempt(
      scenario,
      withRestart,
      rules,
    );

    expect(scoreByDimension(unsafeResult).safety).toBe(9);
    expect(unsafeResult.total_score).toBe(94);
    expect(unsafeResult.band).toBe("evidence-led");
    expect(
      unsafeResult.dimensions
        .find(({ id }) => id === "safety")
        ?.findings.find(({ rule_id }) => rule_id === "restart-penalty"),
    ).toMatchObject({
      status: "penalty",
      points_awarded: -6,
    });
  });

  it("gives a low band to a valid attempt with only one symptom metric", async () => {
    const { attempt, rules, scenario } = await loadInputs();
    const partial = validateIncidentDetectiveAttempt(scenario, {
      ...attempt,
      selected_evidence_ids: ["prometheus-checkout-latency"],
      spent_budget: 1,
      ordered_timeline_event_ids: [
        "application-release",
        "checkout-alert",
        "latency-rise",
      ],
      safety_actions: [],
      hypothesis: {
        ...attempt.hypothesis,
        suspected_service_ids: ["checkout-api"],
        supporting_evidence_ids: ["prometheus-checkout-latency"],
        contradicting_evidence_ids: [],
        confidence: "low",
      },
    });
    const result = scoreIncidentDetectiveAttempt(scenario, partial, rules);

    expect(result.total_score).toBe(15);
    expect(result.band).toBe("needs-evidence");
    expect(result.improvements.length).toBeGreaterThan(0);
  });

  it("is deterministic and returns a result that revalidates", async () => {
    const { attempt, rules, scenario } = await loadInputs();

    const first = scoreIncidentDetectiveAttempt(scenario, attempt, rules);
    const second = scoreIncidentDetectiveAttempt(scenario, attempt, rules);

    expect(second).toEqual(first);
    expect(validateIncidentDetectiveScoreResult(first)).toEqual(first);
  });
});

describe("Incident Detective scoring rule boundary", () => {
  it("rejects scenario mismatches, unknown references and duplicate ids", async () => {
    const { rules, scenario } = await loadInputs();

    expect(() =>
      validateIncidentDetectiveScoringRules(scenario, {
        ...rules,
        scenario_id: "another-scenario",
      }),
    ).toThrow(/validated scenario/);

    const unknownEvidence = structuredClone(rules);
    const evidenceRule = unknownEvidence.dimensions[0]?.rules[0];
    if (!evidenceRule || evidenceRule.kind !== "evidence_selected") {
      throw new Error("Test fixture requires an evidence_selected rule.");
    }
    evidenceRule.evidence_id = "missing-evidence";
    expect(() =>
      validateIncidentDetectiveScoringRules(scenario, unknownEvidence),
    ).toThrow(/scenario evidence/);

    const duplicateRules = structuredClone(rules);
    const firstRule = duplicateRules.dimensions[0]?.rules[0];
    const secondRule = duplicateRules.dimensions[0]?.rules[1];
    if (!firstRule || !secondRule) {
      throw new Error("Test fixture requires two scoring rules.");
    }
    secondRule.id = firstRule.id;
    expect(() =>
      validateIncidentDetectiveScoringRules(scenario, duplicateRules),
    ).toThrow(/rule ids must be unique/);
  });

  it("requires each positive rule sum and the complete score to equal declared maxima", async () => {
    const { rules, scenario } = await loadInputs();
    const dimensionMismatch = structuredClone(rules);
    dimensionMismatch.dimensions[0]!.max_points = 34;

    expect(() =>
      validateIncidentDetectiveScoringRules(scenario, dimensionMismatch),
    ).toThrow(/positive rule points must equal/);

    const totalMismatch = structuredClone(rules);
    const safety = totalMismatch.dimensions.find(({ id }) => id === "safety");
    if (!safety) {
      throw new Error("Test fixture requires the safety dimension.");
    }
    safety.max_points = 14;
    const leastPrivilege = safety.rules.find(
      ({ id }) => id === "least-privilege-selected",
    );
    if (!leastPrivilege || leastPrivilege.kind !== "safety_selected") {
      throw new Error("Test fixture requires least-privilege scoring.");
    }
    leastPrivilege.points = 2;

    expect(() =>
      validateIncidentDetectiveScoringRules(scenario, totalMismatch),
    ).toThrow(/dimensions must total 100/);
  });

  it("rejects sensitive feedback without echoing it", async () => {
    const { rules, scenario } = await loadInputs();
    const rawSecret = "synthetic-score-secret-must-not-echo";
    const sensitiveRules = structuredClone(rules);
    const firstRule = sensitiveRules.dimensions[0]?.rules[0];
    if (!firstRule || firstRule.kind === "unsafe_selected") {
      throw new Error("Test fixture requires a positive scoring rule.");
    }
    firstRule.met_message = `这条评分反馈错误地包含 access_token=${rawSecret}，必须被拒绝。`;

    let error: unknown;
    try {
      validateIncidentDetectiveScoringRules(scenario, sensitiveRules);
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(IncidentDetectiveScoringError);
    expect(String(error)).not.toContain(rawSecret);
  });

  it("keeps weights out of the public scenario and score result", async () => {
    const { attempt, rules, scenario } = await loadInputs();
    const publicScenario = JSON.stringify(scenario);
    const score = scoreIncidentDetectiveAttempt(scenario, attempt, rules);

    expect(publicScenario).not.toMatch(
      /max_points|scoring|weight|required_evidence_ids|root_cause/i,
    );
    expect(() =>
      validateIncidentDetectiveScoreResult({
        ...score,
        evidence_weights: {
          "mysql-query-plan": 7,
        },
      }),
    ).toThrow(/score schema/);
  });

  it("loads separate rules in the page without importing the answer fixtures", async () => {
    const pageSource = await readFile(
      new URL("../pages/incident-detective/index.astro", import.meta.url),
      "utf8",
    );
    const componentSource = await readFile(
      new URL("../components/IncidentDetectiveWorkbench.tsx", import.meta.url),
      "utf8",
    );
    const clientSource = `${pageSource}\n${componentSource}`;

    expect(pageSource).toContain("score-rules.internal.json");
    expect(pageSource).toContain("validateIncidentDetectiveScoringRules");
    expect(clientSource).not.toMatch(
      /answer\.internal|attempt\.canonical|root_cause|required_evidence_ids/,
    );
  });

  it("has no network, storage, AI or logging side effects", async () => {
    const fetchMock = vi.fn();
    const storageMock = vi.fn();
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: storageMock,
      setItem: storageMock,
    });

    try {
      const { attempt, rules, scenario } = await loadInputs();
      scoreIncidentDetectiveAttempt(scenario, attempt, rules);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });
});
