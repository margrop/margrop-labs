import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import requestSchema from "../../../schemas/ai-gateway-request-v1.schema.json";
import responseSchema from "../../../schemas/ai-gateway-response-v1.schema.json";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type AiGatewayRequest<TInput extends JsonObject = JsonObject> = {
  schema_version: "1.0";
  request_id: string;
  lab_id: string;
  operation: string;
  input: TInput;
};

export type AiGatewayUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type AiGatewaySuccessResponse<TResult extends JsonObject = JsonObject> =
  {
    schema_version: "1.0";
    request_id: string;
    status: "ok";
    result: TResult;
    usage: AiGatewayUsage;
    meta: {
      attempt_count: number;
    };
  };

export type AiGatewayErrorCode =
  | "invalid_request"
  | "request_too_large"
  | "input_token_limit_exceeded"
  | "rate_limited"
  | "budget_exhausted"
  | "provider_timeout"
  | "provider_unavailable"
  | "invalid_provider_response"
  | "output_token_limit_exceeded"
  | "response_too_large"
  | "policy_blocked"
  | "internal_error";

export type AiGatewayFailureResponse = {
  schema_version: "1.0";
  request_id?: string;
  status: "error";
  error: {
    code: AiGatewayErrorCode;
    retryable: boolean;
    retry_after_seconds?: number;
  };
  meta: {
    attempt_count: number;
  };
};

export type AiGatewayResponse<TResult extends JsonObject = JsonObject> =
  AiGatewaySuccessResponse<TResult> | AiGatewayFailureResponse;

type AiGatewayLimits = {
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  systemInputTokenReserve: number;
  providerTimeoutMs: number;
  maxAttempts: number;
  maxJsonDepth: number;
  maxJsonNodes: number;
};

export const aiGatewayHardLimits: Readonly<AiGatewayLimits> = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxResponseBytes: 64 * 1024,
  maxInputTokens: 24_000,
  maxOutputTokens: 4_000,
  systemInputTokenReserve: 2_000,
  providerTimeoutMs: 45_000,
  maxAttempts: 2,
  maxJsonDepth: 8,
  maxJsonNodes: 1_000,
});

type AdjustablePolicy = Pick<
  typeof aiGatewayHardLimits,
  | "maxRequestBytes"
  | "maxResponseBytes"
  | "maxInputTokens"
  | "maxOutputTokens"
  | "providerTimeoutMs"
  | "maxAttempts"
>;

type ResolvedPolicy = AiGatewayLimits;

export type AiGatewayExecutionPolicy = Partial<AdjustablePolicy>;

export type AiGatewayOperation<
  TInput extends JsonObject,
  TResult extends JsonObject,
> = {
  readonly id: string;
  validateInput(candidate: JsonObject): TInput;
  validateOutput(candidate: unknown): TResult;
};

export type AiGatewayProviderRequest = {
  request_id: string;
  lab_id: string;
  operation: string;
  input: JsonObject;
  limits: {
    max_input_tokens: number;
    max_output_tokens: number;
  };
};

export type AiGatewayProviderContext = {
  signal: AbortSignal;
};

export interface AiGatewayProviderAdapter {
  readonly adapterId: string;
  generate(
    request: AiGatewayProviderRequest,
    context: AiGatewayProviderContext,
  ): Promise<unknown>;
}

export type AiGatewayExecutionOptions<
  TInput extends JsonObject,
  TResult extends JsonObject,
> = {
  operation: AiGatewayOperation<TInput, TResult>;
  provider: AiGatewayProviderAdapter;
  policy?: AiGatewayExecutionPolicy;
};

export class AiGatewayContractError extends Error {
  override name = "AiGatewayContractError";

  constructor(
    readonly code:
      | "invalid_request"
      | "request_too_large"
      | "invalid_response"
      | "response_too_large",
    message: string,
  ) {
    super(message);
  }
}

type ProviderFailureCode =
  | "rate_limited"
  | "budget_exhausted"
  | "timeout"
  | "unavailable"
  | "policy_blocked";

