# 架构

## 数据流

```mermaid
flowchart TD
  A["Browser Input"] --> B["Local Parse + Redact"]
  B --> C["Deterministic Engine"]
  C --> D["Optional AI Gateway"]
  D --> E["Validated Explanation"]
  C --> F["Result + Export"]
  E --> F
```

## 分层

| 层 | 职责 | 禁止 |
|---|---|---|
| Web Shell | SEO 页面、导航、表单、状态与结果展示 | 保存 Provider Key |
| Local Core | 解析、脱敏、规则、计算、导出 | 隐式网络访问 |
| AI Gateway | 最小化请求、限流、预算、Provider 适配 | 记录请求正文 |
| Contracts | Lab、输入、输出、错误的版本化 Schema | 无版本破坏性变化 |
| Content Bridge | 相关文章、CTA、返回博客链接 | 复制整篇博客内容 |

## 仓库边界

`margrop-labs` 负责公众体验和产品合同；`ai-infrastructure-toolkit` 负责可复用基础设施采集与诊断内核。跨仓库集成优先使用版本化 Schema 或发布包，不复制粘贴核心逻辑。

## 失败策略

AI 不可用时仍应提供确定性结果或样例体验。输入无法安全脱敏、输出不符合 Schema、预算耗尽或 Provider 超时时，显示明确降级状态，不猜测补全。
