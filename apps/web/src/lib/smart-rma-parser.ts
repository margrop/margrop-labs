import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import parseResultSchema from "../../../../schemas/smart-rma-parse-result-v1.schema.json";

export type SmartRmaProtocol = "ata" | "nvme" | "unknown";
export type SmartRmaDeviceKind = "hdd" | "ssd" | "nvme" | "unknown";
export type SmartRmaSupport = "available" | "unavailable" | "unknown";
export type SmartRmaReportedHealth = "passed" | "failed" | "unknown";
export type SmartRmaMissingField =
  | "model"
  | "serial_number"
  | "firmware_version"
  | "overall_health"
  | "temperature"
  | "power_on_hours";
export type SmartRmaSignal =
  | "smart-overall-passed"
  | "smart-overall-failed"
  | "ata-reallocated-sectors"
  | "ata-pending-sectors"
  | "ata-uncorrectable-sectors"
  | "ata-error-log"
  | "nvme-critical-warning"
  | "nvme-spare-below-threshold"
  | "nvme-percentage-used"
  | "nvme-media-errors"
  | "vendor-extension"
  | "smart-unavailable"
  | "incomplete-identification";

export type SmartRmaAtaAttribute = {
  id: number;
  name: string;
  normalized_value: number;
  worst_value: number;
  threshold: number;
  type: "pre-fail" | "old-age" | "unknown";
  updated: "always" | "offline" | "unknown";
  when_failed: boolean;
  raw_value: number | null;
  recognized: boolean;
};

export type SmartRmaParseResult = {
  schema_version: "1.0";
  parser_version: "1.0";
  smartctl_version: string;
  protocol: SmartRmaProtocol;
  device_kind: SmartRmaDeviceKind;
  smart_support: SmartRmaSupport;
  reported_overall_health: SmartRmaReportedHealth;
  signals: SmartRmaSignal[];
  missing_fields: SmartRmaMissingField[];
  temperature_celsius: number | null;
  power_on_hours: number | null;
  ata: {
    attributes: SmartRmaAtaAttribute[];
    error_count: number | null;
    self_test_failure_count: number;
  };
  nvme: {
    critical_warning: number | null;
    available_spare_percent: number | null;
    available_spare_threshold_percent: number | null;
    percentage_used: number | null;
    media_errors: number | null;
    error_log_entries: number | null;
  };
};

export class SmartRmaParserError extends Error {
  readonly code:
    | "invalid-input"
    | "input-too-large"
    | "unsupported-format"
    | "invalid-result";

  constructor(code: SmartRmaParserError["code"], message: string) {
    super(message);
    this.name = "SmartRmaParserError";
    this.code = code;
  }
}

const maximumInputBytes = 64 * 1024;
const maximumAtaAttributes = 128;
const recognizedAtaAttributeIds = new Set([5, 9, 187, 194, 197, 198]);
const signalOrder: readonly SmartRmaSignal[] = [
  "smart-overall-passed",
  "smart-overall-failed",
  "ata-reallocated-sectors",
  "ata-pending-sectors",
  "ata-uncorrectable-sectors",
  "ata-error-log",
  "nvme-critical-warning",
  "nvme-spare-below-threshold",
  "nvme-percentage-used",
  "nvme-media-errors",
  "vendor-extension",
  "smart-unavailable",
  "incomplete-identification",
];
const missingFieldOrder: readonly SmartRmaMissingField[] = [
  "model",
  "serial_number",
  "firmware_version",
  "overall_health",
  "temperature",
  "power_on_hours",
];

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
const validateParseResultSchema: ValidateFunction<SmartRmaParseResult> =
  ajv.compile(parseResultSchema as AnySchema);

export const validateSmartRmaParseResult = (
  candidate: unknown,
): SmartRmaParseResult => {
  if (!validateParseResultSchema(candidate)) {
    throw new SmartRmaParserError(
      "invalid-result",
      `SMART parse result did not match smart-rma-parse-result-v1: ${formatValidationErrors(validateParseResultSchema.errors)}`,
    );
  }

  return candidate as SmartRmaParseResult;
};

const parseSafeInteger = (value: string | undefined): number | null => {
  if (value === undefined) {
    return null;
  }

  const match = /^-?[0-9][0-9,]*/u.exec(value.trim());
  if (!match) {
    return null;
  }

  const parsed = Number(match[0].replaceAll(",", ""));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
};

