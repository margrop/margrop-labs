# Margrop Labs

> 魔都水滴实验室：把技术文章变成可以立即体验、验证和分享的互动工具。

`margrop-labs` 是 [blog.margrop.net](https://blog.margrop.net/) 的互动实验层。博客负责解释“为什么”，Labs 负责让读者“马上试一下”，GitHub 负责公开实现、规则和验证过程。

正式入口：[https://lab.margrop.net](https://lab.margrop.net)。Preview 与 Production 的发布边界、Secret
要求、验收和回滚流程见 [Cloudflare Workers 部署](./docs/cloudflare-deployment.md)。

## 当前产品焦点

**Token 任务炼金炉是当前唯一产品开发主线。** AI 面试工作台是它完成 Beta 出口后的
第二优先级；AI 故障侦探只保留维护，SMART / RMA 报告机暂停并退出后续产品开发序列。
具体顺序和解除冻结的量化门槛见 [Token Forge 优先路线图](./docs/token-forge-roadmap.md)
与 [AI 面试工作台路线图](./docs/interview-workbench-roadmap.md)。

## 首批实验

| 实验                                        | 用户价值                                               | 状态                |
| ------------------------------------------- | ------------------------------------------------------ | ------------------- |
| [Token 任务炼金炉](./labs/token-forge/)     | 把闲置 Token、仓库上下文和目标转换为可验收的开发任务   | Alpha·主线          |
| [AI 面试工作台](./labs/interview-workbench/) | 从岗位匹配和面试计划走到有证据边界的面试结论           | Proposed·第二优先级 |
| [AI 故障侦探](./labs/incident-detective/)   | 在合成事故中练习按证据排障，而不是让 AI 猜根因         | Alpha·维护          |
| [SMART / RMA 报告机](./labs/smart-rma/)     | 保留本地解析与脱敏 Alpha，不继续健康判断、AI 和 RMA 导出 | Alpha·暂停          |

## 产品原则

1. **确定性内核，AI 增强**：解析、计算、脱敏和安全判断由代码负责；AI 用于理解、解释、生成案例和提出下一步。
2. **隐私优先**：敏感原始输入尽量只在浏览器处理；服务端默认不记录输入正文。
3. **样例先行**：所有实验必须提供无需登录、无需真实数据、无需消耗 AI 额度的合成演示。
4. **证据可见**：AI 结论必须能追溯到规则、输入摘要或引用证据。
5. **成本有上限**：每次 AI 调用都有模型、Token、超时、频率和输出大小限制。
6. **文章双向关联**：每个实验链接相关文章；相关文章提供明确的“在线体验”入口。
7. **可访问、可分享**：移动端可用、键盘可操作、结果可导出，但分享链接不得携带敏感原文。

## 预期架构

```text
apps/
├── web/          # Labs 门户与互动页面
└── api/          # 可选 AI 网关、限流与公开仓库读取
labs/             # 每个实验的产品合同、样例和专属规则
packages/         # UI、契约与安全相关公共模块
schemas/          # 版本化 JSON Schema
docs/             # 架构、隐私、成本和博客集成规范
```

Web 端采用 **Astro + TypeScript + Preact Islands**，首期生成静态 HTML，并以 **Cloudflare Workers Static Assets** 作为 `lab.margrop.net` 的部署目标。低优先级交互使用 `client:visible` 按需加载；服务端 AI Gateway 继续通过稳定 HTTP 合同解耦。选型见 [ADR-0003](./docs/adr/0003-web-stack-and-cloudflare-workers.md)。

## 开始贡献

- 开发 Agent：先读 [AGENTS.md](./AGENTS.md)。
- 选择任务：从 [TODO.md](./TODO.md) 取一个未阻塞条目。
- 使用闲置 Token：遵循 [Token 工作流](./docs/token-workflow.md)。
- 新增实验：遵循 [实验规范](./docs/lab-standard.md)。
- 接入 AI：先读 [AI 成本与安全](./docs/ai-safety-and-cost.md)。
- 实现 AI 调用：遵循 [AI Gateway v1 合同](./docs/ai-gateway-contract-v1.md)。
- Token Forge AI 规划：遵循 [AI 任务拆分](./docs/token-forge-ai-planning.md)。
- Token Forge AI 成本边界：遵循 [流量与成本策略](./docs/token-forge-ai-traffic-policy.md)。
- Token Forge 本地导出：遵循 [Markdown / GitHub Issue 导出](./docs/token-forge-export.md)。
- Token Forge 本地编辑：遵循 [可逆编辑与依赖锁定](./docs/token-forge-local-editing.md)。
- Token Forge 执行包：遵循 [Provider-neutral Coding Agent 执行包](./docs/token-forge-agent-package.md)。
- Token Forge 质量解释：遵循 [确定性质量报告](./docs/token-forge-quality.md)。
- Token Forge 首次体验：遵循 [三档样例与移动端闭环](./docs/token-forge-first-use.md)。
- CI、安全与 Schema 门：遵循 [CI 与仓库安全门](./docs/ci-security.md)。
- Token Forge 正式页面：遵循 [页面与事件合同](./docs/token-forge-page.md)。
- Token Forge 博客入口：使用 [统一 CTA v1](./docs/token-forge-blog-cta.md)。
- Token Forge 当前顺序与 Beta 门槛：遵循 [优先路线图](./docs/token-forge-roadmap.md)。
- AI 面试工作台：遵循 [产品路线图](./docs/interview-workbench-roadmap.md) 与
  [边界和 AI 复用 ADR](./docs/adr/0006-interview-workbench-boundaries.md)。
- Incident Detective 合同：遵循 [场景与单局推理 v1](./docs/incident-detective-contract-v1.md)。
- Incident Detective 案例：参阅 [首个完整合成事故](./docs/incident-detective-first-case.md)。
- Incident Detective 页面：遵循 [逐步取证与时间线界面](./docs/incident-detective-page.md)。
- Incident Detective 评分：遵循 [确定性证据评分](./docs/incident-detective-scoring.md)。
- Incident Detective 案例生成：遵循 [受约束 Proposal 与人工审核](./docs/incident-detective-case-generation.md)。
- Incident Detective 分享卡：遵循 [Score-only 隐私 SVG](./docs/incident-detective-share-card.md)。
- SMART / RMA 合成输入：遵循 [完全合成 Fixture 合同](./docs/smart-rma-synthetic-fixtures.md)。
- SMART / RMA 浏览器解析：遵循 [Parse Result v1 与失败边界](./docs/smart-rma-parser-v1.md)。
- SMART / RMA 本地脱敏：遵循 [预览、Boundary Projection 与 sink 边界](./docs/smart-rma-redaction-v1.md)。
- 处理用户输入：先读 [隐私模型](./docs/privacy-model.md) 和 [脱敏包](./packages/redaction/README.md)。
- 发布站点：遵循 [Cloudflare Workers 部署](./docs/cloudflare-deployment.md)。

## 当前状态

## 本地运行

```bash
nvm use
npm ci
npm run validate
npm run dev --workspace @margrop-labs/web
```

开发者与 GitHub Actions 使用同一条根目录质量命令。检查内容和故障处理见 [质量门](./docs/quality-gates.md)。实验卡片由版本化清单生成，规则见 [实验清单加载器](./docs/lab-manifest-loader.md)。页面组件与交互必须遵循 [UI 与可访问性基线](./docs/ui-accessibility-baseline.md)。Token 任务炼金炉的稳定输入输出见 [v1 合同](./docs/token-forge-contract-v1.md)，无需 AI 的降级核心见 [确定性模板模式](./docs/token-forge-template-mode.md)，公开仓库的有界只读输入见 [GitHub 摘要适配器](./docs/github-public-repository-adapter.md)。所有未来 AI 能力必须通过 [Provider 中立的 Gateway 合同](./docs/ai-gateway-contract-v1.md)。

当前站点进入 **alpha**，后续功能开发集中在 Token 任务炼金炉；AI 面试工作台已完成
P5-007 的 noindex 合成工作台并排在第二优先级，AI 故障侦探保留维护，SMART / RMA 暂停后续开发。
P4-001/P4-002 已完成隔离的 Preview 与 Production 部署，
正式站点由 Cloudflare Workers Static Assets 和 Custom Domain 提供。P1-004 已在 P0-006
AI Gateway 和 P0-007 脱敏边界上实现 Token Forge AI 任务拆分核心：最小仓库上下文、
确定性输出安全检查和 P1-002 完整降级均已有合成测试。P1-005 已增加验证计划的本地
Markdown 和逐任务 GitHub Issue 草稿，包含脱敏、Markdown 安全、固定文件名和大小上限。
P1-006 已把无需登录、仓库和 AI 的模板生成与两种本地导出接到 `/token-forge/`；P1-007
又接入可选的受限公开 GitHub 摘要，只展示固定技术标签、覆盖计数和安全未知项，任何仓库
失败都保留模板与导出。P1-008 已完成 Preview 与 Production 的真实 Provider 验收：
浏览器不持有密钥，匿名限流、原子预算、并发上限、超时、熔断与固定 fallback 模型均在
服务端执行，AI 失败仍保留本地模板。P1-009 已为计划增加确定性质量报告；P1-010 已上线
可撤销、本地依赖安全的计划编辑；P1-011 已把最终计划生成第三种 Provider-neutral Coding
Agent 执行包，逐阶段提供上下文边界、命令发现、验收、交接与失败恢复协议。P1-012 已增加
6K/24K/40K 三档一键模板样例、三步引导、错误恢复和移动端结果导航。P0-008 已把固定
工具链、依赖扫描、Secret 扫描、Schema/fixture 验证和手动 Production 边界接入统一质量
门。P1-013 已加入 31 个完整计划场景、8 份跨栈快照、35 个故障注入、五类隐私 sink 和
真实 Chromium 关键路径。P4-003 已把最小事件接到独立的 SQLite Durable Object，只保留
31 天的日期、事件和粗设备类别聚合计数，不保存原始事件、用户标识或正文。P4-005 已提供
版本化的文章中段/文末 CTA，固定正式链接且不带追踪参数。当前下一项是 P4-006，在博客
导航突出 Token Forge 入口。
P2-001 已定义完全合成的 Incident Detective 场景/证据与单局推理
合同；P2-002 已完成首个 MySQL + Prometheus + Loki 合成事故，包含 10 份证据、13/9
点预算取舍、合理反证、按证据揭示的时间线和与公开场景分离的内部答案草稿。P2-003 已上线
逐步取证 Alpha 页面：用户可以管理预算与解锁、查看五类证据和时间线，并在本地生成
Attempt v1。P2-004 已加入五维 100 分确定性评分、逐条判定和改进反馈；页面仍不加载内部
答案，不调用 AI，不保存或上传结果。P2-005 已增加 Provider-neutral 的 Case Proposal
生成核心与显式人工审核门：模型不能接触答案或评分，也不能自动发布候选。P2-006 现已完成
Score-only 的确定性 SVG 下载，Incident Detective MVP 六个任务全部闭环。P3-001 已建立
7 份完全合成的 ATA、NVMe 与未知协议 `smartctl` 输入及版本化索引，覆盖健康、预警、危险、
缺失字段、厂商扩展、SMART 不可用和冲突信号。P3-002 已上线浏览器端只读解析工作台和
Parse Result v1。P3-003 已增加序列号、WWN、主机名、IP 与常见 Secret 的本地脱敏预览，
以及不含自由文本的 Boundary Projection v1；URL、日志和 Analytics 进一步收窄为固定元数据，
AI 与导出尚未启用，现有结果仍不构成厂商保修判断。P5-000 已定义 AI 面试工作台的双角色
三段主流程、敏感输入边界和公共 AI Gateway 复用方案；其功能任务仍阻塞于 P1-014。
完整顺序以 Token Forge 优先路线图为准。
