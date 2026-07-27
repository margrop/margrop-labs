# AI Gateway v1 合同

P0-006 定义 Margrop Labs Web、服务端 Gateway 和 AI Provider Adapter 之间的稳定边界。
通用合同与执行核心位于 `packages/ai-gateway`；P1-008 已为
`token-forge.plan-v1` 增加固定服务端端点和 Adapter。

架构决策见 [ADR-0004](./adr/0004-provider-neutral-ai-gateway.md)。

## 公共请求

`ai-gateway-request-v1` 只包含：

| 字段             | 用途                                     |
| ---------------- | ---------------------------------------- |
| `schema_version` | 固定为 `1.0`                             |
| `request_id`     | UUID 幂等与关联标识                      |
| `lab_id`         | 调用来源 Lab                             |
| `operation`      | 服务端注册的版本化操作                   |
| `input`          | 经过操作专属 Schema 验证的结构化业务数据 |

客户端不能发送 `provider`、`model`、`messages`、`system_prompt`、Provider Key、Authorization、Cookie、密码或访问 Token。即使这些字段藏在嵌套输入中，也会在调用 Provider 前失败关闭。

公共 Schema 只验证通用信封；每个 `operation` 必须再提供独立的输入验证与字段白名单。未知字段不能透传给 Provider。

## 公共响应

成功响应包含经过操作专属验证的 `result`、Provider usage 和 `attempt_count`。失败响应只包含稳定错误码、是否适合稍后重试、可选的受限 `retry_after_seconds`，不包含 Provider 原始消息、堆栈、请求正文或模型正文。

| 错误码                        | HTTP | 自动重试 |
| ----------------------------- | ---: | -------- |
| `invalid_request`             |  400 | 否       |
| `request_too_large`           |  413 | 否       |
| `input_token_limit_exceeded`  |  413 | 否       |
| `rate_limited`                |  429 | 否       |
| `budget_exhausted`            |  429 | 否       |
| `provider_timeout`            |  504 | 否       |
| `provider_unavailable`        |  503 | 最多一次 |
| `invalid_provider_response`   |  502 | 最多一次 |
| `output_token_limit_exceeded` |  502 | 否       |
| `response_too_large`          |  502 | 否       |
| `policy_blocked`              |  422 | 否       |
| `internal_error`              |  500 | 否       |

表中的“自动重试”是 Gateway 单次执行内部的行为；响应中的 `retryable` 表示用户稍后重新发起是否可能成功。客户端不得据此建立无限自动重试。

## Provider Adapter

Adapter 只实现：

```ts
interface AiGatewayProviderAdapter {
  readonly adapterId: string;
  generate(
    request: AiGatewayProviderRequest,
    context: { signal: AbortSignal },
  ): Promise<unknown>;
}
```

返回值故意是 `unknown`。Gateway 只接受两种严格形态：

- 成功：`ok`、`output`、`finish_reason` 和精确 Token usage；
- 失败：`ok: false` 和允许的粗粒度 Provider 错误码。

多余字段、原始 Provider 错误、usage 不一致、未知 finish reason 或操作输出 Schema 失败都视为无效响应。无效响应最多重试一次，仍无效则返回 `invalid_provider_response`。

Adapter 的初始化和密钥注入属于服务端运行时；公共接口没有密钥参数。Provider Request
也没有模型和提示词字段，这些配置由服务端操作注册表持有。

## 上限

| 边界                  | 硬上限 |
| --------------------- | -----: |
| 请求 JSON             | 64 KiB |
| 响应 JSON             | 64 KiB |
| 输入 Token            | 24,000 |
| 服务端指令预留        |  2,000 |
| 输出 Token            |  4,000 |
| 单次 Provider 窗口    |  45 秒 |
| 总尝试次数            |      2 |
| JSON 深度             |      8 |
| JSON 节点             |  1,000 |
| `retry_after_seconds` |  3,600 |

运行时策略只能降低这些值。调用前使用“操作输入 UTF-8 JSON 字节数 + 2,000”作为保守 Token 上界；Provider 返回后再检查实际 usage 和总数一致性。