const parsePercent = (value: string | undefined): number | null =>
  parseSafeInteger(value?.replace("%", ""));

const parseHexByte = (value: string | undefined): number | null => {
  if (!value || !/^0x[0-9a-f]{1,2}$/iu.test(value.trim())) {
    return null;
  }

  return Number.parseInt(value.trim().slice(2), 16);
};

const buildLabelMap = (lines: readonly string[]): Map<string, string[]> => {
  const labels = new Map<string, string[]>();

  for (const line of lines) {
    const match = /^\s*([^:]+):\s*(.*?)\s*$/u.exec(line);
    if (!match) {
      continue;
    }

    const label = match[1]?.trim();
    const value = match[2]?.trim();
    if (!label || value === undefined) {
      continue;
    }
    const existing = labels.get(label) ?? [];
    existing.push(value);
    labels.set(label, existing);
  }

  return labels;
};

const firstLabel = (
  labels: ReadonlyMap<string, string[]>,
  label: string,
): string | undefined => labels.get(label)?.[0];

const detectProtocol = (raw: string): SmartRmaProtocol => {
  if (
    /^NVMe Version:/imu.test(raw) ||
    /SMART\/Health Information \(NVMe Log/iu.test(raw)
  ) {
    return "nvme";
  }
  if (
    /^ATA Version is:/imu.test(raw) ||
    /Vendor Specific SMART Attributes with Thresholds:/iu.test(raw)
  ) {
    return "ata";
  }

  return "unknown";
};

const detectDeviceKind = (
  raw: string,
  protocol: SmartRmaProtocol,
): SmartRmaDeviceKind => {
  if (protocol === "nvme") {
    return "nvme";
  }
  if (/^Rotation Rate:\s+Solid State Device\s*$/imu.test(raw)) {
    return "ssd";
  }
  if (/^Rotation Rate:\s+[0-9][0-9,]* rpm\s*$/imu.test(raw)) {
    return "hdd";
  }

  return "unknown";
};

const detectSmartSupport = (raw: string): SmartRmaSupport => {
  if (
    /Read Device Identity failed/iu.test(raw) ||
    /mandatory SMART command failed/iu.test(raw) ||
    /^SMART support is:\s+Unavailable\b/imu.test(raw)
  ) {
    return "unavailable";
  }
  if (
    /^SMART support is:\s+Available\b/imu.test(raw) ||
    /^SMART support is:\s+Enabled\b/imu.test(raw)
  ) {
    return "available";
  }

  return "unknown";
};

const detectReportedHealth = (raw: string): SmartRmaReportedHealth => {
  const match =
    /^SMART overall-health self-assessment test result:\s*(PASSED|FAILED!?)/imu.exec(
      raw,
    );
  if (!match) {
    return "unknown";
  }

  return match[1]?.toUpperCase().startsWith("PASS") ? "passed" : "failed";
};

const normalizeAtaType = (value: string): SmartRmaAtaAttribute["type"] => {
  if (value.toLowerCase() === "pre-fail") {
    return "pre-fail";
  }
  if (value.toLowerCase() === "old_age") {
    return "old-age";
  }

  return "unknown";
};

const normalizeAtaUpdated = (
  value: string,
): SmartRmaAtaAttribute["updated"] => {
  const normalized = value.toLowerCase();
  if (normalized === "always" || normalized === "offline") {
    return normalized;
  }

  return "unknown";
};

const parseAtaAttributes = (
  lines: readonly string[],
): SmartRmaAtaAttribute[] => {
  const attributes: SmartRmaAtaAttribute[] = [];
  const rowPattern =
    /^\s*([0-9]{1,3})\s+([A-Za-z0-9_-]{1,64})\s+0x[0-9a-f]+\s+([0-9]{1,3})\s+([0-9]{1,3})\s+([0-9]{1,3})\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+?)\s*$/iu;

  for (const line of lines) {
    const match = rowPattern.exec(line);
    if (!match) {
      continue;
    }

    const id = Number(match[1]);
    const normalizedValue = Number(match[3]);
    const worstValue = Number(match[4]);
    const threshold = Number(match[5]);
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 255 ||
      [normalizedValue, worstValue, threshold].some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    ) {
      continue;
    }

    attributes.push({
      id,
      name: match[2] ?? "unknown",
      normalized_value: normalizedValue,
      worst_value: worstValue,
      threshold,
      type: normalizeAtaType(match[6] ?? ""),
      updated: normalizeAtaUpdated(match[7] ?? ""),
      when_failed: (match[8] ?? "-") !== "-",
      raw_value: parseSafeInteger(match[9]),
      recognized: recognizedAtaAttributeIds.has(id),
    });

    if (attributes.length >= maximumAtaAttributes) {
      break;
    }
  }

  return attributes;
};

