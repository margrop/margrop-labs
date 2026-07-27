# ADR-0004：Provider 中立的 AI Gateway 边界

- 状态：Accepted
- 日期：2026-07-24
- 更新：2026-07-26

## 背景

Margrop Labs 的静态 Web 需要为多个实验使用受控 AI 能力，但浏览器不能持有 Provider Key，也不能决定模型、系统提示词、重试和成本策略。不同 Provider 的请求、错误和 Token 统计格式并不一致，直接暴露其中任意一种协议都会把 Lab 与供应商绑定。

P1-004 等功能还要求：模型输出必须经过版本化结构验证；AI 失效时，确定性样例和核心能力仍然可用。

## 决策

在浏览器和 Provider 之间建立服务端 AI Gateway：

1. Web 只发送 `ai-gateway-request-v1` 业务信封；
2. Gateway 按 `lab_id + operation` 从服务端注册表选择操作、提示词、Provider 和模型；
3. Provider Adapter 只接收验证、最小化后的结构化业务数据和服务端硬限制；
4. Adapter 返回 `unknown`，Gateway 必须验证 Provider 信封和操作专属输出；
5. Web 只收到 `ai-gateway-response-v1` 结果或粗粒度错误码；
6. Provider Key 仅由未来服务端运行时从环境绑定取得，不进入公共合同、浏览器包、日志或错误；
7. 请求正文、模型正文和结果正文默认不持久化。

公共合同不包含 `provider`、`model`、`messages`、`system_prompt` 或任何密钥字段。客户端也不能提高请求、响应、Token、超时和尝试次数上限。

## 硬边界

- 请求与响应各 64 KiB；
- 输入最多 24,000 Token，其中预留 2,000 Token 给服务端指令；
- 输出最多 4,000 Token；
- 单次 Gateway Provider 窗口最多 45 秒；各操作应继续使用满足实测延迟的更低上限；
- 总尝试次数最多 2 次；
- 只对 Provider 暂时不可用或无效结构进行一次受控重试；
- 限流、预算耗尽、超时、策略阻断和输出截断不自动重试。

输入 Token 的调用前判断使用保守的 UTF-8 字节上界加系统预留；Provider 返回的实际 usage 仍须再次验证。未来可在不放宽硬上限的前提下，为特定 Provider 增加更精确的服务端 Token 计数器。

## 后果

- Lab 和 Web 不依赖具体 Provider SDK 或错误格式；
- 替换 Provider 不改变公共 Schema；
- 每个 AI 操作必须注册自己的输入清洗器和输出验证器；
- Gateway 会丢弃 Provider 的原始错误正文和未知字段；
- 当前任务不创建网络端点、不选择模型、不部署运行时，也不读取任何真实密钥；
- P0-007 仍需提供完整脱敏包，P1-004 才能安全发送 Token Forge 的最小摘要。

## 备选方案

### 浏览器直连 Provider

拒绝。它会暴露密钥、模型策略和费用控制，也无法建立统一限流与日志边界。

### 每个 Lab 直接实现 Provider 调用

拒绝。会重复超时、错误映射、预算和验证逻辑，并使后续 Provider 切换困难。

### 立即在通用 Gateway 绑定单一模型或 SDK

拒绝。P0-006 只定义稳定边界，模型选择需要依据实际任务质量、成本和运行时环境另行决定。
具体操作可以在服务端 Adapter 中固定主模型和回退模型，但不能把模型选择开放给浏览器。
