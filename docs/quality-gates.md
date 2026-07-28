# 质量门

P0-003 建立仓库级 npm workspace 和唯一验证入口；P0-008 在同一入口补齐版本、依赖、
Secret 与 Schema 安全门。详细边界见 [CI 与仓库安全门](./ci-security.md)。

## 本地要求

- Node.js：读取根目录 `.nvmrc`，当前固定为 24.14.0；
- npm：读取根 `packageManager`，当前固定为 11.9.0；
- 安装：只在仓库根目录执行 `npm ci`；
- 锁文件：只提交根目录 `package-lock.json`。

## 命令

| 命令 | 作用 |
|---|---|
| `npm run format` | 格式化 Web 源码、配置和 Workflow |
| `npm run format:check` | 检查格式，不修改文件 |
| `npm run lint` | ESLint 检查 JavaScript、TypeScript、TSX 和 Astro |
| `npm run typecheck` | Astro/TypeScript diagnostics |
| `npm test` | 执行 Vitest 单元测试 |
| `npm run security:repository` | 固定版本、PR 历史/工作树 Secret、Schema/fixture 与部署策略 |
| `npm run security:dependencies` | 扫描完整依赖树，High/Critical 阻断 |
| `npm run security` | 依次执行仓库与依赖安全门 |
| `npm run build` | 生成生产静态站点 |
| `npm run verify:static` | 验证静态 SEO 和 Hydration 合同 |
| `npm run validate` | 按上述顺序执行全部质量门 |

开发者和 CI 必须调用同一个 `npm run validate`，不得在 Workflow 里维护另一套检查。

## CI

`.github/workflows/quality.yml` 在 Pull Request 和 `main` Push 时执行，权限仅为
`contents: read`。它使用锁文件安装依赖，不接触 AI Key，不部署站点。Actions 使用不可
漂移的提交 SHA；Checkout 不向 npm 脚本保留 GitHub 凭据。

## 测试边界

Lab 的纯函数放在对应源码附近，测试文件使用 `*.test.ts`。仓库级安全合同放在
`scripts/security/`，测试允许使用 `*.test.js`；测试值必须带明确合成标记，不能提交真实
凭据。
