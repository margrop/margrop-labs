# SMART / RMA 完全合成 Fixture

P3-001 为 SMART / RMA 报告机建立一套离线、可审计、完全合成的 `smartctl` 文本语料。它的
用途是固定 P3-002 浏览器解析器和 P3-004 健康规则的输入边界，不是设备诊断结果，也不代表
任何厂商的保修判断。

## 目录合同

[`labs/smart-rma/fixtures/index.json`](../labs/smart-rma/fixtures/index.json)
遵循
[`smart-rma-fixture-index-v1`](../schemas/smart-rma-fixture-index-v1.schema.json)：

- `protocol` 标记 ATA、NVMe 或无法识别；
- `smartctl_version` 必须与文本第一行一致；
- `expected_state` 是未来测试使用的预期状态，不在本任务中实现分类逻辑；
- `coverage` 明确记录健康、预警、危险、未知、缺失字段、厂商扩展、SMART 不可用和信号冲突；
- `missing_fields` 记录样本有意缺少的常用字段；
- `expected_signals` 只列出解析器应发现的稳定信号，不携带设备原始标识。

每个 `.txt` 文件必须恰好在索引出现一次。加载器拒绝重复 ID、重复文件引用、未索引文本、
目录穿越、空文件、超过 64 KiB 的文件、CRLF、NUL、无结尾换行和版本不一致。

## 覆盖矩阵

| Fixture                       | 协议    | 预期状态 | 主要边界                                               |
| ----------------------------- | ------- | -------- | ------------------------------------------------------ |
| `ata-healthy-7-4`             | ATA     | 健康     | SMART 通过、关键 ATA 属性为零                          |
| `ata-warning-7-4`             | ATA     | 预警     | 总体通过但重映射、待处理、不可校正扇区和错误日志非零   |
| `ata-vendor-extension-7-3`    | ATA     | 健康     | 标准属性之外包含未知厂商扩展，不能被强行解释为故障     |
| `nvme-healthy-7-4`            | NVMe    | 健康     | Critical Warning 为零、寿命使用率低且无介质错误        |
| `nvme-critical-7-4`           | NVMe    | 危险     | Critical Warning、备用空间、寿命使用率和介质错误同时异常 |
| `sat-smart-unavailable-7-4`   | Unknown | 未知     | USB-SAT 桥不支持必要命令，身份与健康字段不可得         |
| `ata-incomplete-6-5`          | ATA     | 未知     | 较旧 smartctl 版本、识别信息不完整、SMART 状态未知     |

`ata-warning-7-4` 特意保留“总体健康检查通过，但关键原始属性已出现问题”的冲突。未来规则不能
只读取 `PASSED` 就判定健康。厂商扩展样本则验证相反边界：未知属性不能因为名字或数值看起来
特殊就被判为故障。

## 合成与隐私边界

所有型号都以 `MARGROP LABS SYNTHETIC` 开头，序列号必须以 `SYNTHETIC-` 开头，WWN 只允许
全零占位符。样本不来自用户设备、公开工单或厂商数据，不得把真实 SMART 输出复制进此目录。

加载器还会拒绝邮箱、IP、域名、主机名、Authorization、Cookie、Token 和私钥。错误只说明
违反的稳定规则，不回显被拒绝的值。

这套限制保护的是仓库内公共测试语料。P3-003 仍必须对用户在浏览器粘贴的真实文本执行独立
脱敏，原文不得进入 URL、日志、Analytics、AI 请求或导出。

## 后续消费方式

P3-002 应按索引顺序对每个原始文本运行浏览器端解析器，并把 `expected_signals` 与缺失字段
作为确定性断言。解析器必须接受未知字段、保留未识别属性的“未知”语义，并在无法识别协议或
关键字段时失败为 `unknown`，而不是猜测。

P3-004 才负责把解析后的结构化信号映射为健康、预警、危险或未知。若规则需要改变
`expected_state`，必须同时更新规则测试和本索引，并解释迁移原因。
