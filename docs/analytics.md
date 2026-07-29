# Analytics 规范

## 目标

仅回答固定产品阶段是否被触发，不识别用户，不保存正文，也不把 Analytics 当作计费、审计
或个人行为分析依据。

## 共享 v1 合同

浏览器事件使用
[`lab-analytics-event-v1.schema.json`](../schemas/lab-analytics-event-v1.schema.json)，只允许：

- `schema_version`；
- `lab_id` 与 `lab_version`；
- Lab 专属固定 `event_name`；
- `mobile`、`tablet`、`desktop`、`unknown` 四类粗设备类别。

禁止页面路径之外的自由文本、角色、步骤编号、要求/证据/记录 ID、错误码、Provider、文件名、
访客或会话 ID。请求最大 1 KiB，使用 `credentials: "omit"`、
`referrerPolicy: "no-referrer"`、`keepalive: true` 且不重试；同步、异步或服务端失败都不得影响
Lab 主流程。

## 路由与事件

- `POST /api/token-forge/events`：`lab_open`、`run_success`、`run_failure`、`export`、
  `blog_click`、`github_click`；
- `POST /api/interview-workbench/events`：`lab_open`、`match_complete`、`plan_complete`、
  `conclusion_complete`、`ai_success`、`ai_fallback`、`export`。

两个路由执行同源和 Lab 绑定校验。Token Forge 路由不能接收面试事件，面试路由不能接收
Token Forge 事件。

## 聚合与迁移

Worker 在现有 `TOKEN_FORGE_ANALYTICS` SQLite Durable Object 中立即折叠为“UTC 日期 × Lab ×
事件枚举 × 粗设备类别”计数，只保留 31 天，不提供公共读取端点。持久化合同见
[`lab-analytics-snapshot-v1.schema.json`](../schemas/lab-analytics-snapshot-v1.schema.json)。

旧 `token-forge-analytics-snapshot-v1` 在首次写入时补入 `lab_id: token-forge` 并迁移到
`lab-analytics-snapshot-v1` key；旧 Token Forge API、事件构造函数和旧快照 facade 保持兼容。
架构见 [ADR-0008](./adr/0008-shared-lab-aggregate-analytics.md)。

## 禁止采集

- 简历、岗位说明、问题、回答、记录、结论、导出正文；
- 表单值、仓库 URL、日志、SMART 输出；
- AI Prompt、AI Response 或 Provider 元数据；
- IP、域名、主机名、序列号、Cookie、凭据；
- 输入长度、精确性能或其他可推断敏感信息的高基数字段。

这些计数表示事件次数而非唯一用户；刷新、重复操作和自动化会放大数字。
