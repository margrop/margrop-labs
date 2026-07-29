# AI 面试工作台 Alpha 出口评审（2026-07-29）

## 结论

AI 面试工作台达到**合成 Alpha GO**：`/interview-workbench/` 可索引，双角色三步合成闭环、
可选 AI 降级、无正文 Analytics、固定博客 CTA 和安全摘要导出均有当前仓库证据与自动测试。
这不是对真实候选人数据、真实招聘质量、自动筛选或自动录用/淘汰的批准。

## P5-001 至 P5-009 证据

- P5-001：`schemas/interview-resume-v1.schema.json`、`schemas/interview-jd-v1.schema.json`、
  `apps/web/src/lib/interview-contracts.test.ts` 证明本地输入、允许字段投影与敏感边界。
- P5-002：`schemas/interview-match-v1.schema.json` 与
  `apps/web/src/lib/interview-matching.test.ts` 证明要求—证据引用、unknown 和人工确认。
- P5-003：`schemas/interview-plan-v1.schema.json` 与
  `apps/web/src/lib/interview-planning.test.ts` 证明 30/45/60 分钟闭合与提前门槛边界。
- P5-004：`schemas/interview-record-v1.schema.json`、`schemas/interview-conclusion-v1.schema.json`
  和 `apps/web/src/lib/interview-recording.test.ts` 证明事实、反证、未知项与 draft 结论。
- P5-005：`apps/web/src/lib/interview-synthetic.test.ts` 与双角色 fixtures 证明无需 AI 的完整闭环。
- P5-006：`apps/web/src/server/interview-ai-runtime.test.ts` 与三个同源端点证明 Provider 复用、
  独立策略和失败降级。
- P5-007：`apps/web/src/components/InterviewWorkbench.tsx` 与
  `e2e/interview-workbench.spec.ts` 证明三步导航、本地编辑、恢复和导出。
- P5-008：`apps/web/src/lib/interview-reliability.test.ts`、
  `e2e/interview-workbench-reliability.spec.ts` 证明跨岗位、公平性、隐私 sink 和 AI 故障矩阵。
- P5-009：共享 Analytics 合同位于 `schemas/lab-analytics-*.schema.json`，CTA 位于
  `labs/interview-workbench/integrations/`，SEO/OG 位于
  `apps/web/src/pages/interview-workbench/index.astro`，专属图片为
  `apps/web/public/social/interview-workbench.png`。

## Alpha 出口门槛

- 两种角色无需登录、无需 AI、无需真实数据即可运行；页面明确显示“完全合成样例”。
- 匹配、计划、记录与结论继续通过版本化 Schema、引用完整性、时间预算和人工确认校验。
- AI 端点或 Analytics 返回失败时，浏览器测试仍能导航、编辑和下载安全摘要。
- 320px、reduced motion、键盘原生控件与静态可访问性合同进入统一质量门。
- 页面没有真实简历/岗位说明文件输入或对应 textarea。

## 内容入口与发现

- `labs/interview-workbench/integrations/interview-workbench-cta.json` 是版本化 CTA 唯一内容源；
  inline/footer 片段由确定性 renderer 验证。
- 页面输出 `index, follow`、正式 canonical、WebApplication JSON-LD 和专属 1200×630 PNG。
- `/interview-workbench/` 已进入构建生成的 sitemap；404 与 `/api/` 路由仍排除。
- 本仓库未修改外部博客仓库，也未声明线上文章已经发布。

## Analytics 隐私合同

- 允许事件只有 Lab、版本、固定事件名和粗设备类别；请求最大 1 KiB、无 Cookie、无凭据、
  无重试、无访客/会话标识。
- `POST /api/token-forge/events` 与 `POST /api/interview-workbench/events` 执行路由绑定校验。
- 两个 Lab 共用现有 `TOKEN_FORGE_ANALYTICS` binding 和 `TokenForgeAnalyticsObject`，不新增配置。
- 快照只保存 31 天的“UTC 日期 × Lab × 事件 × 粗设备类别”计数；旧 Token Forge 快照
  保持兼容并在首次写入时迁移。
- 单元与浏览器测试证明简历、岗位说明、问题、记录、结论、Prompt、Response 和受保护属性
  不进入事件载荷。

## AI Token 与基础设施成本

页面打开、阶段完成、导出、CTA 和 Analytics 不调用模型，因此不增加 AI Token。显式点击
三项 AI 按钮时继续使用 P5-006 的既有主/回退模型、预算、限流、并发、超时与熔断策略。
P5-009 没有新增 Durable Object binding、Secret、Provider、模型、端口或配置文件；新增成本
仅为现有对象中的小型聚合计数写入和一个静态 PNG。

## 公平性与人工确认

受保护属性禁止、unknown 不转为负分、证据/反证分离、结论默认 draft、
`automatic_decision: false` 与人工确认要求均保持不变。Analytics 不记录角色、分数、要求 ID、
证据 ID 或结论状态，不能用于候选人画像或决策。

## 已知限制

- 当前只支持仓库内完全合成样例，不接受真实简历、岗位说明或真实面试记录。
- Analytics 是事件次数而非唯一用户；刷新、重复操作和自动化会放大计数。
- 未执行 Production 部署、真实流量观察、搜索收录或社交平台缓存刷新。
- AI 输出质量只通过合成基准，不代表真实招聘场景质量获批。

## GO/NO-GO

**合成 Alpha GO。真实候选人输入与招聘用途 NO-GO。**

2026-07-29 在锁定 Node `24.14.0`、npm `11.9.0` 下执行：

```bash
npm run validate
```

结果：PASS。仓库安全扫描编译 44 个 Schema、验证 43 个登记 fixture 和 4 个 Lab Manifest；
Vitest 47 个文件、425 项测试通过；静态构建与全部静态合同通过；Chromium 9 项 E2E 通过；
`npm audit --audit-level=high` 报告 0 个漏洞。本机默认镜像不支持 Audit API，因此本次命令仅
通过环境变量使用官方 npm registry，未修改仓库或用户配置。

## 下一条最小任务

只创建一项规划评审：决定是否接入真实简历与岗位说明，以及本地解析、会话生命周期、导出
确认、AI 最小投影、删除语义和公平性验收应满足的门槛。在评审通过前不实现真实输入、持久化、
候选人数据库、画像或自动录用/淘汰路径。
