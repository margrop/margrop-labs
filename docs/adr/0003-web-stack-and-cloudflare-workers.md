# ADR-0003：Astro + Preact Islands 部署到 Cloudflare Workers

- 状态：Accepted
- 日期：2026-07-24

## 背景

Margrop Labs 同时需要可被搜索引擎读取的文章型页面和局部高交互工具。首发阶段没有登录、数据库或服务端渲染需求，但未来需要受控的 AI Gateway、限流和自定义域名。

## 决策

采用 Astro 静态输出、TypeScript strict 和 Preact Islands。普通内容不发送客户端框架代码；需要状态的实验组件按需 Hydrate，低优先级内容使用 `client:visible`。

静态产物以 Cloudflare Workers Static Assets 为部署目标，正式域名为 `lab.margrop.net`。首期不安装 `@astrojs/cloudflare` Adapter；只有出现按需渲染或 Cloudflare Runtime 绑定需求时，才通过新 ADR 引入。

## 理由

- 首页、说明和 Lab 卡片在构建时生成完整 HTML；
- Island 模型允许每个 Lab 独立增加交互，不把整站变成 SPA；
- Preact 保留 React 风格组件能力，同时减少客户端运行时；
- Cloudflare 官方当前建议新 Astro 项目优先 Workers；
- Workers Static Assets 可以直接服务 `dist`，并给未来边缘 API 留出路径。

## 约束

- 不得把全站改为 `client:load`；
- 不得在浏览器包含 Provider Key；
- 不得因未来可能需要 SSR 而提前安装 Adapter；
- 公共 Lab 必须有静态说明和无需 AI 的样例模式；
- 新框架、持久化或运行时能力必须另写 ADR。

## 后果

开发者需要理解 Astro 与 Preact 的边界。涉及浏览器 API 的逻辑必须显式 Hydrate。作为回报，静态内容、交互负载和后续 API 可以保持清晰分层。
