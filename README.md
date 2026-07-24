# Margrop Labs

> 魔都水滴实验室：把技术文章变成可以立即体验、验证和分享的互动工具。

`margrop-labs` 是 [blog.margrop.net](https://blog.margrop.net/) 的互动实验层。博客负责解释“为什么”，Labs 负责让读者“马上试一下”，GitHub 负责公开实现、规则和验证过程。

计划部署入口：`https://lab.margrop.net`（尚未上线）。

## 首批实验

| 实验 | 用户价值 | 状态 |
|---|---|---|
| [Token 任务炼金炉](./labs/token-forge/) | 把闲置 Token、仓库上下文和目标转换为可验收的开发任务 | Proposed |
| [AI 故障侦探](./labs/incident-detective/) | 在合成事故中练习按证据排障，而不是让 AI 猜根因 | Proposed |
| [SMART / RMA 报告机](./labs/smart-rma/) | 本地解析并脱敏硬盘信息，生成健康解释与售后材料 | Proposed |

## 产品原则

1. **确定性内核，AI 增强**：解析、计算、脱敏和安全判断由代码负责；AI 用于理解、解释、生成案例和提出下一步。
2. **隐私优先**：敏感原始输入尽量只在浏览器处理；服务端默认不记录输入正文。
3. **样例先行**：所有实验必须提供无需登录、无需真实数据、无需消耗 AI 额度的合成演示。
4. **证据可见**：AI 结论必须能追溯到规则、输入摘要或引用证据。
5. **成本有上限**：每次 AI 调用都有模型、Token、超时、频率和输出大小限制。
6. **文章双向关联**：每个实验链接相关文章；相关文章提供明确的“在线体验”入口。
7. **可访问、可分享**：移动端可用、键盘可操作、结果可导出，但分享链接不得携带敏感原文。

## 预期架构

```text
apps/
├── web/          # Labs 门户与互动页面
└── api/          # 可选 AI 网关、限流与公开仓库读取
labs/             # 每个实验的产品合同、样例和专属规则
packages/         # UI、契约与安全相关公共模块
schemas/          # 版本化 JSON Schema
docs/             # 架构、隐私、成本和博客集成规范
```

Web 端优先采用适合静态内容和交互岛的 TypeScript 技术栈；服务端通过稳定 HTTP 合同解耦。具体框架和部署平台在实现前通过 ADR 确认。

## 开始贡献

- 开发 Agent：先读 [AGENTS.md](./AGENTS.md)。
- 选择任务：从 [TODO.md](./TODO.md) 取一个未阻塞条目。
- 使用闲置 Token：遵循 [Token 工作流](./docs/token-workflow.md)。
- 新增实验：遵循 [实验规范](./docs/lab-standard.md)。
- 接入 AI：先读 [AI 成本与安全](./docs/ai-safety-and-cost.md)。
- 处理用户输入：先读 [隐私模型](./docs/privacy-model.md)。

## 当前状态

项目处于 **scaffold / pre-alpha**。当前仓库仅建立产品与工程合同，尚无可部署网站，也不会向用户暗示任何实验已经可用。
