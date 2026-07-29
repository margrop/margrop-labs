# AI 故障侦探

## 问题

传统故障题只看最终答案，无法训练“先取证、再判断”和最低权限意识。

## MVP 流程

1. 载入完全合成的事故；
2. 用户在有限预算内选择 Prometheus、Loki、MySQL 等证据；
3. 页面构建时间线并显示已知/未知；
4. 确定性规则按证据顺序、越权行为和结论支持度评分；
5. AI 解释错过的证据，并生成安全的场景变体。

## v1 合同

P2-001 已定义[公开场景与单局推理合同](../../docs/incident-detective-contract-v1.md)：

- Scenario 包含完全合成的服务、证据预算、Prometheus/Loki/MySQL/Runbook/Topology
  证据和逐步揭示时间线；
- Attempt 包含取证顺序、实际花费、安全动作、用户时间线与包含支持/反证的假设；
- TypeScript 不变量验证证据解锁 DAG、跨对象引用、预算、时间窗口、表格和拓扑；
- 根因答案、评分规则和 AI 解释不进入 Scenario/Attempt；P2-004 另行定义评分规则与结果合同，
  P2-005 只生成待人工审核的内部 Proposal。

`fixtures/` 中的 P2-001 场景只是最小合同样例，不是可玩的完整事故。

## 首个完整案例

P2-002 已在 `cases/mysql-leading-wildcard/` 完成首个 MySQL + Prometheus + Loki 合成
事故：

- 公开场景有 10 份证据，总成本 13，单局预算 9；
- Prometheus 确定窗口，Loki 正文 trace 关联事件，只读 MySQL 事实验证机制；
- MySQL 存活、宿主机 CPU 正常、订单状态完整和发布 readiness 提供反证；
- canonical attempt 证明必要证据链可正好放进预算；
- 独立内部答案草稿没有分数、权重或唯一理想顺序，且不会由 P2-003 客户端加载。

完整设计、证据菜单和消费边界见
[首个完整案例说明](../../docs/incident-detective-first-case.md)。

## Alpha 页面

P2-003 已提供 `/incident-detective/`：

- 证据按前置条件逐步解锁，并实时计算 9 点预算；
- 已获取证据不可退款，重新选路必须重开整局；
- Metric、Log、Table、Document 和 Topology 都有结构化渲染；
- 时间线只揭示初始事件和已获取证据对应事件；
- 用户可以填写假设、怀疑服务、支持/反证、信心、下一步和安全动作；
- 浏览器生成并重新验证 Attempt v1，再按固定规则给出五维 100 分结果；
- 总分、维度和逐条反馈可审计，不判断自由文本语义，不展示标准答案；
- Attempt 与评分均不保存、不上传；评分不调用 AI，用户可在评分后主动请求受约束解释。

页面导入公开 `scenario.json` 与独立评分规则，但不会加载内部答案或 canonical attempt。
实现与测试边界见[逐步取证页面](../../docs/incident-detective-page.md)和
[确定性证据评分](../../docs/incident-detective-scoring.md)。实验状态现为 Alpha。

P2-006 还允许在评分后下载本地 SVG。分享对象只投影案例 ID、总分、等级和维度分数，不读取
事故原文、Attempt、证据 Payload、答案或逐条反馈。详见
[隐私分享结果卡](../../docs/incident-detective-share-card.md)。

## AI 边界

评分、证据解锁和事实由代码决定；AI 不得修改事实或评分，只能解释和生成待审核变体。

P2-005 的 `incident-detective.case-proposal-v1` 操作只接收 ID、主题、来源、预算和学习目标。
模型不会收到证据 Payload、内部答案、canonical attempt 或评分规则。输出必须通过证据 DAG、
预算取舍、反证、只读与隐私检查，再进入独立人工审核合同；`approved` 也固定
`publishable: false`，不能自动变成公开 Scenario。详见
[受约束案例生成与审核](../../docs/incident-detective-case-generation.md)。

P2-007 的 `incident-detective.explanation-v1` 只接收确定性 Score 投影、Finding 和证据
标题/ID/来源/成本，不接收 Attempt 自由文本、证据 Payload、内部答案或评分规则。输出必须
保持场景与总分，并且只能引用输入中的 Finding 和 Evidence。超时、限流、网络或结构失败时，
页面保留本地 Score 和 Findings。详见
[评分解释与降级](../../docs/incident-detective-ai-explanation.md)。

P2-008 已在同页提供案例 Proposal 与人工审核工坊；审核结果可以本地下载，但始终
`publishable: false`。

## 隐私

首版只使用仓库内合成数据，不接入真实监控系统。

合同拒绝 Secret、邮箱、硬件标识以及 `example.com` / RFC 5737 之外的网络标识；验证过程
不访问网络、不持久化、不记录正文。安全动作只是合成游戏选择，不执行任何真实写入、重启或
删除操作。