type ParsedProviderResult =
  | {
      ok: true;
      output: unknown;
      finish_reason: "stop" | "length";
      usage: AiGatewayUsage;
    }
  | {
      ok: false;
      error: {
        code: ProviderFailureCode;
        retry_after_seconds?: number;
      };
    };

const textEncoder = new TextEncoder();

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

const hasOnlyKeys = (
  candidate: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(candidate).every((key) => allowed.includes(key));

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message ?? "is invalid"}`;
    })
    .join("; ");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const requestValidator = ajv.compile<AiGatewayRequest>(
  requestSchema as AnySchema,
);
const responseValidator = ajv.compile<AiGatewayResponse>(
  responseSchema as AnySchema,
);

const serializeJson = (
  candidate: unknown,
  errorCode: "invalid_request" | "response_too_large",
): { value: unknown; bytes: number; text: string } => {
  let text: string | undefined;

  try {
    text = JSON.stringify(candidate);
  } catch {
    throw new AiGatewayContractError(
      errorCode,
      "AI Gateway data must be serializable JSON.",
    );
  }

  if (text === undefined) {
    throw new AiGatewayContractError(
      errorCode,
      "AI Gateway data must be serializable JSON.",
    );
  }

  return {
    value: JSON.parse(text) as unknown,
    bytes: textEncoder.encode(text).byteLength,
    text,
  };
};

const assertJsonComplexity = (
  candidate: unknown,
  maxDepth: number,
  maxNodes: number,
): void => {
  let nodes = 0;

  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (depth > maxDepth || nodes > maxNodes) {
      throw new AiGatewayContractError(
        "invalid_request",
        "AI Gateway input exceeded the JSON complexity limit.",
      );
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, depth + 1);
      }
      return;
    }

    if (isRecord(value)) {
      for (const child of Object.values(value)) {
        visit(child, depth + 1);
      }
    }
  };

  visit(candidate, 0);
};

const forbiddenControlFields = new Set([
  "api_key",
  "apikey",
  "provider",
  "provider_key",
  "provider_api_key",
  "model",
  "messages",
  "system_prompt",
  "authorization",
  "cookie",
  "set_cookie",
  "password",
  "private_key",
  "client_secret",
  "access_token",
  "refresh_token",
]);

const assertNoClientControlFields = (candidate: unknown): void => {
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replaceAll("-", "_");
      if (forbiddenControlFields.has(normalizedKey)) {
        throw new AiGatewayContractError(
          "invalid_request",
          "AI Gateway input contains a server-controlled field.",
        );
      }
      visit(child);
    }
  };

  visit(candidate);
};

const parseContract = <T>(
  candidate: unknown,
  contractName: string,
  validate: ValidateFunction<T>,
): T => {
  if (!validate(candidate)) {
    throw new AiGatewayContractError(
      "invalid_request",
      `${contractName} validation failed: ${formatValidationErrors(validate.errors)}`,
    );
  }

  return candidate as T;
};

export const validateAiGatewayRequest = (
  candidate: unknown,
): AiGatewayRequest => {
  const serialized = serializeJson(candidate, "invalid_request");
  if (serialized.bytes > aiGatewayHardLimits.maxRequestBytes) {
    throw new AiGatewayContractError(
      "request_too_large",
      "AI Gateway request exceeded the byte limit.",
    );
  }

  const request = parseContract(
    serialized.value,
    "ai-gateway-request-v1",
    requestValidator,
  );
  assertJsonComplexity(
    request.input,
    aiGatewayHardLimits.maxJsonDepth,
    aiGatewayHardLimits.maxJsonNodes,
  );
  assertNoClientControlFields(request.input);

  return request;
};

export const validateAiGatewayResponse = (
  candidate: unknown,
): AiGatewayResponse => {
  const serialized = serializeJson(candidate, "response_too_large");
  if (serialized.bytes > aiGatewayHardLimits.maxResponseBytes) {
    throw new AiGatewayContractError(
      "response_too_large",
      "AI Gateway response exceeded the byte limit.",
    );
  }

  if (!responseValidator(serialized.value)) {
    throw new AiGatewayContractError(
      "invalid_response",
      `ai-gateway-response-v1 validation failed: ${formatValidationErrors(responseValidator.errors)}`,
    );
  }

  return serialized.value as AiGatewayResponse;
};

const clampPolicyValue = (
  candidate: number | undefined,
  hardLimit: number,
): number => {
  if (candidate === undefined || !Number.isFinite(candidate)) {
    return hardLimit;
  }

  return Math.max(1, Math.min(Math.floor(candidate), hardLimit));
};

const resolvePolicy = (
  candidate: AiGatewayExecutionPolicy | undefined,
): ResolvedPolicy => ({
  maxRequestBytes: clampPolicyValue(
    candidate?.maxRequestBytes,
    aiGatewayHardLimits.maxRequestBytes,
  ),
  maxResponseBytes: clampPolicyValue(
    candidate?.maxResponseBytes,
    aiGatewayHardLimits.maxResponseBytes,
  ),
  maxInputTokens: clampPolicyValue(
    candidate?.maxInputTokens,
    aiGatewayHardLimits.maxInputTokens,
  ),
  maxOutputTokens: clampPolicyValue(
    candidate?.maxOutputTokens,
    aiGatewayHardLimits.maxOutputTokens,
  ),
  systemInputTokenReserve: aiGatewayHardLimits.systemInputTokenReserve,
  providerTimeoutMs: clampPolicyValue(
    candidate?.providerTimeoutMs,
    aiGatewayHardLimits.providerTimeoutMs,
  ),
  maxAttempts: clampPolicyValue(
    candidate?.maxAttempts,
    aiGatewayHardLimits.maxAttempts,
  ),
  maxJsonDepth: aiGatewayHardLimits.maxJsonDepth,
  maxJsonNodes: aiGatewayHardLimits.maxJsonNodes,
});

const parseUsage = (candidate: unknown): AiGatewayUsage | undefined => {
  if (
    !isRecord(candidate) ||
    !hasOnlyKeys(candidate, [
      "input_tokens",
      "output_tokens",
      "total_tokens",
    ]) ||
    typeof candidate.input_tokens !== "number" ||
    !Number.isInteger(candidate.input_tokens) ||
    candidate.input_tokens < 0 ||
    typeof candidate.output_tokens !== "number" ||
    !Number.isInteger(candidate.output_tokens) ||
    candidate.output_tokens < 0 ||
    typeof candidate.total_tokens !== "number" ||
    !Number.isInteger(candidate.total_tokens) ||
    candidate.total_tokens < 0 ||
    candidate.total_tokens !== candidate.input_tokens + candidate.output_tokens
  ) {
    return undefined;
  }

  return {
    input_tokens: candidate.input_tokens,
    output_tokens: candidate.output_tokens,
    total_tokens: candidate.total_tokens,
  };
};

const providerFailureCodes = new Set<ProviderFailureCode>([
  "rate_limited",
  "budget_exhausted",
  "timeout",
  "unavailable",
  "policy_blocked",
]);

const parseProviderResult = (
  candidate: unknown,
): ParsedProviderResult | undefined => {
  if (!isRecord(candidate) || typeof candidate.ok !== "boolean") {
    return undefined;
  }

  if (candidate.ok) {
    if (
      !hasOnlyKeys(candidate, ["ok", "output", "finish_reason", "usage"]) ||
      (candidate.finish_reason !== "stop" &&
        candidate.finish_reason !== "length")
    ) {
      return undefined;
    }

    const usage = parseUsage(candidate.usage);
    if (!usage) {
      return undefined;
    }

    return {
      ok: true,
      output: candidate.output,
      finish_reason: candidate.finish_reason,
      usage,
    };
  }

  if (
    !hasOnlyKeys(candidate, ["ok", "error"]) ||
    !isRecord(candidate.error) ||
    !hasOnlyKeys(candidate.error, ["code", "retry_after_seconds"]) ||
    typeof candidate.error.code !== "string" ||
    !providerFailureCodes.has(candidate.error.code as ProviderFailureCode)
  ) {
    return undefined;
  }

  const retryAfter = candidate.error.retry_after_seconds;
  if (
    retryAfter !== undefined &&
    (typeof retryAfter !== "number" ||
      !Number.isInteger(retryAfter) ||
      retryAfter < 1)
  ) {
    return undefined;
  }

  return {
    ok: false,
    error: {
      code: candidate.error.code as ProviderFailureCode,
      ...(retryAfter === undefined
        ? {}
        : { retry_after_seconds: Math.min(retryAfter, 3_600) }),
    },
  };
};

const retryableByCode: Record<AiGatewayErrorCode, boolean> = {
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
};

const buildFailure = (
  code: AiGatewayErrorCode,
  attemptCount: number,
  requestId?: string,
  retryAfterSeconds?: number,
): AiGatewayFailureResponse => ({
  schema_version: "1.0",
  ...(requestId === undefined ? {} : { request_id: requestId }),
  status: "error",
  error: {
    code,
    retryable: retryableByCode[code],
    ...(retryAfterSeconds === undefined
      ? {}
      : { retry_after_seconds: Math.min(retryAfterSeconds, 3_600) }),
  },
  meta: {
    attempt_count: attemptCount,
  },
});

class ProviderTimeoutError extends Error {}

const callProvider = async (
  provider: AiGatewayProviderAdapter,
  request: AiGatewayProviderRequest,
  timeoutMs: number,
): Promise<unknown> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new ProviderTimeoutError());
        controller.abort();
      }, timeoutMs);
    });

    return await Promise.race([
      provider.generate(request, { signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
};

const containsObviousSecretMaterial = (text: string): boolean =>
  [
    /BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/i,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bghp_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  ].some((pattern) => pattern.test(text));

const providerFailureToGatewayCode = (
  code: ProviderFailureCode,
): AiGatewayErrorCode => {
  switch (code) {
    case "rate_limited":
      return "rate_limited";
    case "budget_exhausted":
      return "budget_exhausted";
    case "timeout":
      return "provider_timeout";
    case "unavailable":
      return "provider_unavailable";
    case "policy_blocked":
      return "policy_blocked";
  }
};

export const executeAiGatewayRequest = async <
  TInput extends JsonObject,
  TResult extends JsonObject,
>(
  candidate: unknown,
  options: AiGatewayExecutionOptions<TInput, TResult>,
): Promise<AiGatewayResponse<TResult>> => {
  const policy = resolvePolicy(options.policy);
  let request: AiGatewayRequest;

  try {
    const serializedRequest = serializeJson(candidate, "invalid_request");
    if (serializedRequest.bytes > policy.maxRequestBytes) {
      return buildFailure("request_too_large", 0);
    }
    request = validateAiGatewayRequest(serializedRequest.value);
  } catch (error) {
    if (error instanceof AiGatewayContractError) {
      return buildFailure(
        error.code === "invalid_response" ? "internal_error" : error.code,
        0,
      );
    }
    return buildFailure("internal_error", 0);
  }

  if (request.operation !== options.operation.id) {
    return buildFailure("invalid_request", 0, request.request_id);
  }

  let preparedInput: JsonObject;
  let serializedInput: ReturnType<typeof serializeJson>;
  try {
    preparedInput = options.operation.validateInput(request.input);
    serializedInput = serializeJson(preparedInput, "invalid_request");
    if (!isRecord(serializedInput.value)) {
      return buildFailure("invalid_request", 0, request.request_id);
    }
    preparedInput = serializedInput.value as JsonObject;
    assertJsonComplexity(
      preparedInput,
      policy.maxJsonDepth,
      policy.maxJsonNodes,
    );
    assertNoClientControlFields(preparedInput);
  } catch {
    return buildFailure("invalid_request", 0, request.request_id);
  }

  const conservativeInputTokens =
    serializedInput.bytes + policy.systemInputTokenReserve;
  if (conservativeInputTokens > policy.maxInputTokens) {
    return buildFailure("input_token_limit_exceeded", 0, request.request_id);
  }

  const providerRequest: AiGatewayProviderRequest = {
    request_id: request.request_id,
    lab_id: request.lab_id,
    operation: request.operation,
    input: preparedInput,
    limits: {
      max_input_tokens: policy.maxInputTokens,
      max_output_tokens: policy.maxOutputTokens,
    },
  };

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    let rawProviderResult: unknown;

    try {
      rawProviderResult = await callProvider(
        options.provider,
        providerRequest,
        policy.providerTimeoutMs,
      );
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        return buildFailure("provider_timeout", attempt, request.request_id);
      }

      if (attempt < policy.maxAttempts) {
        continue;
      }

      return buildFailure("provider_unavailable", attempt, request.request_id);
    }

    const providerResult = parseProviderResult(rawProviderResult);
    if (!providerResult) {
      if (attempt < policy.maxAttempts) {
        continue;
      }
      return buildFailure(
        "invalid_provider_response",
        attempt,
        request.request_id,
      );
    }

    if (!providerResult.ok) {
      if (
        providerResult.error.code === "unavailable" &&
        attempt < policy.maxAttempts
      ) {
        continue;
      }

      return buildFailure(
        providerFailureToGatewayCode(providerResult.error.code),
        attempt,
        request.request_id,
        providerResult.error.retry_after_seconds,
      );
    }

    if (
      providerResult.finish_reason === "length" ||
      providerResult.usage.output_tokens > policy.maxOutputTokens
    ) {
      return buildFailure(
        "output_token_limit_exceeded",
        attempt,
        request.request_id,
      );
    }

    if (providerResult.usage.input_tokens > policy.maxInputTokens) {
      if (attempt < policy.maxAttempts) {
        continue;
      }
      return buildFailure(
        "invalid_provider_response",
        attempt,
        request.request_id,
      );
    }

    let result: TResult;
    let serializedResult: ReturnType<typeof serializeJson>;
    try {
      result = options.operation.validateOutput(providerResult.output);
      serializedResult = serializeJson(result, "response_too_large");
      if (
        !isRecord(serializedResult.value) ||
        containsObviousSecretMaterial(serializedResult.text)
      ) {
        return buildFailure("policy_blocked", attempt, request.request_id);
      }
      result = serializedResult.value as TResult;
    } catch {
      if (attempt < policy.maxAttempts) {
        continue;
      }
      return buildFailure(
        "invalid_provider_response",
        attempt,
        request.request_id,
      );
    }

    const response: AiGatewaySuccessResponse<TResult> = {
      schema_version: "1.0",
      request_id: request.request_id,
      status: "ok",
      result,
      usage: providerResult.usage,
      meta: {
        attempt_count: attempt,
      },
    };
    const serializedResponse = serializeJson(response, "response_too_large");
    if (serializedResponse.bytes > policy.maxResponseBytes) {
      return buildFailure("response_too_large", attempt, request.request_id);
    }

    try {
      validateAiGatewayResponse(serializedResponse.value);
    } catch {
      return buildFailure(
        "invalid_provider_response",
        attempt,
        request.request_id,
      );
    }

    return response;
  }

  return buildFailure("internal_error", policy.maxAttempts, request.request_id);
};

export const aiGatewayErrorHttpStatus: Readonly<
  Record<AiGatewayErrorCode, number>
> = Object.freeze({
  invalid_request: 400,
  request_too_large: 413,
  input_token_limit_exceeded: 413,
  rate_limited: 429,
  budget_exhausted: 429,
  provider_timeout: 504,
  provider_unavailable: 503,
  invalid_provider_response: 502,
  output_token_limit_exceeded: 502,
  response_too_large: 502,
  policy_blocked: 422,
  internal_error: 500,
});
