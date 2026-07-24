# 实验清单加载器

P0-004 将 `labs/*/lab.json` 设为 Labs 首页的唯一内容来源。Astro 在构建首页时读取这些文件，并按 `schemas/lab-manifest-v1.schema.json` 校验；任一目录缺少清单、JSON 无法解析、Schema 不匹配、目录与 `id` 不一致，或出现重复路由时，构建都会失败。

## 首页映射

| Manifest 字段 | 首页输出 |
|---|---|
| `title` / `summary` | 卡片标题和说明 |
| `status` | 中文状态标签 |
| `route` | 计划路由 |
| `input_privacy` | 公开输入、本地优先或敏感输入标签 |
| `ai_mode` | AI 使用方式标签 |
| `related_articles` | 指向 `blog.margrop.net` 的文章链接；空数组显示待补充 |

清单按目录名稳定排序。卡片颜色和序号属于展示信息，不进入 Manifest。

## 依赖说明

- `ajv@8.20.0`：实现 JSON Schema draft 2020-12 校验，MIT，npm 解包大小约 1.03 MB；
- `ajv-formats@3.0.1`：补充 Schema 中 `uri` 格式校验，MIT，npm 解包大小约 57 KB。
- `@types/node@24.13.3`：为构建期文件读取代码提供与 Node 24 对齐的类型，MIT，npm 解包大小约 2.54 MB。

两项依赖只在构建和测试阶段执行，不进入浏览器 Hydration 包。Node.js 标准库只能解析 JSON，不能完整实现 draft 2020-12、`format: uri` 和 Schema 错误定位，因此不重复手写验证器。

## 验证

```bash
npm test
npm run build
npm run verify:static
```

单元测试覆盖有效清单、Schema 错误、目录与 ID 不一致及重复路由。首页构建直接调用同一加载器，因此错误清单会在构建阶段阻断发布。
