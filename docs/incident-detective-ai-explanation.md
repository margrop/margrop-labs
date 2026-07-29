# Incident Detective AI 评分解释与降级

P2-007 在确定性评分完成后提供可选 AI 解释。AI 不参与证据解锁、Attempt 验证、Finding
命中、维度分数、总分或等级计算。

## 最小输入

[`incident-detective-ai-explanation-input-v1`](../schemas/incident-detective-ai-explanation-input-v1.schema.json)
只包含：

- 案例 ID、总分、等级和维度分数；
- 每条确定性 Finding 的 ID、状态和公开消息，不包含内部权重；
- 全部证据的 ID、标题、来源、可选服务 ID、成本与是否已获取；
- 六个固定 Guardrails，声明完全合成、分数权威、禁止发明事实、只读建议，以及 Attempt 文本和
  Evidence Payload 均已排除。

构建器先重新验证 Scenario、Attempt 与 Score，再产生投影。用户填写的根因摘要、下一步、信心、
支持/反证选择文本、证据正文、内部答案、canonical attempt 和评分规则不会进入 AI 请求。

## 输出约束

[`incident-detective-ai-explanation-v1`](../schemas/incident-detective-ai-explanation-v1.schema.json)
包含标题、优势、缺口、安全下一步、未知项和固定免责声明。确定性验证器要求：

- 场景 ID 与总分必须和输入一致；
- 优势只能引用 `met` / `avoided` Finding；
- 缺口只能引用 `missed` / `penalty` Finding；
- 所有 Finding 与 Evidence ID 必须来自输入且不能重复；
- 文本继续通过完全合成与敏感内容边界；
- 固定声明为“AI 解释不改变确定性评分、案例事实或未知项。”

## 运行时与降级

浏览器只在用户点击“请求 AI 解释”后调用
`/api/incident-detective/explanation`。服务端要求同源 JSON POST，限制请求/响应为 64 KiB，
Provider 超时 30 秒，单次最多一次模型尝试，并通过独立 SQLite Durable Object 执行按操作
限流、预算、并发和熔断。

浏览器设置 35 秒超时、响应体上限和 request ID 对账。超时、限流、预算耗尽、网络失败、
响应过大、无效 JSON、引用漂移或改分都会返回 `deterministic-fallback`；页面继续展示原有 Score
与 Findings，不生成伪 AI 文本。

请求正文、模型正文和解释正文不写入日志、Analytics、Local Storage 或 Durable Object。
