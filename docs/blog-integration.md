# 博客集成

## 链接闭环

文章中段提供“立即体验”，文章结尾提供“在线实验 / GitHub 源码 / 离线说明”。Lab 页面顶部链接相关文章，结果页提供“为什么这样判断”的深度阅读入口。

## 推荐 URL

- 门户：`https://lab.margrop.net/`
- Token：`/token-forge/`
- AI 面试工作台：`/interview-workbench/`
- 故障侦探：`/incident-detective/`
- SMART：`/smart-rma/`

URL 不得包含用户输入、AI 输出、日志摘要、SMART 属性、仓库文件内容或任何凭据。

Token Forge 已在 `/token-forge/` 建立正式文章闭环：页面顶部数据来自 Lab Manifest 的
相关文章，结果区提供“阅读设计思路”和“查看 GitHub 源码”。P4-005 已提供版本化合同、
文章中段和文末两种统一 Markdown 片段；复制位置、固定链接与更新协议见
[Token Forge 博客 CTA v1](./token-forge-blog-cta.md)。

## 通用 CTA 模板

```markdown
> 🧪 在线实验：不需要安装，也可以使用合成样例体验。
> [打开魔都水滴实验室 →](https://lab.margrop.net/<lab-id>/)
```

上面的占位模板继续供其他 Lab 规划使用。Token Forge 必须使用已验证的具体片段，不把
`<lab-id>`、追踪参数或文章数据带到正式链接。

AI 面试工作台使用独立的版本化 CTA，不复用占位模板。固定合同、两种 Markdown 片段、
插入规则和无追踪边界见 [AI 面试工作台博客 CTA v1](./interview-workbench-blog-cta.md)。
P5-009 只交付仓库内产物，不直接修改外部博客仓库。

## 事件

仅记录 `lab_open`、`sample_load`、`run_success`、`run_failure`、`export`、`blog_click`、`github_click`。事件属性只允许 Lab ID、版本和设备类别。

Token Forge 与 AI 面试工作台使用共享的版本化最小事件合同和同一个现有聚合 Durable
Object；各自同源路由只接受自己的固定事件。接收器只保存 31 天的按日、Lab、事件与粗
设备类别计数，不保存原始事件、用户标识或正文。详情见 [Analytics 规范](./analytics.md)。
