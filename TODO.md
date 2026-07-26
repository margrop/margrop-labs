# TODO / Idle-Token Backlog

每次只处理一个任务。规模：`S` 约 2k–8k Token，`M` 约 8k–25k，`L` 约 25k–60k。

## 当前战略

**Token 任务炼金炉是当前唯一产品开发主线。** 在完成 P1-007 至 P1-014、相关平台前置
任务和 [Token Forge 优先路线图](./docs/token-forge-roadmap.md) 的 Beta 出口门槛前：

- P2、P3 和新 Lab 不继续功能开发，只处理生产故障与安全问题；
- 平台任务只有在直接解锁 Token Forge 时才能执行；
- 默认严格按路线图顺序选择下一项任务；
- 恢复其他 Lab 开发必须经过 P1-014，并由仓库所有者明确批准。

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

- [x] **P0-005 [M] 建立 UI 与可访问性基线**
  - 产物：页面壳导航、FormField、StatusNotice、EvidenceCard、ExportActions 和完整基线文档。
  - 验收：原生键盘控件、文字/符号状态、320px 移动端重排、reduced motion、11 个单测与 20 项静态合同通过。

- [x] **P0-006 [M] 定义 AI Gateway 合同**
  - 产物：Provider 中立 ADR、v1 请求/响应 Schema、错误与 HTTP 映射、硬上限、Provider Adapter 和离线执行核心。
  - 验收：Web 不能指定 Provider、模型、系统提示词或密钥；请求/响应各 64 KiB、输入 24k/输出 4k Token、15 秒超时、最多 2 次尝试；无效或疑似泄密的模型响应失败关闭。

- [x] **P0-007 [M] 建立隐私与脱敏包**
  - 产物：无第三方依赖的 `@margrop-labs/redaction`，覆盖 IP、域名、邮箱、Authorization、Token、Cookie、序列号和 WWN；提供递归允许字段映射、类型/大小限制、Secret 默认拒绝和无原文报告。
  - 验收：未知字段先丢弃，自由文本再脱敏；URL、日志、Analytics、AI 请求和导出边界测试均不包含原文；Secret 错误不回显值；17 项包级测试及根质量门通过。

- [ ] **P0-008 [M] 建立 CI 与安全检查**
  - 产物：lint/type/test/build、依赖扫描、秘密扫描、Schema 验证。
  - 验收：PR 必须通过；版本固定；不自动部署生产。

## P1：Token 任务炼金炉（当前唯一产品主线）

- [x] **P1-001 [S] 定义输入与任务输出 Schema**
  - 产物：v1 输入/计划 Schema、TypeScript 类型与验证器、有效 fixture、失败测试和合同文档。
  - 验收：字段与 S/M/L Token 档位受 Schema 约束；重复、悬空、循环依赖及超 Token/工时计划会失败。

- [x] **P1-002 [M] 实现无需 AI 的任务模板模式**
  - 产物：三种确定性场景、模板生成器、合成输入 fixture、预算/工时/离线/注入边界测试和模式文档。
  - 验收：相同输入生成稳定计划；无网络和 AI 时可用；输出重新通过 v1 合同；可作为 AI 降级路径。

- [x] **P1-003 [M] 实现公开 GitHub 仓库摘要适配器**
  - 产物：固定 GitHub API Origin 的无鉴权适配器、路径/内容过滤、覆盖报告、合成响应 fixture 与失败测试。
  - 验收：只读公开仓库；最多 8 个文件、单文件 32 KiB、总计 128 KiB；忽略二进制、生成目录、秘密路径和疑似秘密内容。

- [x] **P1-004 [M] 实现 AI 任务拆分**
  - 产物：`token-forge.plan-v1` 操作输入 Schema、Provider-neutral 规划核心、最小脱敏仓库上下文、确定性输出后处理和模板降级。
  - 验收：输出重新通过 v1 合同与预算/工时约束；生产写操作和仓库逐字回显失败关闭；相似任务去重并重写依赖；固定显示覆盖与执行未知项；Secret、超时、不可用和无效输出均保留 P1-002 模板结果。

