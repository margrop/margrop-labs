# Web 技术与部署选型比较

评估日期：2026-07-24。

## 评价维度

- 文章和实验说明能否直接输出为可索引 HTML；
- 交互代码能否按组件、按可见性加载；
- 是否适合三个以上独立 Lab；
- 移动端首屏负担；
- AI Gateway 与自定义域名的后续扩展；
- 自托管与平台迁移成本；
- 一个人长期维护的复杂度。

## Web 方案

| 方案 | 优点 | 主要代价 | 结论 |
|---|---|---|---|
| Astro + Preact Islands | 静态 HTML 默认成立；交互可按岛加载；React 风格但运行时更小 | 团队需要理解 Astro/Island 边界 | **选择** |
| Vite + React SPA | 心智模型简单，交互生态丰富 | 默认 HTML 内容少；SEO、路由和元数据需额外工程 | 不作为内容型门户首选 |
| Next.js | 全栈能力、生态和动态渲染强 | 当前三个 Lab 不需要完整服务端框架；部署与运行时更重 | 若未来需要复杂登录/SSR 再评估 |
| Hugo + Vanilla JS | 静态构建快、部署简单 | 多个复杂交互的状态、类型与组件复用成本较高 | 适合博客，不适合 Labs 主应用 |

Preact 只用于有状态交互；普通内容、卡片和导航继续使用 Astro/HTML。禁止为了统一而把整页改成客户端应用。

## 部署方案

| 方案 | 优点 | 主要代价 | 结论 |
|---|---|---|---|
| Cloudflare Workers Static Assets | 自定义域名、边缘静态资源、后续 Worker API 在同一平台；官方建议新 Astro 项目优先 Workers | 平台特有配置需保持最小 | **选择** |
| Cloudflare Pages | Git 集成和静态部署成熟 | Astro 新版 Adapter 已转向 Workers，新增项目路线不再最清晰 | 不选为新项目目标 |
| GitHub Pages | 免费、简单 | AI Gateway 需独立服务；预览、限流和边缘 API 分离 | 可作为灾备静态镜像 |
| 自托管容器 | 完整控制、符合 Homelab 习惯 | 证书、可用性、扩容和攻击面由个人维护 | 不作为公众首发主站 |
| Vercel | 开发体验成熟 | 本项目暂无必须依赖的能力，并会增加另一套平台 | 暂不采用 |

## 已决定

- 构建：Astro 静态输出；
- 语言：TypeScript strict；
- 交互：Preact Islands；
- Hydration：默认无客户端 JS，低优先级组件使用 `client:visible`；
- 包管理：npm，并提交 lockfile；
- Node.js：最低 22.12；
- 部署目标：Cloudflare Workers Static Assets；
- 域名：`lab.margrop.net`；
- AI Gateway：保持 HTTP 合同独立，P0-006 再决定实现方式。

## 暂不决定

- AI Provider 和模型；
- Worker API、SSR Adapter 和持久化；
- Analytics 产品；
- 正式部署、域名绑定和访问策略。
