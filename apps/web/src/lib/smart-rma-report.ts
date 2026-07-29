import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import reportBundleSchema from "../../../../schemas/smart-rma-report-bundle-v1.schema.json";
import type {
  SmartRmaHealthAssessment,
  SmartRmaHealthConflict,
  SmartRmaHealthRule,
  SmartRmaHealthState,
  SmartRmaRecommendedAction,
  SmartRmaUnknownReason,
} from "./smart-rma-health";
import type { SmartRmaBoundaryProjection } from "./smart-rma-redaction";

export type SmartRmaReportBundle = {
  schema_version: "1.0";
  report_version: "1.0";
  state: SmartRmaHealthState;
  chinese_summary_markdown: string;
  english_rma_markdown: string;
  contains_raw_input: false;
  warranty_assessment: "not-determined";
};

export class SmartRmaReportError extends Error {
  override name = "SmartRmaReportError";
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
const validateReportSchema: ValidateFunction<SmartRmaReportBundle> =
  ajv.compile(reportBundleSchema as AnySchema);

export const validateSmartRmaReportBundle = (
  candidate: unknown,
): SmartRmaReportBundle => {
  if (!validateReportSchema(candidate)) {
    throw new SmartRmaReportError(
      `SMART report did not match smart-rma-report-bundle-v1: ${formatValidationErrors(validateReportSchema.errors)}`,
    );
  }
  return candidate as SmartRmaReportBundle;
};

const stateZh: Record<SmartRmaHealthState, string> = {
  healthy: "正常",
  warning: "注意",
  critical: "危险",
  unknown: "未知",
};
const stateEn: Record<SmartRmaHealthState, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Critical",
  unknown: "Unknown",
};
const ruleZh: Record<SmartRmaHealthRule, string> = {
  "reported-failure": "smartctl 报告总体健康检查失败",
  "ata-reallocated-sectors": "ATA 重映射扇区计数非零",
  "ata-pending-sectors": "ATA 待处理扇区计数非零",
  "ata-uncorrectable-sectors": "ATA 不可校正扇区计数非零",
  "ata-error-log": "ATA 错误日志计数非零",
  "ata-self-test-failures": "ATA 自检日志包含失败记录",
  "nvme-critical-warning": "NVMe Critical Warning 非零",
  "nvme-spare-below-threshold": "NVMe 可用备用空间低于阈值",
  "nvme-media-errors": "NVMe 介质与数据完整性错误非零",
  "nvme-wear-high": "NVMe 寿命使用率达到 80%",
  "nvme-wear-exhausted": "NVMe 寿命使用率达到或超过 100%",
  "healthy-baseline": "总体检查通过且未触发已知异常规则",
  "smart-unavailable": "当前连接不提供 SMART 数据",
  "insufficient-core-evidence": "核心健康证据不足",
};
const ruleEn: Record<SmartRmaHealthRule, string> = {
  "reported-failure": "smartctl reported an overall health failure",
  "ata-reallocated-sectors": "ATA reallocated sector count is non-zero",
  "ata-pending-sectors": "ATA pending sector count is non-zero",
  "ata-uncorrectable-sectors": "ATA uncorrectable sector count is non-zero",
  "ata-error-log": "ATA error log count is non-zero",
  "ata-self-test-failures": "ATA self-test log contains failures",
  "nvme-critical-warning": "NVMe Critical Warning is non-zero",
  "nvme-spare-below-threshold": "NVMe available spare is below its threshold",
  "nvme-media-errors": "NVMe media/data integrity errors are non-zero",
  "nvme-wear-high": "NVMe percentage used is at least 80%",
  "nvme-wear-exhausted": "NVMe percentage used is at least 100%",
  "healthy-baseline":
    "overall check passed with no recognized anomaly rule triggered",
  "smart-unavailable":
    "SMART data is unavailable through the current connection",
  "insufficient-core-evidence": "core health evidence is insufficient",
};
const unknownZh: Record<SmartRmaUnknownReason, string> = {
  "smart-unavailable": "当前连接无法取得 SMART 数据",
  "protocol-unknown": "无法确认设备协议",
  "overall-health-missing": "缺少总体健康状态",
  "temperature-missing": "缺少温度",
  "power-on-hours-missing": "缺少通电小时",
  "identification-incomplete": "设备识别信息不完整",
  "vendor-extension-uninterpreted": "厂商扩展属性未解释",
};
const actionZh: Record<SmartRmaRecommendedAction, string> = {
  "continue-monitoring": "继续定期监控 SMART 指标",
  "keep-current-backups": "保持可验证的当前备份",
  "backup-now": "立即确认并补齐重要数据备份",
  "run-extended-self-test": "在安全条件下运行扩展自检",
  "capture-vendor-diagnostics": "收集厂商诊断工具的结构化结果",
  "consider-replacement": "评估更换设备",
  "stop-nonessential-writes": "停止非必要写入",
  "replace-drive": "尽快更换设备",
  "prepare-rma-evidence": "准备脱敏后的售后证据",
  "use-direct-connection": "改用可透传 SMART 的直连方式",
  "enable-smart": "确认固件或系统已启用 SMART",
  "collect-complete-output": "重新收集完整 smartctl 输出",
};
const conflictZh: Record<SmartRmaHealthConflict, string> = {
  "reported-passed-with-warning-evidence":
    "总体状态为 PASSED，但规则发现注意级证据",
  "reported-passed-with-critical-evidence":
    "总体状态为 PASSED，但规则发现危险级证据",
};

