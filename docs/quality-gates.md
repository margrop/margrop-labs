# 质量门

P0-003 建立仓库级 npm workspace 和唯一验证入口。

## 本地要求

- Node.js：读取根目录 `.nvmrc`，当前为 24；
- npm：10 或更高；
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
| `npm run build` | 生成生产静态站点 |
| `npm run verify:static` | 验证静态 SEO 和 Hydration 合同 |
| `npm run validate` | 按上述顺序执行全部质量门 |

开发者和 CI 必须调用同一个 `npm run validate`，不得在 Workflow 里维护另一套检查。

## CI

`.github/workflows/quality.yml` 在 Pull Request 和 `main` Push 时执行，权限仅为 `contents: read`。它使用锁文件安装依赖，不接触 AI Key，不部署站点。

## 测试边界

本任务只为现有 Hello Lab 抽取并测试确定性 Token 档位函数，没有新增正式 Lab 业务。后续每个 Lab 的纯函数放在对应源码附近，测试文件使用 `*.test.ts`。
