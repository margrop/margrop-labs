import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const indexUrl = new URL("../dist/index.html", import.meta.url);
const tokenForgeUrl = new URL(
  "../dist/token-forge/index.html",
  import.meta.url,
);
const incidentDetectiveUrl = new URL(
  "../dist/incident-detective/index.html",
  import.meta.url,
);
const smartRmaUrl = new URL("../dist/smart-rma/index.html", import.meta.url);
const stylesUrl = new URL("../src/styles/global.css", import.meta.url);
const assetsUrl = new URL("../dist/_astro/", import.meta.url);
const html = await readFile(fileURLToPath(indexUrl), "utf8");
const tokenForgeHtml = await readFile(fileURLToPath(tokenForgeUrl), "utf8");
const incidentDetectiveHtml = await readFile(
  fileURLToPath(incidentDetectiveUrl),
  "utf8",
);
const smartRmaHtml = await readFile(fileURLToPath(smartRmaUrl), "utf8");
const styles = await readFile(fileURLToPath(stylesUrl), "utf8");
const assetNames = await readdir(fileURLToPath(assetsUrl));
const clientJavaScript = (
  await Promise.all(
    assetNames
      .filter((name) => name.endsWith(".js"))
      .map((name) => readFile(fileURLToPath(new URL(name, assetsUrl)), "utf8")),
  )
).join("\n");

