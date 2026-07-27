# Token 任务炼金炉 v1 合同

v1 合同只定义输入、输出和失败行为。P1-002 的确定性模板生成器已经消费该合同；后续 AI 模式也必须使用同一份验证器。

## 输入

Schema：[`schemas/token-forge-input-v1.schema.json`](../schemas/token-forge-input-v1.schema.json)

| 字段              | 约束                               | 含义                     |
| ----------------- | ---------------------------------- | ------------------------ |
| `schema_version`  | 固定 `1.0`                         | 合同版本                 |
| `token_budget`    | 整数，2,000–60,000                 | 本轮可消耗的总 Token     |
| `expires_in_days` | 整数，1–30                         | 距离额度到期的天数       |
| `available_hours` | 1–80，步长 0.5                     | 到期前实际可投入的总工时 |
| `tech_stack`      | 1–8 个非空唯一字符串               | 用户愿意使用的技术栈     |
| `goal`            | 10–500 字符                        | 希望达成的可描述目标     |
| `repository_url`  | 可选、规范的 GitHub HTTPS 仓库 URL | 后续公开仓库摘要的入口   |

`repository_url` 的 Schema 只验证 URL 形态，不发起网络请求，也不能证明仓库公开存在。P1-003 的只读适配器负责公开性、读取路径和大小上限。

## 输出

Schema：[`schemas/token-forge-plan-v1.schema.json`](../schemas/token-forge-plan-v1.schema.json)

输出包含 1–6 个任务，以及明确的未知项和安全说明。每个任务必须包含：

- 稳定且唯一的 `id`；
- `S`、`M` 或 `L` 规模；
- 标题、预计 Token 和预计工时；
- 同一计划内的依赖任务 ID；
- 明确的包含范围与排除范围；
- 可以直接交给编码 Agent 的 Prompt；
- 可逐条验证的验收标准。

规模与预计 Token 使用半开区间：

| 规模 |    预计 Token |
| ---- | ------------: |
| S    |   2,000–7,999 |
| M    |  8,000–24,999 |
| L    | 25,000–60,000 |

`mode` 为 `template` 或 `ai-assisted`。它描述计划的生成来源，不改变验证强度。

## 跨字段不变量

JSON Schema 负责字段形态和单项范围；`token-forge-contracts.ts` 在 Schema 通过后继续检查：

1. 任务 ID 不重复；
2. 依赖必须指向同一计划内的任务；
3. 任务不得依赖自己，依赖图不得成环；
4. 所有任务预计 Token 之和不得超过输入额度；
5. 所有任务预计工时之和不得超过可投入时间。

模板输出、AI 输出、fixture 和未来导入的数据都必须经过相同验证。AI 不能绕过或放宽这些规则。

验证后的计划可以交给 [P1-005 Markdown / GitHub Issue 导出](./token-forge-export.md)。
导出拥有独立 v1 Schema、脱敏、文件路径移除、Markdown 安全和字节上限，不改变本计划
合同。也可以交给
[P1-011 Provider-neutral Coding Agent 执行包](./token-forge-agent-package.md)，按最终
依赖安全顺序生成逐阶段执行、验收、交接和失败恢复协议。

## 失败与隐私

- 未知字段默认拒绝，不透传到后续消费者；
- 错误只包含合同名、字段路径和规则，不回显输入值；
- 当前验证器不记录日志、不持久化输入、不发送网络请求；
- `repository_url` 可省略；fixture 不包含真实仓库、凭据或私有地址；
- 原始仓库内容、隐藏 Prompt 和凭据不属于此合同。

## Fixture 与自动验证

- [`input.valid.json`](../labs/token-forge/fixtures/input.valid.json)
- [`plan.valid.json`](../labs/token-forge/fixtures/plan.valid.json)
- [`template-small.input.json`](../labs/token-forge/fixtures/template-small.input.json)
- [`template-medium.input.json`](../labs/token-forge/fixtures/template-medium.input.json)
- [`template-large.input.json`](../labs/token-forge/fixtures/template-large.input.json)
- [`token-forge-export.valid.json`](../labs/token-forge/fixtures/token-forge-export.valid.json)
- [`token-forge-agent-package.valid.json`](../labs/token-forge/fixtures/token-forge-agent-package.valid.json)

单元测试覆盖有效 fixture、非 GitHub URL、未知字段、规模/Token 不匹配、重复任务、超 Token、超工时、悬空依赖和循环依赖，以及模板模式的稳定输出和预算边界。

## 版本策略

v1 允许在不改变既有数据含义的前提下补充文档和测试。新增必填字段、删除字段、收紧已发布范围或改变字段语义属于破坏性变化，必须新建 v2 Schema、fixture、消费者测试和迁移说明；不得原地改写 v1。
