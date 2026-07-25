# SMART / RMA 浏览器解析器 v1

P3-002 在 `/smart-rma/` 提供一个确定性的浏览器端 `smartctl` 解析器。它把文本转换为受
[`smart-rma-parse-result-v1`](../schemas/smart-rma-parse-result-v1.schema.json)
约束的结构化证据，但不负责设备健康分类、完整脱敏、AI 解释或保修判断。

## 输入与执行边界

- 输入必须是以 `smartctl` 版本横幅开头的文本，UTF-8 大小上限为 64 KiB；
- 接受 LF、CRLF 和 CR 换行，拒绝空输入、NUL、替换字符和无法识别的格式；
- 解析在 Preact Island 内同步完成，不发送网络请求；
- 原始文本仅保留在当前组件内存，不进入 URL、Local Storage、日志、Analytics 或 AI；
- 公开页面默认加载 P3-001 的完全合成样例，用户无需登录或提供真实设备数据。

P3-003 才会实现对真实输入的序列号、WWN、主机名和 IP 完整脱敏。在此之前，解析结果主动
不保留原始文本、型号原文、序列号和 WWN，也不提供原文导出。

## 确定性输出

解析结果固定包含：

- `smartctl_version`、ATA/NVMe/未知协议和 HDD/SSD/NVMe/未知设备类别；
- SMART 可用性，以及 `smartctl` 自己报告的 PASSED、FAILED 或未知；
- 温度、通电小时和显式 `missing_fields`；
- 最多 128 个 ATA 属性、错误日志计数和自检失败计数；
- NVMe Critical Warning、备用空间、寿命使用率、介质错误和错误日志条目；
- 按固定顺序输出的 `signals`。

当前识别的 ATA 属性 ID 为 5、9、187、194、197 和 198。其他合法属性仍保留名称与数值，
但标记为 `recognized: false` 并产生 `vendor-extension` 信号；解析器不会依据未知名称或
数值猜测故障。所有输出在返回前重新通过 JSON Schema 校验。

## 三类状态不能混用

1. `reported_overall_health` 只是 `smartctl` 原文中的总体结果；
2. `signals` 是解析到的事实，例如待处理扇区非零或 NVMe 介质错误；
3. P3-004 才会把这些事实映射为健康、注意、危险或未知。

因此，“PASSED 但关键计数非零”会同时保留两类相互冲突的证据，而不会被 P3-002 强行归类。
解析结果也不能被描述成厂商接受 RMA 的承诺。

## 失败模型

公开错误码保持稳定：

| 错误码               | 含义                                  |
| -------------------- | ------------------------------------- |
| `invalid-input`      | 空输入、非法字符或非字符串            |
| `input-too-large`    | UTF-8 输入超过 64 KiB                 |
| `unsupported-format` | 缺少可识别的 `smartctl` 版本横幅      |
| `invalid-result`     | 内部结果未通过 Parse Result v1 Schema |

错误消息不回显输入正文。未知协议、SMART 不可用和字段不完整属于可表达的解析结果，不作为异常。

## 验证

单测按索引顺序运行全部 7 份合成 fixture，并精确断言版本、协议、信号和缺失字段；同时覆盖
ATA/NVMe 数值、未知厂商扩展、CRLF、畸形属性行、大小上限、输出隐私、Schema 拒绝额外字段，
以及无网络、存储或控制台副作用。生产构建还检查页面标题、原生表单控件、隐私文案、合成
样例、可见时 hydration 和移动端重排样式。
