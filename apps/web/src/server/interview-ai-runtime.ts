import {
  type AiGatewayErrorCode,
  type AiGatewayFailureResponse,
  type AiGatewayOperation,
  type AiGatewayResponse,
  type JsonObject,
  aiGatewayErrorHttpStatus,
  executeAiGatewayRequest,
  validateAiGatewayRequest,
} from "@margrop-labs/ai-gateway";
import {
  type AiTrafficPolicy,
  type TokenForgeAiAdmissionDecision,
  type TokenForgeAiPolicySnapshot,
  type TokenForgeAiSettlementResult,
  TokenForgeAiPolicyLedger,
  admissionDecisionToAiGatewayFailure,
  createAiPreviewPolicyLedger,
  validateTokenForgeAiPolicySnapshot,
  validateAiTrafficPolicy,
} from "@margrop-labs/ai-gateway/token-forge-policy";

import {
  type InterviewAiOperationDefinition,
  getInterviewAiOperation,
  getInterviewAiOperationByPath,
} from "./ai-operation-registry";
import {
  createOpenAiCompatibleProvider,
  deriveAiActorKey,
  type TokenForgePolicyMutation,
  type TokenForgePolicyStore,
} from "./token-forge-ai-runtime";

export const interviewAiGatewayPolicy = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 64 * 1024,
  maxInputTokens: 22_000,
  maxOutputTokens: 3_000,
  providerTimeoutMs: 45_000,
  maxAttempts: 1,
});

const interviewAiPrimaryAccountingTokens = 24_000;
const interviewAiFallbackAccountingTokens = 48_000;

const createInterviewAiTrafficPolicy = (
  operation: string,
): Readonly<AiTrafficPolicy> =>
  Object.freeze(
    validateAiTrafficPolicy({
      schema_version: "1.0",
      lab_id: "interview-workbench",
      operation,
      max_request_billable_tokens: interviewAiFallbackAccountingTokens,
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

export const interviewAiProductionTrafficPolicies: Readonly<
  Record<"match" | "plan" | "conclusion", Readonly<AiTrafficPolicy>>
> = Object.freeze({
  match: createInterviewAiTrafficPolicy("interview-workbench.match-v1"),
  plan: createInterviewAiTrafficPolicy("interview-workbench.plan-v1"),
  conclusion: createInterviewAiTrafficPolicy(
    "interview-workbench.conclusion-v1",
  ),
});

export const interviewAiPreviewTrafficPolicies: Readonly<
  Record<"match" | "plan" | "conclusion", Readonly<AiTrafficPolicy>>
> = Object.freeze({
  match: createAiPreviewPolicyLedger(interviewAiProductionTrafficPolicies.match)
    .policy,
  plan: createAiPreviewPolicyLedger(interviewAiProductionTrafficPolicies.plan)
    .policy,
  conclusion: createAiPreviewPolicyLedger(
    interviewAiProductionTrafficPolicies.conclusion,
  ).policy,
});

type InterviewAiTrafficPolicyMode = "production" | "preview";

const resolveTrafficPolicyMode = (
  multiplier: string,
): InterviewAiTrafficPolicyMode => {
  if (multiplier === "1") {
    return "production";
  }
  if (multiplier === "100") {
    return "preview";
  }
  throw new Error("Invalid server-side Interview AI budget configuration.");
};

const createInterviewAiPolicyLedger = (
  operation: InterviewAiOperationDefinition,
  mode: InterviewAiTrafficPolicyMode,
  snapshot?: unknown,
): TokenForgeAiPolicyLedger => {
  const policy = interviewAiProductionTrafficPolicies[operation.key];
  return mode === "preview"
    ? createAiPreviewPolicyLedger(policy, snapshot)
    : new TokenForgeAiPolicyLedger(policy, snapshot);
};

export type InterviewAiRuntimeEnvironment = {
  TOKEN_FORGE_AI_BASE_URL: string;
  TOKEN_FORGE_AI_MODEL: string;
  TOKEN_FORGE_AI_FALLBACK_MODEL: string;
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: string;
  TOKEN_FORGE_AI_API_KEY: string;
  TOKEN_FORGE_ACTOR_KEY_SECRET: string;
};

export type InterviewAiRuntimeOptions = {
  store: TokenForgePolicyStore;
  environment: InterviewAiRuntimeEnvironment;
  fetch?: typeof fetch;
  now?: () => number;
};

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
  error: { code, retryable: failureRetryable[code] },
  meta: { attempt_count: attemptCount },
});

const gatewayResponse = (body: AiGatewayResponse, status?: number): Response =>
  new Response(JSON.stringify(body), {
    status:
      status ??
      (body.status === "ok" ? 200 : aiGatewayErrorHttpStatus[body.error.code]),
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
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

const parsePublicRequest = async (
  request: Request,
  operation: InterviewAiOperationDefinition,
): Promise<{ requestId: string; input: JsonObject }> => {
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > interviewAiGatewayPolicy.maxRequestBytes
  ) {
    throw new RangeError("request-too-large");
  }
  const parsed = JSON.parse(
    await boundedText(request.body, interviewAiGatewayPolicy.maxRequestBytes),
  ) as unknown;
  const gatewayRequest = validateAiGatewayRequest(parsed);
  if (
    gatewayRequest.lab_id !== operation.lab_id ||
    gatewayRequest.operation !== operation.operation
  ) {
    throw new TypeError("invalid-operation");
  }
  const input = operation.validateInput(
    gatewayRequest.input,
  ) as unknown as JsonObject;
  return { requestId: gatewayRequest.request_id, input };
};

const admit = async (
  store: TokenForgePolicyStore,
  operation: InterviewAiOperationDefinition,
  mode: InterviewAiTrafficPolicyMode,
  requestId: string,
  actorKey: string,
  nowMs: number,
): Promise<TokenForgeAiAdmissionDecision> =>
  store.mutate((snapshot) => {
    const ledger = createInterviewAiPolicyLedger(operation, mode, snapshot);
    const result = ledger.admit({
      request_id: requestId,
      actor_key: actorKey,
      lab_id: operation.lab_id,
      operation: operation.operation,
      now_ms: nowMs,
      reserved_tokens: ledger.policy.max_request_billable_tokens,
      reserved_cost_microusd: ledger.policy.max_request_cost_microusd,
    });
    return { snapshot: ledger.exportSnapshot(), result };
  });

const settle = async (
  store: TokenForgePolicyStore,
  operation: InterviewAiOperationDefinition,
  mode: InterviewAiTrafficPolicyMode,
  requestId: string,
  nowMs: number,
  response: AiGatewayResponse<JsonObject>,
  accountingTokenFloor: number,
): Promise<TokenForgeAiSettlementResult> =>
  store.mutate((snapshot) => {
    const ledger = createInterviewAiPolicyLedger(operation, mode, snapshot);
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
            outcome: { status: "failure", error_code: response.error.code },
          },
    );
    return { snapshot: ledger.exportSnapshot(), result };
  });

