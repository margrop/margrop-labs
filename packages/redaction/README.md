# Redaction package

预留浏览器端脱敏和敏感输入检测。

首批覆盖：IP、域名、邮箱、Token、Cookie、Authorization、主机名、序列号、WWN 和 MAC。策略是先映射允许字段，再执行模式脱敏；未知字段默认丢弃。