- [x] **P1-005 [M] 实现 Markdown/GitHub Issue 导出**
  - 产物：导出 v1 Schema、完整计划 Markdown、逐任务 GitHub Issue 草稿、通用安全文件名和确定性隐私/Markdown 边界。
  - 验收：只接收验证后的结构化计划；仓库 URL、上下文、Provider 元数据和隐藏服务端指令不属于输入；标识符与文件路径脱敏，Secret 失败关闭；固定文件名安全，内容可交给现有复制/下载组件；无网络、注入和 UTF-8 大小边界均有合成测试。

- [x] **P1-006 [S] 建立文章入口与转化事件**
  - 产物：`/token-forge/` 正式页面、首页与 Token/Coding Plan 文章闭环、本地模板/导出工作台和最小事件 Schema。
  - 验收：无需登录、仓库和 AI 即可生成并导出一份模板计划；事件只允许打开、运行、导出、文章和 GitHub 点击枚举，不包含表单、仓库 URL、计划或错误正文；P4-003 前接收器保持空实现。

- [x] **P1-007 [M] 在页面接入公开 GitHub 仓库摘要**
  - 产物：可选仓库 URL 输入、受限摘要调用、加载/失败/降级状态、覆盖与未知项界面。
  - 验收：只访问公开 GitHub 固定 API Origin；不要求 Token；明确显示读取、忽略、截断和未知计数；超时、限流、私有/无效仓库或疑似 Secret 时保留 P1-002 模板路径。

- [ ] **P1-008 [L] 接通受预算保护的生产 AI 规划**
  - 依赖：P4-004。
  - 产物：服务端 AI Gateway 端点、Provider Adapter、页面 AI 增强入口、流式或明确等待状态和模板降级。
  - 验收：浏览器不含密钥；AI 只接收版本化 allowlist 投影；预算、超时、限流、无效响应和熔断均保留可导出的模板计划；响应重新通过全部确定性合同。

- [ ] **P1-009 [M] 建立任务质量评分与可解释排序**
  - 产物：质量规则 Schema、价值/清晰度/可验收性/预算匹配/风险维度、排序证据与修改建议。
  - 验收：规则结果与 AI 建议分开显示；空泛任务、超大步骤、缺测试、依赖不完整和低价值工作会被确定性标记；评分不修改用户目标或伪装成事实。

- [ ] **P1-010 [M] 实现本地编辑、锁定和重新规划**
  - 产物：任务锁定、删除、排序、预算调整、依赖重算、撤销和重新验证。
  - 验收：锁定任务不会被重写；每次修改重新通过 Schema、DAG、Token 和工时约束；无自动保存、网络写入或隐藏修改；失败可恢复到最近有效计划。

- [ ] **P1-011 [M] 生成 Provider-neutral Coding Agent 执行包**
  - 产物：分阶段执行顺序、逐任务 Agent Prompt、允许上下文、非目标、验收命令、交接和失败恢复说明。
  - 验收：可直接复制给 Codex、Claude Code、Kimi Code 等工具而不依赖专属语法；不包含仓库原文、密钥、隐藏系统 Prompt 或未经证实的文件路径；每个阶段可独立验收。

- [ ] **P1-012 [M] 完善首次使用、样例和移动端体验**
  - 产物：三档 Token 场景、公开仓库样例、渐进式引导、空/错/降级状态和移动端结果导航。
  - 验收：首次用户无需阅读文档即可在 3 分钟内完成样例与导出；320px、键盘、reduced motion 和错误恢复路径通过；所有样例无需登录和 AI。

