# AI 面试工作台 AI 运行时 v1

P5-006 将面试工作台接入已有 AI Gateway 公共层，同时保持 Token Forge 的生产合同不变。

## 注册表与端点

服务端按 `lab_id + operation` 查找固定注册项，浏览器只能提交版本化输入，不能提交 Provider、模型、系统提示词或密钥：

| 操作 | 同源端点 | 输入 | 输出 |
| --- | --- | --- | --- |
| `interview-workbench.match-v1` | `/api/interview-workbench/match` | `interview-ai-match-input-v1` | `interview-match-v1` |
| `interview-workbench.plan-v1` | `/api/interview-workbench/plan` | `interview-ai-plan-input-v1` | `interview-plan-v1` |
| `interview-workbench.conclusion-v1` | `/api/interview-workbench/conclusion` | `interview-ai-conclusion-input-v1` | `interview-conclusion-v1` |

每个端点都在 Provider 返回后重新执行引用、时间、未知项、冲突、人工确认和草稿状态验证。验证失败返回安全 Gateway 错误，不回显 Provider 原文。

## Provider 与策略

三个操作复用 Token Forge 已验收的 OpenAI-compatible Provider：

- 服务端变量仍使用 `TOKEN_FORGE_AI_BASE_URL`、`TOKEN_FORGE_AI_MODEL` 和 `TOKEN_FORGE_AI_FALLBACK_MODEL`；当前主机是 DDNS 域名，不固定公网 IP；
- 主模型为 `qwen-latest`，可重试的上游失败回退到 `minimax-latest`；API key 只放在服务端 Authorization header；
- Preview 使用 `TOKEN_FORGE_AI_BUDGET_MULTIPLIER=100`，Production 使用 `1`；两套环境的 `INTERVIEW_AI_POLICY` Durable Object 与 Token Forge 策略分开；
- 每个面试操作使用独立 Durable Object 名称和快照空间，保留日预算、滑动限流、并发预留、超时和三次失败熔断；Provider 上限为 64 KiB 请求/响应、22k 输入 Token、3k 输出 Token、45 秒和一次 Gateway 尝试（Provider 内部最多主/回退两次）。

## 隐私边界

Provider 只接收 `interview-boundary-projection-v1` 及 ID/状态投影。简历和 JD 的摘要、成就、职责原文、要求陈述、证据摘要、记录事实和反证文本都不会跨越该边界；本地边界上的姓名、联系方式和 Secret 会脱敏或使请求失败关闭。未知项不转成负面判断，任何操作均固定要求人工确认且禁止自动录用或淘汰。

## 部署与验收

本任务只新增 Worker 路由、策略绑定、合同和自动化测试，不修改 Production Secret、Provider 地址、模型或 Token Forge `/api/token-forge/plan` 行为。Preview 验收应使用同一套 `wrangler deploy --env preview`、合成输入和安全 smoke 流程；真实简历、JD 和生产发布留到 P5-007 之后的明确验收阶段。
