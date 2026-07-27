# UI 与可访问性基线

P0-005 在现有 Astro 页面壳和 Hello Lab 中建立可复用组件，不新增正式 Lab 业务。

P1-006 在不改变这些基础合同的前提下，将组件用于首个正式
[`/token-forge/`](https://lab.margrop.net/token-forge/) 页面。

## 组件

| 组件                             | 合同                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `BaseLayout.astro`               | Skip link、品牌、内部导航、外部入口、`main` 与页脚地标                                                  |
| `FormField.tsx`                  | 可见 Label、当前值、操作提示与 `aria-describedby`                                                       |
| `StatusNotice.tsx`               | 文字、符号、颜色和 `status`/`alert` 语义共同表达状态                                                    |
| `EvidenceCard.tsx`               | 明确区分输入证据、规则依据、AI 解释和未知项                                                             |
| `ExportActions.tsx`              | 复制或下载调用方提供的 Markdown，净化下载文件名，通过状态消息反馈结果，并在成功后触发可选的最小导出回调 |
| `TokenForgeWorkbench.tsx`        | 原生表单、本地模板生成、证据卡、任务卡和三种导出的正式 Lab 组合                                         |
| `IncidentDetectiveWorkbench.tsx` | 预算、证据解锁、五类 Payload、时间线、假设表单、Attempt 验证和五维本地评分                              |

## 键盘与辅助技术

- 导航、Range 和按钮使用原生 HTML 控件，不模拟交互角色；
- Range 提供可见 Label、当前值、范围说明和方向键提示；
- Token Forge 数值、文本和多行文本使用原生控件，并将每条提示通过
  `aria-describedby` 关联；
- Incident Detective 使用原生 `progress`、按钮、复选框、`select`、`textarea`、表格与
  `details`；证据不可用原因通过 `aria-describedby` 关联；
- 宽表容器可以获得键盘焦点并横向滚动；
- 所有可交互控件都有清晰的 `:focus-visible` 外框；
- 动态规则结果和导出反馈使用 `role="status"` 与 `aria-atomic="true"`；
- 状态卡片不只依赖颜色，同时包含符号、类型文字和完整说明；
- Skip link 可直接把焦点移动到主要内容。

## 移动端与动效

- 页面最小支持宽度为 320px；
- 800px 以下三列内容改为单列，600px 以下导航换行；
- Token Forge 的字段、任务、验收项和导出卡在窄屏下逐级改为单列；
- Incident Detective 的简报、证据内容、选项、时间线、评分维度和结果摘要在窄屏下重排，
  日志正文和数据表不会撑破页面；
- 导航和按钮的点击目标最小高度为 44px；
- 长文本、路由和证据值允许换行，不制造横向滚动；
- `prefers-reduced-motion: reduce` 时禁用平滑滚动并压缩动画和过渡时长。

## 导出边界

Hello Lab 的 Markdown 只包含用户当前可见的 Token、天数、规则档位、建议和数据边界。它不包含隐藏 Prompt、仓库内容、浏览器信息或持久标识。

通用下载文件名通过 `normalizeMarkdownFileName` 移除路径、控制字符、非安全扩展名和 Windows
保留名。P1-005 Token Forge 导出在进入该组件前，还会完成计划合同、正文脱敏、Markdown
安全和固定文件名验证。

## 自动验证

`npm run validate` 覆盖：

- 纯函数、规则解释和安全导出单元测试；
- Astro/TypeScript、ESLint 与格式检查；
- 静态 HTML 中的页面地标、表单语义、状态、证据分类和真实导出按钮；
- Token Forge 的可索引主标题、原生表单、隐私声明、文章/源码链接与按需加载；
- Incident Detective 的可索引主标题、公开合成场景、原生控件、确定性评分标识、客户端
  答案隔离、文章/源码链接与按需加载；
- CSS 中的焦点、移动端、触控目标和 reduced-motion 合同。

当前环境不记录虚构的 Lighthouse 或屏幕阅读器分数。真实浏览器、移动设备和辅助技术回归留给 P4-001 Preview 环境。
