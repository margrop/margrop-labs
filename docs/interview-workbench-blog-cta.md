# AI 面试工作台博客 CTA v1

P5-009 提供一套固定、可复制、可验证的合成 Alpha 内容入口。唯一内容源是
[`interview-workbench-cta.json`](../labs/interview-workbench/integrations/interview-workbench-cta.json)，
并由
[`interview-workbench-blog-cta-v1.schema.json`](../schemas/interview-workbench-blog-cta-v1.schema.json)
约束。

## 已提交片段

- 中段：[`interview-workbench-cta-inline.md`](../labs/interview-workbench/integrations/interview-workbench-cta-inline.md)；
- 文末：[`interview-workbench-cta-footer.md`](../labs/interview-workbench/integrations/interview-workbench-cta-footer.md)。

复制时保留 `interview-workbench-cta:v1:*:start/end` 标记，每篇文章最多各放一次。实际博客
仓库修改不属于本仓库 P5-009 范围，应在内容仓库单独提交并完成手机与桌面预览。

## 固定链接与隐私

v1 只允许正式 Lab、Lab 源码和面试路线图三个固定 HTTPS URL；禁止查询参数、fragment、
`utm_*`、`from`、`ref`、`source` 或文章/用户派生数据。CTA 不包含脚本、Cookie、像素、
简历、岗位说明、问题、记录、Prompt 或 Response。

Renderer 不调用网络、不读写存储、不输出日志，也不消耗 AI Token。破坏字段、链接或标记
兼容性时必须新增 v2 Schema 与迁移说明。
