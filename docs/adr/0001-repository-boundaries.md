# ADR-0001：公众体验与基础设施内核分离

- 状态：Accepted
- 日期：2026-07-24

## 决策

`margrop-labs` 负责公众 Web 体验、AI Gateway 合同、博客关联和匿名使用安全；`ai-infrastructure-toolkit` 负责 PVE、NAS、可观测性等可复用内核。

跨仓库优先使用版本化 JSON Schema、发布包或稳定 HTTP API。

## 原因

两者发布节奏、安全模型和用户群不同。分离可避免 Web 展示需求污染运维内核，也避免公众输入直接接触基础设施凭据。
