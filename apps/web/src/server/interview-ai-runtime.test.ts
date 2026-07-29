import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  buildInterviewAiConclusionInput,
  buildInterviewAiMatchInput,
  buildInterviewAiPlanInput,
} from "./interview-ai-contracts";
import {
  createMemoryInterviewAiPolicyStore,
  handleInterviewAiRequest,
  interviewAiGatewayPolicy,
} from "./interview-ai-runtime";
import { interviewAiOperationIds } from "./interview-ai-contracts";
import {
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "../lib/interview-contracts";
import { buildInterviewMatchResult } from "../lib/interview-matching";
import {
  buildInterviewPlan,
  validateInterviewPlan,
} from "../lib/interview-planning";
import {
  validateInterviewConclusion,
  validateInterviewRecord,
} from "../lib/interview-recording";

const environment = {
  TOKEN_FORGE_AI_BASE_URL: "https://api-gpt.speedtest.margrop.net:16666/v1",
  TOKEN_FORGE_AI_MODEL: "qwen-latest",
  TOKEN_FORGE_AI_FALLBACK_MODEL: "minimax-latest",
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: "100",
  TOKEN_FORGE_AI_API_KEY: "synthetic-provider-key",
  TOKEN_FORGE_ACTOR_KEY_SECRET: "synthetic-actor-key-secret",
};

const firstRequestId = "123e4567-e89b-42d3-a456-426614174100";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/interview-workbench/fixtures/${name}`,
    import.meta.url,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadBundle = async () => {
  const resume = validateInterviewResume(
    await readFixture("resume.valid.json"),
  );
  const jd = validateInterviewJobDescription(
    await readFixture("jd.valid.json"),
  );
  const requirement = validateInterviewRequirement(
    await readFixture("requirement.valid.json"),
  );
  const evidence = validateInterviewEvidence(
    await readFixture("evidence.valid.json"),
  );
  return validateInterviewInputBundle({
    resume,
    jd,
    requirements: [
      requirement,
      ...jd.requirements.slice(1).map((item) => ({
        schema_version: "1.0" as const,
        sensitivity: "sensitive" as const,
        ...item,
      })),
    ],
    evidence: [evidence],
  });
};

const openAiSuccess = (content: string, outputTokens = 600): Response =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: { content },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 800,
        completion_tokens: outputTokens,
        total_tokens: 800 + outputTokens,
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

const runtimeRequest = (
  path: string,
  operation: string,
  input: unknown,
  requestId = firstRequestId,
  origin = "https://lab.margrop.net",
): Request =>
  new Request(`https://lab.margrop.net${path}`, {
    method: "POST",
    headers: {
      "cf-connecting-ip": "192.0.2.90",
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      schema_version: "1.0",
      request_id: requestId,
      lab_id: "interview-workbench",
      operation,
      input,
    }),
  });

