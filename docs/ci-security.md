# CI 与仓库安全门

P0-008 把版本固定、依赖扫描、秘密扫描和 Schema 验证接入仓库唯一质量命令。它不增加
运行时服务、浏览器代码、存储、Analytics 或 AI 调用。

## 单一入口

本地和 GitHub Actions 都执行：

```bash
npm ci
npm run validate
```

`validate` 依次检查格式、仓库安全、依赖漏洞、lint、类型、测试、构建和静态产物。Workflow
不得复制另一套安全规则；具体实现位于
[`scripts/security/repository-security.mjs`](../scripts/security/repository-security.mjs)。

## 固定版本

- `.nvmrc` 和所有 workspace 的 `engines.node` 固定为同一个完整 Node.js 版本；
- 根 `packageManager` 与 `engines.npm` 固定同一个完整 npm 版本；
- 直接依赖必须使用完整版本，传递依赖由唯一根 `package-lock.json` 固定；
- `actions/checkout` 与 `actions/setup-node` 使用完整 40 位提交 SHA，而不是可漂移标签；
- Checkout 获取 PR 历史，但不把 GitHub 凭据留给后续 npm 脚本。

版本更新必须通过独立 PR，重新执行完整质量门，不能用放宽扫描或跳过测试的方式升级。

## 依赖扫描

`npm run security:dependencies` 对完整生产与开发依赖树执行
`npm audit --audit-level=high`。High 或 Critical 漏洞阻断 PR；较低等级仍会显示在输出中，
应建立后续修复任务。

P0-008 同时把 ESLint 更新到不再引入已知 `brace-expansion` High 风险的依赖链。安全更新
仍需要通过现有 lint、类型、测试和构建，不能只依赖审计结果。

## 秘密扫描

扫描器检查：

- Git 已跟踪及未忽略的新文本文件；
- 相对 `origin/main` 新增的最多 100 个提交补丁；无法解析基线时检查 `HEAD`；
- 私钥头、GitHub Token、常见 Provider `sk-` Key、AWS Access Key、JWT、Bearer Token
  和常见 Secret 赋值。

报告只输出规则和文件/行列位置，不回显疑似秘密。`synthetic`、`example`、`placeholder`
等明确测试标记允许用于合成 fixture；真实值不能通过路径或注释豁免。二进制文件和超过
5 MiB 的单个文本文件不做内容扫描，因此大文件引入必须单独评审；该规则扫描是 CI 防线，
不能替代 Provider 轮换、GitHub Secret Scanning 或泄露后的密钥吊销。

## Schema 门

仓库安全命令使用 AJV 2020-12 strict 模式：

- 编译 `schemas/` 的所有公开 Schema 和 Lab 的内部 Schema；
- 拒绝缺少 Draft 2020-12 声明、缺少 `$id` 或 `$id` 重复；
- 校验登记的有效 fixture、canonical 文档和三个 `lab.json`；
- 错误只报告合同路径，不输出 Provider Secret。

新增 Schema fixture 时必须登记到脚本的 `fixtureContracts`。公共 Schema 破坏性修改仍须
创建新版本、同步消费者测试与迁移说明。

## CI 与部署边界

`Quality` 在每个 Pull Request 和 `main` Push 上以只读权限执行完整 `npm run validate`，
且没有任何部署步骤。`Deploy Cloudflare Workers` 也先通过同一质量门：

- `main` Push 和手动 `preview` 只允许部署 Preview；
- Production 的 dry-run、部署、smoke 和 URL 记录均要求仓库所有者显式选择
  `workflow_dispatch: production`；
- 自动 Preview 失败不会进入 Production。

仓库合并策略必须把 `Validate` 作为必过检查；P0-008 的 PR 本身也必须在检查成功后才能
合并。
