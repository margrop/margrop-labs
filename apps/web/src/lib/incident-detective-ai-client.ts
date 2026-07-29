import {
  type AiGatewayErrorCode,
  type AiGatewayResponse,
  validateAiGatewayResponse,
} from "@margrop-labs/ai-gateway";

import {
  type IncidentDetectiveExplanation,
  type IncidentDetectiveExplanationInput,
  incidentDetectiveExplanationOperationId,
  validateIncidentDetectiveExplanation,
  validateIncidentDetectiveExplanationInput,
} from "./incident-detective-ai-explanation";
import {
  type IncidentDetectiveCaseGenerationFailureReason,
  type IncidentDetectiveCaseGenerationInput,
  type IncidentDetectiveCaseGenerationResult,
  postProcessIncidentDetectiveCaseProposal,
  prepareIncidentDetectiveCaseGenerationProviderInput,
  validateIncidentDetectiveCaseGenerationInput,
} from "./incident-detective-case-generation";
import type { IncidentDetectiveScenario } from "./incident-detective-contracts";

const explanationEndpoint = "/api/incident-detective/explanation";
const caseProposalEndpoint = "/api/incident-detective/case-proposal";
const responseLimitBytes = 64 * 1024;
const clientTimeoutMs = 35_000;

export type IncidentDetectiveExplanationFailureReason =
  | `gateway_${AiGatewayErrorCode}`
  | "gateway_provider_timeout"
  | "gateway_provider_unavailable"
  | "gateway_response_too_large"
  | "gateway_invalid_provider_response";

export type IncidentDetectiveExplanationResult =
  | {
      status: "ai-assisted";
      explanation: IncidentDetectiveExplanation;
      gateway: {
        usage: {
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
        };
        attempt_count: number;
      };
    }
  | {
      status: "deterministic-fallback";
      failure_reason: IncidentDetectiveExplanationFailureReason;
      gateway: { attempt_count: number };
    };

export type IncidentDetectiveAiClientOptions = {
  fetch?: typeof fetch;
  requestId?: () => string;
  timeoutMs?: number;
};

const boundedResponseJson = async (response: Response): Promise<unknown> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > responseLimitBytes) {
    throw new RangeError("response-too-large");
  }
  if (response.body === null) throw new TypeError("missing-response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        text += decoder.decode();
        return JSON.parse(text) as unknown;
      }
      bytes += next.value.byteLength;
      if (bytes > responseLimitBytes) {
        await reader.cancel();
        throw new RangeError("response-too-large");
      }
      text += decoder.decode(next.value, { stream: true });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
};

const requestGateway = async (
  endpoint: string,
  operation: string,
  input: object,
  options: IncidentDetectiveAiClientOptions,
): Promise<{
  requestId: string;
  response?: AiGatewayResponse;
  transportFailure?: IncidentDetectiveExplanationFailureReason;
}> => {
  const requestId = options.requestId?.() ?? crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? clientTimeoutMs,
  );
  let responseReceived = false;

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: "1.0",
        request_id: requestId,
        lab_id: "incident-detective",
        operation,
        input,
      }),
    });
    responseReceived = true;
    return {
      requestId,
      response: validateAiGatewayResponse(await boundedResponseJson(response)),
    };
  } catch (error) {
    return {
      requestId,
      transportFailure: controller.signal.aborted
        ? "gateway_provider_timeout"
        : error instanceof RangeError
          ? "gateway_response_too_large"
          : responseReceived
            ? "gateway_invalid_provider_response"
            : "gateway_provider_unavailable",
    };
  } finally {
    clearTimeout(timeout);
  }
};

export const requestIncidentDetectiveExplanation = async (
  candidate: unknown,
  options: IncidentDetectiveAiClientOptions = {},
): Promise<IncidentDetectiveExplanationResult> => {
  const input: IncidentDetectiveExplanationInput =
    validateIncidentDetectiveExplanationInput(candidate);
  const gateway = await requestGateway(
    explanationEndpoint,
    incidentDetectiveExplanationOperationId,
    input,
    options,
  );
  if (gateway.transportFailure !== undefined) {
    return {
      status: "deterministic-fallback",
      failure_reason: gateway.transportFailure,
      gateway: { attempt_count: 0 },
    };
  }

  const response = gateway.response;
  if (
    response === undefined ||
    (response.request_id !== undefined &&
      response.request_id !== gateway.requestId)
  ) {
    return {
      status: "deterministic-fallback",
      failure_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: response?.meta.attempt_count ?? 0 },
    };
  }
  if (response.status === "error") {
    return {
      status: "deterministic-fallback",
      failure_reason: `gateway_${response.error.code}`,
      gateway: { attempt_count: response.meta.attempt_count },
    };
  }

  try {
    return {
      status: "ai-assisted",
      explanation: validateIncidentDetectiveExplanation(response.result, input),
      gateway: {
        usage: response.usage,
        attempt_count: response.meta.attempt_count,
      },
    };
  } catch {
    return {
      status: "deterministic-fallback",
      failure_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: response.meta.attempt_count },
    };
  }
};

export const requestIncidentDetectiveCaseProposal = async (
  candidate: unknown,
  baseScenario: IncidentDetectiveScenario,
  options: IncidentDetectiveAiClientOptions = {},
): Promise<IncidentDetectiveCaseGenerationResult> => {
  let input: IncidentDetectiveCaseGenerationInput;
  let providerInput;
  try {
    input = validateIncidentDetectiveCaseGenerationInput(candidate);
    providerInput = prepareIncidentDetectiveCaseGenerationProviderInput(
      input,
      baseScenario,
    );
  } catch {
    return {
      status: "generation-failed",
      failure_reason: "preparation_invalid_input",
      gateway: { attempt_count: 0 },
    };
  }

  const gateway = await requestGateway(
    caseProposalEndpoint,
    "incident-detective.case-proposal-v1",
    input,
    options,
  );
  if (gateway.transportFailure !== undefined) {
    return {
      status: "generation-failed",
      failure_reason:
        gateway.transportFailure as IncidentDetectiveCaseGenerationFailureReason,
      gateway: { attempt_count: 0 },
    };
  }
  const response = gateway.response;
  if (
    response === undefined ||
    (response.request_id !== undefined &&
      response.request_id !== gateway.requestId)
  ) {
    return {
      status: "generation-failed",
      failure_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: response?.meta.attempt_count ?? 0 },
    };
  }
  if (response.status === "error") {
    return {
      status: "generation-failed",
      failure_reason: `gateway_${response.error.code}`,
      gateway: { attempt_count: response.meta.attempt_count },
    };
  }

  try {
    return {
      status: "review-required",
      proposal: postProcessIncidentDetectiveCaseProposal(
        input,
        providerInput,
        response.result,
      ),
      gateway: {
        usage: response.usage,
        attempt_count: response.meta.attempt_count,
      },
    };
  } catch {
    return {
      status: "generation-failed",
      failure_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: response.meta.attempt_count },
    };
  }
};
