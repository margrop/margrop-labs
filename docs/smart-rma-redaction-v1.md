# SMART / RMA 本地脱敏与边界投影 v1

P3-003 为 `/smart-rma/` 增加两层确定性隐私边界：

1. 浏览器内生成可人工检查的脱敏文本预览；
2. 为未来 AI 与导出生成无自由文本的
   [`smart-rma-boundary-projection-v1`](../schemas/smart-rma-boundary-projection-v1.schema.json)。

原始 `smartctl` 文本只存在于当前组件内存，不进入 URL、Local Storage、日志、Analytics、
AI 请求或导出。修改输入会立即清除旧的解析结果和脱敏预览；重置只恢复公开合成样例。

## 本地脱敏预览

输入先通过 P3-002 的 smartctl 格式和 64 KiB 上限，再由
[`@margrop-labs/redaction`](../packages/redaction/README.md) 同步处理。当前明确覆盖：

- `Serial Number`、`Device Serial No.`、`SerialNumber`、`S/N`、`SN` 等有标签序列号；
- `WWN`、`WWN Device Id`、`LU WWN Device Id` 与 `World Wide Name`；
- `Host`、`Host Name`、`Hostname`、`Computer Name`、`Node Name`、`System Name` 和域名；
- 合法 IPv4、压缩或完整 IPv6；
- 邮箱、Authorization、Cookie 与常见有标签 Token，作为纵深防御。

大小写、空格、横线、下划线以及 `:`、`=` 分隔符均有合成测试。重复标识逐次替换为固定占位
符，不保留原值长度、前后缀、哈希或位置。脱敏报告只包含类型和数量；主机名与域名统一计入
`domain`。

本地预览最多 128 KiB，用于容纳固定占位符可能带来的扩张。预览不提供复制、下载或分享
动作；P3-006 的正式导出也只能读取 Boundary Projection，不能读取这段预览文本。

## Boundary Projection v1

投影采用显式字段映射，不展开或透传解析结果。它只包含：

- 协议、设备类别、SMART 支持和 smartctl 报告的总体状态；
- 稳定信号、缺失字段、温度和通电小时；
- 已知 ATA 属性 ID 5、9、187、194、197、198 的数值，不包含属性名称；
- ATA 错误/自检计数和 NVMe 健康计数；
- 各敏感类型的替换数量。

它不包含原始或脱敏文本、型号、固件原文、序列号、WWN、主机名、IP、邮箱、厂商扩展属性
名称、URL、用户标识或时间戳。未知 ATA 属性只保留 `vendor-extension` 信号，不把名称或数值
送出浏览器。

## Sink 最小化

同一个输入不能直接复用于所有边界：

| 边界      | v1 允许内容                                        |
| --------- | -------------------------------------------------- |
| URL       | 固定 Lab ID 与 `workbench` 视图                    |
| 日志      | 固定动作/结果与替换总数，不含正文                  |
| Analytics | 固定事件名与协议枚举；P4-003 前仍无接收器          |
| AI 请求   | 完整 Boundary Projection；P3-005 前不调用 Provider |
| 导出      | 完整 Boundary Projection；P3-006 前不生成用户文件  |

这些投影函数只构造对象，不执行网络、存储、日志或剪贴板操作。

## 失败模型

| 错误码               | 含义                              |
| -------------------- | --------------------------------- |
| `invalid-input`      | 非字符串、空输入或非法文本字符    |
| `input-too-large`    | 原始 UTF-8 输入超过 64 KiB        |
| `unsupported-format` | 缺少受支持的 smartctl 版本横幅    |
| `output-too-large`   | 脱敏预览超过 128 KiB              |
| `invalid-projection` | 解析或投影结果未通过版本化 Schema |

错误消息不回显用户输入。

## 已知边界

模式检测无法可靠区分所有无标签随机字符串和普通文本，因此“替换数量为 0”不是安全证明。安全
主线始终是：原文不离开浏览器、跨边界只使用无自由文本的允许字段投影、Secret 与 Provider
密钥仍由服务端隔离。P3-004 才负责健康分类，P3-005/P3-006 才分别接入 AI 解释和正式导出。

## 验证

测试覆盖全部 7 份 P3-001 合成 fixture，以及重复标签、标签与分隔符变体、含下划线主机名、
IPv4/IPv6、CRLF、Secret、64 KiB 上限、Schema 额外字段拒绝、未知厂商属性丢弃和五类 sink
不含原值。测试同时断言无网络、存储或控制台副作用。
