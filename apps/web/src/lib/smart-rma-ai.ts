import {
  type AiGatewayResponse,
  validateAiGatewayResponse,
} from "@margrop-labs/ai-gateway";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import aiExplanationSchema from "../../../../schemas/smart-rma-ai-explanation-v1.schema.json";
import aiBoundarySchema from "../../../../schemas/smart-rma-ai-boundary-v1.schema.json";
import aiInputSchema from "../../../../schemas/smart-rma-ai-input-v1.schema.json";
import boundarySchema from "../../../../schemas/smart-rma-boundary-projection-v1.schema.json";
import healthSchema from "../../../../schemas/smart-rma-health-assessment-v1.schema.json";
import type {
  SmartRmaHealthAssessment,
  SmartRmaHealthRule,
  SmartRmaRecommendedAction,
  SmartRmaUnknownReason,
} from "./smart-rma-health";
import type { SmartRmaBoundaryProjection } from "./smart-rma-redaction";

export const smartRmaAiOperationId = "smart-rma.explain-v1";
export const smartRmaAiEndpointPath = "/api/smart-rma/explain";

export type SmartRmaAiBoundary = Omit<SmartRmaBoundaryProjection, "privacy">;

export type SmartRmaAiInput = {
  schema_version: "1.0";
  boundary: SmartRmaAiBoundary;
  assessment: SmartRmaHealthAssessment;
  safeguards: {
    raw_text_present: false;
    warranty_decision_allowed: false;
    unknowns_must_remain_unknown: true;
  };
};

export type SmartRmaAiExplanation = {
  schema_version: "1.0";
  plain_language_summary: string;
  evidence_explanations: Array<{
    rule: SmartRmaHealthRule;
    explanation: string;
  }>;
  unknown_explanations: Array<{
    reason: SmartRmaUnknownReason;
    explanation: string;
  }>;
  next_step_explanations: Array<{
    action: SmartRmaRecommendedAction;
    explanation: string;
  }>;
  warranty_assessment: "not-determined";
};

export type SmartRmaAiFallbackReason =
  | "provider_unavailable"
  | "provider_timeout"
  | "rate_limited"
  | "budget_exhausted"
  | "invalid_response"
  | "policy_blocked";

export type SmartRmaAiResult =
  | {
      status: "ready";
      assessment: SmartRmaHealthAssessment;
      explanation: SmartRmaAiExplanation;
      gateway: { attempt_count: number };
    }
  | {
      status: "unavailable";
      assessment: SmartRmaHealthAssessment;
      fallback_reason: SmartRmaAiFallbackReason;
      gateway: { attempt_count: number };
    };