const ataAttributeRawValue = (
  attributes: readonly SmartRmaAtaAttribute[],
  id: number,
): number | null =>
  attributes.find((attribute) => attribute.id === id)?.raw_value ?? null;

const detectMissingFields = ({
  raw,
  reportedHealth,
  temperature,
  powerOnHours,
}: {
  raw: string;
  reportedHealth: SmartRmaReportedHealth;
  temperature: number | null;
  powerOnHours: number | null;
}): SmartRmaMissingField[] => {
  const present = new Set<SmartRmaMissingField>();
  if (/^(?:Device Model|Model Number):\s+\S/imu.test(raw)) {
    present.add("model");
  }
  if (/^Serial Number:\s+\S/imu.test(raw)) {
    present.add("serial_number");
  }
  if (/^Firmware Version:\s+\S/imu.test(raw)) {
    present.add("firmware_version");
  }
  if (reportedHealth !== "unknown") {
    present.add("overall_health");
  }
  if (temperature !== null) {
    present.add("temperature");
  }
  if (powerOnHours !== null) {
    present.add("power_on_hours");
  }

  return missingFieldOrder.filter((field) => !present.has(field));
};

const collectSignals = ({
  protocol,
  smartSupport,
  reportedHealth,
  missingFields,
  ataAttributes,
  ataErrorCount,
  nvmeCriticalWarning,
  nvmeAvailableSpare,
  nvmeSpareThreshold,
  nvmePercentageUsed,
  nvmeMediaErrors,
}: {
  protocol: SmartRmaProtocol;
  smartSupport: SmartRmaSupport;
  reportedHealth: SmartRmaReportedHealth;
  missingFields: readonly SmartRmaMissingField[];
  ataAttributes: readonly SmartRmaAtaAttribute[];
  ataErrorCount: number | null;
  nvmeCriticalWarning: number | null;
  nvmeAvailableSpare: number | null;
  nvmeSpareThreshold: number | null;
  nvmePercentageUsed: number | null;
  nvmeMediaErrors: number | null;
}): SmartRmaSignal[] => {
  const signals = new Set<SmartRmaSignal>();

  if (reportedHealth === "passed") {
    signals.add("smart-overall-passed");
  } else if (reportedHealth === "failed") {
    signals.add("smart-overall-failed");
  }
  if ((ataAttributeRawValue(ataAttributes, 5) ?? 0) > 0) {
    signals.add("ata-reallocated-sectors");
  }
  if ((ataAttributeRawValue(ataAttributes, 197) ?? 0) > 0) {
    signals.add("ata-pending-sectors");
  }
  if (
    (ataAttributeRawValue(ataAttributes, 198) ?? 0) > 0 ||
    (ataAttributeRawValue(ataAttributes, 187) ?? 0) > 0
  ) {
    signals.add("ata-uncorrectable-sectors");
  }
  if ((ataErrorCount ?? 0) > 0) {
    signals.add("ata-error-log");
  }
  if ((nvmeCriticalWarning ?? 0) > 0) {
    signals.add("nvme-critical-warning");
  }
  if (
    nvmeAvailableSpare !== null &&
    nvmeSpareThreshold !== null &&
    nvmeAvailableSpare < nvmeSpareThreshold
  ) {
    signals.add("nvme-spare-below-threshold");
  }
  if (nvmePercentageUsed !== null) {
    signals.add("nvme-percentage-used");
  }
  if ((nvmeMediaErrors ?? 0) > 0) {
    signals.add("nvme-media-errors");
  }
  if (ataAttributes.some(({ recognized }) => !recognized)) {
    signals.add("vendor-extension");
  }
  if (smartSupport === "unavailable") {
    signals.add("smart-unavailable");
  }
  if (
    protocol !== "unknown" &&
    smartSupport === "unknown" &&
    missingFields.includes("overall_health")
  ) {
    signals.add("incomplete-identification");
  }

  return signalOrder.filter((signal) => signals.has(signal));
};

