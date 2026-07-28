# AI 面试工作台：本地输入、脱敏与证据边界 v1

P5-001 定义 AI 面试工作台的第一层合同。它只负责把简历、岗位 JD、要求和证据变成可验证的
本地结构；不实现岗位匹配、面试计划、结论生成、页面或真实 AI 调用。

## 四个版本化合同

| 合同 | 用途 | 关键边界 |
| --- | --- | --- |
| `interview-resume-v1` | 当前浏览器会话内的简历结构 | 只保留经历、技能、范围等工作事实；没有姓名、联系方式、住址、证件或账号字段 |
| `interview-jd-v1` | 当前岗位 JD 结构 | 角色、级别、职责和内嵌要求；不保存公司联系人或来源追踪信息 |
| `interview-requirement-v1` | 独立要求注册表 | 每个要求有稳定 ID、类别、优先级和待验证证据信号 |
| `interview-evidence-v1` | 要求—证据引用 | 区分 direct、partial、conflict、unknown；unknown 不是负面结论 |

所有四个合同都标记 `sensitivity: "sensitive"`，使用 `additionalProperties: false`，并限制
数组数量、文本长度和 ID 格式。未知字段会被拒绝，而不是静默地流入后续步骤。

## 本地输入模型

`validateInterviewInputBundle` 要求：

- 简历经历 ID、要求 ID、证据 ID 各自唯一；
- JD 内嵌要求与独立 Requirement Registry 的 ID 集合完全一致；
- Evidence 只能引用已存在的 Requirement ID；
- 缺失的证据通过 `support: "unknown"` 保留，不转换成“不具备能力”；
- bundle 顶层只允许 `resume`、`jd`、`requirements`、`evidence` 四个字段。

## 跨边界最小投影

`buildInterviewBoundaryProjection` 是 P5-001 的安全出口。它只发送以下结构化信号：

- 经历 ID、角色、领域、技术标签和规模/职责范围；
- 岗位角色、级别、Requirement ID、类别和优先级；
- Evidence ID、来源、类型、引用的 Requirement ID 和 support 状态。

以下字段明确被省略：

`resume_id`、简历 headline、经历 summary、经历 achievements、`jd_id`、JD responsibilities、
Requirement statement/evidence_signals、Evidence summary。这样 P5-001 不会把简历、JD 或
面试记录叙述原文跨出浏览器；P5-002 需要语义匹配时，必须新增经过审查的操作专属投影，不能
直接把本地对象序列化发送。

## 本地敏感文本预览

`redactInterviewLocalText` 只供当前标签页预览，调用公共 redaction 包并额外遮蔽姓名标签、
联系方式标签、手机号和身份证号。它返回占位符与脱敏计数，不返回原值；该函数不调用网络、
AI、存储或 Analytics。

这不是对任意自然语言中人名的完美识别器。因此业务代码必须继续遵守“结构化字段优先、
原文不跨边界”的规则，不能把本地脱敏预览误当作允许上传原文的许可。

## 五类 sink 规则

简历、JD 和面试记录原文及其可识别字段不得进入：

1. URL、查询参数和 fragment；
2. Analytics 事件或聚合快照；
3. 服务日志、错误追踪和异常消息；
4. AI 请求、Provider 元数据和重试日志；
5. 分享卡、公开页面和默认导出。

后续 P5-002 至 P5-009 必须复用本合同和引用 ID。任何结论都要区分事实、证据、反证、未知项
和 AI 推断，并保持人工确认边界。