- [ ] **P1-013 [L] 建立端到端基准与可靠性矩阵**
  - 产物：至少 30 个合成基准场景、跨技术栈仓库快照、AI/网络/Schema/导出失败矩阵、浏览器关键路径测试和质量报告。
  - 验收：Schema、DAG 和预算约束 100% 通过；至少 90% 计划不含无法验收的空泛任务，其余会被质量规则标记；所有 AI 与网络故障均能降级；敏感内容不进入五类 sink。

- [ ] **P1-014 [S] 执行 Token Forge Beta 出口评审**
  - 依赖：P1-007 至 P1-013、P0-008、P4-003 至 P4-008。
  - 产物：逐项门槛报告、未关闭缺陷、14 天真实漏斗、成本与隐私复盘、是否解除冻结的明确决定。
  - 验收：满足优先路线图全部门槛；无 P0/P1 未解决缺陷或确认的敏感正文采集；只有仓库所有者批准后才恢复其他 Lab 开发。

## P2：AI 故障侦探 MVP（已完成，功能冻结）

- [x] **P2-001 [M] 定义事故场景与证据 Schema**
  - 产物：公开场景与单局推理 v1 Schema、TypeScript 类型/验证器、最小 Prometheus/Loki/MySQL 合同 fixture 和合同文档。
  - 验收：Source 与结构化 Payload 匹配；服务/证据/时间线引用、证据解锁 DAG、预算可达性、时间窗口、表格与推理引用均确定性验证；答案/评分字段、真实网络标识和 Secret 失败关闭；无网络、存储或日志副作用。
- [x] **P2-002 [M] 制作首个 MySQL + Prometheus + Loki 合成案例**
  - 产物：`mysql-leading-wildcard` 公开场景、10 份合成证据、13/9 点预算取舍、按证据揭示的时间线、独立内部答案草稿和 canonical attempt。
  - 验收：Prometheus → Loki → 只读 MySQL 证据链可在预算内闭合；包含 MySQL 存活、CPU 正常等合理反证；trace 不进入标签；公开场景无答案/评分；缺失必要证据或审批安全路径时验证失败。
- [x] **P2-003 [M] 实现逐步取证和时间线界面**
  - 产物：`/incident-detective/` Alpha 页面、不可退款的证据状态机、预算/前置解锁、五类证据渲染、证据揭示时间线、假设与安全动作表单、Attempt v1 本地验证结果。
  - 验收：页面只导入公开 `scenario.json`；锁定、重复、超预算和未知证据失败关闭；只引用已获取证据；支持与反证互斥；内部答案、canonical attempt、评分、网络、存储和 AI 均不进入客户端。
- [x] **P2-004 [M] 实现证据优先评分引擎**
  - 产物：独立内部评分规则 Schema、公开 Score v1 合同、首案五维 100 分规则、确定性评分引擎与本地结果界面。
  - 验收：Scenario、Attempt 和规则均先验证；证据覆盖/顺序、结构化结论、反证和安全边界逐条可审计；高风险动作只扣分不执行；标准答案、AI、网络、存储和日志均不参与评分。
- [x] **P2-005 [L] 实现受约束的 AI 案例生成与审核**
  - 产物：Case Generation Input、Case Proposal 与 Human Review v1 合同，Provider-neutral 生成核心，确定性后处理、显式人工审核门和完整合成 fixture。
  - 验收：Provider 不接收证据 Payload、内部答案、canonical attempt 或评分规则；候选 ID/来源/预算/目标不可漂移；证据 DAG、预算取舍、反证、只读与隐私失败关闭；安全说明由服务端固定；任何结果均不能自动发布。
- [x] **P2-006 [M] 实现不含事故原文的分享结果卡**
  - 产物：最小 Share Card v1 合同、Score-only 投影、确定性 1200×630 SVG 渲染和工作台本地下载。
  - 验收：只包含案例 ID、总分、等级和维度分数；拒绝 Attempt、证据 Payload、答案和 Findings；无网络、AI、存储、Analytics、时间戳或持久标识；标签 XML 转义，输出可重复。

