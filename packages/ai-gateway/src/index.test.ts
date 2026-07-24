import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  type AiGatewayOperation,
  type AiGatewayProviderAdapter,
  type AiGatewayProviderRequest,
  type JsonObject,
  AiGatewayContractError,
  aiGatewayErrorHttpStatus,
  aiGatewayHardLimits,
  executeAiGatewayRequest,
  validateAiGatewayRequest,
  validateAiGatewayResponse,
} from "./index";

type SyntheticInput = {
  goal_summary: string;
  token_budget: number;
};

type SyntheticResult = {
  summary: string;
};

const fixtureUrl = (name: string): URL =>
  new URL(`../../../labs/token-forge/fixtures/${name}`, import.meta.url);

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

const operation: AiGatewayOperation<SyntheticInput, SyntheticResult> = {
  id: "token-forge.plan-v1",
  validateInput(candidate) {
    if (
      Object.keys(candidate).length !== 2 ||
      typeof candidate.goal_summary !== "string" ||
      candidate.goal_summary.length < 10 ||
      typeof candidate.token_budget !== "number" ||
      !Number.isInteger(candidate.token_budget) ||
      candidate.token_budget < 2_000
    ) {
      throw new Error("invalid synthetic input");
    }

    return {
      goal_summary: candidate.goal_summary,
      token_budget: candidate.token_budget,
    };
  },
  validateOutput(candidate) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).length !== 1 ||
      typeof candidate.summary !== "string" ||
      candidate.summary.length === 0
    ) {
      throw new Error("invalid synthetic output");
    }

    return { summary: candidate.summary };
  },
};

const successResult = (
  output: JsonObject = { summary: "Synthetic gateway result." },
): unknown => ({
  ok: true,
  output,
  finish_reason: "stop",
  usage: {
    input_tokens: 100,
    output_tokens: 20,
    total_tokens: 120,
  },
});

const createProvider = (
  generate: AiGatewayProviderAdapter["generate"],
): AiGatewayProviderAdapter & {
  generate: ReturnType<typeof vi.fn<AiGatewayProviderAdapter["generate"]>>;
} => ({
  adapterId: "synthetic",
  generate: vi.fn(generate),
});

