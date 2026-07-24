# 博客集成

## 链接闭环

文章中段提供“立即体验”，文章结尾提供“在线实验 / GitHub 源码 / 离线说明”。Lab 页面顶部链接相关文章，结果页提供“为什么这样判断”的深度阅读入口。

## 推荐 URL

- 门户：`https://lab.margrop.net/`
- Token：`/token-forge/`
- 故障侦探：`/incident-detective/`
- SMART：`/smart-rma/`

URL 不得包含用户输入、AI 输出、日志摘要、SMART 属性、仓库文件内容或任何凭据。

## CTA 模板

```markdown
> 🧪 在线实验：不需要安装，也可以使用合成样例体验。
> [打开魔都水滴实验室 →](https://lab.margrop.net/<lab-id>/)
```

## 事件

仅记录 `lab_open`、`sample_load`、`run_success`、`run_failure`、`export`、`blog_click`、`github_click`。事件属性只允许 Lab ID、版本和设备类别。
