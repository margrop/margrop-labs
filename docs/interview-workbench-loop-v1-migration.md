# Interview Loop v1 `local_input` 迁移说明

P5-011 对 `interview-loop-v1` 做兼容性枚举扩展：

- 原值 `scenario_kind: "synthetic"` 保持不变；
- 新增 `scenario_kind: "local_input"`，只用于浏览器本地真实文本派生流程；
- 现有 fixture、导出、记录、结论和 AI 操作 Schema 均不变；
- 现有消费者若使用穷举分支，应增加 `local_input` 分支，不能把它显示为合成样例；
- 两种场景都继续要求 `local_only: true`、人工确认和 `automatic_decision: false`。

仓库内使用 `buildInterviewSyntheticLoop` 的现有调用保持合成语义；真实文本入口必须调用
`buildInterviewLocalInputLoop`。
