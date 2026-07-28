# Token Forge 端到端基准与可靠性报告

## 结论

P1-013 的固定合成基准覆盖 31 个完整计划场景、15 个技术画像、8 份跨技术栈仓库快照、
35 个失败注入和 5 类隐私 sink。当前机器报告中：

- 31/31 计划重新通过 Input / Plan v1 Schema、依赖 DAG、Token 和工时预算；
- 31/31 计划没有质量规则认定的无法验收任务，达到 100%，高于 90% 门槛；
- 7/7 端到端 AI 或网络故障场景保留模板、Issue 草稿和 Coding Agent 执行包；
- 35/35 故障矩阵项达到预期的模板降级或失败关闭；
- URL、日志、Analytics、AI 请求和导出五类 sink 均不包含合成敏感原值；
- 4/4 Chromium 关键路径通过，包括本地生成与下载、仓库限流、AI 限流和 320px
  键盘路径。

[`corpus.json`](../labs/token-forge/benchmarks/corpus.json) 是版本化输入，
[`report.json`](../labs/token-forge/benchmarks/report.json) 是固定机器报告。基准单测会重新
计算全部指标并与报告逐字段比较，避免文档数字在实现变化后静默过期。

## 场景设计

### 计划质量

31 个完整场景由五类管线组成：

| 管线             | 数量 | 验证目标                                   |
| ---------------- | ---: | ------------------------------------------ |
| 本地模板         |   15 | 不读取仓库、不调用 AI 的确定性主路径       |
| 合成仓库摘要     |    8 | 跨栈摘要投影、覆盖证据与完整导出           |
| GitHub 故障降级  |    4 | 限流、超时、网络错误和无效响应             |
| AI 故障降级      |    3 | 限流、Provider 超时和无效结构化响应        |
| AI 通过确定性校验 |    1 | AI 候选计划重新验证、评分和重建导出         |

15 个画像覆盖 TypeScript、Astro、Preact、Go、Gin、Python、FastAPI、Java、Spring、
Rust、Axum、Next.js、React、Ruby、Rails、PHP、Laravel、.NET、Swift、Kotlin、Vue、
SvelteKit、Docker 等组合以及 6K、8K、16K、24K、40K 多档 Token 与不同工时。

8 份仓库快照只包含合成的安全文本，分别代表 Astro、FastAPI、Gin、Spring、Axum、
Next.js、Rails 和 Laravel。它们不会访问 GitHub，也不包含真实仓库路径、正文、用户数据
或凭据。

### 故障矩阵

故障矩阵与计划质量样本分开计数，避免大量负面样本稀释计划可验收率：

| 层      | 数量 | 预期结果                                                   |
| ------- | ---: | ---------------------------------------------------------- |
| AI      |   15 | 3 个准备错误和 12 个 Gateway 错误全部保留模板与完整导出    |
| 网络    |    9 | 全部 GitHub 适配器错误码投影为稳定降级，不回显错误正文     |
| Schema  |    7 | 无效输入、无效计划、重复/悬空/循环依赖、超 Token/工时均拒绝 |
| 导出    |    4 | 无效计划、Secret、超大产物和无效输出均失败关闭             |

语料验证器会比较矩阵与当前 TypeScript 错误码集合；新增错误码但没有基准时，测试会直接
失败。

### 浏览器关键路径

`npm run test:browser` 在构建后的 Astro 静态站上运行真实无头 Chromium：

1. 6K 本地样例生成 1 个任务，结果标题获得焦点，三类导出可用，并完成 Markdown 下载；
2. 24K 公开仓库样例遇到 429 后显示仓库降级状态，模板与三类导出保持可用；
3. AI 端点返回限流合同后显示 AI 降级状态，模板与三类导出保持可用；
4. 320px + reduced-motion 下通过键盘触发样例，结果获得焦点且页面无水平溢出。

测试先通过受控表单更新确认 Preact Island 已完成 hydration，避免把未挂载事件处理器误判
为产品故障。网络和 AI 响应由浏览器路由提供合成合同，不读取生产服务。

## 隐私与成本

- 五类 sink 使用同一组合成邮箱、RFC 5737 IP、示例域名、序列号和 WWN；每个边界都断言
  原值不存在。
- Secret 由 AI 准备和导出失败矩阵单独证明失败关闭，错误信息不包含原值。
- 基准不调用真实 GitHub 或 AI Provider，不产生模型 Token 成本，不写入生产或浏览器存储。
- Playwright 追踪、截图和录像默认关闭；失败上下文只来自完全合成页面。

## 测试依赖说明

Node 和 DOM 模拟器不能验证真实下载、焦点、媒体查询、横向布局和浏览器网络拦截，因此增加
两个仅开发环境使用的固定版本依赖：

- `@playwright/test@1.60.0`：Microsoft 维护，Apache-2.0；测试包、`playwright` 和
  `playwright-core` 的 npm 解包体积合计约 17.4 MB。它提供真实浏览器自动化、可访问性
  定位器、下载和网络路由能力，不进入 Astro 生产产物。
- `@sparticuz/chromium@148.0.0`：持续维护的 MIT 项目，npm 解包体积约 69.0 MB。其
  Chromium 148 与 Playwright 1.60 的 Chromium 148 主版本一致；浏览器由锁文件随
  `npm ci` 获取，避免 CI 另行下载未锁定的系统 Chrome 或依赖运行时 CDN。

浏览器首次运行会把压缩资源展开到 `node_modules/.cache`；该目录不受版本控制。生产依赖、
客户端 JavaScript 和 Worker 部署大小不变。

## 重复验证

从仓库根目录执行：

```text
npm run benchmark:token-forge
npm run build
npm run test:browser
npm run validate
```

`npm run validate` 是本地与 GitHub Actions 共用的唯一质量门，顺序执行格式、依赖/Secret/
Schema 安全检查、lint、类型、全部 Vitest、生产构建、静态合同和真实浏览器测试。

## 已知限制

- 全部数据是合成数据；真实 Provider、GitHub 和 Production 可用性继续由部署 smoke 与
  P4-008 的上线观察覆盖。
- 当前浏览器门只固定 Chromium，不宣称 Firefox 或 WebKit 兼容性。
- 当前 31 个完整计划均为 `ready`，因此基准报告中的“剩余需标记”数量为 0；质量规则对
  空泛任务的标记由独立单元测试继续覆盖。
