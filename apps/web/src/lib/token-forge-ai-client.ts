import {
  type AiGatewayResponse,
  validateAiGatewayResponse,
} from "@margrop-labs/ai-gateway";

import type { GitHubPublicRepositorySummary } from "./github-public-repository";
import {
  type TokenForgeAiFallbackReason,
  type TokenForgeAiPlanJson,
  type TokenForgeAiPlanningResult,
  TokenForgeAiPreparationError,
  prepareTokenForgeAiInput,
  tokenForgeAiOperationId,
} from "./token-forge-ai";
import {
  type TokenForgeInput,
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const endpoint = "/api/token-forge/plan";
const responseLimitBytes = 64 * 1024;
const clientTimeoutMs = 20_000;

const fallback = (
  input: TokenForgeInput,
  reason: TokenForgeAiFallbackReason,
  attemptCount = 0,
): TokenForgeAiPlanningResult => ({
  status: "template-fallback",
  plan: generateTokenForgeTemplatePlan(input),
  fallback_reason: reason,
  gateway: {
    attempt_count: attemptCount,
  },
});

const boundedResponseJson = async (response: Response): Promise<unknown> => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > responseLimitBytes) {
    throw new RangeError("response-too-large");
  }
  if (response.body === null) {
    throw new TypeError("missing-response");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        text += decoder.decode();
        break;
      }

      bytes += next.value.byteLength;
      if (bytes > responseLimitBytes) {
        await reader.cancel();
        throw new RangeError("response-too-large");
      }
      text += decoder.decode(next.value, { stream: true });
    }
    return JSON.parse(text) as unknown;
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
};

export type TokenForgeAiClientOptions = {
  fetch?: typeof fetch;
  requestId?: () => string;
};

export const requestTokenForgeAiPlan = async (
  candidate: unknown,
  repositorySummary?: GitHubPublicRepositorySummary,
  options: TokenForgeAiClientOptions = {},
): Promise<TokenForgeAiPlanningResult> => {
  const input = validateTokenForgeInput(candidate);
  let providerInput;

  try {
    providerInput = prepareTokenForgeAiInput(input, repositorySummary);
  } catch (error) {
    return fallback(
      input,
      error instanceof TokenForgeAiPreparationError
        ? `preparation_${error.code}`
        : "preparation_invalid_repository_summary",
    );
  }

  const requestId = options.requestId?.() ?? crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), clientTimeoutMs);
  let gatewayResponse: AiGatewayResponse;
  let responseReceived = false;

  try {
    const response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        schema_version: "1.0",
        request_id: requestId,
        lab_id: "token-forge",
        operation: tokenForgeAiOperationId,
        input: providerInput,
      }),
    });
    responseReceived = true;
    gatewayResponse = validateAiGatewayResponse(
      await boundedResponseJson(response),
    );
  } catch (error) {
    return fallback(
      input,
      controller.signal.aborted
        ? "gateway_provider_timeout"
        : error instanceof RangeError
          ? "gateway_response_too_large"
          : responseReceived
            ? "gateway_invalid_provider_response"
            : "gateway_provider_unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (
    gatewayResponse.request_id !== undefined &&
    gatewayResponse.request_id !== requestId
  ) {
    return fallback(
      input,
      "gateway_invalid_provider_response",
      gatewayResponse.meta.attempt_count,
    );
  }

  if (gatewayResponse.status === "error") {
    return fallback(
      input,
      `gateway_${gatewayResponse.error.code}`,
      gatewayResponse.meta.attempt_count,
    );
  }

  try {
    const plan = validateTokenForgePlan(
      input,
      gatewayResponse.result,
    ) as TokenForgeAiPlanJson;
    if (plan.mode !== "ai-assisted") {
      throw new TypeError("invalid-mode");
    }

    return {
      status: "ai-assisted",
      plan,
      gateway: {
        usage: gatewayResponse.usage,
        attempt_count: gatewayResponse.meta.attempt_count,
      },
    };
  } catch {
    return fallback(
      input,
      "gateway_invalid_provider_response",
      gatewayResponse.meta.attempt_count,
    );
  }
};
