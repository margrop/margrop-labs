# Cloudflare Workers 部署

Margrop Labs 使用同一份静态产物部署到两个彼此隔离的 Cloudflare Worker：

| 环境       | Worker                 | 入口                              | 用途       |
| ---------- | ---------------------- | --------------------------------- | ---------- |
| Preview    | `margrop-labs-preview` | Wrangler 返回的 `workers.dev` URL | 上线前验收 |
| Production | `margrop-labs`         | `https://lab.margrop.net`         | 正式流量   |

`apps/web/wrangler.jsonc` 是路由和静态资源配置的唯一事实来源。Production 关闭稳定的
`workers.dev` 入口并使用 Custom Domain；Preview 不绑定 `margrop.net` 的任何域名。

## GitHub 配置

仓库 Actions Secrets 必须包含：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

不要把值写进代码、Workflow 输出、Issue 或日志。Token 至少需要 Workers Scripts 写权限；
Custom Domain 发布还必须能访问 `margrop.net` 所在的活动 Zone。Cloudflare 会为 Custom
Domain 创建 DNS 记录并签发证书；若 `lab.margrop.net` 已有冲突的 CNAME，必须先移除。

## 发布流程

部署不会随 `main` 提交自动触发。进入 GitHub Actions 的
`Deploy Cloudflare Workers`，选择 `Run workflow`，然后选择：

1. `preview`：执行完整质量门、Wrangler dry-run、部署和在线 smoke test。
2. 在手机宽度和桌面浏览器完成验收。
3. `production`：再次执行质量门、dry-run、正式部署和
   `https://lab.margrop.net` 在线 smoke test。

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
- Preview 不响应正式域名；Production 只把正式入口指向
  `lab.margrop.net`。

Workflow 的在线 smoke test 会自动检查 HTTP 状态、核心首页内容、移动端 viewport 和
`robots.txt`；视觉和交互验收仍需在 Preview 完成后执行。

## 失败与回滚

- Workflow 在质量门、dry-run 或 smoke test 任一步失败都会停止。
- Preview 失败时不要执行 Production。
- Production 失败时先保留失败日志和 Version ID，再在 Cloudflare 的 Worker
  `margrop-labs` 中回滚到最近一次已验证版本。
- Custom Domain 初次签发证书可能需要短暂传播时间；smoke test 最多等待一分钟。
