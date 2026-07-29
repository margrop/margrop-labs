import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import healthAssessmentSchema from "../../../../schemas/smart-rma-health-assessment-v1.schema.json";
import type { SmartRmaReportedHealth } from "./smart-rma-parser";
import type { SmartRmaBoundaryProjection } from "./smart-rma-redaction";

export type SmartRmaHealthState =
  "healthy" | "warning" | "critical" | "unknown";
export type SmartRmaHealthConfidence = "complete" | "partial" | "insufficient";
export type SmartRmaHealthRule =
  | "reported-failure"
  | "ata-reallocated-sectors"
  | "ata-pending-sectors"
  | "ata-uncorrectable-sectors"
  | "ata-error-log"
  | "ata-self-test-failures"
  | "nvme-critical-warning"
  | "nvme-spare-below-threshold"
  | "nvme-media-errors"
  | "nvme-wear-high"
  | "nvme-wear-exhausted"
  | "healthy-baseline"
  | "smart-unavailable"
  | "insufficient-core-evidence";
export type SmartRmaHealthConflict =
  | "reported-passed-with-warning-evidence"
  | "reported-passed-with-critical-evidence";
export type SmartRmaUnknownReason =
  | "smart-unavailable"
  | "protocol-unknown"
  | "overall-health-missing"
  | "temperature-missing"
  | "power-on-hours-missing"
  | "identification-incomplete"
  | "vendor-extension-uninterpreted";
export type SmartRmaRecommendedAction =
  | "continue-monitoring"
  | "keep-current-backups"
  | "backup-now"
  | "run-extended-self-test"
  | "capture-vendor-diagnostics"
  | "consider-replacement"
  | "stop-nonessential-writes"
  | "replace-drive"
  | "prepare-rma-evidence"
  | "use-direct-connection"
  | "enable-smart"
  | "collect-complete-output";

export type SmartRmaHealthAssessment = {
  schema_version: "1.0";
  ruleset_version: "1.0";
  state: SmartRmaHealthState;
  confidence: SmartRmaHealthConfidence;
  reported_overall_health: SmartRmaReportedHealth;
  triggered_rules: SmartRmaHealthRule[];
  conflicts: SmartRmaHealthConflict[];
  unknown_reasons: SmartRmaUnknownReason[];
  recommended_actions: SmartRmaRecommendedAction[];
  warranty_assessment: "not-determined";
};

export class SmartRmaHealthError extends Error {
  override name = "SmartRmaHealthError";
}

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateHealthSchema: ValidateFunction<SmartRmaHealthAssessment> =
  ajv.compile(healthAssessmentSchema as AnySchema);

export const validateSmartRmaHealthAssessment = (
  candidate: unknown,
): SmartRmaHealthAssessment => {
  if (!validateHealthSchema(candidate)) {
    throw new SmartRmaHealthError(
      `SMART health assessment did not match smart-rma-health-assessment-v1: ${formatValidationErrors(validateHealthSchema.errors)}`,
    );
  }
  return candidate as SmartRmaHealthAssessment;
};

const hasPositiveAtaAttribute = (
  projection: SmartRmaBoundaryProjection,
  id: number,
): boolean =>
  projection.ata.attributes.some(
    (attribute) => attribute.id === id && (attribute.raw_value ?? 0) > 0,
  );

const actionsByState: Record<SmartRmaHealthState, SmartRmaRecommendedAction[]> =
  {
    healthy: ["continue-monitoring", "keep-current-backups"],
    warning: [
      "backup-now",
      "run-extended-self-test",
      "capture-vendor-diagnostics",
      "consider-replacement",
    ],
    critical: [
      "backup-now",
      "stop-nonessential-writes",
      "replace-drive",
      "prepare-rma-evidence",
    ],
    unknown: [
      "use-direct-connection",
      "enable-smart",
      "collect-complete-output",
    ],
  };

