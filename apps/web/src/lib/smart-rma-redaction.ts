import {
  type RedactionReport,
  redactTextWithReport,
} from "@margrop-labs/redaction";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import boundaryProjectionSchema from "../../../../schemas/smart-rma-boundary-projection-v1.schema.json";
import {
  type SmartRmaAtaAttribute,
  type SmartRmaDeviceKind,
  type SmartRmaMissingField,
  type SmartRmaParseResult,
  type SmartRmaProtocol,
  type SmartRmaReportedHealth,
  type SmartRmaSignal,
  type SmartRmaSupport,
  SmartRmaParserError,
  parseSmartctlText,
} from "./smart-rma-parser";

export const smartRmaRedactionLimits = Object.freeze({
  maximumRedactedBytes: 128 * 1024,
});

export type SmartRmaPrivacyCounts = {
  authorization: number;
  cookie: number;
  token: number;
  email: number;
  ip: number;
  domain: number;
  serial_number: number;
  wwn: number;
};

export type SmartRmaBoundaryAtaAttribute = Pick<
  SmartRmaAtaAttribute,
  | "id"
  | "normalized_value"
  | "worst_value"
  | "threshold"
  | "when_failed"
  | "raw_value"
>;

export type SmartRmaBoundaryProjection = {
  schema_version: "1.0";
  parser_version: "1.0";
  redactor_version: "1.0";
  protocol: SmartRmaProtocol;
  device_kind: SmartRmaDeviceKind;
  smart_support: SmartRmaSupport;
  reported_overall_health: SmartRmaReportedHealth;
  signals: SmartRmaSignal[];
  missing_fields: SmartRmaMissingField[];
  temperature_celsius: number | null;
  power_on_hours: number | null;
  ata: {
    attributes: SmartRmaBoundaryAtaAttribute[];
    error_count: number | null;
    self_test_failure_count: number;
  };
  nvme: SmartRmaParseResult["nvme"];
  privacy: {
    redactions_total: number;
    counts: SmartRmaPrivacyCounts;
  };
};

export type SmartRmaRedactionPreview = {
  redacted_text: string;
  parse_result: SmartRmaParseResult;
  projection: SmartRmaBoundaryProjection;
};

export type SmartRmaBoundary =
  "url" | "log" | "analytics" | "ai-request" | "export";

export type SmartRmaBoundaryPayload =
  | {
      lab_id: "smart-rma";
      view: "workbench";
    }
  | {
      lab_id: "smart-rma";
      action: "redact";
      outcome: "success";
      redactions_total: number;
    }
  | {
      lab_id: "smart-rma";
      event_name: "redact_success";
      protocol: SmartRmaProtocol;
    }
  | SmartRmaBoundaryProjection;

export class SmartRmaRedactionError extends Error {
  readonly code:
    | "invalid-input"
    | "input-too-large"
    | "unsupported-format"
    | "output-too-large"
    | "invalid-projection";

  constructor(code: SmartRmaRedactionError["code"], message: string) {
    super(message);
    this.name = "SmartRmaRedactionError";
    this.code = code;
  }
}

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
const validateBoundaryProjectionSchema: ValidateFunction<SmartRmaBoundaryProjection> =
  ajv.compile(boundaryProjectionSchema as AnySchema);

export const validateSmartRmaBoundaryProjection = (
  candidate: unknown,
): SmartRmaBoundaryProjection => {
  if (!validateBoundaryProjectionSchema(candidate)) {
    throw new SmartRmaRedactionError(
      "invalid-projection",
      `SMART boundary projection did not match smart-rma-boundary-projection-v1: ${formatValidationErrors(validateBoundaryProjectionSchema.errors)}`,
    );
  }

  return candidate as SmartRmaBoundaryProjection;
};

const privacyCounts = (report: RedactionReport): SmartRmaPrivacyCounts => ({
  authorization: report.counts.authorization ?? 0,
  cookie: report.counts.cookie ?? 0,
  token: report.counts.token ?? 0,
  email: report.counts.email ?? 0,
  ip: report.counts.ip ?? 0,
  domain: report.counts.domain ?? 0,
  serial_number: report.counts["serial-number"] ?? 0,
  wwn: report.counts.wwn ?? 0,
});

export const createSmartRmaBoundaryProjection = (
  parsed: SmartRmaParseResult,
  report: RedactionReport,
): SmartRmaBoundaryProjection =>
  validateSmartRmaBoundaryProjection({
    schema_version: "1.0",
    parser_version: parsed.parser_version,
    redactor_version: "1.0",
    protocol: parsed.protocol,
    device_kind: parsed.device_kind,
    smart_support: parsed.smart_support,
    reported_overall_health: parsed.reported_overall_health,
    signals: [...parsed.signals],
    missing_fields: [...parsed.missing_fields],
    temperature_celsius: parsed.temperature_celsius,
    power_on_hours: parsed.power_on_hours,
    ata: {
      attributes: parsed.ata.attributes
        .filter(({ recognized }) => recognized)
        .map(
          ({
            id,
            normalized_value,
            worst_value,
            threshold,
            when_failed,
            raw_value,
          }) => ({
            id,
            normalized_value,
            worst_value,
            threshold,
            when_failed,
            raw_value,
          }),
        ),
      error_count: parsed.ata.error_count,
      self_test_failure_count: parsed.ata.self_test_failure_count,
    },
    nvme: {
      critical_warning: parsed.nvme.critical_warning,
      available_spare_percent: parsed.nvme.available_spare_percent,
      available_spare_threshold_percent:
        parsed.nvme.available_spare_threshold_percent,
      percentage_used: parsed.nvme.percentage_used,
      media_errors: parsed.nvme.media_errors,
      error_log_entries: parsed.nvme.error_log_entries,
    },
    privacy: {
      redactions_total: report.total,
      counts: privacyCounts(report),
    },
  });

const translateParserError = (error: SmartRmaParserError): never => {
  const code =
    error.code === "invalid-result" ? "invalid-projection" : error.code;
  throw new SmartRmaRedactionError(code, error.message);
};

export const redactSmartctlText = (
  candidate: unknown,
): SmartRmaRedactionPreview => {
  let parsed: SmartRmaParseResult;
  try {
    parsed = parseSmartctlText(candidate);
  } catch (error) {
    if (error instanceof SmartRmaParserError) {
      return translateParserError(error);
    }
    throw error;
  }

  const redacted = redactTextWithReport(candidate as string);
  if (
    new TextEncoder().encode(redacted.text).byteLength >
    smartRmaRedactionLimits.maximumRedactedBytes
  ) {
    throw new SmartRmaRedactionError(
      "output-too-large",
      "Redacted SMART preview exceeded its deterministic size limit.",
    );
  }

  return {
    redacted_text: redacted.text,
    parse_result: parsed,
    projection: createSmartRmaBoundaryProjection(parsed, redacted.report),
  };
};

export const createSmartRmaBoundaryPayload = (
  candidate: unknown,
  boundary: SmartRmaBoundary,
): SmartRmaBoundaryPayload => {
  const projection = validateSmartRmaBoundaryProjection(candidate);

  switch (boundary) {
    case "url":
      return {
        lab_id: "smart-rma",
        view: "workbench",
      };
    case "log":
      return {
        lab_id: "smart-rma",
        action: "redact",
        outcome: "success",
        redactions_total: projection.privacy.redactions_total,
      };
    case "analytics":
      return {
        lab_id: "smart-rma",
        event_name: "redact_success",
        protocol: projection.protocol,
      };
    case "ai-request":
    case "export":
      return projection;
  }
};