const checks = [
  ["Chinese language", html.includes('lang="zh-CN"')],
  [
    "indexable title",
    html.includes("<title>Margrop Labs｜魔都水滴实验室</title>"),
  ],
  [
    "meta description",
    html.includes('name="description"') &&
      html.includes("把 AI Agent、Self-hosting、PVE、NAS 与可观测性文章"),
  ],
  ["static H1", html.includes("把技术文章，变成可以")],
  [
    "static Lab cards",
    ["Token 任务炼金炉", "AI 故障侦探", "SMART / RMA 报告机"].every((text) =>
      html.includes(text),
    ),
  ],
  [
    "manifest routes",
    ["/token-forge/", "/incident-detective/", "/smart-rma/"].every((route) =>
      html.includes(route),
    ),
  ],
  [
    "manifest labels",
    ["Alpha", "公开输入", "本地优先", "AI 可选", "含合成样例"].every((label) =>
      html.includes(label),
    ),
  ],
  [
    "live Token Forge route",
    html.includes('href="/token-forge/"') &&
      html.includes("打开实验 · /token-forge/"),
  ],
  [
    "live Incident Detective route",
    html.includes('href="/incident-detective/"') &&
      html.includes("打开实验 · /incident-detective/"),
  ],
  [
    "live SMART / RMA route",
    html.includes('href="/smart-rma/"') &&
      html.includes("打开实验 · /smart-rma/"),
  ],
  [
    "related articles",
    [
      "codex-four-resets-token-abundance-creativity",
      "mysql-prometheus-loki-grafana-ai-agent-hands-on",
      "相关文章待补充",
    ].every((article) => html.includes(article)),
  ],
  [
    "page landmarks",
    [
      'class="skip-link"',
      '<nav aria-label="主导航">',
      '<main id="main-content">',
      "<footer",
    ].every((landmark) => html.includes(landmark)),
  ],
  [
    "native form controls",
    ["<form", "<fieldset", "<legend", 'type="range"', 'type="reset"'].every(
      (control) => html.includes(control),
    ),
  ],
  [
    "accessible field guidance",
    html.includes("aria-describedby=") &&
      html.includes("使用左右方向键微调") &&
      html.includes("使用方向键选择 1–30 天"),
  ],
  [
    "programmatic status messages",
    html.includes('role="status"') &&
      html.includes('aria-atomic="true"') &&
      html.includes("本地计算已就绪"),
  ],
  [
    "non-color evidence labels",
    ["输入证据", "规则依据", "AI 解释", "未知项"].every((label) =>
      html.includes(label),
    ),
  ],
  [
    "real export actions",
    html.includes("复制 Markdown") && html.includes("下载 Markdown"),
  ],
  [
    "visible keyboard focus",
    styles.includes(":focus-visible") &&
      styles.includes("outline: 3px solid var(--amber)"),
  ],
  [
    "touch targets",
    styles.includes("min-height: 44px") &&
      styles.includes('.preview-controls input[type="range"]'),
  ],
  [
    "mobile reflow",
    styles.includes("@media (max-width: 800px)") &&
      styles.includes("@media (max-width: 600px)") &&
      styles.includes("min-width: 320px"),
  ],
  [
    "reduced motion",
    styles.includes("@media (prefers-reduced-motion: reduce)") &&
      styles.includes("scroll-behavior: auto"),
  ],
  ["visible hydration", html.includes('client="visible"')],
  ["no eager hydration", !html.includes('client="load"')],
  [
    "Token Forge indexable page",
    tokenForgeHtml.includes("<title>Token 任务炼金炉｜Margrop Labs</title>") &&
      tokenForgeHtml.includes("把闲置 Token") &&
      tokenForgeHtml.includes("可以验收"),
  ],
  [
    "Token Forge native form",
    tokenForgeHtml.includes('<form class="token-forge-form"') &&
      tokenForgeHtml.includes('name="token_budget"') &&
      tokenForgeHtml.includes('name="expires_in_days"') &&
      tokenForgeHtml.includes('name="available_hours"') &&
      tokenForgeHtml.includes('name="tech_stack"') &&
      tokenForgeHtml.includes('name="repository_url"') &&
      tokenForgeHtml.includes('name="goal"') &&
      tokenForgeHtml.includes("<textarea"),
  ],
  [
    "Token Forge dual planning actions",
    tokenForgeHtml.includes("AI 增强生成") &&
      tokenForgeHtml.includes("仅生成模板") &&
      tokenForgeHtml.includes("载入合成样例"),
  ],
  [
    "Token Forge privacy disclosure",
    [
      "无需登录",
      "公开只读",
      "不发送 GitHub Token",
      "浏览器不含 API Key",
      "仅点击“AI 增强生成”",
      "不保存输入",
    ].every((label) => tokenForgeHtml.includes(label)),
  ],
  [
    "Token Forge optional repository and no AI key field",
    tokenForgeHtml.includes('name="repository_url"') &&
      tokenForgeHtml.includes("https://github.com/owner/repository") &&
      !tokenForgeHtml.includes('name="api_key'),
  ],
  [
    "Token Forge server configuration excluded from browser bundle",
    [
      "api-gpt.speedtest.margrop.net",
      "qwen-latest",
      "minimax-latest",
      "TOKEN_FORGE_AI_BUDGET_MULTIPLIER",
      "TOKEN_FORGE_AI_TRANSPORT",
      "TOKEN_FORGE_AI_API_KEY",
      "TOKEN_FORGE_ACTOR_KEY_SECRET",
      "Return only a Token Forge Plan v1 JSON object",
    ].every((value) => !clientJavaScript.includes(value)),
  ],
  [
    "Token Forge content loop",
    tokenForgeHtml.includes("codex-four-resets-token-abundance-creativity") &&
      tokenForgeHtml.includes(
        "github.com/margrop/margrop-labs/tree/main/labs/token-forge",
      ),
  ],
  [
    "Token Forge visible hydration",
    tokenForgeHtml.includes('client="visible"') &&
      !tokenForgeHtml.includes('client="load"'),
  ],
  [
    "Token Forge responsive controls",
    styles.includes(".token-forge-field-grid") &&
      styles.includes(".token-forge-form input") &&
      styles.includes("min-height: 46px") &&
      styles.includes(".token-forge-task-columns"),
  ],
  [
    "Incident Detective indexable page",
    incidentDetectiveHtml.includes(
      "<title>AI 故障侦探｜Margrop Labs</title>",
    ) &&
      incidentDetectiveHtml.includes("别让 AI 猜根因") &&
      incidentDetectiveHtml.includes("先把证据找齐"),
  ],
  [
    "Incident Detective public scenario",
    [
      "结账搜索变慢：先别重启 MySQL",
      "MySQL 与 Exporter 存活状态",
      "结账搜索延迟趋势",
      "结账请求的合成 Trace 日志",
      "慢查询形态的只读 EXPLAIN",
    ].every((label) => incidentDetectiveHtml.includes(label)),
  ],
  [
    "Incident Detective native controls",
    incidentDetectiveHtml.includes('class="incident-hypothesis"') &&
      incidentDetectiveHtml.includes('name="hypothesis_summary"') &&
      incidentDetectiveHtml.includes('name="suspected_services"') &&
      incidentDetectiveHtml.includes('name="confidence"') &&
      incidentDetectiveHtml.includes('name="next_action"') &&
      incidentDetectiveHtml.includes('name="safety_actions"') &&
      incidentDetectiveHtml.includes("<textarea") &&
      incidentDetectiveHtml.includes("<select"),
  ],
  [
    "Incident Detective local boundary",
    ["完全合成", "不连接监控", "本局不调用", "本地规则评分"].every((label) =>
      incidentDetectiveHtml.includes(label),
    ),
  ],
  [
    "Incident Detective deterministic scoring",
    [
      "确定性规则评分",
      "验证并评分",
      "证据覆盖",
      "取证顺序",
      "结论覆盖",
      "反证意识",
      "安全边界",
    ].every((label) => incidentDetectiveHtml.includes(label)) &&
      !incidentDetectiveHtml.includes("调用 AI 评分"),
  ],
  [
    "Incident Detective public-only client",
    [
      "answer.internal",
      "attempt.canonical",
      "root_cause",
      "required_evidence_ids",
      "evidence_weights",
    ].every((field) => !incidentDetectiveHtml.includes(field)),
  ],
  [
    "Incident Detective visible hydration",
    incidentDetectiveHtml.includes('client="visible"') &&
      !incidentDetectiveHtml.includes('client="load"'),
  ],
  [
    "Incident Detective responsive evidence",
    styles.includes(".incident-evidence-list") &&
      styles.includes(".incident-table-scroll") &&
      styles.includes(".incident-timeline") &&
      styles.includes(".incident-choice-grid") &&
      styles.includes(".incident-safety-grid") &&
      styles.includes(".incident-score-dimensions") &&
      styles.includes(".incident-score-feedback") &&
      styles.includes(".incident-share-actions"),
  ],
  [
    "SMART / RMA indexable page",
    smartRmaHtml.includes("<title>SMART / RMA 报告机｜Margrop Labs</title>") &&
      smartRmaHtml.includes("先看懂 SMART") &&
      smartRmaHtml.includes("再谈健康结论"),
  ],
  [
    "SMART / RMA native controls",
    smartRmaHtml.includes('class="smart-rma-form"') &&
      smartRmaHtml.includes('name="synthetic_sample"') &&
      smartRmaHtml.includes('name="smartctl_text"') &&
      smartRmaHtml.includes("<select") &&
      smartRmaHtml.includes("<textarea") &&
      smartRmaHtml.includes('type="submit"') &&
      smartRmaHtml.includes('type="reset"'),
  ],
  [
    "SMART / RMA synthetic corpus",
    [
      "ATA SSD · 基础正常样例",
      "ATA HDD · PASSED 但关键计数非零",
      "ATA SSD · 未知厂商扩展",
      "NVMe · 基础正常样例",
      "NVMe · Critical Warning 与介质错误",
      "USB-SAT · SMART 不可用",
      "ATA · 旧版本与字段不完整",
    ].every((label) => smartRmaHtml.includes(label)),
  ],
  [
    "SMART / RMA local privacy boundary",
    [
      "仅当前标签页",
      "不上传文本",
      "本阶段不调用",
      "不写入 URL",
      "Local Storage",
      "序列号、WWN、主机名和 IP",
      "无自由文本的允许字段投影",
    ].every((label) => smartRmaHtml.includes(label)),
  ],
  [
    "SMART / RMA local redaction preview",
    [
      "本地解析并脱敏",
      "本地脱敏预览",
      "主机名 / 域名",
      "查看脱敏后的本地文本",
      "[REDACTED:SERIAL_NUMBER]",
      "[REDACTED:WWN]",
      "Boundary Projection v1",
    ].every((label) => smartRmaHtml.includes(label)),
  ],
  [
    "SMART / RMA parse evidence",
    [
      "原始总体状态",
      "解析信号（未判定健康）",
      "未知项 / 缺失字段",
      "ATA 属性",
      "设备类别",
      "SMART 支持",
      "不是健康结论",
      "不是厂商保修判断",
    ].every((label) => smartRmaHtml.includes(label)),
  ],
  [
    "SMART / RMA visible hydration",
    smartRmaHtml.includes('client="visible"') &&
      !smartRmaHtml.includes('client="load"'),
  ],
  [
    "SMART / RMA responsive workbench",
    styles.includes(".smart-rma-shell") &&
      styles.includes(".smart-rma-sample-controls") &&
      styles.includes(".smart-rma-form textarea") &&
      styles.includes(".smart-rma-summary-grid") &&
      styles.includes(".smart-rma-table-scroll") &&
      styles.includes(".smart-rma-nvme-grid") &&
      styles.includes(".smart-rma-redaction-counts"),
  ],
];

const failures = checks.filter(([, passed]) => !passed);

for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
