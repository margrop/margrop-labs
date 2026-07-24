# Token 任务炼金炉

## 问题

用户有即将过期或暂时闲置的 Coding Token，却缺少值得做、范围清楚、可以验收的任务。

## MVP 流程

1. 输入额度规模、到期时间、技术栈、目标和可投入时间；
2. 可选提供公开 GitHub 仓库 URL；
3. 先由确定性模板生成任务骨架；
4. AI 在受限仓库摘要上补充 S/M/L 任务；
5. 导出 Markdown 或 GitHub Issue 文本。

## v1 合同

- [输入 Schema](../../schemas/token-forge-input-v1.schema.json)
- [任务计划 Schema](../../schemas/token-forge-plan-v1.schema.json)
- [字段、失败与版本说明](../../docs/token-forge-contract-v1.md)
- [有效 fixture](./fixtures/)

输入与计划都必须先通过版本化 Schema。任务依赖还必须位于同一计划、无自引用、无环；预计 Token 和工时总和不得超过输入预算。

## 确定性模板模式

[P1-002 模板模式](../../docs/token-forge-template-mode.md) 根据 Token 额度和可投入工时选择合同加固、完整功能切片或离线 MVP。它不分析自然语言、不读取仓库、不调用 AI；相同输入会产生相同计划，并作为未来 AI 超时、限流或无效输出时的降级路径。

较大目标会拆成有依赖关系的 S/M 阶段，而不是生成一个边界模糊的 L 任务。三个合成输入 fixture 覆盖小、中、大场景。

## 公开 GitHub 仓库摘要

[P1-003 摘要适配器](../../docs/github-public-repository-adapter.md) 只接受规范的公开 GitHub URL，不使用 GitHub Token。它通过固定 API Origin 读取仓库元数据、一次目录树和最多 8 个安全文本文件；单文件、总字节、目录树、响应、超时和重试都有硬上限。

秘密样式路径、生成目录、二进制、过大文件和疑似秘密内容会被跳过。摘要返回覆盖计数、截断状态和未知项，文件正文明确标记为不可信数据。P1-003 仍不调用 AI；元数据或目录树失败时，未来流程必须退回 P1-002 模板模式。

## AI 边界

代码负责输入验证、仓库读取上限、任务 Schema、去重基础和安全规则；AI 负责语义拆分、优先级解释和 Prompt 草拟。

未来 AI 拆分必须通过 [AI Gateway v1 合同](../../docs/ai-gateway-contract-v1.md)：Web 只发送操作专属的最小结构化数据，不能指定 Provider、模型、系统提示词或密钥；无效模型响应整体丢弃并保留模板结果。完整脱敏包由 P0-007 提供，完成前不接真实 Provider。

## 隐私

只读取公开仓库；不得要求 GitHub 私有 Token。导出不包含原始文件正文或隐藏系统 Prompt。Analytics 不记录仓库 URL和表单内容。

模板模式不读取仓库，P1-003 适配器只读取有界的公开样本；两者都不调用 AI、不记录日志、不持久化输入。Analytics 不得接收仓库 URL、文件路径或正文。

## MVP 验收

无需仓库、无需 AI 的样例可以完成一次任务生成；AI 失败时保留模板结果。
