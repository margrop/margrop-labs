# ADR-0009：Incident Detective AI 解释与案例工坊边界

- 状态：Accepted
- 日期：2026-07-29

## 背景

Incident Detective 已有完全离线的场景、Attempt、确定性评分、分享卡和 Case Proposal 核心，
但公开页面仍没有实现 MVP 中的“解释错过证据”和“生成安全场景变体”。这两项能力需要模型，
同时不得让模型获得事故 Payload、用户自由文本、内部答案、评分规则或发布权限。

## 决策

新增两个 Provider-neutral AI Gateway 操作：

1. `incident-detective.explanation-v1`：只接收已验证 Score 的最小投影、已获取证据 ID 与公开
   元数据，以及固定安全声明；输出只能引用输入中的 Finding、Evidence 和服务 ID。
2. `incident-detective.case-proposal-v1`：复用 P2-005 的 Generation Input、Proposal 和 Human
   Review 合同；服务端根据公开 base Scenario 构造 Provider 输入并执行现有确定性后处理。

两个操作共用独立的 `INCIDENT_DETECTIVE_AI_POLICY` Durable Object 和流量账本，但按 operation
分别计费、限流和熔断。浏览器不能选择 Provider、模型、提示词、重试或预算。

## 硬边界

- 离线取证、Attempt 验证、确定性评分、分享卡和本地审核始终可用；AI 失败只产生降级状态。
- Explanation 不发送 Attempt 的 `summary`、`next_action`、支持/反证自由选择文本或证据 Payload。
- Case Proposal 不发送内部答案、canonical attempt 或评分规则；模型结果不能直接成为 Scenario。
- 所有 AI 输入输出使用版本化 JSON Schema，并在渲染前重新验证交叉引用和固定字段。
- 请求正文、模型正文与结果正文不写入日志、Analytics 或 Durable Object；只保存限流与 Token 元数据。
- Case Review 始终返回 `publishable: false`；页面只允许下载本地审核包，不提供发布按钮。

## 失败行为

- 输入敏感、引用不一致或超限：调用 Provider 前失败关闭。
- 超时、限流、预算耗尽、网络错误或无效模型结构：返回稳定错误码，不回显原始正文。
- Explanation 失败时继续展示确定性 Score 与 Findings，并明确标注 AI 未参与评分。
- Proposal 失败时不生成伪 Proposal；用户可以修改合成约束后重试。

## 后果

- Incident Detective 从“离线 Alpha 页面”扩展为“确定性核心 + 可选 AI 解释 + 审核型变体工坊”。
- 新增一个部署绑定和版本化公共合同，但不新增登录、数据库、真实监控接入或自动发布能力。
- Provider 成本只在用户主动请求解释或 Proposal 时发生；离线样例成本保持为零。
