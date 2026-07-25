# Incident Detective v1 合同

P2-001 为 AI 故障侦探建立两份互相分离的公共合同：

- [`incident-detective-scenario-v1`](../schemas/incident-detective-scenario-v1.schema.json)：
  仓库内完全合成的初始简报、服务、证据和时间线；
- [`incident-detective-attempt-v1`](../schemas/incident-detective-attempt-v1.schema.json)：
  一局中的取证顺序、预算、安全动作、时间线排序和用户假设。

根因答案、评分权重、理想取证顺序和 AI 解释都不属于这两份合同。P2-004 必须使用独立评分
合同，不能向场景输入补入 `answer`、`ground_truth` 或 `rubric`。

## 场景合同

场景顶层包含：

- 稳定 ID、标题、无答案的初始症状摘要和难度；
- 1–24 点证据预算；
- 1–12 个服务与 1–6 个学习目标；
- 有开始和结束的事故窗口；
- 1–12 份有获取成本和前置条件的证据；
- 1–40 个按时间排序的初始或随证据揭示的事件；
- 明确只读、合成和人工审批边界的安全说明。

服务类型限定为应用、数据库、缓存、可观测性、基础设施或外部依赖。场景 ID、服务 ID、
证据 ID 和时间线 ID 使用稳定的 kebab-case，不使用随机值或真实基础设施标识。

## 证据类型

`source` 与 `data.kind` 必须严格对应：

| Source       | Data kind  | 有界内容                                         |
| ------------ | ---------- | ------------------------------------------------ |
| `prometheus` | `metric`   | 查询、单位、最多 8 条序列，每条最多 120 个时间点 |
| `loki`       | `log`      | 合成 Stream 和最多 120 条有级别日志              |
| `mysql`      | `table`    | 只读合成查询、最多 12 列和 100 行标量数据        |
| `runbook`    | `document` | 最多 12 个标题/正文段落                          |
| `topology`   | `topology` | 最多 20 个服务节点和 40 条有向关系               |

Schema 负责字段、类型、数量和长度上限；TypeScript 验证器继续检查：

- 服务、证据和时间线 ID 唯一；
- 服务、证据前置条件和时间线证据引用位于同一场景；
- 证据解锁关系无自引用、悬空引用和环；
- 每一条证据及其全部前置成本都能放进场景预算；
- 指标点、日志和时间线位于事故窗口内并按时间排列；
- 表格每行单元格数与列数一致；
- 拓扑节点唯一引用场景服务，边只引用同一证据中的节点。

`initial` 时间线事件不依赖证据；`revealed` 事件必须引用一份证据。时间线陈述只描述变化、
症状、观察或恢复，不能在合同层把观察标记成根因。

## 单局推理合同

Attempt 记录：

- 对应场景 ID；
- 按实际获取顺序排列的证据 ID 和精确花费预算；
- 用户排列的时间线事件；
- 只读优先、保留证据、最低权限、请求审批，以及重启/写入/删除等待评分安全动作；
- 用户的根因摘要、怀疑服务、支持证据、反证、信心级别和下一步。

验证器会重新验证场景，再确认：

- 每份证据存在，且选择顺序满足前置条件；
- `spent_budget` 等于所选证据成本之和且不超预算；
- 支持与反证都已解锁，并且不能同时出现在两组；
- 怀疑服务属于场景；
- 随证据揭示的时间线事件只有在对应证据已选时才能出现；
- 用户时间线保持时间顺序。

安全动作只记录用户在合成游戏中的选择，不执行重启、写入、删除或任何真实系统操作。

## 隐私与合成边界

两份合同都离线验证，不访问网络、存储或日志。未知字段失败关闭，验证错误只返回字段路径或
稳定不变量，不回显输入值。

自由文本拒绝 Authorization、Cookie、Token、邮箱、序列号和 WWN。网络标识只允许
`example.com` 和 RFC 5737 的 `192.0.2.0/24`、`198.51.100.0/24`、
`203.0.113.0/24`；其他域名与 IP 失败关闭。

P2 首版不接受用户粘贴的真实日志、Prometheus 响应或数据库结果。P2-002 完整案例也只使用
仓库内合成数据。

## Fixture 与测试

- [`scenario.valid.json`](../labs/incident-detective/fixtures/scenario.valid.json)：
  最小 Prometheus/Loki/MySQL 合同样例；
- [`attempt.valid.json`](../labs/incident-detective/fixtures/attempt.valid.json)：
  与场景预算和引用一致的合成推理。

它们只验证合同，不是 P2-002 的完整可玩事故。测试覆盖有效路径、答案字段拒绝、Source/
Payload 配对、重复/悬空/循环引用、预算可达性、时间窗口与顺序、表格列宽、推理引用、证据
揭示、敏感内容和无副作用运行。

P2-002 完整案例位于
[`mysql-leading-wildcard`](../labs/incident-detective/cases/mysql-leading-wildcard/)：

- `scenario.json` 是 P2-003 唯一可加载的公开场景；
- `attempt.canonical.json` 证明预算、依赖、引用与安全路径闭合；
- `answer.internal.json` 受仓库内部 Schema 约束，只供测试和 P2-004 设计输入；
- 内部答案明确拒绝分数和权重，不是评分合同。

案例设计与验收详见
[Incident Detective 首个完整案例](./incident-detective-first-case.md)。

## 版本与后续

v1 Schema 发布后保持不可变。破坏性变化必须新增版本、fixture、消费者测试和迁移说明。

- P2-002 已在本合同上完成首个完整 MySQL + Prometheus + Loki 合成案例；
- P2-003 消费公开场景和 Attempt 合同实现逐步取证与时间线界面；
- P2-004 另行定义不向公共场景泄露答案的确定性评分合同。
