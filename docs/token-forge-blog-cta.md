# Token Forge 博客 CTA v1

P4-005 为 `blog.margrop.net` 和其他 Markdown 渠道提供一套固定、可复制、可验证的
Token Forge 入口。CTA 只负责把已经对 Token 使用产生兴趣的读者带到正式 Lab，不复制
整篇文章，也不承担博客导航改版、SEO 或漏斗复盘。

## 交付物

唯一内容源是版本化合同：

- [`token-forge-cta.json`](../labs/token-forge/integrations/token-forge-cta.json)
- [`token-forge-blog-cta-v1.schema.json`](../schemas/token-forge-blog-cta-v1.schema.json)

从同一合同渲染两种已提交片段：

- [`token-forge-cta-inline.md`](../labs/token-forge/integrations/token-forge-cta-inline.md)：
  放在文章中段，读者已经理解“Token 多但缺任务”的问题之后；
- [`token-forge-cta-footer.md`](../labs/token-forge/integrations/token-forge-cta-footer.md)：
  放在文章结语之后、参考资料之前，补充在线实验、源码和离线模板入口。

两个片段使用稳定的 `token-forge-cta:v1:*:start/end` HTML 注释。复制到博客时必须保留
标记，便于未来准确替换 CTA，而不匹配或改写文章其他内容。

## 推荐位置

对于相关文章
[`codex-four-resets-token-abundance-creativity`](https://blog.margrop.net/post/codex-four-resets-token-abundance-creativity/)：

1. 在“我到底想解决什么问题？”等瓶颈清单之后插入中段片段；
2. 在结语之后、参考资料之前插入文末片段；
3. 每篇文章最多各放一次，不把同一 CTA 塞入连续段落；
4. 发布前在桌面和手机预览中确认引用块、列表和三个链接可见。

P4-005 只生成并冻结片段，不修改外部博客仓库或线上文章。实际插入需要在博客内容仓库中
单独提交，以保留文章版本和回滚记录。博客导航入口属于 P4-006。

## 固定链接和隐私

v1 只允许三个固定 HTTPS URL：

- `https://lab.margrop.net/token-forge/`
- `https://github.com/margrop/margrop-labs/tree/main/labs/token-forge`
- `https://github.com/margrop/margrop-labs/blob/main/docs/token-forge-template-mode.md`

链接不得追加 `utm_*`、`from`、`ref`、`source`、用户输入或文章正文。CTA 不包含脚本、
Cookie、像素、仓库 URL、目标、Prompt、计划、导出或错误内容。打开 Lab 后仍只产生
P4-003 的固定 `lab_open` 事件；它代表打开次数，不代表唯一用户，也不能单独证明来源。

## 更新协议

1. 先修改 JSON 合同；未知字段、可变 URL 和 Markdown 注入会失败关闭；
2. 用确定性 renderer 同步中段和文末片段；
3. 保持 v1 标记、固定链接和无查询参数边界；
4. 从仓库根目录运行 `npm run validate`；
5. 破坏字段或标记兼容性时新增 v2 Schema 和迁移说明，不原地改变 v1。

本能力不调用 AI、不访问网络、不写存储，也不增加模型 Token 或 Production 运行成本。
