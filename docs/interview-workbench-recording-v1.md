# AI 面试工作台：面试记录与结论草稿 v1

P5-004 在 P5-003 的 Interview Plan 之上建立本地、可编辑的面试记录和结论草稿。它把面试
中观察到的内容与后续结构化推断分开，任何缺失或矛盾都保留为可审查状态；它不是自动录用、
淘汰或候选人画像系统。

## Interview Record v1

`interview-record-v1.schema.json` 的一份记录包含：

- `entry_id`、`question_id` 和 `requirement_ids`，将记录绑定到已生成的面试题；
- `response_status`，区分已回答、部分回答、未提问、拒答和未知；
- `facts`，分别标记候选人陈述、面试官观察和可验证材料；
- `counterevidence`，记录与当前支持信号不一致或仍需核对的内容；
- `unknown_reason`，明确没有结论是因为未提问、未回答、未验证或不适用；
- `user_confirmed` 和顶层 `status`，支持逐条编辑与人工确认。

所有记录都要求 `sensitivity: "sensitive"`、`local_only: true` 和人工复核。原始简历、联系信息、
面试全文和 Secret 不应进入 URL、Analytics、日志、Provider 或持久化存储；当前 P5-004 只保留
用户主动输入的结构化事实摘要。

## Interview Conclusion v1

`buildInterviewConclusion(record, plan)` 只依据记录中的 ID 引用生成结论草稿：

| 记录信号           | 结论状态       | inference code        |
| ------------------ | -------------- | --------------------- |
| 只有事实支持       | `supported`    | `fact_supported`      |
| 有事实但回答不完整 | `partial`      | `partial_facts`       |
| 有事实与反证       | `conflict`     | `conflicting_facts`   |
| 没有可用事实       | `unknown`      | `not_enough_evidence` |
| 计划中没有对应记录 | `not_assessed` | `not_assessed`        |

每条 judgment 必须引用至少一条记录 entry，并且其 fact/counterevidence ID 必须属于被引用的
entry。结论同时列出未评估、未知、冲突要求和下一步动作；整体推荐只是当前证据的审查信号，
不是录用建议。

## 人工确认和安全边界

- 结论默认 `status: "draft"`，每条 judgment 的 `review_state` 固定为 `draft`；
- `human_review.required` 永远为 `true`，并保留 `draft_requires_user_confirmation` 与
  `no_automatic_decision`；
- `automatic_decision` 固定为 `false`；确认状态只能由用户显式改变，不能由 AI 或规则自动改变；
- unknown 不是负面分数，冲突不会被平均掉，未提问不会被当作不通过；
- 结论不复制事实文本，只携带可回到本地记录的 ID，便于在界面中分别显示“记录事实”和
  “结构化推断”。

P5-004 的确定性校验器不调用 AI、网络、日志、Analytics 或存储。P5-006 才可以在独立的
Provider-neutral 操作中增加 AI 摘要，但必须把输入限制为最小脱敏投影，并将输出重新验证为
同一结论合同。
