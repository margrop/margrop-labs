# Labs SEO、Open Graph 与 sitemap

P4-007 为 Labs 首页和 Token Forge 建立同一套可构建验证的发现合同。目标是让搜索引擎、
社交平台和消息应用读到稳定的正式 URL 与预览信息，同时不把表单输入、来源参数或运行时
状态带入元数据。

## 页面合同

`apps/web/src/layouts/BaseLayout.astro` 通过
`apps/web/src/lib/seo.ts` 为所有页面输出：

- 由 `Astro.site` 和当前路径生成的 HTTPS canonical；
- `description` 与显式 `index, follow` / `noindex, nofollow`；
- Open Graph 的站点、语言、URL、标题、描述、图片、尺寸和替代文本；
- Twitter/X `summary_large_image` 的标题、描述、图片和替代文本；
- 指向 `/sitemap-index.xml` 的发现链接；
- 仅由仓库内固定对象序列化的 JSON-LD。

canonical 会丢弃查询参数和 fragment。分享图片必须与
`https://lab.margrop.net` 同源；外部图片会失败关闭。404 页面显式设置
`noindex, nofollow`，且不会进入 sitemap。

## 页面级内容

| 页面 | 分享标题 | 图片 | JSON-LD |
| --- | --- | --- | --- |
| `/` | `Margrop Labs｜把技术文章变成可验证实验` | `/social/margrop-labs.png` | `WebSite` + 已上线 Lab 的 `ItemList` |
| `/token-forge/` | `Token 任务炼金炉｜把闲置 Token 锻造成可验收任务` | `/social/token-forge.png` | `WebApplication` |
| `/interview-workbench/` | `AI 面试工作台｜把面试判断变成可追溯证据链` | `/social/interview-workbench.png` | `WebApplication` |

三张 PNG 固定为 1200×630。可编辑 SVG 源文件位于
`apps/web/src/assets/social/`；发布图片位于 `apps/web/public/social/`。图片只有固定品牌
文案和抽象界面，不含用户输入、Analytics 标识或远程资源。

## sitemap 与 robots

`@astrojs/sitemap` 在静态构建后生成：

- `/sitemap-index.xml`；
- `/sitemap-0.xml`。

sitemap 只包含实际生成且可索引的正式页面。AI 面试工作台在 P5-009 成为仅合成数据的
Alpha 后进入列表；404 和 Worker API 不进入列表。`robots.txt` 允许正常抓取，并声明正式
sitemap index。

不写入虚构的 `lastmod`、更新频率或优先级；后续如果有可靠的内容发布日期，再通过构建数据
显式提供。

## 验证

`npm run validate` 中的单元与静态合同覆盖：

1. canonical 去除查询参数和 fragment；
2. 外部分享图片与缺失 `Astro.site` 失败关闭；
3. 首页、Token Forge 和 AI 面试工作台的 canonical、OG、Twitter 与 JSON-LD；
4. 三张 PNG 的签名、1200×630 尺寸和非空内容；
5. robots、sitemap index、实际路由 allowlist 与 404/API 路由排除。

部署后仍需用 Production smoke 检查这些静态文件返回 HTTP 200。搜索收录与社交平台缓存是
外部系统行为，不由构建成功保证。
