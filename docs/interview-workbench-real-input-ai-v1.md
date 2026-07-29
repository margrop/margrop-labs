# AI 面试工作台真实输入 AI 最小投影 v1

P5-013 允许 P5-012 的本地真实文本流程调用既有三个 AI 端点，但不改变 Provider、模型、
Secret、端口、预算、限流、超时、熔断或服务端日志策略。

## 三项操作

- `interview-workbench.match-v1`：发送脱敏后的经历短标签、技能、岗位短标签、要求 ID/类别/
  优先级和证据状态；
- `interview-workbench.plan-v1`：在同一 boundary 上增加已验证 Match Result、角色、时长和用户
  选择的必备门槛 ID；
- `interview-workbench.conclusion-v1`：只发送计划、问题、记录、事实和反证 ID，以及回答状态
  和 unknown 原因。

## 明确排除

请求不包含：

- `resume_text`、`jd_text` 或完整经历/职责/要求叙述；
- 姓名、邮箱、电话、地址、证件、账号、Secret 或受保护属性；
- 记录事实正文、反证正文、问题正文和追问正文；
- Provider、模型、Prompt、重试、预算或其他浏览器控制字段。

所有请求继续通过版本化输入 Schema。服务端输出必须通过操作专属 Schema 和引用完整性校验；
超时、限流、预算拒绝、Provider 失败、无效 JSON 或无效结构时，页面保留本地确定性结果。

## 验收

- 单元测试对同一真实文本 bundle 构建三项输入并检查敏感标记缺失；
- Chromium 拦截三项请求，证明请求不含原文、联系方式和提示注入文本；
- 三项 AI 失败时均显示安全降级，三步本地流程继续可用；
- 合成样例仍使用相同端点和既有回归。
