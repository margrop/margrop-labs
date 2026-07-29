# SMART / RMA 报告机

## 问题

SMART 输出难读且含序列号、WWN、主机名等信息；用户需要健康解释和可提交售后的脱敏材料。

## MVP 流程

1. 在浏览器粘贴或载入合成 `smartctl` 输出；
2. 本地识别并遮蔽敏感字段；
3. 本地解析版本、型号类别、关键属性和错误摘要；
4. 规则引擎给出正常、注意、危险或未知；
5. 可选把脱敏后的结构化指标交给 AI 通俗解释；
6. 导出中文摘要和英文 RMA Markdown。

## AI 边界

解析、脱敏和健康规则由代码负责。AI 不得判断厂商是否必须保修，也不得把未知属性强行解释为故障。

## 隐私

原始文本不离开浏览器、不写入 URL、不进入 Analytics。AI 只接收允许字段和脱敏指标。

## 完全合成 Fixture

P3-001 已建立版本化索引和 7 份离线 `smartctl` 文本，覆盖 ATA、NVMe、健康、预警、危险、
未知、缺失字段、厂商扩展、SMART 不可用和总体状态与关键属性冲突。

- 索引：[`fixtures/index.json`](./fixtures/index.json)
- 合同：[`smart-rma-fixture-index-v1`](../../schemas/smart-rma-fixture-index-v1.schema.json)
- 覆盖、隐私与后续消费规则：
  [SMART / RMA 完全合成 Fixture](../../docs/smart-rma-synthetic-fixtures.md)

这些文本不来自任何真实设备。真实 SMART 输出不得提交进仓库。

## 浏览器端解析器

P3-002 已上线 `/smart-rma/` Alpha 工作台：可载入上述 7 份合成样例或粘贴文本，并在当前
浏览器标签页内解析 smartctl 版本、协议、设备类别、SMART 支持、工具报告的总体状态、ATA
属性与错误摘要、NVMe 健康计数、稳定信号和缺失字段。

- 输出合同：
  [`smart-rma-parse-result-v1`](../../schemas/smart-rma-parse-result-v1.schema.json)
- 解析与失败边界：
  [SMART / RMA 浏览器解析器 v1](../../docs/smart-rma-parser-v1.md)

解析结果不包含原始文本、型号原文、序列号或 WWN。P3-002 不做健康分类，也不声称设备满足
厂商保修条件。

## 本地脱敏与边界投影

P3-003 已在工作台加入只在当前页面内存生成的脱敏预览，覆盖序列号、WWN、主机名、IPv4、
IPv6、邮箱和常见 Secret。未来 AI 与导出不能读取预览文本，只能消费无自由文本的版本化
投影。

- 投影合同：
  [`smart-rma-boundary-projection-v1`](../../schemas/smart-rma-boundary-projection-v1.schema.json)
- 模式、sink 最小化与失败边界：
  [SMART / RMA 本地脱敏与边界投影 v1](../../docs/smart-rma-redaction-v1.md)

模式命中数量不是“输入一定安全”的证明；原文不离开浏览器和显式允许字段映射才是主边界。

## 确定性健康规则

P3-004 使用 Health Assessment v1 与 Ruleset v1，把脱敏结构证据映射为正常、注意、危险或
未知。规则单独保留 `smartctl` 报告状态、触发规则、冲突、未知项与建议动作；PASSED 与异常
计数并存时会显示冲突，未知厂商属性不会被猜测为故障。

- 合同：[`smart-rma-health-assessment-v1`](../../schemas/smart-rma-health-assessment-v1.schema.json)
- 规则实现：[`smart-rma-health.ts`](../../apps/web/src/lib/smart-rma-health.ts)

规则结论不判断厂商保修资格。

## 可选 AI 通俗解释

P3-005 复用服务端 Provider-neutral Gateway。只有用户显式点击后才发送 AI Boundary v1 与
Health Assessment v1；原文、脱敏预览、标识与隐私统计均不进入请求。AI 输出必须通过
Explanation v1 Schema 与引用一致性校验；超时、限流、预算、无效结构和 Provider 不可用均
降级到完整本地结果。

- AI allowlist：[`smart-rma-ai-boundary-v1`](../../schemas/smart-rma-ai-boundary-v1.schema.json)
- 输入合同：[`smart-rma-ai-input-v1`](../../schemas/smart-rma-ai-input-v1.schema.json)
- 输出合同：[`smart-rma-ai-explanation-v1`](../../schemas/smart-rma-ai-explanation-v1.schema.json)

## 中文摘要与英文 RMA Markdown

P3-006 由确定性代码生成两份 Markdown，只消费结构化投影与规则评估，不包含原始文本、设备
标识、时间戳或持久标识。英文材料请求厂商复核观测证据，但不声称厂商必须保修或 RMA 已获
批准。

- 合同：[`smart-rma-report-bundle-v1`](../../schemas/smart-rma-report-bundle-v1.schema.json)
- 生成器：[`smart-rma-report.ts`](../../apps/web/src/lib/smart-rma-report.ts)
