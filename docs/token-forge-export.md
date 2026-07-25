# Token Forge Markdown / GitHub Issue 导出

P1-005 为已经验证的 Token Forge v1 计划提供完全本地、确定性的导出核心。它生成一份完整
计划 Markdown，以及每个任务对应的 GitHub Issue 标题和正文。实现不调用 GitHub API，不
访问网络，不读取仓库，也不自动写入 Issue。

## 输入与输出

导出器 `buildTokenForgeExports(input, plan)` 只接受：

- Token Forge v1 输入，用于重新验证预算和工时；
- Token Forge Plan v1 结构化计划。

输入与计划先通过既有 Schema、依赖图和预算不变量。导出结果再通过
[`token-forge-export-v1.schema.json`](../schemas/token-forge-export-v1.schema.json)，包含：

- `markdown`：完整任务计划、未知项和安全说明；
- `github_issues.issues`：1–6 个可单独复制的 Issue 标题和正文；
- `github_issues.content`：便于下载和人工审阅的 Issue 草稿合集；
- 固定安全文件名、MIME 类型和经过复核的 UTF-8 字节数。

相同输入和计划会得到结构和值完全一致的结果，不包含时间戳、随机 ID 或运行环境信息。

## Markdown 内容

完整计划对每个任务显示：

- ID、规模、预计 Token、预计工时和依赖；
- 包含范围与排除范围；
- v1 计划中用户可见、可交给 Coding Agent 的 `prompt`；
- 验收标准；
- 计划级未知项与安全说明。

计划里的 `prompt` 是公开业务字段，不等于 AI Gateway 的隐藏服务端指令。导出器没有
`system_prompt`、Provider、模型或仓库上下文字段；在计划对象中添加这些未知字段会使输入
合同失败，而不是静默透传。

## GitHub Issue 草稿

每个任务生成一个独立草稿：

- 标题格式为 `[Token Forge][S|M|L] 任务标题`；
- 正文只包含该任务和计划级未知项、安全说明；
- 依赖保留为同一计划中的任务 ID；
- 每个标题和正文都可以直接交给剪贴板组件。

合并 Markdown 只是本地导出包，不是批量创建 Issue 的脚本。提交前仍需用户人工确认范围、
依赖和仓库状态。

## 隐私与安全

处理顺序固定：

1. 使用 Token Forge v1 合同拒绝未知字段和无效计划；
2. 通过 P0-007 允许字段策略重建新计划对象；
3. 邮箱、IP、域名、序列号和 WWN 替换为不可逆占位符；
4. Authorization、Cookie 和 Token 样式内容失败关闭；
5. 绝对路径、相对路径、常见仓库路径和单文件名替换为
   `[REDACTED:FILE_PATH]`；
6. Markdown 元字符和 HTML 标签转义；
7. GitHub `@mention` 与 `#123` 引用加入不可见分隔符，避免复制后意外通知用户或关联
   Issue；
8. 对最终 Schema、固定文件名、内容字节数和大小上限再次验证。

固定文件名为：

- `token-forge-plan.md`；
- `token-forge-github-issues.md`。

通用下载组件还会调用 `normalizeMarkdownFileName`，只保留文件名最后一段、安全 ASCII
字符和 `.md` 扩展名，并处理空值、超长名称、路径穿越和 Windows 保留名。

## 大小上限

| 产物 | UTF-8 上限 |
|---|---:|
| 完整计划 Markdown | 128 KiB |
| Issue 草稿合集 | 128 KiB |
| 单个 Issue 正文 | 64 KiB |

计划本身仍受 v1 的 6 个任务、字段长度、Token 和工时上限约束。脱敏或渲染后超过上限时，
导出整体失败，不截断 Prompt 或验收标准。

## 失败行为

稳定错误码包括：

- `invalid_plan`：输入或计划不符合既有合同；
- `sensitive_content`：计划含 Secret 样式内容；
- `export_too_large`：最终 UTF-8 产物超过硬上限；
- `invalid_export`：净化或渲染后的产物不符合导出合同。

错误不包含输入、Secret、路径、Markdown 正文或底层验证详情。

## 测试范围

合成测试覆盖：

- 有效 export fixture 和字节元数据；
- 稳定 Markdown 与逐任务 Issue 草稿；
- 邮箱、IP、域名、序列号、WWN 和文件路径脱敏；
- Secret 拒绝且错误不回显；
- 仓库 URL 省略与隐藏字段拒绝；
- HTML、Markdown、`@mention`、Issue 引用和代码围栏注入；
- 无效计划、超长字段、最终 UTF-8 大小上限和无网络运行；
- 下载文件名的路径穿越、保留名、扩展名和长度边界。

## 已知限制

- P1-006 已把导出接到 Token Forge 正式页面的本地模板路径；
- 不自动创建 GitHub Issue，也不请求 GitHub Token；
- 导出器不接收仓库原文，因此无法独立判断计划中的任意普通句子是否来自仓库；AI 计划仍
  依赖 P1-004 的源码回显检测；
- 浏览器剪贴板和下载行为由现有 `ExportActions` 组件负责，真实浏览器回归留给页面接入
  任务。
