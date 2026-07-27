import {
  type AiGatewayErrorCode,
  type AiGatewayFailureResponse,
  type AiGatewayProviderAdapter,
  type AiGatewayProviderContext,
  type AiGatewayProviderRequest,
  type AiGatewayResponse,
  type AiGatewayUsage,
  aiGatewayErrorHttpStatus,
  validateAiGatewayRequest,
} from "@margrop-labs/ai-gateway";
import {
  type TokenForgeAiAdmissionDecision,
  type TokenForgeAiPolicySnapshot,
  type TokenForgeAiSettlementResult,
  type TokenForgeAiTrafficPolicy,
  TokenForgeAiPolicyLedger,
  admissionDecisionToAiGatewayFailure,
  createTokenForgeAiPreviewPolicyLedger,
  validateTokenForgeAiPolicySnapshot,
  validateTokenForgeAiTrafficPolicy,
} from "@margrop-labs/ai-gateway/token-forge-policy";

import {
  type TokenForgeAiPlanJson,
  type TokenForgeAiProviderInput,
  executePreparedTokenForgeAiRequest,
  tokenForgeAiOperationId,
  validateTokenForgeAiInput,
} from "../lib/token-forge-ai";
import { tokenForgeOpenAiSystemPrompt } from "./token-forge-ai-prompt";

export const tokenForgeAiEndpointPath = "/api/token-forge/plan";
const tokenForgeAiFallbackAccountingTokens = 48_000;

export const tokenForgeAiGatewayPolicy = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 64 * 1024,
  maxInputTokens: 22_000,
  maxOutputTokens: 2_000,
  providerTimeoutMs: 45_000,
  maxAttempts: 1,
});

const createTokenForgeAiTrafficPolicy =
  (): Readonly<TokenForgeAiTrafficPolicy> =>
    Object.freeze(
      validateTokenForgeAiTrafficPolicy({
        schema_version: "1.0",
        lab_id: "token-forge",
        operation: tokenForgeAiOperationId,
        max_request_billable_tokens: tokenForgeAiFallbackAccountingTokens,
        max_request_cost_microusd: 1,
        daily_budgets: {
          actor_tokens: 96_000,
          lab_tokens: 1_200_000,
          site_tokens: 2_400_000,
          actor_cost_microusd: 4,
          lab_cost_microusd: 50,
          site_cost_microusd: 100,
          actor_requests: 4,
          lab_requests: 50,
          site_requests: 100,
        },
        rate_limit: {
          window_seconds: 60,
          actor_requests: 1,
          lab_requests: 6,
          site_requests: 10,
        },
        concurrency: {
          actor_in_flight: 1,
          lab_in_flight: 2,
          site_in_flight: 3,
        },
        circuit_breaker: {
          consecutive_failures: 3,
          open_seconds: 120,
          half_open_requests: 1,
        },
        reservation_ttl_seconds: 60,
      }),
    );

export const tokenForgeAiProductionTrafficPolicy: Readonly<TokenForgeAiTrafficPolicy> =
  createTokenForgeAiTrafficPolicy();

export const tokenForgeAiPreviewTrafficPolicy: Readonly<TokenForgeAiTrafficPolicy> =
  createTokenForgeAiPreviewPolicyLedger(
    tokenForgeAiProductionTrafficPolicy,
  ).policy;

type TokenForgeAiTrafficPolicyMode = "production" | "preview";

const resolveTokenForgeAiTrafficPolicyMode = (
  multiplier: string,
): TokenForgeAiTrafficPolicyMode => {
  if (multiplier === "1") {
    return "production";
  }
  if (multiplier === "100") {
    return "preview";
  }
  throw new Error("Invalid server-side Token Forge budget configuration.");
};

