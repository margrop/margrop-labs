import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { buildIncidentDetectiveExplanationInput } from "./incident-detective-ai-explanation";
import {
  requestIncidentDetectiveCaseProposal,
  requestIncidentDetectiveExplanation,
} from "./incident-detective-ai-client";
import { validateIncidentDetectiveScenario } from "./incident-detective-contracts";
import {
  scoreIncidentDetectiveAttempt,
  validateIncidentDetectiveScoringRules,
} from "./incident-detective-scoring";

const requestId = "123e4567-e89b-42d3-a456-426614174400";

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

const loadExplanation = async () => {
  const scenario = validateIncidentDetectiveScenario(
    await readCase("scenario.json"),
  );
  const attempt = await readCase("attempt.canonical.json");
  const score = scoreIncidentDetectiveAttempt(
    scenario,
    attempt,
    validateIncidentDetectiveScoringRules(
      scenario,
      await readCase("score-rules.internal.json"),
    ),
  );
  const input = buildIncidentDetectiveExplanationInput(
    scenario,
    attempt,
    score,
  );
  const finding = input.score.dimensions
    .flatMap(({ findings }) => findings)
    .find(({ status }) => status === "met");
  return {
    scenario,
    input,
    output: {
      schema_version: "1.0",
      scenario_id: scenario.id,
      total_score: score.total_score,
      headline: "结构化评分已经形成闭环，AI 只解释现有结果。",
      strengths: [
        {
          finding_rule_id: finding?.rule_id,
          explanation: "该项由确定性规则确认，AI 不改变分数。",
        },
      ],
      gaps: [],
      safe_next_steps: [
        {
          title: "继续只读验证",
          rationale: "保留证据并在任何生产变更前请求审批。",
          evidence_ids: [],
          safety: "read-only",
        },
      ],
      unknowns: ["证据正文未发送给模型，因此不能扩展事实。"],
      disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。",
    },
  };
};

const gatewaySuccess = (result: unknown): Response =>
  new Response(
    JSON.stringify({
      schema_version: "1.0",
      request_id: requestId,
      status: "ok",
      result,
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
      meta: { attempt_count: 1 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("Incident Detective AI browser client", () => {
  it("validates an explanation and sends no credentials", async () => {
    const { input, output } = await loadExplanation();
    const fetchMock = vi.fn().mockResolvedValue(gatewaySuccess(output));
    const result = await requestIncidentDetectiveExplanation(input, {
      fetch: fetchMock,
      requestId: () => requestId,
    });

    expect(result.status).toBe("ai-assisted");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/incident-detective/explanation",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.headers).toEqual({ "content-type": "application/json" });
    expect(String(request.body)).not.toContain("authorization");
  });

  it("falls back on timeout, gateway errors and invalid output", async () => {
    const { input, output } = await loadExplanation();
    const timeout = requestIncidentDetectiveExplanation(input, {
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      requestId: () => requestId,
      timeoutMs: 1,
    });
    const gatewayError = requestIncidentDetectiveExplanation(input, {
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema_version: "1.0",
            request_id: requestId,
            status: "error",
            error: { code: "rate_limited", retryable: true },
            meta: { attempt_count: 0 },
          }),
        ),
      ),
      requestId: () => requestId,
    });
    const invalid = requestIncidentDetectiveExplanation(input, {
      fetch: vi
        .fn()
        .mockResolvedValue(gatewaySuccess({ ...output, total_score: 0 })),
      requestId: () => requestId,
    });

    await expect(timeout).resolves.toMatchObject({
      status: "deterministic-fallback",
      failure_reason: "gateway_provider_timeout",
    });
    await expect(gatewayError).resolves.toMatchObject({
      status: "deterministic-fallback",
      failure_reason: "gateway_rate_limited",
    });
    await expect(invalid).resolves.toMatchObject({
      status: "deterministic-fallback",
      failure_reason: "gateway_invalid_provider_response",
    });
  });

  it("validates generated proposals against the public request and base case", async () => {
    const scenario = validateIncidentDetectiveScenario(
      await readCase("scenario.json"),
    );
    const input = await readFixture("case-generation-input.valid.json");
    const proposal = await readFixture("case-proposal.valid.json");
    const result = await requestIncidentDetectiveCaseProposal(input, scenario, {
      fetch: vi.fn().mockResolvedValue(gatewaySuccess(proposal)),
      requestId: () => requestId,
    });

    expect(result).toMatchObject({
      status: "review-required",
      proposal: { requires_human_review: true },
    });
  });
});
