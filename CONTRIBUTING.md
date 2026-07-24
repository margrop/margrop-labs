# 贡献指南

## 工作流

1. 从 `TODO.md` 选择一个无阻塞任务。
2. 使用 `tasks/TASK_TEMPLATE.md` 固定范围与验收标准。
3. 创建短生命周期分支，例如 `feat/token-forge-form`。
4. 先完成确定性逻辑和测试，再接入 AI。
5. 运行任务规定的 lint、type-check、test、build 和端到端检查。
6. 使用 PR 模板说明隐私、AI 成本、可访问性和博客关联变化。

## 设计决策

以下变化需要 ADR：主框架、部署平台、AI Provider、持久化、认证、Analytics、公共 Schema、跨仓库集成和任何新的敏感数据流。

## PR 最低要求

- 关联 TODO/Issue；
- 范围单一、可回滚；
- 提供无需真实数据的复现方式；
- 包含失败与降级路径；
- 不泄露用户输入和密钥；
- 更新相关文档、示例与 `lab.json`；
- 至少由一名人类审阅后合并。
