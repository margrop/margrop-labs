# Cloudflare Workers 部署

Margrop Labs 使用同一份静态产物部署到两个彼此隔离的 Cloudflare Worker：

| 环境       | Worker                 | 入口                                               | 用途       |
| ---------- | ---------------------- | -------------------------------------------------- | ---------- |
| Preview    | `margrop-labs-preview` | `https://margrop-labs-preview.margrop.workers.dev` | 上线前验收 |
| Production | `margrop-labs`         | `https://lab.margrop.net`                          | 正式流量   |

`apps/web/wrangler.jsonc` 是路由、静态资源、AI 服务端变量和 Durable Object binding
配置的唯一事实来源。Production 关闭稳定的 `workers.dev` 入口并使用 Custom Domain；
Preview 不绑定 `margrop.net` 的任何域名。静态路径仍由 Assets 直接提供，只有 `/api/*`
先进入 Worker。

## GitHub 配置

仓库 Actions Secrets 必须包含：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

不要把值写进代码、Workflow 输出、Issue 或日志。Token 至少需要 Workers Scripts 写权限；
Custom Domain 发布还必须能访问 `margrop.net` 所在的活动 Zone。Cloudflare 会为 Custom
Domain 创建 DNS 记录并签发证书；若 `lab.margrop.net` 已有冲突的 CNAME，必须先移除。

## Token Forge AI Secrets

Token Forge AI 使用两个只存在于 Cloudflare 的 Secret，Preview 与 Production 必须分别
设置：

```bash
npx wrangler secret put TOKEN_FORGE_AI_API_KEY --env preview
npx wrangler secret put TOKEN_FORGE_ACTOR_KEY_SECRET --env preview

npx wrangler secret put TOKEN_FORGE_AI_API_KEY
npx wrangler secret put TOKEN_FORGE_ACTOR_KEY_SECRET
```

命令会交互式读取值；不要把值写进命令行、仓库、GitHub 输出或聊天。API Key 使用上游网关
分配的值；匿名键 Secret 使用独立、随机且至少 32 字符的值。两套环境建议使用不同的匿名键
Secret。

固定上游是
`https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions`，模型为
`qwen-latest`。由于使用自定义端口，`api-gpt.speedtest.margrop.net` 必须保持
Cloudflare DNS-only（灰云）；若启用橙云，应先把服务迁移到 443 或受支持的 HTTPS 端口。
Worker 的 `compatibility_date` 晚于 `2024-09-02`，自定义端口能力已经默认启用，不再显式
声明 `allow_custom_ports`。

Bindings、变量和 Secrets 是按环境隔离的，见
[Wrangler environments](https://developers.cloudflare.com/workers/wrangler/environments/)；
自定义端口与代理端口限制见
[compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#allow-specifying-a-custom-port-when-making-a-subrequest-with-the-fetch-api)
和 [Network ports](https://developers.cloudflare.com/fundamentals/reference/network-ports/)。

## 发布流程

每次提交合并或推送到 `main` 后，`Deploy Cloudflare Workers` 会自动执行 Preview 的完整
质量门、Wrangler dry-run、部署和在线 smoke test。自动 Preview 失败时停止，不会继续执行
Production。

需要重新运行 Preview 时，也可以在 GitHub Actions 中选择 `Run workflow` 和 `preview`。
完成手机宽度与桌面浏览器验收后，仓库所有者才能手动选择 `production`；Production 会再次
执行质量门、dry-run、正式部署和 `https://lab.margrop.net` 在线 smoke test。Preview 与
Production 共用串行部署队列，不会同时修改 Cloudflare Worker。

命令行等价操作：

```bash
npm ci
npm run validate
npm run deploy:check:preview --workspace @margrop-labs/web
npm run deploy:preview --workspace @margrop-labs/web

npm run deploy:check --workspace @margrop-labs/web
npm run deploy:production --workspace @margrop-labs/web
```

## 验收清单

- 首页返回 HTTP 200，标题包含 `Margrop Labs`。
- `Token 任务炼金炉` 可见，预算滑块和输出会响应操作。
- 320px 宽度无横向滚动；导航、卡片和按钮不重叠。
- 键盘可以聚焦并操作交互控件。
- `/robots.txt` 返回 HTTP 200。
- `/api/token-forge/plan` 对无效同源请求返回安全的 Gateway 400，不返回 HTML 或上游正文。
- 点击“仅生成模板”不调用 AI；点击“AI 增强生成”成功时显示 usage，失败时仍能导出模板。
- 连续快速请求会安全限流；浏览器源码、Network 响应和导出中都没有 API Key。
- Preview 不响应正式域名；Production 只把正式入口指向
  `lab.margrop.net`。

Workflow 的在线 smoke test 会自动检查 HTTP 状态、核心首页内容、移动端 viewport、
`robots.txt` 和 API 安全错误响应；为覆盖 Worker 发布传播窗口，在线检查会对瞬态错误最多
重试约一分钟。视觉和交互验收仍需在 Preview 完成后执行。

## 失败与回滚

- Workflow 在质量门、dry-run 或 smoke test 任一步失败都会停止。
- Preview 失败时不要执行 Production。
- Production 失败时先保留失败日志和 Version ID，再在 Cloudflare 的 Worker
  `margrop-labs` 中回滚到最近一次已验证版本。
- Custom Domain 初次签发证书可能需要短暂传播时间；smoke test 最多等待一分钟。
