# Token Forge Provider-neutral Coding Agent 执行包

P1-011 把通过 Token Forge Plan v1、质量规则与 P1-010 本地编辑验证的最终计划，确定性地
转换成可复制或下载的分阶段 Coding Agent Markdown。执行包不绑定 Codex、Claude Code、
Kimi Code 或任何专属语法；接收工具只需要能够读取用户提供的当前工作区并遵循普通文本
指令。

## v1 合同

Schema：
[`token-forge-agent-package-v1.schema.json`](../schemas/token-forge-agent-package-v1.schema.json)

执行包顶层包含：

- `format: "provider-neutral"` 与模板或 AI 辅助的已验证来源；
- 固定的依赖安全阶段顺序、工作区访问、命令发现和破坏性操作策略；
- 1–6 个与最终计划任务一一对应的阶段；
- 计划未知项与安全说明；
- `token-forge-agent-package.md`、MIME 类型、正文和精确 UTF-8 字节数。

每个阶段包含任务 ID、顺序、规模、Token/工时上限、依赖、Agent Prompt、允许上下文、
禁止上下文、包含范围、非目标、验收标准、命令发现与验收协议、交接模板和失败恢复。

## 阶段顺序与独立验收

生成器不静默重排最终计划。它先验证 Plan v1，再要求每项依赖已经出现在使用者之前；无效
顺序失败关闭。每个任务成为一个阶段，阶段编号与页面、完整计划、Issue 草稿顺序一致。

阶段必须独立产生以下交接证据：

1. `completed`、`blocked` 或 `failed` 状态；
2. 本阶段完成与明确未完成的摘要；
3. 实际修改且已验证存在的路径；
4. 实际运行的命令、退出码、关键结果与逐条验收结论；
5. 剩余风险、未知项和需要用户决定的事项；
6. 后续阶段可使用的已验证产物。

任一验收失败时，阶段不得标记完成，所有依赖它的后续阶段停止。

## 命令与上下文策略

Token Forge 没有完整仓库审计证据，因此不能在浏览器中声称某个文件或命令真实存在。
执行包要求 Coding Agent：

- 只访问用户提供的当前工作区；
- 先检查工作区状态，并读取实际存在的仓库级与目录级 Agent 指令；
- 只从已验证存在的项目配置、脚本和文档中确定 lint、类型检查、测试与构建命令；
- 找不到仓库原生命令时停止并报告未知项，不猜测路径或伪造成功结果；
- 只执行与当前阶段相关的非破坏性命令，并记录实际命令和退出码。

允许上下文只包含当前阶段可见字段、用户明确补充的信息、实际工作区和已完成依赖阶段的
交接摘要。密钥、认证材料、未经提供的私有仓库、生产数据、原始仓库摘要、隐藏系统指令、
模型配置、Provider 元数据和未验证路径属于禁止上下文。

## 隐私与安全

生成器复用 P1-005 的 allowlist、PII 脱敏、文件路径移除和 Secret 失败关闭边界：

- 邮箱、IP、域名、序列号和 WWN 替换为不可逆占位符；
- 绝对、相对、常见仓库路径和独立文件名替换为
  `[REDACTED:FILE_PATH]`；
- Token、Cookie、Authorization 等 Secret 使整个执行包失败；
- Markdown、HTML、GitHub mention 和 Issue 引用被转义或中和；
- 仓库 URL、目标输入、公开仓库正文、Gateway 配置和隐藏 Prompt 不属于执行包输入。

失败错误只返回 `invalid_plan`、`sensitive_content`、`package_too_large` 或
`invalid_package` 稳定类别，不回显原文。生成过程不调用网络、AI、存储、日志或
Analytics，不增加 Token 成本。

## 大小与验证

- Markdown 固定文件名：`token-forge-agent-package.md`；
- UTF-8 硬上限：192 KiB；
- 相同输入与最终计划得到结构和值完全一致的执行包；
- Schema 通过后继续检查字节数、阶段编号、任务 ID 唯一性和依赖先行；
- 合成 fixture、模板/AI/编辑编排、PII/路径、Secret、Markdown 注入、超长内容和无副作用
  均由自动测试覆盖。

## 已知限制

- 执行包不会自动启动 Coding Agent、修改仓库、创建 PR 或发送外部消息；
- 它不保存命令发现结果；接收执行包的 Agent 必须在实际工作区重新确认；
- 任务风险目前通过未知项、安全说明、禁止上下文和失败恢复表达，尚未成为 Plan v1 独立字段；
- 跨会话保存、三档引导与移动端结果导航属于 P1-012。