const createTokenForgeAiPolicyLedger = (
  mode: TokenForgeAiTrafficPolicyMode,
  snapshot?: unknown,
): TokenForgeAiPolicyLedger =>
  mode === "preview"
    ? createTokenForgeAiPreviewPolicyLedger(
        tokenForgeAiProductionTrafficPolicy,
        snapshot,
      )
    : new TokenForgeAiPolicyLedger(
        tokenForgeAiProductionTrafficPolicy,
        snapshot,
      );

const textEncoder = new TextEncoder();

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

const isNonNegativeInteger = (candidate: unknown): candidate is number =>
  typeof candidate === "number" &&
  Number.isSafeInteger(candidate) &&
  candidate >= 0;

const failureRetryable: Readonly<Record<AiGatewayErrorCode, boolean>> =
  Object.freeze({
    invalid_request: false,
    request_too_large: false,
    input_token_limit_exceeded: false,
    rate_limited: true,
    budget_exhausted: false,
    provider_timeout: true,
    provider_unavailable: true,
    invalid_provider_response: false,
    output_token_limit_exceeded: false,
    response_too_large: false,
    policy_blocked: false,
    internal_error: false,
  });

const failureResponse = (
  code: AiGatewayErrorCode,
  requestId?: string,
  attemptCount = 0,
): AiGatewayFailureResponse => ({
  schema_version: "1.0",
  ...(requestId === undefined ? {} : { request_id: requestId }),
  status: "error",
  error: {
    code,
    retryable: failureRetryable[code],
  },
  meta: {
    attempt_count: attemptCount,
  },
});

const publicHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

const gatewayResponse = (body: AiGatewayResponse, status?: number): Response =>
  new Response(JSON.stringify(body), {
    status:
      status ??
      (body.status === "ok" ? 200 : aiGatewayErrorHttpStatus[body.error.code]),
    headers: publicHeaders,
  });

const boundedText = async (
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<string> => {
  if (body === null) {
    return "";
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        text += decoder.decode();
        return text;
      }

      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel();
        throw new RangeError("body-too-large");
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new RangeError("invalid-body");
  }
};

const parseRetryAfter = (
  value: string | null,
  nowMs: number,
): number | undefined => {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isInteger(seconds) && seconds >= 1) {
    return Math.min(seconds, 3_600);
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date) || date <= nowMs) {
    return undefined;
  }
  return Math.min(Math.max(1, Math.ceil((date - nowMs) / 1_000)), 3_600);
};

type OpenAiCompatibleProviderOptions = {
  baseUrl: string;
  primaryModel: string;
  fallbackModel: string;
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => number;
};

const providerFailure = (
  code:
    | "rate_limited"
    | "budget_exhausted"
    | "timeout"
    | "unavailable"
    | "policy_blocked",
  retryAfterSeconds?: number,
) => ({
  ok: false as const,
  error: {
    code,
    ...(retryAfterSeconds === undefined
      ? {}
      : { retry_after_seconds: retryAfterSeconds }),
  },
});

const parseProviderUsage = (candidate: unknown): AiGatewayUsage | undefined => {
  if (
    !isRecord(candidate) ||
    !isNonNegativeInteger(candidate.prompt_tokens) ||
    !isNonNegativeInteger(candidate.completion_tokens)
  ) {
    return undefined;
  }

  return {
    input_tokens: candidate.prompt_tokens,
    output_tokens: candidate.completion_tokens,
    total_tokens: candidate.prompt_tokens + candidate.completion_tokens,
  };
};

