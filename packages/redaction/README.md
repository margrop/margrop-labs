# Redaction package

`@margrop-labs/redaction` 是浏览器和服务端都可使用的确定性隐私边界。它不访问网络、不记录日志、不持久化输入，也不依赖第三方包。

P0-007 首批覆盖：

- IPv4 与 IPv6；
- URL、公开域名和有标签的内部主机名；
- 邮箱；
- Authorization、Token 与 Cookie；
- 有标签的序列号与 WWN。

## 处理顺序

结构化输入必须调用 `sanitizeAllowedFields`，顺序固定为：

1. 只读取策略声明的允许字段，未知字段直接丢弃；
2. 验证允许字段的类型、长度、数量和数值范围；
3. 对所有自由文本执行模式脱敏；
4. 默认拒绝 Authorization、Token 和 Cookie，不把命中值写入错误；
5. 返回已净化的数据，以及只含类型和数量的脱敏报告。

自由文本可以直接调用 `redactText` 或 `redactTextWithReport`。替换值固定为
`[REDACTED:TYPE]`，不保留原值长度、哈希、前缀或后缀。

```ts
import {
  type AllowedFieldMap,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

const policy = {
  goal_summary: {
    required: true,
    rule: { type: "text", maxLength: 500 },
  },
  token_budget: {
    required: true,
    rule: {
      type: "number",
      integer: true,
      minimum: 2_000,
      maximum: 60_000,
    },
  },
  mode: {
    required: true,
    rule: {
      type: "enum",
      values: ["template", "ai-assisted"],
    },
  },
} as const satisfies AllowedFieldMap;

const sanitized = sanitizeAllowedFields(untrustedInput, policy);
```

策略支持 `text`、`number`、`boolean`、`enum`、`array` 和嵌套 `object`。
自由字符串只能使用 `text` 规则并经过脱敏；已知有限集合使用 `enum`，不存在任意字符串直通规则。

## Secret 处理

`sanitizeAllowedFields` 默认将 Authorization、Token 和 Cookie 视为 Secret 并抛出
`SanitizationError`。错误只包含稳定错误码、策略字段路径和敏感类型，不包含输入值。

只有完全本地、明确需要生成脱敏预览的流程，才可以传入 `{ rejectKinds: [] }`，把 Secret 替换成占位符后继续。网络、AI、日志和 Analytics 边界不得关闭默认拒绝。

## 不同边界的策略

| 边界           | 允许字段                                           |
| -------------- | -------------------------------------------------- |
| URL            | Lab ID、版本化页面状态等有限 `enum`；不放自由文本  |
| 日志与错误追踪 | 状态码、耗时、计数、稳定错误码；不放输入输出正文   |
| Analytics      | Lab ID、打开/运行/导出/点击事件；不放表单字段      |
| AI 请求        | 操作所需的最小数字、枚举和已脱敏文本               |
| 导出           | 用户主动触发，并且只包含允许字段映射后的已脱敏结果 |

同一份原始对象不能直接传给上述边界。调用方必须为具体操作定义最小
`AllowedFieldMap`，并只传递 `sanitizeAllowedFields(...).value`。

## 安全边界

模式检测是纵深防御，不是秘密格式的完整清单。随机字符串、无标签序列号和自定义内部标识无法可靠地与普通文本区分。因此：

- 先按业务 Schema 和允许字段收窄数据，再执行脱敏；
- Secret 字段不得进入允许字段；
- 不得把“没有检测到”解释为“输入一定安全”；
- Provider、模型、密钥和系统提示词继续由 AI Gateway 服务端控制；
- 新增敏感格式时必须添加不回显原文的失败测试。

域名检测对 URL 和 `domain`、`host`、`hostname`、`server` 标签使用严格主机名语法；无标签文本使用保守后缀启发式，并排除常见源文件扩展名，避免把 `index.ts` 当作域名。
