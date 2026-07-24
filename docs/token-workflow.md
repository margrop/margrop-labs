# 闲置 Token 工作流

1. 从 `TODO.md` 选择一个无依赖任务。
2. 复制 `tasks/TASK_TEMPLATE.md` 并补齐路径、输入和验证命令。
3. 将任务卡与 `prompts/IMPLEMENT_TASK.md` 交给 Agent。
4. 要求先提交确定性逻辑和测试，再接 UI/AI。
5. 人类检查 diff、隐私、模型成本和移动端结果后再合并。

| Token 规模 | 推荐任务 |
|---|---|
| S | 文档、Schema、fixture、单一组件或纯函数 |
| M | 一个完整交互切片、解析器、适配器或 AI 合同 |
| L | 一个 Lab 的离线 MVP；先拆成多个 M 更好 |

禁止用闲置 Token 批量生成没有测试、没有真实入口和没有维护计划的“工具壳”。
