import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const indexUrl = new URL("../dist/index.html", import.meta.url);
const html = await readFile(fileURLToPath(indexUrl), "utf8");

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
