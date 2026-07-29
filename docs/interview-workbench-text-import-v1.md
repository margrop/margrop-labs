# AI 面试工作台本地文本导入 v1

P5-011 实现经 ADR-0007 批准的纯文本本地导入内核，不包含页面入口和文件解析。

## 输入合同

`interview-text-import-v1` 包含：

- `resume_text`：简历纯文本；
- `jd_text`：岗位 JD 纯文本；
- 每项 UTF-8 最大 32 KiB、至少 20 个字符；
- 原文标记为 `sensitive`，只允许在当前浏览器组件内存中存在。

## 确定性解析

`parseInterviewTextImport` 使用固定规则：

- 从标签和首行提取目标岗位；
- 从固定技术词表提取技能；
- 从职责、任职要求和列表项生成 Requirement Registry；
- 依据要求信号与简历文本的可解释交集生成 Evidence；
- 没有交集时输出 `unknown`，不生成负面事实；
- 最终重新通过 Resume/JD/Requirement/Evidence v1 和 bundle 引用校验。

解析器不会执行 HTML、Markdown、链接或自然语言指令。活动标记和提示注入式行不会参与
结构化结果；受保护属性要求在生成 bundle 前失败关闭。

## 场景合同

`interview-loop-v1` 的 `scenario_kind` 兼容性新增 `local_input`。合成调用继续使用
`buildInterviewSyntheticLoop`；真实文本派生调用使用 `buildInterviewLocalInputLoop`。两者都保持
本地运行、人工确认和禁止自动决策。

## 已知限制

- 首版只支持文本粘贴，不支持 PDF/DOCX；
- 非结构化或复杂排版可能得到保守的 unknown；
- 固定技术词表之外的技能可能需要通过岗位要求文本人工核验；
- 本地解析结果是准备和面试辅助，不是候选人事实认证。
