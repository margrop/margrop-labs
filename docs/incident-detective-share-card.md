# Incident Detective 隐私分享结果卡

P2-006 把已验证的 Score v1 投影为一个可本地下载的 SVG 分享卡。分享链路不会读取 Scenario、
Attempt、证据 Payload、内部答案或评分 Findings。

## 最小合同

[`incident-detective-share-card-v1`](../schemas/incident-detective-share-card-v1.schema.json)
只包含：

- 固定 Lab ID；
- 合成案例 ID；
- 0–100 总分与等级；
- 每个维度的 ID、公开标签、得分和上限；
- 四个固定隐私声明。

隐私声明明确表示只含合成分数，且不含 Attempt 文本、证据 Payload 或答案。Schema 拒绝额外
字段，所以用户假设、下一步、Strengths、Improvements、逐条 Findings、事故标题、日志和查询
结果都不能进入分享对象。

## 本地流程

1. 用户完成一局并得到已验证的 Score v1；
2. `createIncidentDetectiveShareCard(score)` 只投影允许字段；
3. 分享合同重新对账维度上限、维度得分、总分和等级；
4. `renderIncidentDetectiveShareCardSvg(card)` 转义所有标签并生成独立 SVG；
5. 浏览器使用临时 Object URL 下载固定安全文件名；
6. 下载后立即撤销 Object URL。

过程不访问网络、不使用 Local Storage、不调用 AI、不写 Analytics，也不生成时间戳、随机 ID
或可追踪用户标识。相同 Score v1 始终生成相同 SVG。

## SVG 内容

1200×630 卡片包含：

- Margrop Labs / Incident Detective 固定品牌文字；
- 案例 ID；
- 总分和四档等级；
- 各维度进度条；
- “完全合成、仅分享结构化分数”的固定说明；
- `lab.margrop.net` 固定入口。

卡片不包含脚本、外链资源或嵌入字体。维度标签先做 XML 转义，避免 SVG 注入。

## 验证

自动化覆盖最小字段投影、总分对账、额外文本字段拒绝、确定性 SVG、XML 转义、安全文件名、
无副作用，以及工作台只把 `score` 而不是 `attempt` 传给分享构建器。
