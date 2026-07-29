# AI 面试工作台：岗位匹配分析 v1

P5-002 在 P5-001 的本地输入和 Evidence Registry 之上，提供一个无需 AI、无需网络的确定性
匹配结果。它是后续 AI 语义匹配的安全降级路径，不是自动筛选、录用或淘汰器。

## 输入与输出

`buildInterviewMatchResult(bundle)` 只接收已经通过 P5-001 校验的 Resume、JD、Requirement 和
Evidence。输出由 `interview-match-v1.schema.json` 约束，包含：

- 每个 Requirement 的 `status`、可选分数、Evidence ID 和固定 `basis`；
- `must_have`、`technical`、`domain`、`scope`、`collaboration` 五个维度的聚合结果；
- `unknowns`、`conflicts` 和完整的 Requirement/Evidence 引用；
- 总体 `match_band` 与 `human_review.required: true`。

输出只保存结构化 ID、枚举和分数，不复制简历、JD 或面试记录叙述原文。

## 确定性规则

对每个 Requirement，只使用引用它的 Evidence 的 `support`：

| Evidence 状态 | Requirement 状态 | 分数 | 解释 |
| --- | --- | ---: | --- |
| 至少一个 `conflict` | `conflict` | `null` | 先解决矛盾，不能把矛盾平均掉 |
| 至少一个 `direct` 且无冲突 | `direct` | `100` | 有直接支持证据 |
| 至少一个 `partial` 且无 direct/冲突 | `partial` | `60` | 只有部分支持证据 |
| 没有证据 | `unknown` | `null` | 当前材料未覆盖，不等于不具备能力 |
| 只有 `unknown` 证据 | `unknown` | `null` | 证据存在但无法判断 |

维度和总体分数只对有数值的已知结果求平均；unknown 不被转换成 0。只要存在 unknown，
总体最多是 `partial_match`；只要存在 conflict，总体就是 `conflicted`。只有所有 Requirement
均为 direct 时才是 `strong_match`。没有已知证据时是 `insufficient_evidence`。

分数表达“已有证据的支持强度”，完整性由 status、unknowns 和 conflicts 单独表达，避免把
“目前没有材料”误读为负面分数。

## 人工确认边界

每个结果都强制 `human_review.required: true`，并包含 `no_automatic_decision`。unknown 或
conflict 会追加对应原因。结果不能直接推出录用、淘汰、人格判断或受保护属性判断；后续面试
计划必须把 unknown/conflict 转换为待验证问题，而不是事实结论。

## 与 AI 的关系

P5-002 不调用 Provider，不发送原文，不写入 Analytics、日志、URL 或存储。P5-006 若增加
语义匹配，只能新增审查过的操作专属投影，并将 AI 结果重新验证为同一 v1 结果合同；AI 不得
覆盖引用完整性、unknown 保留或人工确认标记。
