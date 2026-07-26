# `@margrop-labs/ai-gateway`

Provider 中立的 AI Gateway v1 合同、离线执行核心和 Token Forge 流量策略。

包含：

- 请求与响应 Schema 验证；
- 客户端控制字段拒绝；
- 请求、响应、Token、JSON 复杂度、超时和尝试次数硬上限；
- Provider Adapter 接口和严格返回值解析；
- 粗粒度错误与 HTTP 状态映射；
- 操作专属输入/输出验证钩子；
- 无效模型响应、秘密回流与超限输出失败关闭；
- Token Forge 的 Token/微美元日预算、滑动限流、并发预留与熔断状态机；
- 可验证、可序列化且不含输入正文的策略快照。

不包含网络路由、Provider SDK、模型选择、真实密钥、数据库、持久化适配器或 AI 业务功能。
通用合同见 [`docs/ai-gateway-contract-v1.md`](../../docs/ai-gateway-contract-v1.md)，Token
Forge 的成本与流量合同见
[`docs/token-forge-ai-traffic-policy.md`](../../docs/token-forge-ai-traffic-policy.md)。