describe("AI Gateway v1 contracts", () => {
  it("accepts the synthetic request and response fixtures", async () => {
    const request = validateAiGatewayRequest(
      await readFixture("ai-gateway-request.valid.json"),
    );
    const response = validateAiGatewayResponse(
      await readFixture("ai-gateway-response.valid.json"),
    );

    expect(request.operation).toBe("token-forge.plan-v1");
    expect(response.status).toBe("ok");
  });

  it("rejects unknown envelope fields without echoing their values", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const candidate = {
      ...(request as JsonObject),
      provider_api_key: "synthetic-secret-value",
    };

    let error: unknown;
    try {
      validateAiGatewayRequest(candidate);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AiGatewayContractError);
    expect((error as Error).message).toContain("additional properties");
    expect((error as Error).message).not.toContain("synthetic-secret-value");
  });

  it.each([
    "provider",
    "model",
    "system_prompt",
    "authorization",
    "provider_api_key",
  ])("rejects the server-controlled input field %s", async (field) => {
    const request = validateAiGatewayRequest(
      await readFixture("ai-gateway-request.valid.json"),
    );

    expect(() =>
      validateAiGatewayRequest({
        ...request,
        input: {
          ...request.input,
          [field]: "synthetic-value",
        },
      }),
    ).toThrow(/server-controlled field/);
  });

  it("passes only validated business data and server limits to the adapter", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () => successResult());
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response.status).toBe("ok");
    expect(provider.generate).toHaveBeenCalledTimes(1);

    const providerRequest = provider.generate.mock.calls[0]?.[0];
    expect(providerRequest).toEqual({
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      lab_id: "token-forge",
      operation: "token-forge.plan-v1",
      input: {
        goal_summary: "Create one bounded synthetic implementation plan.",
        token_budget: 16000,
      },
      limits: {
        max_input_tokens: 24_000,
        max_output_tokens: 4_000,
      },
    } satisfies AiGatewayProviderRequest);
    expect(JSON.stringify(providerRequest)).not.toMatch(
      /api_key|system_prompt|authorization|cookie|password/i,
    );
  });

  it("retries one invalid model response and then fails closed", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () =>
      successResult({ wrong_field: "not accepted" }),
    );
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response).toMatchObject({
      status: "error",
      error: {
        code: "invalid_provider_response",
        retryable: false,
      },
      meta: { attempt_count: 2 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("does not retry rate limits and caps retry-after metadata", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () => ({
      ok: false,
      error: {
        code: "rate_limited",
        retry_after_seconds: 10_000,
      },
    }));
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response).toMatchObject({
      status: "error",
      error: {
        code: "rate_limited",
        retryable: true,
        retry_after_seconds: 3_600,
      },
      meta: { attempt_count: 1 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("retries one unavailable provider response and can recover", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(
      vi
        .fn<AiGatewayProviderAdapter["generate"]>()
        .mockResolvedValueOnce({
          ok: false,
          error: { code: "unavailable" },
        })
        .mockResolvedValueOnce(successResult()),
    );
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response).toMatchObject({
      status: "ok",
      meta: { attempt_count: 2 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("times out once and returns no provider error details", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(
      async () => new Promise<never>(() => undefined),
    );
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
      policy: { providerTimeoutMs: 5 },
    });

    expect(response).toEqual({
      schema_version: "1.0",
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      status: "error",
      error: {
        code: "provider_timeout",
        retryable: true,
      },
      meta: {
        attempt_count: 1,
      },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("enforces request and conservative input-token limits before provider use", async () => {
    const request = validateAiGatewayRequest(
      await readFixture("ai-gateway-request.valid.json"),
    );
    const provider = createProvider(async () => successResult());

    const inputLimited = await executeAiGatewayRequest(request, {
      operation,
      provider,
      policy: { maxInputTokens: 2_001 },
    });
    expect(inputLimited).toMatchObject({
      status: "error",
      error: { code: "input_token_limit_exceeded" },
      meta: { attempt_count: 0 },
    });

    const requestLimited = await executeAiGatewayRequest(request, {
      operation,
      provider,
      policy: { maxRequestBytes: 10 },
    });
    expect(requestLimited).toMatchObject({
      status: "error",
      error: { code: "request_too_large" },
      meta: { attempt_count: 0 },
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("fails closed when the provider exceeds the output-token ceiling", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () => ({
      ok: true,
      output: { summary: "Synthetic gateway result." },
      finish_reason: "length",
      usage: {
        input_tokens: 100,
        output_tokens: 4_001,
        total_tokens: 4_101,
      },
    }));
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response).toMatchObject({
      status: "error",
      error: { code: "output_token_limit_exceeded" },
    });
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });

  it("blocks obvious secret material in otherwise valid output", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () =>
      successResult({
        summary: "Synthetic -----BEGIN PRIVATE KEY REDACTED----- marker.",
      }),
    );
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
    });

    expect(response).toMatchObject({
      status: "error",
      error: { code: "policy_blocked" },
    });
    expect(JSON.stringify(response)).not.toContain("PRIVATE KEY");
  });

  it("enforces a lowered response-size policy after output validation", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () =>
      successResult({ summary: "x".repeat(1_000) }),
    );
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
      policy: { maxResponseBytes: 200 },
    });

    expect(response).toMatchObject({
      status: "error",
      error: { code: "response_too_large" },
    });
  });

  it("never exposes malformed provider error bodies", async () => {
    const request = await readFixture("ai-gateway-request.valid.json");
    const provider = createProvider(async () => ({
      ok: false,
      error: {
        code: "unavailable",
        raw_error: "synthetic provider detail",
      },
    }));
    const response = await executeAiGatewayRequest(request, {
      operation,
      provider,
      policy: { maxAttempts: 1 },
    });

    expect(response).toMatchObject({
      status: "error",
      error: { code: "invalid_provider_response" },
    });
    expect(JSON.stringify(response)).not.toContain("synthetic provider detail");
  });

  it("keeps all hard limits and HTTP mappings explicit", () => {
    expect(aiGatewayHardLimits).toEqual({
      maxRequestBytes: 65_536,
      maxResponseBytes: 65_536,
      maxInputTokens: 24_000,
      maxOutputTokens: 4_000,
      systemInputTokenReserve: 2_000,
      providerTimeoutMs: 15_000,
      maxAttempts: 2,
      maxJsonDepth: 8,
      maxJsonNodes: 1_000,
    });
    expect(aiGatewayErrorHttpStatus).toMatchObject({
      invalid_request: 400,
      request_too_large: 413,
      rate_limited: 429,
      provider_timeout: 504,
      provider_unavailable: 503,
      invalid_provider_response: 502,
      policy_blocked: 422,
    });
  });
});
