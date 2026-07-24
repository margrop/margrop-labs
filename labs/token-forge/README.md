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

## AI 边界

代码负责输入验证、仓库读取上限、任务 Schema、去重基础和安全规则；AI 负责语义拆分、优先级解释和 Prompt 草拟。

## 隐私

只读取公开仓库；不得要求 GitHub 私有 Token。导出不包含原始文件正文或隐藏系统 Prompt。Analytics 不记录仓库 URL和表单内容。

P1-001 不读取仓库、不调用 AI、不持久化输入。输入 Schema 只能验证 GitHub URL 形态，仓库是否公开存在由 P1-003 处理。

## MVP 验收

无需仓库、无需 AI 的样例可以完成一次任务生成；AI 失败时保留模板结果。

