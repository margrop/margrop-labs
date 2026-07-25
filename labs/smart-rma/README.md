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
厂商保修条件；完整输入脱敏由 P3-003 实现。
