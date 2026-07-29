# AI 面试工作台真实文本输入威胁模型 v1

## 数据流

```text
用户粘贴纯文本
  → 浏览器内存中的长度/字符/受保护属性检查
  → 本地确定性 Resume/JD/Requirement/Evidence v1
  → 本地匹配、计划、记录、结论和安全导出
  → 用户显式点击 AI
  → operation-specific allowlist 投影
  → 既有 Worker / Provider
```

原文只允许存在于第一段浏览器内存路径。任何网络请求、URL、Analytics、日志和导出均不是
原文的允许目的地。

## 威胁与控制

| 威胁 | 入口 | 控制 | 失败行为 |
| --- | --- | --- | --- |
| XSS / HTML 注入 | 简历或 JD 文本 | 只按文本解析；Preact 文本节点渲染；不使用 `innerHTML` | 拒绝纯标记输入，其他标记不执行 |
| 提示注入 | “忽略规则”“system prompt”等文本 | 解析器不执行指令；AI 请求不含原文 | 保留本地流程，原文不发送 |
| 受保护属性 | 年龄、性别、婚育、民族、健康等 | 本地模式检测并拒绝生成 bundle | 显示固定错误，不回显内容 |
| Secret / 联系方式 | Token、Cookie、邮箱、电话、证件号 | 本地允许存在；跨边界前 allowlist + redaction | 投影验证失败关闭 |
| 超大输入 | 粘贴大量文本 | 每项 UTF-8 最大 32 KiB | 拒绝并保留上一版结果 |
| 控制字符 | NUL、不可见控制序列 | NUL 拒绝；允许的换行/制表外控制字符移除 | 固定错误或规范化 |
| 路径穿越 / 恶意文件 | 文件名、压缩包、Office/PDF | 首期无文件入口、无文件系统 API | 不可到达 |
| 原文持久化 | Storage、Cookie、URL、缓存 | 不调用相关 API；刷新/清除销毁状态 | 回到合成样例 |
| 日志泄漏 | 异常、Worker 日志、Analytics | 错误只含固定代码；事件 Schema 无正文 | 请求拒绝，不记录正文 |
| 自动招聘决策 | 匹配或 AI 输出 | unknown 不为负分；`automatic_decision: false`；人工确认 | Schema/语义验证失败关闭 |

## 信任边界

1. **不可信原文区**：两个 textarea 与组件内存状态；不得直接用于 HTML、URL、日志或请求。
2. **本地验证区**：确定性解析器和版本化 Schema；输出仍为 sensitive，但允许驱动本地 UI。
3. **跨边界投影区**：操作专属 allowlist、脱敏和 Schema；只有此区输出允许发送。
4. **服务端运行时区**：既有请求上限、匿名限流、预算、超时、熔断和输出 Schema。

## 验收证据

- 单元测试覆盖有效/无效、空输入、超限、NUL、XSS、提示注入和受保护属性；
- 单元测试证明原文、联系方式、Secret 和受保护属性不进入 AI 投影；
- Chromium 覆盖录入、生成、清除、合成恢复、移动端和 AI 降级；
- 仓库安全扫描覆盖新 Schema 与 fixture；
- 根目录 `npm run validate` 和 Preview smoke 通过后才完成 P5-013。
