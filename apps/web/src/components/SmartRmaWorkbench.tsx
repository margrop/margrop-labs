import { useMemo, useState } from "preact/hooks";

import {
  type SmartRmaRedactionPreview,
  SmartRmaRedactionError,
  redactSmartctlText,
} from "../lib/smart-rma-redaction";
import {
  type SmartRmaDeviceKind,
  type SmartRmaMissingField,
  type SmartRmaParseResult,
  type SmartRmaProtocol,
  type SmartRmaReportedHealth,
  type SmartRmaSignal,
  type SmartRmaSupport,
  SmartRmaParserError,
  parseSmartctlText,
} from "../lib/smart-rma-parser";
import { StatusNotice, type StatusTone } from "./ui/StatusNotice";

export type SmartRmaSample = {
  id: string;
  label: string;
  raw: string;
};

type SmartRmaWorkbenchProps = {
  samples: SmartRmaSample[];
  sourceUrl: string;
};

type WorkbenchStatus = {
  tone: StatusTone;
  title: string;
  message: string;
};

const protocolLabels: Record<SmartRmaProtocol, string> = {
  ata: "ATA / SATA",
  nvme: "NVMe",
  unknown: "未知协议",
};

const deviceKindLabels: Record<SmartRmaDeviceKind, string> = {
  hdd: "机械硬盘",
  ssd: "SATA / ATA SSD",
  nvme: "NVMe SSD",
  unknown: "未知设备类别",
};

const supportLabels: Record<SmartRmaSupport, string> = {
  available: "SMART 可用",
  unavailable: "SMART 不可用",
  unknown: "SMART 支持未知",
};

const reportedHealthLabels: Record<SmartRmaReportedHealth, string> = {
  passed: "smartctl 报告 PASSED",
  failed: "smartctl 报告 FAILED",
  unknown: "未报告",
};

const signalLabels: Record<SmartRmaSignal, string> = {
  "smart-overall-passed": "检测到 smartctl 总体 PASSED",
  "smart-overall-failed": "检测到 smartctl 总体 FAILED",
  "ata-reallocated-sectors": "ATA 重映射扇区非零",
  "ata-pending-sectors": "ATA 待处理扇区非零",
  "ata-uncorrectable-sectors": "ATA 不可校正计数非零",
  "ata-error-log": "ATA 错误日志非空",
  "nvme-critical-warning": "NVMe Critical Warning 非零",
  "nvme-spare-below-threshold": "NVMe 可用备用空间低于阈值",
  "nvme-percentage-used": "检测到 NVMe 寿命使用百分比",
  "nvme-media-errors": "NVMe 介质与数据完整性错误非零",
  "vendor-extension": "包含未解释的厂商扩展属性",
  "smart-unavailable": "设备或桥接器不提供 SMART 数据",
  "incomplete-identification": "设备识别或 SMART 输出不完整",
};

const missingFieldLabels: Record<SmartRmaMissingField, string> = {
  model: "设备型号",
  serial_number: "序列号（解析结果主动不保留）",
  firmware_version: "固件版本",
  overall_health: "总体自检状态",
  temperature: "温度",
  power_on_hours: "通电小时",
};

const initialStatus: WorkbenchStatus = {
  tone: "info",
  title: "合成样例已就绪",
  message:
    "选择一个完全合成的 smartctl 样例，或粘贴文本后在当前浏览器标签页解析并脱敏。",
};

const formatMetric = (value: number | null, suffix = ""): string =>
  value === null ? "未知" : `${value.toLocaleString()}${suffix}`;