export class SmartRmaAiContractError extends Error {
  override name = "SmartRmaAiContractError";
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(boundarySchema as AnySchema);
ajv.addSchema(aiBoundarySchema as AnySchema);
ajv.addSchema(healthSchema as AnySchema);
const validateInputSchema: ValidateFunction<SmartRmaAiInput> = ajv.compile(
  aiInputSchema as AnySchema,
);
const validateExplanationSchema: ValidateFunction<SmartRmaAiExplanation> =
  ajv.compile(aiExplanationSchema as AnySchema);

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");

export const validateSmartRmaAiInput = (
  candidate: unknown,
): SmartRmaAiInput => {
  if (!validateInputSchema(candidate)) {
    throw new SmartRmaAiContractError(
      `SMART AI input did not match smart-rma-ai-input-v1: ${formatValidationErrors(validateInputSchema.errors)}`,
    );
  }
  return candidate as SmartRmaAiInput;
};

const warrantyClaimPattern =
  /(?:必须保修|保证\s*(?:rma|售后|换新)|厂商(?:必须|一定)|warranty\s+(?:eligible|approved|guaranteed)|guaranteed\s+rma|must\s+(?:honou?r|approve|replace))/iu;

const unique = (values: readonly string[]): boolean =>
  new Set(values).size === values.length;

export const validateSmartRmaAiExplanation = (
  candidate: unknown,
  input: SmartRmaAiInput,
): SmartRmaAiExplanation => {
  if (!validateExplanationSchema(candidate)) {
    throw new SmartRmaAiContractError(
      `SMART AI explanation did not match smart-rma-ai-explanation-v1: ${formatValidationErrors(validateExplanationSchema.errors)}`,
    );
  }
  const explanation = candidate as SmartRmaAiExplanation;
  const rules = explanation.evidence_explanations.map(({ rule }) => rule);
  const unknowns = explanation.unknown_explanations.map(({ reason }) => reason);
  const actions = explanation.next_step_explanations.map(
    ({ action }) => action,
  );
  if (
    !unique(rules) ||
    !rules.every((rule) => input.assessment.triggered_rules.includes(rule)) ||
    !unique(unknowns) ||
    !unknowns.every((reason) =>
      input.assessment.unknown_reasons.includes(reason),
    ) ||
    !unique(actions) ||
    !actions.every((action) =>
      input.assessment.recommended_actions.includes(action),
    )
  ) {
    throw new SmartRmaAiContractError(
      "SMART AI explanation contains a reference that is absent from the deterministic input.",
    );
  }
  if (warrantyClaimPattern.test(JSON.stringify(explanation))) {
    throw new SmartRmaAiContractError(
      "SMART AI explanation contains a prohibited warranty conclusion.",
    );
  }
  return explanation;
};

export const buildSmartRmaAiInput = (
  boundary: SmartRmaBoundaryProjection,
  assessment: SmartRmaHealthAssessment,
): SmartRmaAiInput => {
  const aiBoundary: SmartRmaAiBoundary = {
    schema_version: boundary.schema_version,
    parser_version: boundary.parser_version,
    redactor_version: boundary.redactor_version,
    protocol: boundary.protocol,
    device_kind: boundary.device_kind,
    smart_support: boundary.smart_support,
    reported_overall_health: boundary.reported_overall_health,
    signals: [...boundary.signals],
    missing_fields: [...boundary.missing_fields],
    temperature_celsius: boundary.temperature_celsius,
    power_on_hours: boundary.power_on_hours,
    ata: {
      attributes: boundary.ata.attributes.map((attribute) => ({
        ...attribute,
      })),
      error_count: boundary.ata.error_count,
      self_test_failure_count: boundary.ata.self_test_failure_count,
    },
    nvme: { ...boundary.nvme },
  };
  return validateSmartRmaAiInput({
    schema_version: "1.0",
    boundary: aiBoundary,
    assessment,
    safeguards: {
      raw_text_present: false,
      warranty_decision_allowed: false,
      unknowns_must_remain_unknown: true,
    },
  });
};

const responseLimitBytes = 64 * 1024;
const clientTimeoutMs = 50_000;

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

const gatewayFallbackReason = (
  response: AiGatewayResponse,
): SmartRmaAiFallbackReason => {
  if (response.status === "ok") return "invalid_response";
  if (response.error.code === "provider_timeout") return "provider_timeout";
  if (response.error.code === "rate_limited") return "rate_limited";
  if (response.error.code === "budget_exhausted") return "budget_exhausted";
  if (response.error.code === "policy_blocked") return "policy_blocked";
  if (response.error.code === "invalid_provider_response")
    return "invalid_response";
  return "provider_unavailable";
};

export type SmartRmaAiClientOptions = {
  fetch?: typeof fetch;
  requestId?: () => string;
};

export const requestSmartRmaAiExplanation = async (
  boundary: SmartRmaBoundaryProjection,
  assessment: SmartRmaHealthAssessment,
  options: SmartRmaAiClientOptions = {},
): Promise<SmartRmaAiResult> => {
  const input = buildSmartRmaAiInput(boundary, assessment);
  const requestId = options.requestId?.() ?? crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), clientTimeoutMs);
  let responseReceived = false;
  let gateway: AiGatewayResponse;
  try {
    const response = await (options.fetch ?? fetch)(smartRmaAiEndpointPath, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema_version: "1.0",
        request_id: requestId,
        lab_id: "smart-rma",
        operation: smartRmaAiOperationId,
        input,
      }),
    });
    responseReceived = true;
    gateway = validateAiGatewayResponse(await boundedResponseJson(response));
  } catch {
    return {
      status: "unavailable",
      assessment,
      fallback_reason: controller.signal.aborted
        ? "provider_timeout"
        : responseReceived
          ? "invalid_response"
          : "provider_unavailable",
      gateway: { attempt_count: 0 },
    };
  } finally {
    clearTimeout(timeout);
  }

  if (gateway.request_id !== undefined && gateway.request_id !== requestId) {
    return {
      status: "unavailable",
      assessment,
      fallback_reason: "invalid_response",
      gateway: { attempt_count: gateway.meta.attempt_count },
    };
  }
  if (gateway.status === "error") {
    return {
      status: "unavailable",
      assessment,
      fallback_reason: gatewayFallbackReason(gateway),
      gateway: { attempt_count: gateway.meta.attempt_count },
    };
  }
  try {
    return {
      status: "ready",
      assessment,
      explanation: validateSmartRmaAiExplanation(gateway.result, input),
      gateway: { attempt_count: gateway.meta.attempt_count },
    };
  } catch {
    return {
      status: "unavailable",
      assessment,
      fallback_reason: "invalid_response",
      gateway: { attempt_count: gateway.meta.attempt_count },
    };
  }
};
