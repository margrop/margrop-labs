# ADR-0009：恢复 SMART / RMA 报告机与完整产品边界

- 状态：Accepted
- 日期：2026-07-29

## 背景

ADR-0006 暂停了 SMART / RMA 报告机 P3-004 至 P3-006，除非仓库所有者再次明确调整优先级。
2026-07-29，仓库所有者明确要求基于当前 `main` 创建独立开发分支，恢复并完成 SMART / RMA
报告机的全部功能。

现有 P3-001 至 P3-003 已提供完全合成 fixture、浏览器端确定性解析器、本地脱敏预览和无自由
文本的 Boundary Projection v1。恢复开发不能放宽这些隐私边界，也不能让 AI 取代规则判断。

## 决策

1. P3-004 使用版本化确定性规则集，把 Boundary Projection v1 映射为健康、注意、危险或未知；
2. 规则输出单独保留 `smartctl` 报告状态、触发规则、冲突、未知项、建议动作和“不判断保修”；
3. P3-005 复用 ADR-0004 的 Provider-neutral Gateway，AI 只接收 Boundary Projection v1 与
   Health Assessment v1，不接收原始文本、脱敏预览或设备标识；
4. AI 输出使用版本化结构化 Schema，渲染前验证；超时、限流、无效结构和不可用均降级到
   完整可用的确定性结果；
5. P3-006 的中文摘要与英文 RMA Markdown 由确定性代码生成，只消费版本化结构结果；导出不含
   原始文本、型号原文、序列号、WWN、主机名、IP、Secret、时间戳或持久标识；
6. 英文 RMA Markdown 只陈述用户可提交的观测证据，不声称厂商必须保修或已经接受 RMA；
7. 继续提供无需登录、无需 AI、无需网络的完全合成样例路径。

## 公共合同

- `smart-rma-health-assessment-v1`：确定性健康状态、规则证据、冲突、未知项和建议动作；
- `smart-rma-ai-boundary-v1`：从 Boundary Projection v1 派生的 AI allowlist，移除隐私统计；
- `smart-rma-ai-input-v1`：AI 最小输入，仅含 AI Boundary v1 与 Health Assessment v1；
- `smart-rma-ai-explanation-v1`：受限中文通俗解释，不允许保修结论；
- `smart-rma-report-bundle-v1`：确定性中文摘要与英文 RMA Markdown。

公共合同变化必须同步 Schema、fixture 回归测试、消费者测试和迁移说明。

## 后果

- 即使 AI 完全不可用，用户仍可完成解析、脱敏、健康评估和报告导出；
- 规则变化需要升级规则版本并固定全部合成 fixture 的预期结果；
- Provider、模型、密钥、预算和重试继续由服务端控制；
- UI 必须持续区分输入证据、规则结果、AI 解释和未知项。

## 备选方案

### 让 AI 直接阅读脱敏文本并诊断

拒绝。脱敏预览仍包含自由文本，模式匹配不能证明全部标识已移除，且诊断规则可以确定实现。

### 只根据 `smartctl` 的 PASSED / FAILED 输出状态

拒绝。现有合成样例已经包含 PASSED 与关键计数非零的冲突，单读总体状态会产生错误结论。

### 导出原始或脱敏后的完整 smartctl 文本

拒绝。正式导出只允许结构化最小证据，避免遗漏标识、Secret 或无关自由文本。
