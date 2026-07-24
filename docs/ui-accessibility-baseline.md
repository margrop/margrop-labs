# UI 与可访问性基线

P0-005 在现有 Astro 页面壳和 Hello Lab 中建立可复用组件，不新增正式 Lab 业务。

## 组件

| 组件 | 合同 |
|---|---|
| `BaseLayout.astro` | Skip link、品牌、内部导航、外部入口、`main` 与页脚地标 |
| `FormField.tsx` | 可见 Label、当前值、操作提示与 `aria-describedby` |
| `StatusNotice.tsx` | 文字、符号、颜色和 `status`/`alert` 语义共同表达状态 |
| `EvidenceCard.tsx` | 明确区分输入证据、规则依据、AI 解释和未知项 |
| `ExportActions.tsx` | 复制或下载调用方提供的 Markdown，并通过状态消息反馈结果 |

## 键盘与辅助技术

- 导航、Range 和按钮使用原生 HTML 控件，不模拟交互角色；
- Range 提供可见 Label、当前值、范围说明和方向键提示；
- 所有可交互控件都有清晰的 `:focus-visible` 外框；
- 动态规则结果和导出反馈使用 `role="status"` 与 `aria-atomic="true"`；
- 状态卡片不只依赖颜色，同时包含符号、类型文字和完整说明；
- Skip link 可直接把焦点移动到主要内容。

## 移动端与动效

- 页面最小支持宽度为 320px；
- 800px 以下三列内容改为单列，600px 以下导航换行；
- 导航和按钮的点击目标最小高度为 44px；
- 长文本、路由和证据值允许换行，不制造横向滚动；
- `prefers-reduced-motion: reduce` 时禁用平滑滚动并压缩动画和过渡时长。

## 导出边界

Hello Lab 的 Markdown 只包含用户当前可见的 Token、天数、规则档位、建议和数据边界。它不包含隐藏 Prompt、仓库内容、浏览器信息或持久标识。

## 自动验证

`npm run validate` 覆盖：

- 纯函数、规则解释和安全导出单元测试；
- Astro/TypeScript、ESLint 与格式检查；
- 静态 HTML 中的页面地标、表单语义、状态、证据分类和真实导出按钮；
- CSS 中的焦点、移动端、触控目标和 reduced-motion 合同。

当前环境不记录虚构的 Lighthouse 或屏幕阅读器分数。真实浏览器、移动设备和辅助技术回归留给 P4-001 Preview 环境。