未来 HTTP 层还必须在解析 JSON 前执行请求体流式上限。当前离线执行器只能限制已经交给它的 JavaScript 数据。

## 失败关闭与降级

- Provider 超时：中止当前尝试，返回 `provider_timeout`；
- Provider 限流或预算耗尽：不在同一次调用中重试；
- Provider 暂时不可用：最多再尝试一次；
- 输出截断或超 Token：丢弃整个输出；
- 操作输出无效：最多再尝试一次，随后丢弃；
- 输出疑似包含私钥头、AWS Access Key 或 GitHub Token：返回 `policy_blocked`；
- 任意失败：消费者保留确定性结果，例如 Token Forge 的 P1-002 模板计划。

P0-006 不把无效模型字段修补进有效对象，也不让 AI 覆盖确定性事实。

## 隐私、日志与成本

执行核心不记录日志、不持久化请求或响应、不访问网络。未来 Gateway 服务只允许记录时间、Lab ID、操作、模型代号、状态码、耗时、尝试次数和 Token 数；禁止请求正文、响应正文、仓库 URL、文件路径和 Provider 原始错误。

P0-007 已提供允许字段优先、Secret 默认拒绝的完整脱敏边界。P1-004 的
`token-forge.plan-v1` 操作在调用本合同前，会把公开仓库样本进一步压缩为最多 4 个无路径
脱敏片段，仓库正文合计不超过 10 KiB，整个操作输入不超过 20 KiB。操作和降级行为见
[Token Forge AI 任务拆分](./token-forge-ai-planning.md)。

P2-005 的 `incident-detective.case-proposal-v1` 操作只发送 ID、主题、允许来源、预算、
学习目标、base case 服务类型和固定 Guardrails，总输入不超过 8 KiB。它不发送现有证据
Payload、内部答案、canonical attempt 或评分规则；输出只能进入人工审核，不能自动发布。
详见[受约束案例生成与审核](./incident-detective-case-generation.md)。

P4-004 为 `token-forge.plan-v1` 增加 Provider-neutral 的准入状态机。它在 Provider 调用前
按最多两次尝试预留 56,000 可计费 Token 和 $0.10，执行匿名用户、Lab、全站三层日预算、
滑动限流、并发与熔断；成功后按所有尝试的可信汇总用量退款，失败或预留超时按全额计费。
固定数值、快照隐私和 P1-008 接入要求见
[Token Forge AI 流量与成本策略](./token-forge-ai-traffic-policy.md)。

P1-008 把 Token Forge 收紧为每模型 22,000 输入、2,000 输出、共享 45 秒和 1 次 Gateway
尝试，并用 SQLite Durable Object 原子保存准入与结算快照。其服务端 Adapter 固定
`qwen-latest` 主模型和 `minimax-latest` 顺序回退模型；回退不改变公共合同，也不能由
浏览器触发或选择。自建上游网关负责真实货币预算，因此 Labs 的金额字段只作最小合同占位。

## Fixture 与验证

- `ai-gateway-request.valid.json`
- `ai-gateway-response.valid.json`
- `token-forge-ai-policy.valid.json`

测试使用内存中的合成 Adapter，覆盖公共 Schema、服务端控制字段、请求/响应/Token 上限、超时、限流、暂时不可用、无效模型结构、秘密回流、Provider 错误隔离和 HTTP 映射。没有真实 Provider、真实仓库内容或真实凭据。

## 已知限制

- 通用 Gateway 没有自动路由注册表；当前只有 Token Forge 具备生产 HTTP 适配；
- Token Forge 使用上游标准 usage，没有本地精确 Tokenizer；
- 通用请求 Schema 不能替代每个操作的输入 Schema；
- Gateway 自身的最小秘密检测不能替代 P0-007 和各操作的允许字段脱敏；
- 通用 Gateway 的 `request_id` 仍没有响应缓存；Token Forge 策略只提供 24 小时有限去重；
- P4-004 不读取模型价格，也不汇总 Provider 尝试；P1-008 必须在服务端完成这两项后才能
  提交可信结算。
