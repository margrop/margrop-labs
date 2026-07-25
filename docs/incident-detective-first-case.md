# Incident Detective 首个完整案例

P2-002 在 P2-001 v1 合同上完成了首个可玩的合成事故：
`mysql-leading-wildcard`。它把相关文章中的“指标确定窗口、日志补充事件、只读数据库事实验证
机制”方法，转换成一局有预算、有前置条件、有反证的离线取证练习。

相关文章：
[MySQL + Prometheus + Loki + Grafana + AI Agent 实战](https://blog.margrop.net/en/post/mysql-prometheus-loki-grafana-ai-agent-hands-on/)。

## 案例边界

- 全部服务、指标、日志、查询结果、时间和 trace 都是仓库内合成数据；
- 不连接真实 Prometheus、Loki、MySQL 或 Grafana；
- MySQL 证据只包含 `SELECT` 与 `EXPLAIN`；
- trace 只出现在日志正文，不成为 Loki Stream 或 Prometheus Label；
- 重启、写入、删除和生产变更只作为安全边界讨论，不会执行；
- 公开场景不包含根因答案、评分、权重或唯一理想顺序。

## 事故简报

一次合成应用发布后，结账搜索接口延迟和超时开始上升。发布时间接近症状开始时间，但这只能
形成假设，不能直接证明发布、MySQL、宿主机或缓存中的任意一项是根因。

用户拥有 9 点证据预算，而全部证据需要 13 点，因此不能打开所有卡片。证据前置关系还要求
用户先发现症状窗口，再沿同一合成 trace 查看日志，最后才能执行只读查询计划检查。

## 证据菜单

| 证据                             | 来源       | 成本 | 主要用途                                    |
| -------------------------------- | ---------- | ---: | ------------------------------------------- |
| `stack-topology`                 | Topology   |    1 | 确认请求、数据库、缓存与可观测组件边界      |
| `prometheus-mysql-health`        | Prometheus |    1 | 反证 MySQL 或 Exporter 整体下线             |
| `prometheus-checkout-latency`    | Prometheus |    1 | 确定延迟上升的时间窗和幅度                  |
| `prometheus-connection-pressure` | Prometheus |    2 | 观察延迟后连接是否堆积                      |
| `prometheus-host-cpu`            | Prometheus |    1 | 反证宿主机 CPU 饱和                         |
| `loki-checkout-trace`            | Loki       |    2 | 用正文 trace 关联慢查询、连接等待与上游超时 |
| `mysql-query-plan`               | MySQL      |    2 | 用只读 `EXPLAIN` 验证查询访问路径           |
| `mysql-order-state`              | MySQL      |    1 | 反证订单状态数据丢失                        |
| `loki-release-events`            | Loki       |    1 | 区分发布发生与进程崩溃                      |
| `runbook-slow-search`            | Runbook    |    1 | 提醒有界查询、保留证据与生产审批边界        |

所有单份证据连同其前置证据都能放进 9 点预算，完整菜单又大于预算。这样既不会产生无法解锁
的死路，也保留了有意义的取舍。

## 可验证的推理链

仓库中的 canonical attempt 证明存在一条正好花费 9 点的安全路径：

1. 看拓扑，明确每种数据源负责回答什么问题；
2. 确认 MySQL 持续存活，避免把慢查询误判成整体下线；
3. 用 Prometheus 确定延迟上升窗口；
4. 观察连接压力随延迟升高，但不把相关性直接写成因果；
5. 用 Loki 正文中的同一合成 trace 关联慢查询、连接等待与超时；
6. 用只读 `EXPLAIN` 验证前置通配符查询没有选择普通邮箱索引，并扫描大量合成行。

内部答案草稿将普通索引无法有效服务前置通配符搜索、扫描时间增长、连接堆积和上游超时写成
一个可审核机制。它同时保留 MySQL 存活、宿主机 CPU 正常、订单状态完整和发布后 readiness
通过等反证，以及数据分布、选择性、并发和缓存收益等未知项。

## 文件与消费边界

| 文件                                                                          | 用途                           | P2-003 客户端是否加载 |
| ----------------------------------------------------------------------------- | ------------------------------ | --------------------- |
| `labs/incident-detective/cases/mysql-leading-wildcard/scenario.json`          | 公开场景、证据菜单和揭示时间线 | 是                    |
| `labs/incident-detective/cases/mysql-leading-wildcard/attempt.canonical.json` | 证明预算和引用闭合，供仓库测试 | 否                    |
| `labs/incident-detective/cases/mysql-leading-wildcard/answer.internal.json`   | 独立答案草稿与后续评分设计输入 | 否                    |
| `labs/incident-detective/internal/answer-draft-v1.schema.json`                | 约束内部答案边界               | 否                    |

内部答案 Schema 明确拒绝分数和权重，所以 P2-002 不会提前把某一取证顺序固化为评分规则。
P2-004 仍须定义独立、可审核且不会进入公开场景的确定性评分合同。

## 自动化验收

案例测试会验证：

- 10 份证据总成本为 13，公开预算为 9；
- Prometheus、Loki 和 MySQL 三种关键来源都存在；
- 公开 JSON 不包含答案或评分元数据；
- Loki Stream 和 Prometheus Label 不包含 trace、订单、客户或邮箱等高基数字段；
- MySQL 查询保持只读且查询参数不含真实邮箱；
- canonical attempt 包含全部必要证据并正好用完预算；
- 支持证据和反证不重叠；
- 缺少必要证据、预算取舍或审批安全动作时验证失败；
- 验证过程不访问网络、存储或日志。

## P2-003 接入结果

逐步取证界面现在只读取 `scenario.json`，按 `unlocks_after` 决定证据是否可选，按
`acquisition_cost` 实时计算剩余预算，并且只显示已选择证据对应的 `revealed` 时间线事件。
用户提交后生成 Attempt v1；界面不加载内部答案，也不会在 P2-004 前伪造评分结果。实现边界
见[逐步取证页面](./incident-detective-page.md)。
