# Token Forge 正式页面与事件合同

P1-006 把 P1-002 的确定性模板和 P1-005 的本地导出接到
[`/token-forge/`](https://lab.margrop.net/token-forge/)。

## 用户路径

1. 页面在静态 HTML 中说明无需登录、不读取仓库、不调用 AI、不保存输入；
2. 用户输入 Token 预算、到期天数、可投入工时、技术栈和可公开目标，或载入合成样例；
3. 浏览器先做数值约束、允许字段映射、PII 脱敏和 Secret 拒绝；
4. P1-002 生成 `mode: "template"` 的确定性计划；
5. 计划重新通过 Token Forge v1 的预算、工时和依赖合同；
6. P1-005 在本地生成完整计划和逐任务 GitHub Issue 草稿；
7. 用户复制或下载产物，是否提交给 Coding Agent 或 GitHub 由用户决定。

正式页面没有仓库 URL、API Key 或 AI 控件。修改表单后旧结果立即失效，避免把旧计划误认为
新输入的结果。

## 表单边界

| 字段 | 页面约束 |
|---|---|
| Token 预算 | 2,000–60,000 的整数 |
| 到期时间 | 1–30 天的整数 |
| 可投入时间 | 1–80 小时，步长 0.5 小时 |
| 技术栈 | 1–8 项，逗号、中文逗号、分号或换行分隔 |
| 目标 | 10–500 字符 |

目标和技术栈是不可信自由文本。邮箱、IP 等 PII 在进入计划前脱敏；Token、Cookie 和
Authorization 等 Secret 直接拒绝，错误消息不回显原值。

## 最小事件合同

事件使用 [`token-forge-event-v1.schema.json`](../schemas/token-forge-event-v1.schema.json)，
只允许以下五个字段：

- `schema_version`：固定 `1.0`；
- `event_name`：`lab_open`、`run_success`、`run_failure`、`export`、`blog_click` 或
  `github_click`；
- `lab_id`：固定 `token-forge`；
- `lab_version`：固定 `1.0`；
- `device_category`：`mobile`、`tablet`、`desktop` 或 `unknown`。

未知字段在事件边界丢弃。表单值、目标、仓库 URL、计划、导出正文、错误正文、输入长度和
高精度设备数据都不属于事件。

P4-003 完成前，默认事件接收器是空实现：不发网络请求、不写存储、不打印日志。统计接入
失败也不得中断生成或导出流程。

## 静态与可访问性

- 标题、主标题、隐私合同和表单由 Astro 预渲染，禁用 JavaScript 时仍可索引和理解；
- Preact 工作台使用 `client:visible`，不抢占首屏加载；
- 控件使用原生 `label`、`input`、`textarea` 和 `button`，提示通过
  `aria-describedby` 关联；
- 成功、提示和错误同时使用文字、符号与 ARIA 状态，不仅依赖颜色；
- 触控目标不小于 44px，字段、任务与导出卡在 800px/600px 断点重排到单列；
- reduced-motion、forced-colors 和键盘焦点沿用站点基线。

构建后的首页与正式页面由静态合同脚本共同验收。
