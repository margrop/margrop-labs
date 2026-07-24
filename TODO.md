# TODO / Idle-Token Backlog

每次只处理一个任务。规模：`S` 约 2k–8k Token，`M` 约 8k–25k，`L` 约 25k–60k。

## P0：平台基础

- [x] **P0-000 [S] 初始化仓库合同**
  - 已建立目录、规则、Lab Manifest Schema、首批实验说明和任务模板。

- [ ] **P0-001 [S] 选择许可证**
  - 产物：`LICENSE` 与 README 说明。
  - 验收：由仓库所有者确认，不由 Agent 擅自决定。

- [x] **P0-002 [M] 决定 Web 技术栈和部署目标**
  - 决策：Astro + TypeScript strict + Preact Islands，部署目标为 Cloudflare Workers Static Assets。
  - 产物：ADR-0003、选型比较、可运行 Hello Lab、移动端/构建基线。
  - 验收：静态标题与 Lab 内容可索引；交互使用 `client:visible`；7 项静态合同检查通过。

- [x] **P0-003 [M] 建立 Web 工程与质量门**
  - 产物：根 npm workspace、Prettier、ESLint、Astro/TypeScript、Vitest、构建/静态合同和 GitHub Actions。
  - 验收：干净 `npm ci` 后 `npm run validate` 全部通过；CI 调用同一命令；仅抽取并测试已有确定性函数。

- [x] **P0-004 [M] 实现实验清单加载器**
  - 产物：构建期 Manifest 加载器、首页字段映射、依赖说明和错误合同测试。
  - 验收：三个 `lab.json` 按 v1 Schema 生成静态卡片；无效清单、目录/ID 不一致和重复路由会阻断构建。

- [ ] **P0-005 [M] 建立 UI 与可访问性基线**
  - 产物：页面壳、导航、表单、状态提示、证据卡、结果导出组件。
  - 验收：键盘可操作、颜色非唯一提示、reduced motion、手机宽度可用。

- [ ] **P0-006 [M] 定义 AI Gateway 合同**
  - 产物：请求/响应 Schema、错误码、超时、Token 上限、Provider 适配接口。
  - 验收：Web 永远不接触 Provider Key；无效模型响应 fail closed。

- [ ] **P0-007 [M] 建立隐私与脱敏包**
  - 产物：IP、域名、邮箱、Token、Cookie、序列号和 WWN 脱敏。
  - 验收：原文不进入 URL、日志、Analytics、AI 请求和导出。

- [ ] **P0-008 [M] 建立 CI 与安全检查**
  - 产物：lint/type/test/build、依赖扫描、秘密扫描、Schema 验证。
  - 验收：PR 必须通过；版本固定；不自动部署生产。

## P1：Token 任务炼金炉 MVP

- [ ] **P1-001 [S] 定义输入与任务输出 Schema**
  - 输入：额度、到期时间、技术栈、目标、可投入时间、公开仓库 URL。
  - 输出：S/M/L 任务、依赖、范围、Prompt 和验收标准。

- [ ] **P1-002 [M] 实现无需 AI 的任务模板模式**
  - 验收：内置场景可生成稳定结果；离线可用；作为 AI 降级路径。

- [ ] **P1-003 [M] 实现公开 GitHub 仓库摘要适配器**
  - 验收：只读公开仓库；文件数、大小和读取路径有上限；忽略二进制和秘密文件名。

- [ ] **P1-004 [M] 实现 AI 任务拆分**
  - 验收：输出符合 Schema；不得建议生产写操作；相似任务去重；显示不确定项。

- [ ] **P1-005 [M] 实现 Markdown/GitHub Issue 导出**
  - 验收：导出不含仓库原文和隐藏 Prompt；文件名安全；可复制。

- [ ] **P1-006 [S] 建立文章入口与转化事件**
  - 关联 Token/Coding Plan 文章；只记录打开、运行、导出和 GitHub 点击，不记录表单内容。

## P2：AI 故障侦探 MVP

- [ ] **P2-001 [M] 定义事故场景与证据 Schema**
- [ ] **P2-002 [M] 制作首个 MySQL + Prometheus + Loki 合成案例**
- [ ] **P2-003 [M] 实现逐步取证和时间线界面**
- [ ] **P2-004 [M] 实现证据优先评分引擎**
- [ ] **P2-005 [L] 实现受约束的 AI 案例生成与审核**
- [ ] **P2-006 [M] 实现不含事故原文的分享结果卡**

验收原则：用户可以在完全离线样例中完成一局；评分由确定性规则给出，AI 只负责解释与变体。

## P3：SMART / RMA 报告机 MVP

- [ ] **P3-001 [M] 收集完全合成的 smartctl fixture**
- [ ] **P3-002 [M] 实现浏览器端 SMART 解析器**
- [ ] **P3-003 [M] 实现序列号、WWN、主机名和 IP 脱敏**
- [ ] **P3-004 [M] 实现规则化健康指标与未知状态**
- [ ] **P3-005 [M] 实现 AI 通俗解释**
- [ ] **P3-006 [M] 生成中文摘要与英文 RMA Markdown**

验收原则：原始 SMART 文本不离开浏览器；AI 只接收脱敏后的结构化指标；不得把工具结果描述成厂商保修结论。

## P4：平台与增长

- [ ] **P4-001 [M] 部署 preview 环境并验证移动端**
- [ ] **P4-002 [M] 配置 `lab.margrop.net` 正式部署**
- [ ] **P4-003 [M] 建立不采集输入正文的 Analytics**
- [ ] **P4-004 [M] 建立 AI 日/用户/Lab 预算与熔断**
- [ ] **P4-005 [S] 为博客生成统一 CTA 片段**
- [ ] **P4-006 [S] 在博客导航增加“实验室”入口**
- [ ] **P4-007 [M] 建立 Labs 首页 SEO、Open Graph 和 sitemap**
- [ ] **P4-008 [M] 上线后复盘打开率、运行率、导出率和 GitHub 点击率**

## 推荐下一项任务

接下来做 **P0-005**：建立可复用的页面壳、导航、表单、状态提示、证据卡和结果导出组件，并补齐移动端与无障碍基线。每个任务使用 `tasks/TASK_TEMPLATE.md` 与 `prompts/IMPLEMENT_TASK.md`。