验收原则：用户可以在完全离线样例中完成一局；评分由确定性规则给出，AI 只负责解释与变体。

## P3：SMART / RMA 报告机 MVP（功能冻结）

- [x] **P3-001 [M] 收集完全合成的 smartctl fixture**
  - 产物：Fixture Index v1 Schema、7 份完全合成 ATA/NVMe/未知输入、离线加载器和覆盖说明。
  - 验收：覆盖健康/预警/危险/未知、缺失字段、厂商扩展、SMART 不可用和冲突信号；索引、
    文本边界和合成标识失败关闭；不包含真实设备、网络或 Secret 标识。
- [x] **P3-002 [M] 实现浏览器端 SMART 解析器**
  - 产物：Parse Result v1 Schema、浏览器端确定性解析器、`/smart-rma/` Alpha 工作台和
    7 份合成 fixture 的精确回归测试。
  - 验收：结构化提取版本、协议、设备类别、SMART 支持、工具报告状态、ATA/NVMe 指标、稳定
    信号和缺失字段；64 KiB 上限与错误失败关闭；不上传、持久化或回显原文和设备标识；不做
    健康分类、AI 解释或保修判断。
- [x] **P3-003 [M] 实现序列号、WWN、主机名和 IP 脱敏**
  - 产物：smartctl 标识格式扩展、本地脱敏预览、Boundary Projection v1 Schema、五类 sink
    最小投影和工作台隐私报告。
  - 验收：覆盖序列号/WWN/主机名/IPv4/IPv6 的重复、大小写与分隔符变体；原文与自由文本不
    进入 URL、日志、Analytics、AI 请求或导出；Secret 本地遮蔽；错误不回显；无网络、存储
    和日志副作用。
- [ ] **P3-004 [M] [冻结] 实现规则化健康指标与未知状态**
- [ ] **P3-005 [M] [冻结] 实现 AI 通俗解释**
- [ ] **P3-006 [M] [冻结] 生成中文摘要与英文 RMA Markdown**

验收原则：原始 SMART 文本不离开浏览器；AI 只接收脱敏后的结构化指标；不得把工具结果描述成厂商保修结论。

## P4：Token Forge 平台与增长支撑

- [x] **P4-001 [M] 部署 preview 环境并验证移动端**
  - Preview：`https://margrop-labs-preview.margrop.workers.dev`。
  - 验收：完整质量门、Wrangler dry-run、在线 smoke test、320px 重排、触控目标和显式 viewport 全部通过。
- [x] **P4-002 [M] 配置 `lab.margrop.net` 正式部署**
  - Production：`https://lab.margrop.net`。
  - 验收：Custom Domain、HTTPS、首页、核心内容和 `robots.txt` 在线检查通过；生产发布保持手动触发。
- [ ] **P4-003 [M] 为 Token Forge 建立不采集输入正文的 Analytics**
- [ ] **P4-004 [M] 建立 Token Forge AI 日/用户预算、限流与熔断**
- [ ] **P4-005 [S] 为博客生成 Token Forge 统一 CTA 片段**
- [ ] **P4-006 [S] 在博客导航突出 Token Forge 入口**
- [ ] **P4-007 [M] 建立 Labs 首页与 Token Forge 的 SEO、Open Graph 和 sitemap**
- [ ] **P4-008 [M] 复盘 Token Forge 打开率、运行率、导出率、失败原因和 GitHub 点击率**

## 推荐下一项任务

接下来只做 **P1-007**：把已经完成的公开 GitHub 仓库摘要适配器接入 Token Forge 页面，
形成“可选仓库 URL → 受限只读摘要 → 覆盖/未知项 → 模板计划”的可用闭环。仓库不可用、
限流、超时、疑似 Secret 或输入无效时必须保留无需网络的模板结果；不得要求用户提供
GitHub Token，不得提前接入真实 AI。每次仍只处理一个任务。