const parseProviderContent = (content: string): unknown | undefined => {
  const trimmed = content.trim();
  const fenced = /^```json[ \t]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const candidate =
    fenced === null
      ? trimmed.includes("```")
        ? undefined
        : trimmed
      : fenced[1];

  if (candidate === undefined || candidate.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
};

export const createOpenAiCompatibleProvider = (
  options: OpenAiCompatibleProviderOptions,
): AiGatewayProviderAdapter & { getAccountingTokenFloor(): number } => {
  const baseUrl = new URL(options.baseUrl);
  const models = Array.from(
    new Set([options.primaryModel.trim(), options.fallbackModel.trim()]),
  );
  if (
    baseUrl.protocol !== "https:" ||
    baseUrl.username.length > 0 ||
    baseUrl.password.length > 0 ||
    baseUrl.search.length > 0 ||
    baseUrl.hash.length > 0 ||
    models.some((model) => model.length === 0) ||
    options.apiKey.length < 8
  ) {
    throw new Error("Invalid server-side Provider configuration.");
  }

  const endpoint = `${baseUrl.toString().replace(/\/+$/, "")}/chat/completions`;
  const fetchProvider = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let fallbackAttempted = false;

  return {
    adapterId: "openai-compatible",
    getAccountingTokenFloor() {
      return fallbackAttempted ? tokenForgeAiFallbackAccountingTokens : 0;
    },
    async generate(
      request: AiGatewayProviderRequest,
      context: AiGatewayProviderContext,
    ): Promise<unknown> {
      for (const [index, model] of models.entries()) {
        const canFallback = index < models.length - 1;
        let response: Response;

        if (index > 0) {
          fallbackAttempted = true;
        }

        try {
          response = await fetchProvider(endpoint, {
            method: "POST",
            redirect: "error",
            signal: context.signal,
            headers: {
              authorization: `Bearer ${options.apiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              stream: false,
              temperature: 0.2,
              max_tokens: request.limits.max_output_tokens,
              response_format: {
                type: "json_object",
              },
              messages: [
                {
                  role: "system",
                  content: tokenForgeOpenAiSystemPrompt,
                },
                {
                  role: "user",
                  content: JSON.stringify(request.input),
                },
              ],
            }),
          });
        } catch (error) {
          if (context.signal.aborted || !canFallback) {
            throw error;
          }
          continue;
        }

        if (!response.ok) {
          const retryAfter = parseRetryAfter(
            response.headers.get("retry-after"),
            now(),
          );
          const failure =
            response.status === 429
              ? providerFailure("rate_limited", retryAfter)
              : response.status === 402
                ? providerFailure("budget_exhausted")
                : response.status === 408 || response.status === 504
                  ? providerFailure("timeout", retryAfter)
                  : response.status >= 500
                    ? providerFailure("unavailable", retryAfter)
                    : providerFailure("policy_blocked");
          const retryable =
            failure.error.code === "rate_limited" ||
            failure.error.code === "timeout" ||
            failure.error.code === "unavailable";

          if (retryable && canFallback) {
            continue;
          }
          return failure;
        }

        let parsed: unknown;
        try {
          const contentLength = Number(response.headers.get("content-length"));
          if (
            Number.isFinite(contentLength) &&
            contentLength > tokenForgeAiGatewayPolicy.maxResponseBytes
          ) {
            if (canFallback) {
              continue;
            }
            return undefined;
          }
          parsed = JSON.parse(
            await boundedText(
              response.body,
              tokenForgeAiGatewayPolicy.maxResponseBytes,
            ),
          ) as unknown;
        } catch {
          if (canFallback) {
            continue;
          }
          return undefined;
        }

        if (
          !isRecord(parsed) ||
          !Array.isArray(parsed.choices) ||
          !isRecord(parsed.choices[0]) ||
          !isRecord(parsed.choices[0].message) ||
          typeof parsed.choices[0].message.content !== "string"
        ) {
          if (canFallback) {
            continue;
          }
          return undefined;
        }

        const usage = parseProviderUsage(parsed.usage);
        const output = parseProviderContent(parsed.choices[0].message.content);
        if (usage === undefined || output === undefined) {
          if (canFallback) {
            continue;
          }
          return undefined;
        }

        return {
          ok: true,
          output,
          finish_reason:
            parsed.choices[0].finish_reason === "stop" ? "stop" : "length",
          usage,
        };
      }

      return undefined;
    },
  };
};

export type TokenForgePolicyMutation<T> = {
  snapshot: TokenForgeAiPolicySnapshot;
  result: T;
};

export interface TokenForgePolicyStore {
  mutate<T>(
    mutation: (
      snapshot: TokenForgeAiPolicySnapshot | undefined,
    ) => TokenForgePolicyMutation<T>,
  ): Promise<T>;
}

type TokenForgeAiRuntimeEnvironment = {
  TOKEN_FORGE_AI_BASE_URL: string;
  TOKEN_FORGE_AI_MODEL: string;
  TOKEN_FORGE_AI_FALLBACK_MODEL: string;
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: string;
  TOKEN_FORGE_AI_API_KEY: string;
  TOKEN_FORGE_ACTOR_KEY_SECRET: string;
};

type TokenForgeAiRuntimeOptions = {
  store: TokenForgePolicyStore;
  environment: TokenForgeAiRuntimeEnvironment;
  fetch?: typeof fetch;
  now?: () => number;
};

const deriveActorKey = async (
  ipAddress: string,
  secret: string,
): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(ipAddress),
  );
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

  return `anon_${encoded}`;
};

const admit = async (
  store: TokenForgePolicyStore,
  trafficPolicyMode: TokenForgeAiTrafficPolicyMode,
  requestId: string,
  actorKey: string,
  nowMs: number,
): Promise<TokenForgeAiAdmissionDecision> =>
  store.mutate((snapshot) => {
    const ledger = createTokenForgeAiPolicyLedger(trafficPolicyMode, snapshot);
    const result = ledger.admit({
      request_id: requestId,
      actor_key: actorKey,
      lab_id: "token-forge",
      operation: tokenForgeAiOperationId,
      now_ms: nowMs,
      reserved_tokens: ledger.policy.max_request_billable_tokens,
      reserved_cost_microusd: ledger.policy.max_request_cost_microusd,
    });

    return {
      snapshot: ledger.exportSnapshot(),
      result,
    };
  });

const settle = async (
  store: TokenForgePolicyStore,
  trafficPolicyMode: TokenForgeAiTrafficPolicyMode,
  requestId: string,
  nowMs: number,
  response: AiGatewayResponse<TokenForgeAiPlanJson>,
  accountingTokenFloor: number,
): Promise<TokenForgeAiSettlementResult> =>
  store.mutate((snapshot) => {
    const ledger = createTokenForgeAiPolicyLedger(trafficPolicyMode, snapshot);
    const result = ledger.settle(
      response.status === "ok"
        ? {
            request_id: requestId,
            now_ms: nowMs,
            outcome: {
              status: "success",
              actual_tokens: Math.max(
                response.usage.total_tokens,
                accountingTokenFloor,
              ),
              actual_cost_microusd: 0,
            },
          }
        : {
            request_id: requestId,
            now_ms: nowMs,
            outcome: {
              status: "failure",
              error_code: response.error.code,
            },
          },
    );

    return {
      snapshot: ledger.exportSnapshot(),
      result,
    };
  });

const parsePublicRequest = async (
  request: Request,
): Promise<{
  requestId: string;
  input: TokenForgeAiProviderInput;
}> => {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > tokenForgeAiGatewayPolicy.maxRequestBytes
  ) {
    throw new RangeError("request-too-large");
  }

  const parsed = JSON.parse(
    await boundedText(request.body, tokenForgeAiGatewayPolicy.maxRequestBytes),
  ) as unknown;
  const gatewayRequest = validateAiGatewayRequest(parsed);
  if (
    gatewayRequest.lab_id !== "token-forge" ||
    gatewayRequest.operation !== tokenForgeAiOperationId
  ) {
    throw new TypeError("invalid-operation");
  }

  return {
    requestId: gatewayRequest.request_id,
    input: validateTokenForgeAiInput(gatewayRequest.input),
  };
};

export const handleTokenForgeAiRequest = async (
  request: Request,
  options: TokenForgeAiRuntimeOptions,
): Promise<Response> => {
  const url = new URL(request.url);
  if (url.pathname !== tokenForgeAiEndpointPath) {
    return gatewayResponse(failureResponse("invalid_request"), 404);
  }
  if (request.method !== "POST") {
    return gatewayResponse(failureResponse("invalid_request"), 405);
  }
  if (request.headers.get("origin") !== url.origin) {
    return gatewayResponse(failureResponse("policy_blocked"), 403);
  }
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  ) {
    return gatewayResponse(failureResponse("invalid_request"), 415);
  }

  let parsed: Awaited<ReturnType<typeof parsePublicRequest>>;
  try {
    parsed = await parsePublicRequest(request);
  } catch (error) {
    return gatewayResponse(
      failureResponse(
        error instanceof RangeError ? "request_too_large" : "invalid_request",
      ),
    );
  }

  const ipAddress = request.headers.get("cf-connecting-ip");
  const { environment } = options;
  if (
    ipAddress === null ||
    ipAddress.length > 64 ||
    typeof environment.TOKEN_FORGE_ACTOR_KEY_SECRET !== "string" ||
    environment.TOKEN_FORGE_ACTOR_KEY_SECRET.length < 16 ||
    typeof environment.TOKEN_FORGE_AI_API_KEY !== "string" ||
    environment.TOKEN_FORGE_AI_API_KEY.length < 8
  ) {
    return gatewayResponse(
      failureResponse("provider_unavailable", parsed.requestId),
    );
  }

  let actorKey: string;
  let provider: ReturnType<typeof createOpenAiCompatibleProvider>;
  let trafficPolicyMode: TokenForgeAiTrafficPolicyMode;
  try {
    actorKey = await deriveActorKey(
      ipAddress,
      environment.TOKEN_FORGE_ACTOR_KEY_SECRET,
    );
    provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: options.fetch,
      now: options.now,
    });
    trafficPolicyMode = resolveTokenForgeAiTrafficPolicyMode(
      environment.TOKEN_FORGE_AI_BUDGET_MULTIPLIER,
    );
  } catch {
    return gatewayResponse(
      failureResponse("provider_unavailable", parsed.requestId),
    );
  }

  const now = options.now ?? Date.now;
  let admission: TokenForgeAiAdmissionDecision;
  try {
    admission = await admit(
      options.store,
      trafficPolicyMode,
      parsed.requestId,
      actorKey,
      now(),
    );
  } catch {
    return gatewayResponse(failureResponse("internal_error", parsed.requestId));
  }

  if (admission.status === "denied") {
    return gatewayResponse(
      admissionDecisionToAiGatewayFailure(admission, parsed.requestId),
    );
  }

  const response = await executePreparedTokenForgeAiRequest(
    parsed.input,
    parsed.requestId,
    provider,
    tokenForgeAiGatewayPolicy,
  );

  try {
    const settlement = await settle(
      options.store,
      trafficPolicyMode,
      parsed.requestId,
      now(),
      response,
      provider.getAccountingTokenFloor(),
    );
    if (settlement.status !== "settled") {
      return gatewayResponse(
        failureResponse(
          "internal_error",
          parsed.requestId,
          response.meta.attempt_count,
        ),
      );
    }
  } catch {
    return gatewayResponse(
      failureResponse(
        "internal_error",
        parsed.requestId,
        response.meta.attempt_count,
      ),
    );
  }

  return gatewayResponse(response);
};

export const createMemoryTokenForgePolicyStore = (): TokenForgePolicyStore => {
  let snapshot: TokenForgeAiPolicySnapshot | undefined;

  return {
    async mutate<T>(
      mutation: (
        current: TokenForgeAiPolicySnapshot | undefined,
      ) => TokenForgePolicyMutation<T>,
    ): Promise<T> {
      const next = mutation(snapshot);
      snapshot = validateTokenForgeAiPolicySnapshot(next.snapshot);
      return next.result;
    },
  };
};
