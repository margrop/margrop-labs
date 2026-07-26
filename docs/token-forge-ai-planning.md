# Token Forge AI 任务拆分

P1-004 在 P1-002 确定性模板之上增加 Provider-neutral 的 AI 规划核心。它定义
`token-forge.plan-v1` 操作、最小输入、确定性输出后处理和完整降级行为；当前不包含真实
Provider、HTTP 路由或页面交互。

## 执行顺序

1. Token Forge v1 输入先通过业务合同；
2. 立即生成一份经过本地脱敏的 P1-002 模板计划；
3. 可选的 P1-003 公开仓库摘要被压缩、允许字段映射和脱敏；
4. AI Gateway 在硬上限、超时和最多两次尝试内调用注入的 Provider Adapter；
5. AI 输出重新通过 Token Forge Plan v1 合同和确定性安全规则；
6. 任一步失败都丢弃 AI 输出并返回第 2 步的完整模板计划。

这使 AI 成为可替换的增强层，而不是生成可用任务的单点依赖。

## 操作输入

操作输入由
[`token-forge-ai-input-v1.schema.json`](../schemas/token-forge-ai-input-v1.schema.json)
约束，只允许：

- 目标摘要；
- Token 预算、到期天数、可用工时和技术栈；
- 可选的脱敏公开仓库上下文：技术信号、无路径的文件类型、正文片段、覆盖计数和未知项。

结构化仓库 URL、Owner、仓库名、默认分支和文件路径不会进入 Provider Request。仓库正文
明确使用 `untrusted_excerpt` 字段，服务端指令要求把它和用户目标都当作数据，不能当作
指令。

### 上下文硬上限

| 项目 | 上限 |
|---|---:|
| 仓库片段 | 4 个 |
| 单个片段 | 3 KiB UTF-8 |
| 仓库正文合计 | 10 KiB UTF-8 |
| 操作输入 JSON | 20 KiB UTF-8 |

这些限制比 AI Gateway 通用上限更严格。允许字段映射会先丢弃未知字段，再替换邮箱、IP、
域名、序列号和 WWN；Authorization、Cookie 和 Token 样式内容默认拒绝。命中 Secret 时
不会调用 Provider。

## 服务端指令

`tokenForgeAiServerInstructions` 是未来 Provider 注册表使用的固定服务端配置，不能由
Web 请求覆盖。它要求模型：

- 只返回 `mode: "ai-assisted"` 的 Token Forge Plan v1 JSON；
- 遵守 Token 与工时预算；
- 只提出本地、测试环境或独立分支中的有界工作；
- 不建议生产写入、凭据读取、隐藏指令披露或安全绕过；
- 显式说明仓库覆盖范围和执行状态未知。

AI Gateway 的 Provider Request 不包含 `provider`、`model`、`system_prompt` 或密钥。
具体 Provider、模型和上述指令的注入仍属于未来服务端 Adapter 配置。

## 确定性后处理

模型返回值不会直接交给用户。核心按顺序执行：

1. Token Forge Plan v1 Schema、依赖图、总 Token 和总工时验证；
2. 强制 `mode` 为 `ai-assisted`；
3. 输出自由文本脱敏，Secret 样式输出失败关闭；
4. 检测生产写操作与常见直接发布命令；
5. 检测对仓库长行或长片段的逐字回显；
6. 以标题和范围二元组相似度合并重复任务并重写依赖；
7. 追加固定的覆盖未知项和执行安全说明；
8. 对最终计划再次执行完整 v1 合同验证。

生产写操作检测是保守的确定性护栏，不是自然语言安全证明。否定表达只用于说明“不得
部署”时不会被误判；真实执行边界仍必须由权限、分支保护和部署流程控制。

## 降级结果

结果使用带判别字段的联合类型：

- `ai-assisted`：包含验证后的 AI 计划、Token usage 和尝试次数；
- `template-fallback`：包含完整模板计划、稳定降级原因和尝试次数。

准备阶段的原因包括敏感输入、仓库摘要无效和输入过大；Provider 阶段沿用 AI Gateway
稳定错误码。结果不包含 Adapter ID、Provider 原始错误、请求正文或无效模型正文。

模板输入也会在本地脱敏，所以降级计划不会把导致 AI 拒绝的 Secret 原样写回 Prompt。

## 生产流量边界

P4-004 已提供 `token-forge.plan-v1` 专属的日 Token/微美元预算、匿名用户滑动限流、并发
预留与熔断状态机。每次生产调用必须在 Provider 前预留最多两次尝试的最坏成本；成功后按
所有尝试的可信汇总用量结算，任意失败或预留超时则保留全额预留。准入拒绝映射为现有
Gateway 错误码，P1-004 继续返回完整模板计划。

策略核心不包含 Provider、端点、匿名身份派生或持久化。P1-008 必须按
[AI 流量与成本策略](./token-forge-ai-traffic-policy.md) 接入原子状态存储后，才能把本
模块连接到正式页面。

## 测试范围

测试使用内存中的合成 Adapter 和合成公开仓库摘要，覆盖：

- 操作输入 fixture、身份字段/路径省略、脱敏和字节上限；
- 有效 AI 计划与 Provider Request 控制字段；
- 输出标识符脱敏、相似任务合并和依赖重写；
- 生产写入、仓库原文回显、超预算和无效输出；
- Secret 预检、Provider 超时、暂时不可用和有界重试；
- 所有失败路径回退到仍符合 v1 合同的模板计划。

没有测试或实现使用真实仓库正文、真实 Provider 或真实凭据。

## 已知限制

- 尚无真实 Provider Adapter、服务端操作注册表或 HTTP API；
- Token Forge 正式页面当前只接入确定性模板，AI 路径仍未连接；
- 用户级/每日预算、限流和熔断已有离线状态机，但尚无生产端点与原子持久化；
- 自然语言护栏不能替代最小权限与人工确认；
- 导出边界由 P1-005 另行实现。
