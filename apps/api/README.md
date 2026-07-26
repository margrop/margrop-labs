# API / AI Gateway

可选服务端能力的预留目录，职责限于：

- AI Provider 密钥隔离；
- 结构化请求验证；
- 限流、预算、超时和熔断；
- 公开 GitHub 仓库的受限读取；
- 不含正文的调用元数据。

服务端不得成为确定性解析和脱敏的唯一实现，也不得记录用户输入正文。P4-004 已提供
Token Forge 的 Provider-neutral 流量策略与可序列化快照；P1-008 选择运行时时必须为它
提供原子持久化、服务端匿名用户键、固定价格表和所有 Provider 尝试的可信结算。完整边界见
[Token Forge AI 流量与成本策略](../../docs/token-forge-ai-traffic-policy.md)。
