# MySQL Leading-Wildcard Case

P2-002 的首个完整合成案例。公开 `scenario.json` 可由未来 P2-003 页面加载；
`answer.internal.json` 只供仓库测试和后续 P2-004 评分设计参考，不得发送到客户端；
`attempt.canonical.json` 证明在 9 点预算内存在一条完整、只读、包含反证的推理路径。

案例方法论与相关文章一致：先确认 MySQL/Exporter 存活，再用有界 Prometheus 时间序列确定
窗口，用 Loki 中低基数 Stream 和正文 trace 关联慢查询与超时，最后以只读 EXPLAIN 验证
机制。查询参数、真实邮件、真实订单、真实网络标识和凭据都未进入 fixture。

该答案文件不是评分规则：没有分数、权重或唯一理想顺序。P2-004 必须另行定义可审核的确定性
评分合同。