const makeGatewayOperation = (
  definition: InterviewAiOperationDefinition,
  input: JsonObject,
): AiGatewayOperation<JsonObject, JsonObject> => {
  let preparedInput: JsonObject = input;
  return {
    id: definition.operation,
    validateInput(candidate) {
      preparedInput = definition.validateInput(
        candidate,
      ) as unknown as JsonObject;
      return preparedInput;
    },
    validateOutput(candidate) {
      return definition.validateOutput(candidate, preparedInput);
    },
  };
};

export const handleInterviewAiRequest = async (
  request: Request,
  options: InterviewAiRuntimeOptions,
): Promise<Response> => {
  const url = new URL(request.url);
  const operation = getInterviewAiOperationByPath(url.pathname);
  if (!operation) {
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

  let parsed: { requestId: string; input: JsonObject };
  try {
    parsed = await parsePublicRequest(request, operation);
  } catch (error) {
    return gatewayResponse(
      failureResponse(
        error instanceof RangeError ? "request_too_large" : "invalid_request",
      ),
    );
  }

  const { environment } = options;
  const ipAddress = request.headers.get("cf-connecting-ip");
  if (
    ipAddress === null ||
    ipAddress.length > 64 ||
    environment.TOKEN_FORGE_ACTOR_KEY_SECRET.length < 16 ||
    environment.TOKEN_FORGE_AI_API_KEY.length < 8
  ) {
    return gatewayResponse(
      failureResponse("provider_unavailable", parsed.requestId),
    );
  }

  let actorKey: string;
  let provider: ReturnType<typeof createOpenAiCompatibleProvider>;
  let mode: InterviewAiTrafficPolicyMode;
  try {
    actorKey = await deriveAiActorKey(
      ipAddress,
      environment.TOKEN_FORGE_ACTOR_KEY_SECRET,
    );
    mode = resolveTrafficPolicyMode(
      environment.TOKEN_FORGE_AI_BUDGET_MULTIPLIER,
    );
    provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      systemPrompt: operation.system_prompt,
      maxResponseBytes: interviewAiGatewayPolicy.maxResponseBytes,
      primaryAccountingTokens: interviewAiPrimaryAccountingTokens,
      fallbackAccountingTokens: interviewAiFallbackAccountingTokens,
      fetch: options.fetch,
      now: options.now,
    });
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
      operation,
      mode,
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

  const gatewayOperation = makeGatewayOperation(operation, parsed.input);
  let response: AiGatewayResponse<JsonObject>;
  try {
    response = await executeAiGatewayRequest(
      {
        schema_version: "1.0",
        request_id: parsed.requestId,
        lab_id: operation.lab_id,
        operation: operation.operation,
        input: parsed.input,
      },
      {
        operation: gatewayOperation,
        provider,
        policy: interviewAiGatewayPolicy,
      },
    );
  } catch {
    response = failureResponse("internal_error", parsed.requestId);
  }

  try {
    const settlement = await settle(
      options.store,
      operation,
      mode,
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

export const createMemoryInterviewAiPolicyStore = (): TokenForgePolicyStore => {
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

export const getInterviewAiOperationForRequest = (
  labId: string,
  operation: string,
): InterviewAiOperationDefinition | undefined =>
  getInterviewAiOperation(labId, operation);
