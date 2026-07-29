import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  buildIncidentDetectiveExplanationInput,
  incidentDetectiveExplanationOperationId,
} from "../lib/incident-detective-ai-explanation";
import {
  incidentDetectiveCaseGenerationOperationId,
  validateIncidentDetectiveCaseGenerationInput,
} from "../lib/incident-detective-case-generation";
import { validateIncidentDetectiveScenario } from "../lib/incident-detective-contracts";
import {
  scoreIncidentDetectiveAttempt,
  validateIncidentDetectiveScoringRules,
} from "../lib/incident-detective-scoring";
import {
  createMemoryIncidentDetectiveAiPolicyStore,
  handleIncidentDetectiveAiRequest,
} from "./incident-detective-ai-runtime";

const environment = {
  TOKEN_FORGE_AI_BASE_URL: "https://api-gpt.speedtest.margrop.net:16666/v1",
  TOKEN_FORGE_AI_MODEL: "qwen-latest",
  TOKEN_FORGE_AI_FALLBACK_MODEL: "minimax-latest",
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: "100",
  TOKEN_FORGE_AI_API_KEY: "synthetic-provider-key",
  TOKEN_FORGE_ACTOR_KEY_SECRET: "synthetic-actor-key-secret",
};

const requestId = "123e4567-e89b-42d3-a456-426614174300";

const readCase = async (name: string): Promise<unknown> =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(
    await readFile(
      new URL(
        `../../../../labs/incident-detective/fixtures/${name}`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as unknown;

const loadExplanationInput = async () => {
  const scenario = validateIncidentDetectiveScenario(
    await readCase("scenario.json"),
  );
  const attempt = await readCase("attempt.canonical.json");
  const rules = validateIncidentDetectiveScoringRules(
    scenario,
    await readCase("score-rules.internal.json"),
  );
  const score = scoreIncidentDetectiveAttempt(scenario, attempt, rules);
  return {
    input: buildIncidentDetectiveExplanationInput(scenario, attempt, score),
    attempt,
    scenario,
  };
};

const openAiSuccess = (content: unknown): Response =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: { content: JSON.stringify(content) },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 700, completion_tokens: 500, total_tokens: 1200 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const runtimeRequest = (
  path: string,
  operation: string,
  input: unknown,
  origin = "https://lab.margrop.net",
): Request =>
  new Request(`https://lab.margrop.net${path}`, {
    method: "POST",
    headers: {
      "cf-connecting-ip": "192.0.2.91",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      schema_version: "1.0",
      request_id: requestId,
      lab_id: "incident-detective",
      operation,
      input,
    }),
  });

describe("Incident Detective AI runtime", () => {
  it("routes explanation through a minimal projection and preserves deterministic score", async () => {
    const { input, attempt, scenario } = await loadExplanationInput();
    const metFinding = input.score.dimensions
      .flatMap(({ findings }) => findings)
      .find(({ status }) => status === "met");
    const evidenceId = input.evidence_catalog[0]?.id;
    const explanation = {
      schema_version: "1.0",
      scenario_id: input.scenario_id,
      total_score: input.score.total_score,
      headline: "这次推理已经形成证据闭环，同时继续保留未知项。",
      strengths: [
        {
          finding_rule_id: metFinding?.rule_id,
          explanation: "结构化评分显示取证动作满足了对应规则。",
        },
      ],
      gaps: [],
      safe_next_steps: [
        {
          title: "继续只读复核证据",
          rationale: "先确认结构化时间窗口，再请求任何生产变更审批。",
          evidence_ids: evidenceId === undefined ? [] : [evidenceId],
          safety: "read-only",
        },
      ],
      unknowns: ["未发送证据正文，不能扩展新的事故事实。"],
      disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。",
    };
    const fetchProvider = vi.fn().mockResolvedValue(openAiSuccess(explanation));
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const response = await handleIncidentDetectiveAiRequest(
        runtimeRequest(
          "/api/incident-detective/explanation",
          incidentDetectiveExplanationOperationId,
          input,
        ),
        {
          store: createMemoryIncidentDetectiveAiPolicyStore(),
          environment,
          fetch: fetchProvider,
          now: () => Date.UTC(2026, 6, 29, 12),
        },
      );
      const body = (await response.json()) as {
        status: string;
        result: { total_score: number };
      };

      expect(response.status).toBe(200);
      expect(body.status).toBe("ok");
      expect(body.result.total_score).toBe(input.score.total_score);
      const providerBody = JSON.parse(
        String((fetchProvider.mock.calls[0]?.[1] as RequestInit).body),
      ) as { messages: Array<{ role: string; content: string }> };
      const providerInput = providerBody.messages.find(
        ({ role }) => role === "user",
      )?.content;
      expect(providerInput).toBeDefined();
      expect(providerInput).not.toContain(
        (attempt as { hypothesis: { summary: string } }).hypothesis.summary,
      );
      for (const evidence of scenario.evidence) {
        expect(providerInput).not.toContain(JSON.stringify(evidence.data));
      }
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      logMock.mockRestore();
    }
  });

  it("prepares and validates a review-only case proposal", async () => {
    const input = validateIncidentDetectiveCaseGenerationInput(
      await readFixture("case-generation-input.valid.json"),
    );
    const proposal = await readFixture("case-proposal.valid.json");
    const fetchProvider = vi.fn().mockResolvedValue(openAiSuccess(proposal));
    const response = await handleIncidentDetectiveAiRequest(
      runtimeRequest(
        "/api/incident-detective/case-proposal",
        incidentDetectiveCaseGenerationOperationId,
        input,
      ),
      {
        store: createMemoryIncidentDetectiveAiPolicyStore(),
        environment,
        fetch: fetchProvider,
        now: () => Date.UTC(2026, 6, 29, 13),
      },
    );
    const body = (await response.json()) as {
      status: string;
      result: { requires_human_review: boolean; safety_notes: string[] };
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.result.requires_human_review).toBe(true);
    expect(body.result.safety_notes).toHaveLength(4);
    const providerBody = JSON.parse(
      String((fetchProvider.mock.calls[0]?.[1] as RequestInit).body),
    ) as { messages: Array<{ role: string; content: string }> };
    const providerInput = JSON.parse(
      providerBody.messages.find(({ role }) => role === "user")?.content ??
        "{}",
    ) as Record<string, unknown>;
    expect(providerInput).toMatchObject({
      proposal_id: input.proposal_id,
      allowed_service_kinds: expect.any(Array),
      guardrails: {
        synthetic_only: true,
        read_only_only: true,
        requires_human_review: true,
        automatic_publish_forbidden: true,
      },
    });
  });

  it("blocks cross-origin requests and invalid model references", async () => {
    const { input } = await loadExplanationInput();
    const fetchProvider = vi.fn();
    const blocked = await handleIncidentDetectiveAiRequest(
      runtimeRequest(
        "/api/incident-detective/explanation",
        incidentDetectiveExplanationOperationId,
        input,
        "https://example.com",
      ),
      {
        store: createMemoryIncidentDetectiveAiPolicyStore(),
        environment,
        fetch: fetchProvider,
      },
    );

    expect(blocked.status).toBe(403);
    expect(fetchProvider).not.toHaveBeenCalled();
  });
});
