import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const indexUrl = new URL("../dist/index.html", import.meta.url);
const stylesUrl = new URL("../src/styles/global.css", import.meta.url);
const html = await readFile(fileURLToPath(indexUrl), "utf8");
const styles = await readFile(fileURLToPath(stylesUrl), "utf8");

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
    ["规划中", "公开输入", "本地优先", "AI 可选", "含合成样例"].every((label) =>
      html.includes(label),
    ),
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
];

const failures = checks.filter(([, passed]) => !passed);

for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}

if (failures.length > 0) {
  process.exitCode = 1;
}
