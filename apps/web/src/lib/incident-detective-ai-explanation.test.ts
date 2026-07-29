import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildIncidentDetectiveExplanationInput,
  validateIncidentDetectiveExplanation,
} from "./incident-detective-ai-explanation";
import { validateIncidentDetectiveScenario } from "./incident-detective-contracts";
import {
  scoreIncidentDetectiveAttempt,
  validateIncidentDetectiveScoringRules,
} from "./incident-detective-scoring";

const loadCaseJson = async (name: string): Promise<unknown> =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;

const loadScoredAttempt = async () => {
  const scenario = validateIncidentDetectiveScenario(
    await loadCaseJson("scenario.json"),
  );
  const attempt = await loadCaseJson("attempt.canonical.json");
  const rules = validateIncidentDetectiveScoringRules(
    scenario,
    await loadCaseJson("score-rules.internal.json"),
  );
  const score = scoreIncidentDetectiveAttempt(scenario, attempt, rules);
  return { scenario, attempt, score };
};

describe("Incident Detective AI explanation boundary", () => {
  it("builds a minimal projection without attempt text or evidence payloads", async () => {
    const { scenario, attempt, score } = await loadScoredAttempt();
    const input = buildIncidentDetectiveExplanationInput(
      scenario,
      attempt,
      score,
    );
    const serialized = JSON.stringify(input);
    const attemptRecord = attempt as {
      hypothesis: { summary: string; next_action: string };
    };

    expect(input.scenario_id).toBe(scenario.id);
    expect(input.score.total_score).toBe(score.total_score);
    expect(
      input.evidence_catalog.filter(({ acquired }) => acquired),
    ).toHaveLength(
      (attempt as { selected_evidence_ids: unknown[] }).selected_evidence_ids
        .length,
    );
    expect(serialized).not.toContain(attemptRecord.hypothesis.summary);
    expect(serialized).not.toContain(attemptRecord.hypothesis.next_action);
    for (const evidence of scenario.evidence) {
      expect(serialized).not.toContain(JSON.stringify(evidence.data));
    }
    expect(serialized).not.toContain("points_awarded");
  });

  it("accepts only explanations that preserve score and known references", async () => {
    const { scenario, attempt, score } = await loadScoredAttempt();
    const input = buildIncidentDetectiveExplanationInput(
      scenario,
      attempt,
      score,
    );
    const metFinding = input.score.dimensions
      .flatMap(({ findings }) => findings)
      .find(({ status }) => status === "met");
    const knownEvidenceId = input.evidence_catalog[0]?.id;

    expect(metFinding).toBeDefined();
    expect(knownEvidenceId).toBeDefined();

    const explanation = validateIncidentDetectiveExplanation(
      {
        schema_version: "1.0",
        scenario_id: input.scenario_id,
        total_score: input.score.total_score,
        headline: "这次推理已形成可审计证据链，但仍需保留未知项。",
        strengths: [
          {
            finding_rule_id: metFinding?.rule_id,
            explanation: "该步骤先使用结构化证据缩小范围，没有把猜测当作事实。",
          },
        ],
        gaps: [],
        safe_next_steps: [
          {
            title: "继续使用只读证据验证",
            rationale: "先复核已知时间窗口，再决定是否需要审批后的生产操作。",
            evidence_ids: [knownEvidenceId],
            safety: "read-only",
          },
        ],
        unknowns: ["当前结构化投影不包含证据正文，因此不能扩展新的事故事实。"],
        disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。",
      },
      input,
    );

    expect(explanation.total_score).toBe(score.total_score);
  });

  it("rejects changed scores, unknown findings, unknown evidence and sensitive output", async () => {
    const { scenario, attempt, score } = await loadScoredAttempt();
    const input = buildIncidentDetectiveExplanationInput(
      scenario,
      attempt,
      score,
    );
    const base = {
      schema_version: "1.0",
      scenario_id: input.scenario_id,
      total_score: input.score.total_score,
      headline: "解释只复述结构化评分，不改变任何确定性结果。",
      strengths: [],
      gaps: [],
      safe_next_steps: [
        {
          title: "先执行只读复核",
          rationale: "保持证据优先并明确尚未验证的部分。",
          evidence_ids: [],
          safety: "read-only",
        },
      ],
      unknowns: ["没有发送证据正文，因此保持未知。"],
      disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。",
    };

    expect(() =>
      validateIncidentDetectiveExplanation(
        { ...base, total_score: input.score.total_score - 1 },
        input,
      ),
    ).toThrow();
    expect(() =>
      validateIncidentDetectiveExplanation(
        {
          ...base,
          strengths: [
            {
              finding_rule_id: "unknown-finding",
              explanation: "这个引用不属于确定性评分结果。",
            },
          ],
        },
        input,
      ),
    ).toThrow();
    expect(() =>
      validateIncidentDetectiveExplanation(
        {
          ...base,
          safe_next_steps: [
            {
              ...base.safe_next_steps[0],
              evidence_ids: ["unknown-evidence"],
            },
          ],
        },
        input,
      ),
    ).toThrow();
    expect(() =>
      validateIncidentDetectiveExplanation(
        {
          ...base,
          headline: "authorization=Bearer synthetic-secret-must-be-rejected",
        },
        input,
      ),
    ).toThrow();
  });
});