describe("Interview AI runtime registry and shared Provider", () => {
  it("routes the match operation through the shared qwen Provider and safe policy ledger", async () => {
    const bundle = await loadBundle();
    const match = buildInterviewMatchResult(bundle);
    const input = buildInterviewAiMatchInput(bundle);
    const fetchProvider = vi
      .fn()
      .mockResolvedValue(openAiSuccess(JSON.stringify(match)));
    const response = await handleInterviewAiRequest(
      runtimeRequest(
        "/api/interview-workbench/match",
        interviewAiOperationIds.match,
        input,
      ),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: fetchProvider,
        now: () => Date.UTC(2026, 6, 26, 12),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      request_id: firstRequestId,
      status: "ok",
      result: { match_id: match.match_id },
      meta: { attempt_count: 1 },
    });
    const [, init] = fetchProvider.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    };
    expect(body.model).toBe("qwen-latest");
    expect(body.max_tokens).toBe(interviewAiGatewayPolicy.maxOutputTokens);
    expect(body.messages[0]?.content).toContain("interview-workbench.match-v1");
    expect(JSON.stringify(body)).not.toContain(
      environment.TOKEN_FORGE_AI_API_KEY,
    );
  });

  it("reuses minimax fallback and keeps the three operation policy namespaces independent", async () => {
    const bundle = await loadBundle();
    const match = buildInterviewMatchResult(bundle);
    const planInput = buildInterviewAiPlanInput(bundle, match, {
      mode: "interviewer",
      duration_minutes: 45,
    });
    const plan = buildInterviewPlan(bundle, match, {
      plan_id: "plan-runtime-test",
      mode: "interviewer",
      duration_minutes: 45,
    });
    const fetchProvider = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("upstream unavailable", { status: 503 }),
      )
      .mockResolvedValueOnce(openAiSuccess(JSON.stringify(plan)));
    const response = await handleInterviewAiRequest(
      runtimeRequest(
        "/api/interview-workbench/plan",
        interviewAiOperationIds.plan,
        planInput,
      ),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: fetchProvider,
        now: () => Date.UTC(2026, 6, 26, 12),
      },
    );
    expect(response.status).toBe(200);
    expect(fetchProvider).toHaveBeenCalledTimes(2);
    const models = fetchProvider.mock.calls.map(
      ([, init]) =>
        (JSON.parse(String((init as RequestInit).body)) as { model: string })
          .model,
    );
    expect(models).toEqual(["qwen-latest", "minimax-latest"]);

    const conclusionPlan = validateInterviewPlan(
      await readFixture("plan.valid.json"),
    );
    const record = validateInterviewRecord(
      await readFixture("record.valid.json"),
      conclusionPlan,
    );
    const conclusionInput = buildInterviewAiConclusionInput(
      conclusionPlan,
      record,
    );
    const conclusion = validateInterviewConclusion(
      await readFixture("conclusion.valid.json"),
      record,
      conclusionPlan,
    );
    const isolatedFetch = vi
      .fn()
      .mockResolvedValue(openAiSuccess(JSON.stringify(conclusion)));
    const conclusionResponse = await handleInterviewAiRequest(
      runtimeRequest(
        "/api/interview-workbench/conclusion",
        interviewAiOperationIds.conclusion,
        conclusionInput,
        "123e4567-e89b-42d3-a456-426614174101",
      ),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: isolatedFetch,
        now: () => Date.UTC(2026, 6, 26, 12),
      },
    );
    expect(conclusionResponse.status).toBe(200);
    expect(isolatedFetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed for browser model control and cross-origin requests", async () => {
    const bundle = await loadBundle();
    const input = buildInterviewAiMatchInput(bundle);
    const fetchProvider = vi.fn();
    const controlled = runtimeRequest(
      "/api/interview-workbench/match",
      interviewAiOperationIds.match,
      { ...input, model: "attacker-model" },
      "123e4567-e89b-42d3-a456-426614174102",
    );
    const controlledResponse = await handleInterviewAiRequest(controlled, {
      store: createMemoryInterviewAiPolicyStore(),
      environment,
      fetch: fetchProvider,
    });
    expect(controlledResponse.status).toBe(400);
    expect(fetchProvider).not.toHaveBeenCalled();

    const crossOriginResponse = await handleInterviewAiRequest(
      runtimeRequest(
        "/api/interview-workbench/match",
        interviewAiOperationIds.match,
        input,
        "123e4567-e89b-42d3-a456-426614174103",
        "https://example.com",
      ),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: fetchProvider,
      },
    );
    expect(crossOriginResponse.status).toBe(403);
  });

  it.each([
    {
      label: "provider 5xx",
      response: () => new Response("upstream unavailable", { status: 503 }),
      expectedCode: "provider_unavailable",
      expectedStatus: 503,
      expectedCalls: 2,
    },
    {
      label: "provider rate limit",
      response: () => new Response("rate limited", { status: 429 }),
      expectedCode: "rate_limited",
      expectedStatus: 429,
      expectedCalls: 2,
    },
    {
      label: "provider budget refusal",
      response: () => new Response("budget exhausted", { status: 402 }),
      expectedCode: "budget_exhausted",
      expectedStatus: 429,
      expectedCalls: 1,
    },
    {
      label: "invalid provider JSON",
      response: () => new Response("not-json", { status: 200 }),
      expectedCode: "invalid_provider_response",
      expectedStatus: 502,
      expectedCalls: 2,
    },
    {
      label: "schema-invalid provider output",
      response: () => openAiSuccess(JSON.stringify({ unexpected: true })),
      expectedCode: "invalid_provider_response",
      expectedStatus: 502,
      expectedCalls: 1,
    },
  ])(
    "maps $label to a safe gateway failure after fallback",
    async ({ response, expectedCode, expectedStatus, expectedCalls }) => {
      const bundle = await loadBundle();
      const input = buildInterviewAiMatchInput(bundle);
      const fetchProvider = vi.fn().mockImplementation(response);
      const gatewayResponse = await handleInterviewAiRequest(
        runtimeRequest(
          "/api/interview-workbench/match",
          interviewAiOperationIds.match,
          input,
          `${firstRequestId.slice(0, -2)}${String(expectedStatus).slice(-2)}`,
        ),
        {
          store: createMemoryInterviewAiPolicyStore(),
          environment,
          fetch: fetchProvider,
          now: () => Date.UTC(2026, 6, 26, 12),
        },
      );
      const body = (await gatewayResponse.json()) as {
        status: string;
        error?: { code: string };
        meta: { attempt_count: number };
      };

      expect(gatewayResponse.status).toBe(expectedStatus);
      expect(body).toMatchObject({
        status: "error",
        error: { code: expectedCode },
      });
      expect(body.meta.attempt_count).toBe(1);
      expect(fetchProvider).toHaveBeenCalledTimes(expectedCalls);
    },
  );

  it("maps a valid provider response above the output cap to a local-safe failure", async () => {
    const bundle = await loadBundle();
    const match = buildInterviewMatchResult(bundle);
    const input = buildInterviewAiMatchInput(bundle);
    const fetchProvider = vi
      .fn()
      .mockResolvedValue(openAiSuccess(JSON.stringify(match), 3_001));
    const response = await handleInterviewAiRequest(
      runtimeRequest(
        "/api/interview-workbench/match",
        interviewAiOperationIds.match,
        input,
        "123e4567-e89b-42d3-a456-426614174199",
      ),
      {
        store: createMemoryInterviewAiPolicyStore(),
        environment,
        fetch: fetchProvider,
        now: () => Date.UTC(2026, 6, 26, 12),
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      error: { code: "output_token_limit_exceeded" },
    });
    expect(response.status).toBe(502);
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });
});
