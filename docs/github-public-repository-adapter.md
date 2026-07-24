# Token 任务炼金炉：公开 GitHub 仓库摘要适配器

P1-003 提供只读、无鉴权、有硬上限的公开 GitHub 仓库摘要。它只接受规范的 `https://github.com/{owner}/{repo}` URL，将受限文本样本标记为不可信数据，并返回明确的覆盖范围与未知项。

适配器不调用 AI。未来 P1-004 只能消费这份结构化摘要，不能直接遍历 GitHub 或把仓库内容当作指令。

## 请求流程

适配器把 API Origin 固定为 `https://api.github.com`，调用方不能覆盖，从而避免把仓库 URL 变成任意网络请求。

| 顺序 | GitHub REST API | 用途 |
|---|---|---|
| 1 | `GET /repos/{owner}/{repo}` | 确认仓库存在、公开并取得默认分支 |
| 2 | `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` | 取得一次受限目录树 |
| 3 | `GET /repos/{owner}/{repo}/contents/{path}?ref={branch}` | 只读取通过策略并入选的文本文件 |

请求使用 `X-GitHub-Api-Version: 2026-03-10`、`credentials: "omit"` 和禁止重定向的 GET，不发送 `Authorization`。公开资源允许无鉴权读取，相关行为见 GitHub 的[仓库](https://docs.github.com/en/rest/repos/repos?apiVersion=2026-03-10)、[目录树](https://docs.github.com/en/rest/git/trees?apiVersion=2026-03-10)和[仓库内容](https://docs.github.com/en/rest/repos/contents?apiVersion=2026-03-10)文档。

## 硬上限

调用方只能调低可调整上限，不能调高。

| 边界 | 默认硬上限 |
|---|---:|
| 读取文件数 | 8 |
| 单文件解码后大小 | 32 KiB |
| 文件内容合计 | 128 KiB |
| 检查目录树条目 | 2,000 |
| 仓库元数据响应 | 64 KiB |
| 目录树响应 | 512 KiB |
| 单个内容 API 响应 | 64 KiB |
| 单次请求超时 | 5 秒 |
| 仅 5xx 重试 | 1 次 |

正常成功路径最多发出 10 个请求：2 个仓库请求和 8 个文件请求。若每个请求首次都遇到 5xx，理论上限为 20 次尝试。403 或 429 会立即停止，不继续请求。GitHub 对无鉴权 REST 请求实施共享来源 IP 配额，当前公开说明为每小时 60 次，见[速率限制](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。

## 路径与内容策略

候选文件按固定优先级和字典序选择：

1. 根目录 README；
2. 根目录包清单和构建入口；
3. `docs/` 与其他 README；
4. 配置和 GitHub Actions 工作流；
5. 其他允许的文本源码。

路径长度最多 240 字符、目录深度最多 6 层，拒绝绝对路径、反斜杠、NUL、空路径段和 `..`。只允许常见文档、源码和文本配置扩展名。

以下内容在发起文件请求前跳过：

- `.env*`、`.npmrc`、`.pypirc`、`.netrc`、SSH 私钥名；
- 名称含 secret、credential、private key、API key 或 access/auth token 标记的文件；
- `.key`、`.pem`、`.p12`、`.pfx`、`.jks`、`.keystore`；
- `.git`、`node_modules`、`vendor`、`dist`、`build`、`coverage`、`target` 等生成目录；
- 不在文本白名单内的扩展名和超过单文件上限的条目。

内容 API 的路径、声明大小、Base64 解码大小必须与目录树一致。含 NUL、非法 UTF-8、私钥头、AWS Access Key 或 GitHub Token 形态的内容不会进入摘要。这里的检测是谨慎的最小防线，不是完整的秘密扫描器。

## 输出与失败

成功结果包含：

- 仓库 owner、name 和默认分支；
- 从安全候选路径推断的有限技术信号；
- `path`、`size_bytes` 和明确标记为 `untrusted_text` 的文件样本；
- 目录树、候选、采样字节和各类跳过计数；
- 实际上限、目录树是否截断和未知项。

元数据或目录树失败会抛出安全错误码；未来消费者应直接退回 P1-002 模板模式。单个文件出现 404、响应形态错误或大小不一致时只跳过该文件并增加覆盖缺口；限流、超时和网络错误会停止整个读取。为保持请求上限和确定性，跳过文件后不会递补其他候选。

错误消息不包含用户提交的 URL。适配器自身不记录日志、不持久化内容，也不会把输入放进 URL 查询参数、Analytics 或 AI 请求。

## 验证

合成 GitHub 响应覆盖：

- 固定 API Origin、API 版本、无鉴权和禁止重定向；
- 路径过滤、秘密内容过滤、文件/总量/目录树上限；
- 稳定选取顺序和安全技术信号；
- 私有仓库、非规范 URL、限流、5xx 重试、超时和超大响应；
- 截断目录树与单文件失败的显式未知项。

fixture 只含合成文本和经过标记的假秘密，不依赖真实仓库或网络。

## 已知限制

- 不支持 GitHub Enterprise、自定义 API Origin、私有仓库、子模块或 Git LFS 内容；
- 大型仓库可能先触及 512 KiB 目录树响应上限，适配器不会继续分页或改用昂贵遍历；
- 技术信号只来自路径，不代表依赖已安装、代码可构建或功能正确；
- 样本不是完整代码审计，也不能证明仓库没有秘密；
- P1-003 只提供核心适配器，不包含 UI、缓存、AI 拆分或导出。
