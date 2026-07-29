# ADR-0008：共享 Lab 聚合 Analytics 内核

- 状态：Accepted
- 日期：2026-07-29

## 背景

Token Forge 已有同源、无正文、31 天保留期的 SQLite Durable Object 聚合 Analytics。
AI 面试工作台需要观察合成 Alpha 的页面打开、三段完成、AI 成功/降级和导出，但不能采集
简历、岗位说明、问题、记录、结论或任何访客标识。复制一套 Durable Object、binding 和
配置会增加安全策略漂移与部署成本。

## 决策

1. 新增版本化 `LabAnalyticsEvent` 与 `LabAnalyticsSnapshot` 公共合同；事件只包含
   `schema_version`、`lab_id`、`lab_version`、`event_name` 和粗设备类别。
2. `/api/token-forge/events` 与 `/api/interview-workbench/events` 使用独立同源路由，服务端
   必须验证事件 `lab_id` 与路由一致。
3. 两个 Lab 共用现有 `TOKEN_FORGE_ANALYTICS` binding、`TokenForgeAnalyticsObject` class
   和对象名，不新增 binding、Secret、Cookie、公共读取 API 或环境配置。
4. Durable Object 优先读取 `lab-analytics-snapshot-v1`；若不存在，则读取旧的
   `token-forge-analytics-snapshot-v1`，补入 `lab_id: token-forge` 后只写新 key。
5. 聚合维度固定为 UTC 日期、Lab、事件枚举和粗设备类别；保留 31 天，计数饱和于
   `Number.MAX_SAFE_INTEGER`。
6. Token Forge 旧事件类型、构造函数、路由、旧快照 facade 与消费者测试保持兼容。

## 隐私与失败行为

- 请求体最大 1 KiB，`credentials: omit`、`no-referrer`、无重试；
- 未知字段先删除，Schema 无效或跨 Lab 事件返回空正文 `400`；
- 跨源、非 JSON、超限和存储错误只返回安全状态码；
- 不保存原始事件、单次时间戳、来源、User-Agent、IP、访客或会话 ID；
- Analytics 失败不得阻断任何 Lab 主流程。

## 后果

面试工作台获得最小转化观测能力，而部署配置、AI Token 使用和 Token Forge 行为不变。
共享快照属于新的不可变 v1 合同；未来增加 Lab 或事件必须同步 Schema、fixture、消费者测试
和迁移说明。
