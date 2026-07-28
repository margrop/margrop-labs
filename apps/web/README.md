# Web application

Margrop Labs 的可运行 Web 切片。

## 已确定技术栈

- Astro：静态 HTML 和 SEO 页面；
- TypeScript strict：公共交互与类型安全；
- Preact Islands：仅为需要状态的局部组件发送 JavaScript；
- `client:visible`：低优先级实验进入视口前不加载交互代码；
- `@astrojs/sitemap`：从实际静态路由生成 sitemap index 与 urlset；
- Cloudflare Workers Static Assets：未来承载 `lab.margrop.net`。

首期保持纯静态输出，不安装 Cloudflare SSR Adapter。以后确有按需渲染、Workers AI 或绑定需求时，再通过 ADR 引入 Adapter。

## 本地验证

要求 Node.js 22.12 或更高版本。依赖和质量命令由仓库根目录统一管理：

```bash
nvm use
npm ci
npm run validate
```

启动 Web：

```bash
npm run dev --workspace @margrop-labs/web
```

Cloudflare Worker 本地预览：

```bash
npm run build --workspace @margrop-labs/web
npm run preview:worker --workspace @margrop-labs/web
```

## 当前页面

首页包含可被搜索引擎直接读取的静态标题、首批 Lab 卡片和隐私合同，以及一个使用
`client:visible` 按需激活的 Token 预算预览。所有页面共用 canonical、Open Graph、
Twitter 与 sitemap 发现合同；首页和 Token Forge 提供独立 1200×630 分享图与 JSON-LD。
具体边界见 [SEO、Open Graph 与 sitemap](../../docs/seo-and-discovery.md)。

P0-004 才会把 Lab 卡片改为自动读取根目录 `labs/*/lab.json`；本任务不提前实现该范围。
