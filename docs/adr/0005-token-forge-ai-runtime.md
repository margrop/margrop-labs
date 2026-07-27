# ADR-0005：Token Forge 生产 AI 运行时

- 状态：Accepted
- 日期：2026-07-26

## 背景

ADR-0003 选择 Astro 静态输出与 Cloudflare Workers Static Assets，并要求新增运行时或
持久化前另写 ADR。P1-008 需要在不把 Provider Key 放进浏览器的前提下接通
`token-forge.plan-v1`，同时把 P4-004 的准入与结算状态放进跨请求、跨实例的原子存储。

用户提供了一个标准 OpenAI Chat Completions 兼容服务：

- Base URL：`https://api-gpt.speedtest.margrop.net:16666/v1`
- 主模型：`qwen-latest`
- 回退模型：`minimax-latest`
- 认证：服务端 `Authorization: Bearer` Secret

该上游网关负责真实货币预算，因此 Labs 仍必须限制 Token、请求、频率、并发与故障扩散，
但不重复维护可能失真的模型价格表。

## 决策

1. 保持 Astro `output: "static"`，只为 `/api/*` 增加 ES Module Worker；静态资源继续由
   Assets binding 提供。
2. 固定公开端点为 `POST /api/token-forge/plan`。浏览器只能提交
   `ai-gateway-request-v1` 和 `token-forge-ai-input-v1`，不能提交 URL、模型、指令、价格、
   尝试次数或密钥。
3. Worker 使用固定 OpenAI-compatible Adapter 调用 `/v1/chat/completions`。主模型固定为
   `qwen-latest`；网络失败、429、408/504、5xx 或响应无法解析时，才顺序调用固定回退模型
   `minimax-latest`。401/402/403 等终止型错误不回退，浏览器不能选择或覆盖模型。
4. 每个模型仍固定最大输入 22,000 Token、输出 2,000 Token；两个模型共享 45 秒 Gateway
   窗口和 1 次 Gateway 尝试。请求显式要求 `json_object`；只额外接受完整、无前后文字的
   单个 `json` Markdown 围栏，解析后仍执行相同的 Plan v1 与安全校验。
5. `TOKEN_FORGE_AI_API_KEY` 和 `TOKEN_FORGE_ACTOR_KEY_SECRET` 分别作为 Preview 与
   Production Worker Secret 管理；任何一个缺失时失败关闭到模板。
6. 只使用 Cloudflare Edge 写入的 `CF-Connecting-IP`，通过 HMAC-SHA256 派生
   `anon_<base64url>`。原始 IP、Secret 与对应关系不写入状态、日志或响应。
7. 使用单个 SQLite Durable Object 保存 P4-004 快照。在存储事务内完成“读取 → 准入/结算
   → 写回”，Provider 网络调用位于两个事务之间。
8. 生产流量配置为：每请求按两个模型的最坏情况预留 48,000 Token；未回退的成功请求按
   标准 usage 结算，一旦实际调用回退模型则按 48,000 Token 保守结算。匿名用户、Lab、
   全站每日请求 4/50/100；60 秒请求 1/6/10；并发 1/2/3；连续失败 3 次后熔断 120 秒；
   预留 60 秒。
9. 成本字段使用最小合同占位：调用前预留 1 microUSD，成功按 0 结算。真实货币预算完全由
   上游网关负责；Labs 不展示或推断费用。
10. API 只接受同源 JSON POST，请求与响应各 64 KiB，禁止重定向与缓存，不记录请求、
    Provider 正文、计划正文或原始错误。
11. 页面提供显式“AI 增强生成”和独立“仅生成模板”。AI、网络、限流、熔断或输出校验失败
    时，完整模板和导出继续可用。
12. `main` 的每次 push 自动部署并 smoke test 隔离的 Preview Worker；Production 仍只允许
    仓库所有者通过 `workflow_dispatch` 人工触发，且两种部署串行执行。

## 自定义端口约束

Worker 的 `compatibility_date` 晚于 `2024-09-02`，因此无需显式声明已经默认启用的
`allow_custom_ports`，仍可请求 `16666`。该上游主机名必须保持 Cloudflare DNS-only
（灰云），否则 Cloudflare Proxy 不接受的 HTTPS 端口不会被代理。如果必须启用橙云，应把
上游迁移到 443 或 Cloudflare 支持的 HTTPS 端口，再更新固定配置。

Cloudflare 参考：

- [Workers custom port compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#allow-specifying-a-custom-port-when-making-a-subrequest-with-the-fetch-api)
- [Cloudflare Network ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/)
- [Durable Object migrations and SQLite storage](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)
- [Static Assets binding and Worker-first routes](https://developers.cloudflare.com/workers/static-assets/binding/)

## 后果

- 静态页面与确定性模板不依赖 Worker API 或模型可用性；
- Provider Key、模型与系统指令不进入浏览器包和公共 Schema；
- Durable Object 成为 Token Forge AI 策略状态的唯一生产写入者；
- 共享 NAT 用户会共用匿名限额；轮换 HMAC Secret 会切换匿名桶，但不会恢复全局预算；
- 上游 usage 必须提供 `prompt_tokens` 和 `completion_tokens`，缺失或无效时整体降级；
- 页面 usage 只表示最终成功模型的标准 usage；回退路径的策略结算固定采用 48,000 Token
  下限，避免主模型无效响应缺少可信 usage 时低估消耗；
- `minimax-latest` 仍受 2,000 输出 Token 和共享 45 秒窗口限制；若只返回推理正文或
  `finish_reason: length`，会失败关闭到模板，不会放宽合同；
- Preview 与 Production 的 Durable Object、Secrets 和流量状态彼此隔离；
- 发布仍先经过 Preview，Production 只能由仓库所有者人工触发。

## 备选方案

### 浏览器直连兼容 API

拒绝。会暴露 API Key、模型和提示词，也无法建立可信的全局准入与结算。

### KV 或进程内 Map

拒绝。KV 不提供本状态机所需的单对象强一致事务；进程内状态会在隔离实例或重启时丢失。

### D1

暂不采用。当前状态小于 256 KiB 且所有写入需要单一串行边界，单个 SQLite Durable Object
更直接。未来若需要跨 Lab 报表，可在不写入正文的前提下另做投影。

### Labs 自行维护模型价格

拒绝。该上游已集中处理货币预算；重复价格表会过期并制造错误的费用结论。Labs 只保留
Token、请求、频率、并发和熔断保护。
