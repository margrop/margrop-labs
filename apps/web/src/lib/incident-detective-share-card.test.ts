import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createIncidentDetectiveShareCard,
  incidentDetectiveShareCardFileName,
  renderIncidentDetectiveShareCardSvg,
  validateIncidentDetectiveShareCard,
} from "./incident-detective-share-card";
import {
  scoreIncidentDetectiveAttempt,
  validateIncidentDetectiveScoringRules,
} from "./incident-detective-scoring";
import {
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

const caseUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
    import.meta.url,
  );
const readCase = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(caseUrl(name), "utf8")) as unknown;

const loadCard = async () => {
  const scenario = validateIncidentDetectiveScenario(
    await readCase("scenario.json"),
  );
  const attempt = validateIncidentDetectiveAttempt(
    scenario,
    await readCase("attempt.canonical.json"),
  );
  const rules = validateIncidentDetectiveScoringRules(
    scenario,
    await readCase("score-rules.internal.json"),
  );
  const score = scoreIncidentDetectiveAttempt(scenario, attempt, rules);
  return {
    attempt,
    card: createIncidentDetectiveShareCard(score),
    score,
  };
};

describe("Incident Detective private share card", () => {
  it("projects Score v1 to the minimal share contract", async () => {
    const { card, score } = await loadCard();

    expect(card).toEqual({
      schema_version: "1.0",
      lab_id: "incident-detective",
      scenario_id: "mysql-leading-wildcard",
      total_score: 100,
      max_score: 100,
      band: "excellent",
      dimensions: score.dimensions.map(
        ({ id, label, score: dimensionScore, max_score: maxScore }) => ({
          id,
          label,
          score: dimensionScore,
          max_score: maxScore,
        }),
      ),
      privacy: {
        synthetic_score_only: true,
        contains_attempt_text: false,
        contains_evidence_payload: false,
        contains_answer: false,
      },
    });
  });

  it("renders a deterministic standalone SVG without attempt or evidence text", async () => {
    const { attempt, card, score } = await loadCard();
    const first = renderIncidentDetectiveShareCardSvg(card);
    const second = renderIncidentDetectiveShareCardSvg(card);

    expect(second).toBe(first);
    expect(first).toContain("<svg");
    expect(first).toContain("100");
    expect(first).toContain("证据覆盖");
    expect(first).toContain("完全合成");
    expect(first).not.toContain(attempt.hypothesis.summary);
    expect(first).not.toContain(attempt.hypothesis.next_action);
    expect(first).not.toContain(score.strengths[0]);
    expect(first).not.toMatch(
      /mysql-query-plan|loki-checkout-trace|root_cause/,
    );
    expect(first).not.toMatch(/<script|javascript:|created_at|timestamp/i);
  });

  it("rejects extra text-bearing fields and inconsistent scores", async () => {
    const { card } = await loadCard();

    for (const forbidden of [
      { attempt_summary: "不应分享的用户假设文本" },
      { evidence_payload: { logs: ["不应分享的日志"] } },
      { answer: "不应分享的根因答案" },
      { findings: ["不应分享的逐条反馈"] },
    ]) {
      expect(() =>
        validateIncidentDetectiveShareCard({
          ...card,
          ...forbidden,
        }),
      ).toThrow(/share card/i);
    }
    expect(() =>
      validateIncidentDetectiveShareCard({
        ...card,
        total_score: 99,
      }),
    ).toThrow(/reconcile/i);
  });

  it("escapes dimension labels before placing them in SVG", async () => {
    const { card } = await loadCard();
    const escapedCard = structuredClone(card);
    escapedCard.dimensions[0]!.label = "证据 <覆盖> & 复核";

    const svg = renderIncidentDetectiveShareCardSvg(escapedCard);
    expect(svg).toContain("证据 &lt;覆盖&gt; &amp; 复核");
    expect(svg).not.toContain("证据 <覆盖>");
  });

  it("uses a stable safe filename and has no side effects", async () => {
    const { card } = await loadCard();
    const fetchMock = vi.fn();
    const storageMock = vi.fn();
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: storageMock,
      setItem: storageMock,
    });

    try {
      expect(incidentDetectiveShareCardFileName(card)).toBe(
        "incident-detective-mysql-leading-wildcard-score.svg",
      );
      renderIncidentDetectiveShareCardSvg(card);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });

  it("builds the downloadable card from Score v1 rather than the Attempt", async () => {
    const componentSource = await readFile(
      new URL("../components/IncidentDetectiveWorkbench.tsx", import.meta.url),
      "utf8",
    );

    expect(componentSource).toContain(
      "createIncidentDetectiveShareCard(score)",
    );
    expect(componentSource).not.toContain(
      "createIncidentDetectiveShareCard(attempt)",
    );
    expect(componentSource).toContain("下载隐私分享卡");
  });
});
