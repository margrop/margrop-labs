# Analytics 规范

## 目标

回答：读者是否从文章进入 Lab、是否完成第一次运行、是否导出、是否访问源码或返回文章。

## 允许采集

- 事件名、Lab ID、Lab 版本；
- 页面路径；
- 粗粒度设备类别；
- 成功/失败/降级状态；
- 不含正文的粗粒度性能桶。

## 禁止采集

- 表单值、仓库 URL、日志、SMART 输出；
- AI Prompt、AI Response；
- IP、域名、主机名、序列号；
- 导出文件内容；
- 输入长度等可用于推断敏感信息的高精度字段。

Analytics 不是发布阻塞项；无法满足最小化要求时保持关闭。

## Token Forge v1

P1-006 使用独立的
[`token-forge-event-v1.schema.json`](../schemas/token-forge-event-v1.schema.json) 收紧
首个正式 Lab 的事件面。它只保留事件名、Lab ID、Lab 版本和粗粒度设备类别，不包含页面
路径、状态详情、性能桶或任意自由文本。

允许事件为 `lab_open`、`run_success`、`run_failure`、`export`、`blog_click` 和
`github_click`。P1-012 的样例选择不增加独立事件；一键模板成功或失败仍只映射为
`run_success` / `run_failure`，复制和下载共用 `export`。

P4-003 完成前默认接收器为空：不发送、不存储、不记录。未来接入必须在同一 Schema 和允许
字段映射之后进行，接收器异常不得影响 Lab 主流程。
