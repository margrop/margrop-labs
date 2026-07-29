import { describe, expect, it, vi } from "vitest";
import { validateAiGatewayRequest } from "@margrop-labs/ai-gateway";

import { loadSmartRmaFixtureCorpus } from "../lib/smart-rma-fixtures";
import {
  buildSmartRmaAiInput,
  smartRmaAiOperationId,
} from "../lib/smart-rma-ai";
import { assessSmartRmaHealth } from "../lib/smart-rma-health";
import { redactSmartctlText } from "../lib/smart-rma-redaction";
import {
  createMemoryInterviewAiPolicyStore,
  handleInterviewAiRequest,
  interviewAiGatewayPolicy,
} from "./interview-ai-runtime";
import {
  getInterviewAiOperation,
  getInterviewAiOperationByPath,
} from "./ai-operation-registry";

const environment = {
  TOKEN_FORGE_AI_BASE_URL: "https://provider.example.com/v1",
  TOKEN_FORGE_AI_MODEL: "primary-model",
  TOKEN_FORGE_AI_FALLBACK_MODEL: "fallback-model",
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: "100",
  TOKEN_FORGE_AI_API_KEY: "server-only-test-key",
  TOKEN_FORGE_ACTOR_KEY_SECRET: "server-only-actor-secret",
};

const providerSuccess = (content: string): Response =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
    }),
    { headers: { "content-type": "application/json" } },
  );

describe("SMART / RMA shared AI runtime", () => {
  it("routes the versioned minimal input through the shared provider policy", async () => {
    const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[0];
    if (!fixture) throw new Error("fixture required");
    const preview = redactSmartctlText(fixture.raw);
    const assessment = assessSmartRmaHealth(preview.projection);
    const input = buildSmartRmaAiInput(preview.projection, assessment);
    const explanation = {
      schema_version: "1.0",
      plain_language_summary: "结构化证据未触发已知异常规则。",
      evidence_explanations: [
        {
          rule: "healthy-baseline",
          explanation: "总体状态通过且已知异常规则未触发。",
        },
      ],
      unknown_explanations: [],
      next_step_explanations: [
        { action: "continue-monitoring", explanation: "继续定期观察趋势。" },
      ],
      warranty_assessment: "not-determined",
    };
    const providerFetch = vi
      .fn()
      .mockResolvedValue(providerSuccess(JSON.stringify(explanation)));
    const publicBody = {
      schema_version: "1.0",
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      lab_id: "smart-rma",
      operation: smartRmaAiOperationId,
      input,
    };
    expect(validateAiGatewayRequest(publicBody)).toEqual(publicBody);
    expect(
      getInterviewAiOperationByPath("/api/smart-rma/explain"),
    ).toBeDefined();
    expect(
      getInterviewAiOperation("smart-rma", smartRmaAiOperationId),
    ).toBeDefined();
    expect(
      new TextEncoder().encode(JSON.stringify(publicBody)).byteLength,
    ).toBeLessThan(interviewAiGatewayPolicy.maxRequestBytes);
    const response = await handleInterviewAiRequest(
      new Request("https://lab.example.com/api/smart-rma/explain", {
        method: "POST",
        headers: {
          origin: "https://lab.example.com",
          "content-type": "application/json",
          "cf-connecting-ip": "192.0.2.10",
        },
        body: JSON.stringify(publicBody),
      }),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: providerFetch,
        now: () => Date.UTC(2026, 6, 29, 12),
      },
    );
    const responseBody = await response.json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(responseBody).toMatchObject({
      status: "ok",
      result: { warranty_assessment: "not-determined" },
    });
    const [, init] = providerFetch.mock.calls[0] as [string, RequestInit];
    const providerBody = JSON.parse(String(init.body));
    expect(providerBody.max_tokens).toBe(
      interviewAiGatewayPolicy.maxOutputTokens,
    );
    expect(providerBody.messages[0].content).toContain(
      "smart-rma-ai-explanation-v1",
    );
    expect(JSON.stringify(providerBody)).not.toContain(fixture.raw);
    expect(JSON.stringify(providerBody)).not.toContain(
      environment.TOKEN_FORGE_AI_API_KEY,
    );
  });
});
