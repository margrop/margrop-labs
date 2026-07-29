# Incident Detective 受约束案例生成与审核

P2-005 为 Incident Detective 增加 `incident-detective.case-proposal-v1` AI Gateway 操作核心。
它生成的是仓库内部、必须人工审核的 **Case Proposal**，不是可直接进入页面的 Scenario。

## 为什么先生成 Proposal

完整可玩案例需要指标点、日志、只读查询结果、时间线、答案、canonical attempt 和独立评分
规则互相闭合。让模型一次性生成并直接发布这些文件，会同时把事实、答案和分数交给不确定输出。

P2-005 把流程拆成：

1. 调用方提交结构化生成约束；
2. AI 只生成服务、证据大纲、预期观察、机制和审核问题；
3. 代码重新验证 Proposal 的 Schema、引用、预算、DAG、反证和隐私边界；
4. 服务端固定安全说明，丢弃模型提供的安全措辞；
5. 结果状态只能是 `review-required`；
6. 人工填写独立审核合同；
7. 即使审核为 `approved`，结果仍固定为 `publishable: false`；
8. 案例作者再人工制作 Scenario、内部答案、canonical attempt 与评分规则，并分别运行现有合同。

这样 AI 负责提出候选变体，人类和确定性代码继续拥有事实与发布权。

## 生成输入

[`incident-detective-case-generation-input-v1`](../schemas/incident-detective-case-generation-input-v1.schema.json)
只接受：

- 稳定 Proposal ID 与一个已验证的 base case ID；
- beginner / intermediate / advanced 难度；
- 六种有界主题之一；
- 3–5 个允许的 Prometheus、Loki、MySQL、Runbook 或 Topology 来源；
- 4–16 点证据预算；
- 2–4 条学习目标。

自由仓库正文、真实日志、URL、Provider、模型、系统提示词、凭据和评分规则都不属于输入。
学习目标继续通过 Incident Detective 合成/隐私边界，敏感内容会在调用 Provider 前失败关闭。

## Provider 边界

Provider 只收到验证后的输入、base case 中允许出现的服务类型和固定布尔 Guardrails。它不会
收到 base Scenario 的证据 Payload、内部答案、canonical attempt 或评分规则。

固定 Guardrails 要求：

- 完全合成；
- 只读证据；
- 必须包含反证和预算取舍；
- 必须人工审核；
- 禁止评分字段；
- 禁止自动发布。

整个 Provider 输入不超过 8 KiB；通用 Gateway 继续执行 64 KiB 信封、24k 输入 Token、
4k 输出 Token、15 秒超时和最多两次尝试等硬上限。

## Proposal 合同

[`incident-detective-case-proposal-v1`](../schemas/incident-detective-case-proposal-v1.schema.json)
包含：

- `requires_human_review: true`；
- 标题、摘要、难度和主题；
- 合成服务；
- 证据预算与 5–12 个证据大纲；
- 每份证据的来源、服务、成本、前置、角色、只读访问、用途和预期观察；
- review-only 机制、未知项和审核问题；
- 服务端固定的安全说明。

确定性验证器还检查：

- 服务与证据 ID 唯一，所有引用位于同一 Proposal；
- 证据前置关系无自引用、悬空引用和环；
- 每条前置路径都能放进预算；
- 全部证据成本必须大于预算，形成真实取舍；
- support、counterevidence 与 context 三种角色都存在；
- 来源集合、预算、难度、主题、学习目标和 ID 与调用方输入完全一致；
- 服务类型不能超出已验证 base case 的类型集合；
- 不接受分数、权重、写入权限、真实基础设施或敏感标识。

模型返回的 `safety_notes` 先经过结构与隐私检查，随后由代码替换成四条固定说明。模型不能通过
改写安全文案放宽边界。

## 人工审核门

[`incident-detective-case-review-v1`](../schemas/incident-detective-case-review-v1.schema.json)
把 decision 限定为：

- `approved`；
- `changes_requested`；
- `rejected`。

审核人必须明确确认合成数据、答案隔离、只读、反证、预算路径、隐私和评分独立性。批准要求
七项全部为真且没有待修改项；请求修改必须列出具体变化；Proposal ID 必须匹配。

审核结果始终返回 `publishable: false`。`approved` 只表示“大纲可以进入人工制作阶段”，
不表示它已经是有效 Scenario，更不会触发 GitHub 写入、部署或页面发布。

## 失败与重试

- 输入无效、敏感、base case 不匹配或超限：不调用 Provider，返回 preparation failure；
- Provider 暂时不可用：由 Gateway 最多重试一次，失败后不保留 Proposal；
- Proposal 结构、约束、隐私或引用不合格：作为无效模型响应最多重试一次；
- 任意失败：结果只有稳定失败码和尝试次数，不含模型正文或敏感原文；
- 没有“自动修补成可发布案例”或确定性假 Proposal 降级。

## 当前交付边界

P2-008 已把 P2-005 的离线核心接入 `/api/incident-detective/case-proposal` 与公开案例工坊。
浏览器只提交 Generation Input；服务端根据已验证的公开 base Scenario 增加允许的服务类型和
固定 Guardrails，再通过共享 OpenAI-compatible Provider Adapter、独立 Durable Object 流量
账本和原有 Proposal 后处理执行生成。

页面只展示通过验证的 Proposal，并在本地执行七项 Human Review。审核包可以下载为 JSON，
但任何决定都保持 `publishable: false`；运行时没有仓库写入、部署或自动发布路径。Provider
失败时不创建确定性假 Proposal，离线取证与评分继续可用。

自动化覆盖有效生成、Provider 最小输入、固定安全说明、来源/预算/目标/服务类型漂移、DAG、
反证、敏感内容、Gateway 失败、无副作用、HTTP 同源/限流边界、批准/修改/拒绝状态，以及
Chromium 中的生成、审核和本地下载。所有 fixture 都是仓库内合成数据。