export const assessSmartRmaHealth = (
  projection: SmartRmaBoundaryProjection,
): SmartRmaHealthAssessment => {
  const criticalRules: SmartRmaHealthRule[] = [];
  const warningRules: SmartRmaHealthRule[] = [];
  const unknownRules: SmartRmaHealthRule[] = [];
  const unknownReasons: SmartRmaUnknownReason[] = [];

  if (projection.reported_overall_health === "failed") {
    criticalRules.push("reported-failure");
  }
  if ((projection.nvme.critical_warning ?? 0) > 0) {
    criticalRules.push("nvme-critical-warning");
  }
  if (
    projection.nvme.available_spare_percent !== null &&
    projection.nvme.available_spare_threshold_percent !== null &&
    projection.nvme.available_spare_percent <
      projection.nvme.available_spare_threshold_percent
  ) {
    criticalRules.push("nvme-spare-below-threshold");
  }
  if ((projection.nvme.media_errors ?? 0) > 0) {
    criticalRules.push("nvme-media-errors");
  }
  if ((projection.nvme.percentage_used ?? 0) >= 100) {
    criticalRules.push("nvme-wear-exhausted");
  } else if ((projection.nvme.percentage_used ?? 0) >= 80) {
    warningRules.push("nvme-wear-high");
  }

  if (hasPositiveAtaAttribute(projection, 5))
    warningRules.push("ata-reallocated-sectors");
  if (hasPositiveAtaAttribute(projection, 197))
    warningRules.push("ata-pending-sectors");
  if (
    hasPositiveAtaAttribute(projection, 187) ||
    hasPositiveAtaAttribute(projection, 198)
  ) {
    warningRules.push("ata-uncorrectable-sectors");
  }
  if ((projection.ata.error_count ?? 0) > 0) warningRules.push("ata-error-log");
  if (projection.ata.self_test_failure_count > 0)
    warningRules.push("ata-self-test-failures");

  if (projection.smart_support === "unavailable") {
    unknownRules.push("smart-unavailable");
    unknownReasons.push("smart-unavailable");
  }
  if (projection.protocol === "unknown")
    unknownReasons.push("protocol-unknown");
  if (projection.missing_fields.includes("overall_health")) {
    unknownReasons.push("overall-health-missing");
  }
  if (projection.missing_fields.includes("temperature")) {
    unknownReasons.push("temperature-missing");
  }
  if (projection.missing_fields.includes("power_on_hours")) {
    unknownReasons.push("power-on-hours-missing");
  }
  if (projection.signals.includes("incomplete-identification")) {
    unknownReasons.push("identification-incomplete");
  }
  if (projection.signals.includes("vendor-extension")) {
    unknownReasons.push("vendor-extension-uninterpreted");
  }

  let state: SmartRmaHealthState;
  let triggeredRules: SmartRmaHealthRule[];
  if (criticalRules.length > 0) {
    state = "critical";
    triggeredRules = [...criticalRules, ...warningRules];
  } else if (warningRules.length > 0) {
    state = "warning";
    triggeredRules = warningRules;
  } else if (
    projection.protocol !== "unknown" &&
    projection.reported_overall_health === "passed" &&
    (projection.smart_support === "available" || projection.protocol === "nvme")
  ) {
    state = "healthy";
    triggeredRules = ["healthy-baseline"];
  } else {
    state = "unknown";
    triggeredRules = [...unknownRules, "insufficient-core-evidence"];
  }

  const conflicts: SmartRmaHealthConflict[] = [];
  if (projection.reported_overall_health === "passed" && state === "warning") {
    conflicts.push("reported-passed-with-warning-evidence");
  }
  if (projection.reported_overall_health === "passed" && state === "critical") {
    conflicts.push("reported-passed-with-critical-evidence");
  }

  const confidence: SmartRmaHealthConfidence =
    state === "unknown"
      ? "insufficient"
      : unknownReasons.length > 0
        ? "partial"
        : "complete";

  return validateSmartRmaHealthAssessment({
    schema_version: "1.0",
    ruleset_version: "1.0",
    state,
    confidence,
    reported_overall_health: projection.reported_overall_health,
    triggered_rules: triggeredRules,
    conflicts,
    unknown_reasons: [...new Set(unknownReasons)],
    recommended_actions: actionsByState[state],
    warranty_assessment: "not-determined",
  });
};