export const parseSmartctlText = (candidate: unknown): SmartRmaParseResult => {
  if (typeof candidate !== "string") {
    throw new SmartRmaParserError(
      "invalid-input",
      "SMART input must be plain text.",
    );
  }

  const inputBytes = new TextEncoder().encode(candidate).byteLength;
  if (inputBytes === 0) {
    throw new SmartRmaParserError(
      "invalid-input",
      "SMART input must not be empty.",
    );
  }
  if (inputBytes > maximumInputBytes) {
    throw new SmartRmaParserError(
      "input-too-large",
      "SMART input must not exceed 64 KiB.",
    );
  }
  if (candidate.includes("\0") || candidate.includes("\uFFFD")) {
    throw new SmartRmaParserError(
      "invalid-input",
      "SMART input contains unsupported text characters.",
    );
  }

  const raw = candidate.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const versionMatch = /^smartctl\s+([0-9]+\.[0-9]+)\b/iu.exec(raw);
  if (!versionMatch?.[1]) {
    throw new SmartRmaParserError(
      "unsupported-format",
      "Input is not a supported smartctl text report.",
    );
  }

  const lines = raw.split("\n");
  const labels = buildLabelMap(lines);
  const protocol = detectProtocol(raw);
  const smartSupport = detectSmartSupport(raw);
  const reportedHealth = detectReportedHealth(raw);
  const ataAttributes = parseAtaAttributes(lines);
  const ataErrorCount = parseSafeInteger(
    /^ATA Error Count:\s*([0-9][0-9,]*)/imu.exec(raw)?.[1],
  );
  const nvmeCriticalWarning = parseHexByte(
    firstLabel(labels, "Critical Warning"),
  );
  const nvmeAvailableSpare = parsePercent(
    firstLabel(labels, "Available Spare"),
  );
  const nvmeSpareThreshold = parsePercent(
    firstLabel(labels, "Available Spare Threshold"),
  );
  const nvmePercentageUsed = parsePercent(
    firstLabel(labels, "Percentage Used"),
  );
  const nvmeMediaErrors = parseSafeInteger(
    firstLabel(labels, "Media and Data Integrity Errors"),
  );
  const nvmeErrorLogEntries = parseSafeInteger(
    firstLabel(labels, "Error Information Log Entries"),
  );
  const nvmeTemperature = parseSafeInteger(firstLabel(labels, "Temperature"));
  const ataTemperature = ataAttributeRawValue(ataAttributes, 194);
  const temperature = protocol === "nvme" ? nvmeTemperature : ataTemperature;
  const nvmePowerOnHours = parseSafeInteger(
    firstLabel(labels, "Power On Hours"),
  );
  const ataPowerOnHours = ataAttributeRawValue(ataAttributes, 9);
  const powerOnHours = protocol === "nvme" ? nvmePowerOnHours : ataPowerOnHours;
  const missingFields = detectMissingFields({
    raw,
    reportedHealth,
    temperature,
    powerOnHours,
  });
  const signals = collectSignals({
    protocol,
    smartSupport,
    reportedHealth,
    missingFields,
    ataAttributes,
    ataErrorCount,
    nvmeCriticalWarning,
    nvmeAvailableSpare,
    nvmeSpareThreshold,
    nvmePercentageUsed,
    nvmeMediaErrors,
  });
  const selfTestFailureCount = lines.filter(
    (line) =>
      /^#\s*[0-9]+\s+/u.test(line) &&
      /(?:read failure|write failure|failed)/iu.test(line),
  ).length;

  return validateSmartRmaParseResult({
    schema_version: "1.0",
    parser_version: "1.0",
    smartctl_version: versionMatch[1],
    protocol,
    device_kind: detectDeviceKind(raw, protocol),
    smart_support: smartSupport,
    reported_overall_health: reportedHealth,
    signals,
    missing_fields: missingFields,
    temperature_celsius: temperature,
    power_on_hours: powerOnHours,
    ata: {
      attributes: ataAttributes,
      error_count: ataErrorCount,
      self_test_failure_count: selfTestFailureCount,
    },
    nvme: {
      critical_warning: nvmeCriticalWarning,
      available_spare_percent: nvmeAvailableSpare,
      available_spare_threshold_percent: nvmeSpareThreshold,
      percentage_used: nvmePercentageUsed,
      media_errors: nvmeMediaErrors,
      error_log_entries: nvmeErrorLogEntries,
    },
  });
};
