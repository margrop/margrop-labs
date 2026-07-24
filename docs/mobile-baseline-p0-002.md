# P0-002 移动端与静态输出基线

记录日期：2026-07-24。

## 验证目标

- 390px 宽度下不出现强制横向滚动；
- 导航、主按钮、三个 Lab 卡片和 Hello Lab 保持可读；
- 所有输入有可见 Label，交互结果使用 `aria-live`；
- 支持键盘焦点和 `prefers-reduced-motion`；
- 首页标题、描述、H1 和 Lab 文本直接存在于静态 HTML；
- Hello Lab 使用 `client:visible`，不使用 `client:load`。

## 构建基线

| 项目 | 当前结果 |
|---|---:|
| 静态路由 | 2 个：首页、404 |
| `dist` 总大小 | 45,115 bytes |
| 首页 HTML | 10,166 bytes；gzip 约 4,736 bytes |
| CSS | 7,687 bytes；gzip 约 2,423 bytes |
| 按需交互 JavaScript | 约 11.4 KB gzip（包含 Preact 运行时与组件） |
| Astro diagnostics | 0 errors / 0 warnings / 0 hints |
| 静态内容与 Hydration 合同 | 7/7 checks passed |

## Lighthouse 记录方式

本任务执行环境没有 Chromium，因此不伪造 Lighthouse 分数。P0-002 已确保页面能构建并具备移动端样式，首次 preview 部署后使用下列方式记录真实 Mobile Lighthouse：

```bash
npx lighthouse https://<preview-host>/ \
  --preset=perf \
  --form-factor=mobile \
  --screenEmulation.mobile \
  --output=html \
  --output-path=./artifacts/lighthouse-mobile.html
```

首次可访问部署的分数由 P4-001 记录，并以本文件的构建体积作为前置基线。Lighthouse 报告属于本地 `artifacts/`，默认不提交仓库。
