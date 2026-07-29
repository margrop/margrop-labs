# AI 面试工作台 P5-008 可靠性、公平性与隐私基线

更新时间：2026-07-28

这是一份可重复的合成基线，不是生产招聘质量报告。当前工作台仍是 noindex 的合成样例页，
不接收真实简历或 JD，也没有真实候选人观察数据。它的目标是先证明边界在不同岗位族、
故障和浏览器尺寸下保持稳定，再进入 P5-009 的 Alpha 出口评审。

## 合成语料覆盖

`apps/web/src/lib/interview-reliability.ts` 从现有 v1 合成输入派生三个岗位族：

| 岗位族   |            角色 |        计划 |  结论 |       导出 |
| -------- | --------------: | ----------: | ----: | ---------: |
| 云平台   | 面试官 + 面试者 | 45 分钟闭合 | draft | 结构化摘要 |
| 前端产品 | 面试官 + 面试者 | 45 分钟闭合 | draft | 结构化摘要 |
| 数据平台 | 面试官 + 面试者 | 45 分钟闭合 | draft | 结构化摘要 |

Vitest 对三个岗位族的六个角色运行完整闭环，并逐项检查：

- requirement/evidence ID 引用属于当前 bundle；
- 计划阶段总分钟数精确等于 45；
- unknown 保留为 unknown，不转成零分或淘汰；
- 记录和结论始终要求人工确认，`automatic_decision` 始终为 `false`；
- 两种角色的安全导出只包含计数和状态，不含简历、JD、问题、事实或反证正文。

## AI/网络/Schema/导出故障矩阵

确定性结果是主结果，AI 只能作为显式请求的可审阅建议。下面的矩阵由
`interviewReliabilityFailureMatrix` 版本化；共享 Gateway 的底层错误映射由
`packages/ai-gateway` 单测覆盖，面试专属端点还覆盖 Provider 5xx、限流、预算拒绝、
无效 JSON、Schema 无效输出和输出 Token 超限。

| 故障                                    | 共享/面试测试                                                                        | 页面行为                     |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------- |
| 网络不可用、Provider 超时、Provider 5xx | `packages/ai-gateway/src/index.test.ts`、`interview-ai-runtime.test.ts`              | 保留本地三段结果             |
| 频率/并发/熔断限流                      | `packages/ai-gateway/src/token-forge-policy.test.ts`、`interview-ai-runtime.test.ts` | 保留本地三段结果             |
| 预算耗尽                                | `interview-ai-runtime.test.ts`                                                       | 不重试，不阻断本地结果       |
| Provider JSON 或操作 Schema 无效        | `interview-ai-runtime.test.ts`、Gateway 合同测试                                     | 不采用 AI 输出               |
| 输出 Token/响应过大                     | `packages/ai-gateway/src/index.test.ts`、面试策略上限                                | 不采用 AI 输出               |
| Secret/受保护属性/策略阻断              | AI 输出合同测试、仓库安全门                                                          | 失败关闭                     |
| 三项端点同时不可用                      | `e2e/interview-workbench-reliability.spec.ts`                                        | 匹配、计划、记录、导出仍可用 |

## 五类隐私 sink

`interview-reliability.test.ts` 使用带姓名、电话、邮箱和地址的本地样例，检查以下五类
边界不会携带原文：

1. AI request boundary；
2. 浏览器 URL；
3. Analytics payload（当前面试页不发送正文 Analytics）；
4. 用户主动下载的安全 Markdown 摘要；
5. 错误/日志文本。

受保护属性文本进入 AI 输出、`automatic_decision: true` 或人工确认漂移时，合同测试必须
拒绝；错误只返回通用边界信息，不回显输入值。

## 浏览器验收

- `interview-workbench.spec.ts`：双角色三步路径、429 降级、记录编辑、安全导出、320px 和
  reduced motion；
- `interview-workbench-reliability.spec.ts`：match/plan/conclusion 三个 AI 操作在 Provider
  503 时全部降级，仍能下载面试官摘要。

本基线通过后，页面仍保持 `noindex`。只有 P5-009 完成内容入口、无正文 Analytics 和
Alpha 出口评审后，才讨论真实简历/JD 的本地输入；任何真实输入接入都必须重新跑本矩阵。