export default function SmartRmaWorkbench({
  samples,
  sourceUrl,
}: SmartRmaWorkbenchProps) {
  const initialSample = samples[0];
  if (!initialSample) {
    throw new Error("SMART / RMA workbench requires a synthetic sample.");
  }

  const [selectedSampleId, setSelectedSampleId] = useState(initialSample.id);
  const [rawText, setRawText] = useState(initialSample.raw);
  const [redactionPreview, setRedactionPreview] =
    useState<SmartRmaRedactionPreview | null>(() =>
      redactSmartctlText(initialSample.raw),
    );
  const [result, setResult] = useState<SmartRmaParseResult | null>(
    () =>
      redactionPreview?.parse_result ?? parseSmartctlText(initialSample.raw),
  );
  const [status, setStatus] = useState<WorkbenchStatus>(initialStatus);
  const selectedSample = useMemo(
    () => samples.find(({ id }) => id === selectedSampleId) ?? initialSample,
    [initialSample, samples, selectedSampleId],
  );

  const loadSelectedSample = (): void => {
    setRawText(selectedSample.raw);
    setResult(null);
    setRedactionPreview(null);
    setStatus({
      tone: "info",
      title: "合成样例已载入",
      message: `${selectedSample.label} 已放入输入框；点击“本地解析并脱敏”查看结果。`,
    });
  };

  const parseLocally = (): void => {
    try {
      const preview = redactSmartctlText(rawText);
      setRedactionPreview(preview);
      setResult(preview.parse_result);
      setStatus({
        tone: "ready",
        title: "本地解析与脱敏完成",
        message:
          "序列号、WWN、主机名、IP 与其他常见敏感值已遮蔽；跨边界只使用无自由文本的结构化投影。",
      });
    } catch (error) {
      setResult(null);
      setRedactionPreview(null);
      setStatus({
        tone: "error",
        title: "无法解析或脱敏",
        message:
          error instanceof SmartRmaRedactionError ||
          error instanceof SmartRmaParserError
            ? error.message
            : "输入没有通过本地解析与脱敏合同，请检查是否为 smartctl 文本。",
      });
    }
  };

  const resetWorkbench = (): void => {
    const preview = redactSmartctlText(initialSample.raw);
    setSelectedSampleId(initialSample.id);
    setRawText(initialSample.raw);
    setRedactionPreview(preview);
    setResult(preview.parse_result);
    setStatus(initialStatus);
  };

  const updateRawText = (value: string): void => {
    setRawText(value);
    setResult(null);
    setRedactionPreview(null);
    setStatus({
      tone: "info",
      title: "输入已改变",
      message: "点击“本地解析并脱敏”生成与当前文本对应的新结果。",
    });
  };

  return (
    <div class="smart-rma-shell">
      <section
        class="smart-rma-input"
        aria-labelledby="smart-rma-input-heading"
      >
        <div class="smart-rma-section-heading">
          <div>
            <p class="section-kicker">LOCAL INPUT</p>
            <h2 id="smart-rma-input-heading">载入 SMART 文本</h2>
          </div>
          <p>最大 64 KiB；支持 Linux/Windows 换行；不上传、不保存。</p>
        </div>

        <div class="smart-rma-sample-controls">
          <label for="smart-rma-sample">
            <span>完全合成样例</span>
            <select
              id="smart-rma-sample"
              name="synthetic_sample"
              value={selectedSampleId}
              onChange={(event) =>
                setSelectedSampleId(event.currentTarget.value)
              }
            >
              {samples.map((sample) => (
                <option value={sample.id} key={sample.id}>
                  {sample.label}
                </option>
              ))}
            </select>
          </label>
          <button
            class="button button--secondary"
            type="button"
            onClick={loadSelectedSample}
          >
            载入合成样例
          </button>
        </div>

        <form
          class="smart-rma-form"
          onSubmit={(event) => {
            event.preventDefault();
            parseLocally();
          }}
          onReset={(event) => {
            event.preventDefault();
            resetWorkbench();
          }}
        >
          <label for="smartctl-text">
            <span>smartctl 文本</span>
            <small id="smartctl-text-help">
              当前版本不导出原文；解析时会同时生成仅供本页查看的脱敏预览。
            </small>
          </label>
          <textarea
            id="smartctl-text"
            name="smartctl_text"
            aria-describedby="smartctl-text-help"
            value={rawText}
            spellcheck={false}
            onInput={(event) => updateRawText(event.currentTarget.value)}
          />
          <div class="smart-rma-actions">
            <button class="button button--primary" type="submit">
              本地解析并脱敏
            </button>
            <button class="button button--secondary" type="reset">
              恢复默认样例
            </button>
          </div>
        </form>

        <aside class="smart-rma-privacy">
          <strong>当前隐私边界</strong>
          <p>
            原始文本只存在于这个页面的内存，不写入 URL、Local
            Storage、Analytics、日志、导出或 AI 请求。序列号、WWN、主机名和 IP
            会在本地预览中遮蔽；未来跨边界能力只能读取无自由文本的允许字段投影。
          </p>
        </aside>

        <StatusNotice tone={status.tone} title={status.title}>
          {status.message}
        </StatusNotice>

        {redactionPreview && (
          <section
            class="smart-rma-redaction"
            aria-labelledby="smart-rma-redaction-heading"
          >
            <div class="smart-rma-detail-heading">
              <div>
                <p class="section-kicker">LOCAL REDACTION</p>
                <h3 id="smart-rma-redaction-heading">本地脱敏预览</h3>
              </div>
              <p>
                共遮蔽 {redactionPreview.projection.privacy.redactions_total}{" "}
                处；报告只保留类型和数量。
              </p>
            </div>

            <dl class="smart-rma-redaction-counts">
              <div>
                <dt>序列号</dt>
                <dd>
                  {redactionPreview.projection.privacy.counts.serial_number}
                </dd>
              </div>
              <div>
                <dt>WWN</dt>
                <dd>{redactionPreview.projection.privacy.counts.wwn}</dd>
              </div>
              <div>
                <dt>主机名 / 域名</dt>
                <dd>{redactionPreview.projection.privacy.counts.domain}</dd>
              </div>
              <div>
                <dt>IP</dt>
                <dd>{redactionPreview.projection.privacy.counts.ip}</dd>
              </div>
              <div>
                <dt>邮箱</dt>
                <dd>{redactionPreview.projection.privacy.counts.email}</dd>
              </div>
              <div>
                <dt>Secret</dt>
                <dd>
                  {redactionPreview.projection.privacy.counts.authorization +
                    redactionPreview.projection.privacy.counts.cookie +
                    redactionPreview.projection.privacy.counts.token}
                </dd>
              </div>
            </dl>

            <details>
              <summary>查看脱敏后的本地文本</summary>
              <pre>{redactionPreview.redacted_text}</pre>
            </details>
            <p class="smart-rma-boundary-note">
              AI
              与导出不会接收这段文本，只能使用协议、计数、枚举和受支持指标组成的
              Boundary Projection v1。
            </p>
          </section>
        )}
      </section>

      <section
        class="smart-rma-result"
        aria-labelledby="smart-rma-result-heading"
      >
        <div class="smart-rma-section-heading">
          <div>
            <p class="section-kicker">PARSED EVIDENCE</p>
            <h2 id="smart-rma-result-heading">结构化解析结果</h2>
          </div>
          <p>这是输入证据，不是健康结论，更不是厂商保修判断。</p>
        </div>

        {result ? (
          <>
            <dl class="smart-rma-facts">
              <div>
                <dt>smartctl</dt>
                <dd>{result.smartctl_version}</dd>
              </div>
              <div>
                <dt>协议</dt>
                <dd>{protocolLabels[result.protocol]}</dd>
              </div>
              <div>
                <dt>设备类别</dt>
                <dd>{deviceKindLabels[result.device_kind]}</dd>
              </div>
              <div>
                <dt>SMART 支持</dt>
                <dd>{supportLabels[result.smart_support]}</dd>
              </div>
              <div>
                <dt>原始总体状态</dt>
                <dd>{reportedHealthLabels[result.reported_overall_health]}</dd>
              </div>
              <div>
                <dt>温度 / 通电</dt>
                <dd>
                  {formatMetric(result.temperature_celsius, "°C")} ·{" "}
                  {formatMetric(result.power_on_hours, "h")}
                </dd>
              </div>
            </dl>

            <div class="smart-rma-summary-grid">
              <section>
                <h3>解析信号（未判定健康）</h3>
                {result.signals.length > 0 ? (
                  <ul>
                    {result.signals.map((signal) => (
                      <li key={signal}>{signalLabels[signal]}</li>
                    ))}
                  </ul>
                ) : (
                  <p>没有提取到受支持的稳定信号。</p>
                )}
              </section>
              <section>
                <h3>未知项 / 缺失字段</h3>
                {result.missing_fields.length > 0 ? (
                  <ul>
                    {result.missing_fields.map((field) => (
                      <li key={field}>{missingFieldLabels[field]}</li>
                    ))}
                  </ul>
                ) : (
                  <p>当前合同要求的字段均可识别。</p>
                )}
              </section>
            </div>

            {result.protocol === "ata" && (
              <section class="smart-rma-detail">
                <div class="smart-rma-detail-heading">
                  <h3>ATA 属性</h3>
                  <p>
                    错误日志 {formatMetric(result.ata.error_count)} · 自检失败{" "}
                    {result.ata.self_test_failure_count}
                  </p>
                </div>
                {result.ata.attributes.length > 0 ? (
                  <div
                    class="smart-rma-table-scroll"
                    tabIndex={0}
                    aria-label="ATA SMART 属性表"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">ID</th>
                          <th scope="col">属性</th>
                          <th scope="col">当前 / 最差 / 阈值</th>
                          <th scope="col">RAW</th>
                          <th scope="col">识别</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.ata.attributes.map((attribute) => (
                          <tr key={`${attribute.id}-${attribute.name}`}>
                            <td>{attribute.id}</td>
                            <td>
                              <code>{attribute.name}</code>
                            </td>
                            <td>
                              {attribute.normalized_value} /{" "}
                              {attribute.worst_value} / {attribute.threshold}
                            </td>
                            <td>{formatMetric(attribute.raw_value)}</td>
                            <td>
                              {attribute.recognized
                                ? "标准关注项"
                                : "厂商扩展 · 未解释"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p class="smart-rma-empty">没有识别到完整 ATA 属性行。</p>
                )}
              </section>
            )}

            {result.protocol === "nvme" && (
              <section class="smart-rma-detail">
                <h3>NVMe Health Log</h3>
                <dl class="smart-rma-nvme-grid">
                  <div>
                    <dt>Critical Warning</dt>
                    <dd>{formatMetric(result.nvme.critical_warning)}</dd>
                  </div>
                  <div>
                    <dt>Available Spare</dt>
                    <dd>
                      {formatMetric(result.nvme.available_spare_percent, "%")}
                    </dd>
                  </div>
                  <div>
                    <dt>Spare Threshold</dt>
                    <dd>
                      {formatMetric(
                        result.nvme.available_spare_threshold_percent,
                        "%",
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Percentage Used</dt>
                    <dd>{formatMetric(result.nvme.percentage_used, "%")}</dd>
                  </div>
                  <div>
                    <dt>Media Errors</dt>
                    <dd>{formatMetric(result.nvme.media_errors)}</dd>
                  </div>
                  <div>
                    <dt>Error Log Entries</dt>
                    <dd>{formatMetric(result.nvme.error_log_entries)}</dd>
                  </div>
                </dl>
              </section>
            )}
          </>
        ) : (
          <p class="smart-rma-empty">
            尚无解析结果。载入合成样例或粘贴 smartctl
            文本后，点击“本地解析并脱敏”。
          </p>
        )}

        <nav class="smart-rma-next-links" aria-label="SMART / RMA 后续链接">
          <a class="button button--secondary" href={sourceUrl}>
            查看合成 Fixture 与合同
          </a>
          <a class="button button--secondary" href="/">
            返回 Labs 首页
          </a>
        </nav>
      </section>
    </div>
  );
}