const list = (items: readonly string[], empty: string): string =>
  items.length === 0
    ? `- ${empty}`
    : items.map((item) => `- ${item}`).join("\n");
const metric = (value: number | null, suffix = ""): string =>
  value === null ? "unknown" : `${value}${suffix}`;

export const createSmartRmaReportBundle = (
  projection: SmartRmaBoundaryProjection,
  assessment: SmartRmaHealthAssessment,
): SmartRmaReportBundle => {
  const Chinese = [
    "# SMART 健康摘要",
    "",
    `- 规则结论：${stateZh[assessment.state]}`,
    `- 证据完整度：${assessment.confidence}`,
    `- smartctl 原始总体状态：${assessment.reported_overall_health}`,
    `- 协议：${projection.protocol}`,
    `- 设备类别：${projection.device_kind}`,
    `- 温度：${metric(projection.temperature_celsius, "°C")}`,
    `- 通电小时：${metric(projection.power_on_hours)}`,
    "",
    "## 规则证据",
    list(
      assessment.triggered_rules.map((rule) => ruleZh[rule]),
      "未触发已知规则",
    ),
    "",
    "## 冲突",
    list(
      assessment.conflicts.map((conflict) => conflictZh[conflict]),
      "未发现状态冲突",
    ),
    "",
    "## 未知项",
    list(
      assessment.unknown_reasons.map((reason) => unknownZh[reason]),
      "无显式未知项",
    ),
    "",
    "## 建议动作",
    list(
      assessment.recommended_actions.map((action) => actionZh[action]),
      "继续人工检查",
    ),
    "",
    "> 本摘要由确定性规则生成，不判断厂商保修资格，也不能替代备份、专业诊断或厂商流程。",
  ].join("\n");

  const English = [
    "# SMART / RMA Evidence Summary",
    "",
    "## Device Context",
    `- Deterministic state: ${stateEn[assessment.state]}`,
    `- Evidence completeness: ${assessment.confidence}`,
    `- smartctl reported overall health: ${assessment.reported_overall_health}`,
    `- Protocol: ${projection.protocol}`,
    `- Device category: ${projection.device_kind}`,
    `- Temperature: ${metric(projection.temperature_celsius, " C")}`,
    `- Power-on hours: ${metric(projection.power_on_hours)}`,
    "",
    "## Observed SMART Evidence",
    list(
      assessment.triggered_rules.map((rule) => ruleEn[rule]),
      "No recognized rule was triggered",
    ),
    "",
    "## Structured Counters",
    `- ATA error count: ${metric(projection.ata.error_count)}`,
    `- ATA self-test failure count: ${projection.ata.self_test_failure_count}`,
    `- NVMe Critical Warning: ${metric(projection.nvme.critical_warning)}`,
    `- NVMe available spare: ${metric(projection.nvme.available_spare_percent, "%")}`,
    `- NVMe available spare threshold: ${metric(projection.nvme.available_spare_threshold_percent, "%")}`,
    `- NVMe percentage used: ${metric(projection.nvme.percentage_used, "%")}`,
    `- NVMe media/data integrity errors: ${metric(projection.nvme.media_errors)}`,
    `- NVMe error log entries: ${metric(projection.nvme.error_log_entries)}`,
    "",
    "## Request for Vendor Review",
    "Please review the structured SMART evidence above and advise the applicable diagnostic or RMA process.",
    "",
    "> This deterministic report does not determine warranty eligibility and does not include raw smartctl input or device identifiers.",
  ].join("\n");

  return validateSmartRmaReportBundle({
    schema_version: "1.0",
    report_version: "1.0",
    state: assessment.state,
    chinese_summary_markdown: Chinese,
    english_rma_markdown: English,
    contains_raw_input: false,
    warranty_assessment: "not-determined",
  });
};
