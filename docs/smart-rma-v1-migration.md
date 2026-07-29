# SMART / RMA 完整 MVP v1 迁移说明

## 范围

2026-07-29，仓库所有者恢复 P3-004 至 P3-006。原有 Parse Result v1 与 Boundary Projection
v1 保持兼容；本次新增健康评估、AI 最小边界、AI 解释和报告导出合同。

## 新合同

- `smart-rma-health-assessment-v1`：确定性规则状态、冲突、未知项和动作；
- `smart-rma-ai-boundary-v1`：从 Boundary Projection v1 派生的 AI allowlist，移除隐私统计；
- `smart-rma-ai-input-v1`：AI Boundary v1、Health Assessment v1 和固定 safeguards；
- `smart-rma-ai-explanation-v1`：带规则、未知项与动作引用的结构化中文解释；
- `smart-rma-report-bundle-v1`：确定性中文摘要与英文 RMA Markdown。

## 消费者迁移

1. 继续使用 `redactSmartctlText()` 取得 Boundary Projection v1；
2. 调用 `assessSmartRmaHealth()` 生成 Health Assessment v1；
3. 本地报告调用 `createSmartRmaReportBundle()`，不得传入原始或脱敏自由文本；
4. AI 请求必须调用 `buildSmartRmaAiInput()`，不得直接发送 Boundary Projection v1；
5. AI 输出必须调用 `validateSmartRmaAiExplanation()` 并提供同一次请求的输入引用；
6. AI 不可用时保留 Health Assessment v1 与 Report Bundle v1，不隐藏或降级确定性结果。

## 兼容性与隐私

- Parse Result v1、Boundary Projection v1 和 7 份合成 fixture 未改版本；
- AI Boundary v1 故意不包含 `privacy`，避免无任务必要的统计进入模型请求；
- 报告不含原始文本、脱敏预览、型号原文、序列号、WWN、主机名、IP、Secret、时间戳或持久标识；
- 所有输出继续使用 `warranty_assessment: not-determined`，不承诺厂商保修或 RMA 接受。
