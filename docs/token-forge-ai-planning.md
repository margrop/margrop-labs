# Token Forge AI 任务拆分

P1-004 在 P1-002 确定性模板之上增加 Provider-neutral 的 AI 规划核心。P1-008 已把它接到
固定服务端 Provider、HTTP 路由和显式页面入口，同时保留完整模板降级。

## 执行顺序

1. Token Forge v1 输入先通过业务合同；
2. 立即生成一份经过本地脱敏的 P1-002 模板计划；
3. 可选的 P1-003 公开仓库摘要被压缩、允许字段映射和脱敏；
4. 生产 AI Gateway 在每模型 22,000 输入、2,000 输出、共享 45 秒和 1 次 Gateway
   尝试内，先调用固定主模型，符合条件时再顺序调用固定回退模型；
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

| 项目          |         上限 |
| ------------- | -----------: |
| 仓库片段      |         4 个 |
| 单个片段      |  3 KiB UTF-8 |
| 仓库正文合计  | 10 KiB UTF-8 |
| 操作输入 JSON | 20 KiB UTF-8 |

这些限制比 AI Gateway 通用上限更严格。允许字段映射会先丢弃未知字段，再替换邮箱、IP、
域名、序列号和 WWN；Authorization、Cookie 和 Token 样式内容默认拒绝。命中 Secret 时
不会调用 Provider。

## 服务端指令

`token-forge-ai-prompt.ts` 是只进入 Worker bundle 的固定服务端配置，不能由 Web 请求
覆盖。它要求模型：

- 只返回 `mode: "ai-assisted"` 的 Token Forge Plan v1 JSON；
- 遵守 Token 与工时预算；
- 只提出本地、测试环境或独立分支中的有界工作；
- 不建议生产写入、凭据读取、隐藏指令披露或安全绕过；
- 显式说明仓库覆盖范围和执行状态未知。

AI Gateway 的 Provider Request 不包含 `provider`、`model`、`system_prompt` 或密钥。
生产 Adapter 在服务端固定 OpenAI-compatible
`https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions` 与
主模型 `qwen-latest`、回退模型 `minimax-latest`；上述配置、Secret 和系统指令都不能由
Web 覆盖。网络错误、429、408/504、5xx 或无法解析的响应才会进入回退；认证、预算或其他
策略型 4xx 不会回退。两个模型不会并行调用。

Adapter 请求标准 `json_object` 响应。若兼容网关仍把唯一 JSON 对象包在 Markdown 中，
只接受完整、无前后文字的单个 `json` 围栏；围栏被移除后，结果仍须通过全部合同和安全
后处理，不能借此接受自然语言说明、多围栏或部分 JSON。

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
预留与熔断状态机。P1-008 用 HMAC 匿名键和 SQLite Durable Object 原子保存快照，并在
Provider 前按两个模型的最坏情况预留 48,000 Token。主模型直接成功时按标准 usage
结算；只要调用回退模型，就按 48,000 Token 保守下限结算；失败或预留超时同样保留全额
预留。自建上游网关负责真实货币预算，因此金额只保留最小合同占位。

详细固定参数见 [AI 流量与成本策略](./token-forge-ai-traffic-policy.md)。

## 测试范围

测试使用内存中的合成 Adapter 和合成公开仓库摘要，覆盖：

- 操作输入 fixture、身份字段/路径省略、脱敏和字节上限；
- 有效 AI 计划与 Provider Request 控制字段；
- 输出标识符脱敏、相似任务合并和依赖重写；
- 生产写入、仓库原文回显、超预算和无效输出；
- Secret 预检、Provider 超时、终止型错误不回退、暂时错误顺序回退和双模型失败；
- 所有失败路径回退到仍符合 v1 合同的模板计划。

测试不使用真实仓库正文、真实 Provider 或真实凭据。

## 已知限制

- 上游必须支持标准 Chat Completions 字符串内容与 prompt/completion usage；
- 页面只展示最终成功模型的 usage；策略层对已调用的回退路径采用最坏 Token 下限；
- `minimax-latest` 若在 2,000 输出 Token 内没有形成最终 JSON，会按输出截断或无效响应
  降级，不会返回推理正文；
- 自定义 `16666` 端口要求上游域名保持 DNS-only，或迁移到支持的 HTTPS 端口；
- 共享 NAT 用户共用匿名限额；匿名键轮换会创建新的匿名桶；
- 代码完成不等于真实流量已激活，仍需 Secrets、Preview 验收和人工 Production 决定；
- 自然语言护栏不能替代最小权限与人工确认；
- 导出边界由 P1-005 另行实现。
