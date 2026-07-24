# `@margrop-labs/ai-gateway`

Provider 中立的 AI Gateway v1 合同与离线执行核心。

包含：

- 请求与响应 Schema 验证；
- 客户端控制字段拒绝；
- 请求、响应、Token、JSON 复杂度、超时和尝试次数硬上限；
- Provider Adapter 接口和严格返回值解析；
- 粗粒度错误与 HTTP 状态映射；
- 操作专属输入/输出验证钩子；
- 无效模型响应、秘密回流与超限输出失败关闭。

不包含网络路由、Provider SDK、模型选择、真实密钥、数据库、限流存储或 AI 业务功能。完整合同见 [`docs/ai-gateway-contract-v1.md`](../../docs/ai-gateway-contract-v1.md)。
