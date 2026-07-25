import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  type AllowedFieldMap,
  SanitizationError,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import exportSchema from "../../../../schemas/token-forge-export-v1.schema.json";
import { normalizeMarkdownFileName } from "./export-safety";
import {
  type TokenForgeInput,
  type TokenForgePlan,
  type TokenForgeTask,
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";

export const tokenForgeExportLimits = Object.freeze({
  maxArtifactBytes: 128 * 1024,
  maxIssueBodyBytes: 64 * 1024,
});

export type TokenForgeMarkdownArtifact = {
  file_name: string;
  mime_type: "text/markdown;charset=utf-8";
  content: string;
  content_bytes: number;
};

export type TokenForgeIssueDraft = {
  task_id: string;
  title: string;
  body: string;
  body_bytes: number;
};

export type TokenForgeExportBundle = {
  schema_version: "1.0";
  markdown: TokenForgeMarkdownArtifact;
  github_issues: TokenForgeMarkdownArtifact & {
    issues: TokenForgeIssueDraft[];
  };
};

export type TokenForgeExportErrorCode =
  "invalid_plan" | "sensitive_content" | "export_too_large" | "invalid_export";

const exportErrorMessages: Record<TokenForgeExportErrorCode, string> = {
  invalid_plan: "Token Forge export requires a valid input and plan.",
  sensitive_content: "Token Forge export rejected Secret material.",
  export_too_large: "Token Forge export exceeded a deterministic size limit.",
  invalid_export: "Token Forge export failed its output contract.",
};

export class TokenForgeExportError extends Error {
  override name = "TokenForgeExportError";

  constructor(readonly code: TokenForgeExportErrorCode) {
    super(exportErrorMessages[code]);
  }
}

const exportPlanPolicy = {
  schema_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  mode: {
    required: true,
    rule: { type: "enum", values: ["template", "ai-assisted"] },
  },
  tasks: {
    required: true,
    rule: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        fields: {
          id: {
            required: true,
            rule: { type: "text", maxLength: 100 },
          },
          size: {
            required: true,
            rule: { type: "enum", values: ["S", "M", "L"] },
          },
          title: {
            required: true,
            rule: { type: "text", maxLength: 100 },
          },
          estimated_tokens: {
            required: true,
            rule: {
              type: "number",
              integer: true,
              minimum: 2_000,
              maximum: 60_000,
            },
          },
          estimated_hours: {
            required: true,
            rule: { type: "number", minimum: 0.5, maximum: 80 },
          },
          dependencies: {
            required: true,
            rule: {
              type: "array",
              maxItems: 8,
              items: { type: "text", maxLength: 100 },
            },
          },
          scope: {
            required: true,
            rule: {
              type: "object",
              fields: {
                included: {
                  required: true,
                  rule: {
                    type: "array",
                    maxItems: 10,
                    items: { type: "text", maxLength: 300 },
                  },
                },
                excluded: {
                  required: true,
                  rule: {
                    type: "array",
                    maxItems: 10,
                    items: { type: "text", maxLength: 300 },
                  },
                },
              },
            },
          },
          prompt: {
            required: true,
            rule: { type: "text", maxLength: 4_000 },
          },
          acceptance_criteria: {
            required: true,
            rule: {
              type: "array",
              maxItems: 10,
              items: { type: "text", maxLength: 300 },
            },
          },
        },
      },
    },
  },
  unknowns: {
    required: true,
    rule: {
      type: "array",
      maxItems: 10,
      items: { type: "text", maxLength: 300 },
    },
  },
  safety_notes: {
    required: true,
    rule: {
      type: "array",
      maxItems: 10,
      items: { type: "text", maxLength: 300 },
    },
  },
} as const satisfies AllowedFieldMap;

const textEncoder = new TextEncoder();
const utf8Length = (value: string): number =>
  textEncoder.encode(value).byteLength;

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const pathPlaceholder = "[REDACTED:FILE_PATH]";
const pathToken = String.raw`[A-Za-z0-9_.@%+~-]+`;
const knownFileExtension = String.raw`(?:astro|conf|config|css|csv|go|gradle|html|ini|java|js|json|jsonc|jsx|kt|log|md|mjs|php|properties|py|rb|rs|sh|sql|toml|ts|tsx|txt|vue|xml|ya?ml)`;

const filePathPatterns = [
  new RegExp(
    String.raw`(^|[\s("'=])(?:[A-Za-z]:[\\/](?:${pathToken}[\\/])*${pathToken})`,
    "g",
  ),
  new RegExp(String.raw`(^|[\s("'=])(?:\/${pathToken}){2,}`, "g"),
  new RegExp(
    String.raw`(^|[\s("'=])(?:\.{1,2}[\\/](?:${pathToken}[\\/])*${pathToken})`,
    "g",
  ),
  new RegExp(
    String.raw`(^|[\s("'=])(?:(?:apps|config|docs|labs|packages|public|schemas|scripts|src|test|tests)[\\/](?:${pathToken}[\\/])*${pathToken})`,
    "gi",
  ),
  new RegExp(
    String.raw`(^|[\s("'=])(?:(?:${pathToken}[\\/])+${pathToken}\.${knownFileExtension})`,
    "gi",
  ),
  new RegExp(
    String.raw`(^|[\s("'=])(?:Dockerfile|Makefile|README(?:\.[A-Za-z0-9_-]+)?|${pathToken}\.${knownFileExtension})(?=$|[\s,，;；:：)"'])`,
    "gi",
  ),
];

const redactFilePaths = (value: string): string =>
  filePathPatterns.reduce(
    (result, pattern) =>
      result.replace(pattern, (_match: string, prefix: string) => {
        return `${prefix}${pathPlaceholder}`;
      }),
    value,
  );

const sanitizeTextForExport = (value: string): string =>
  redactFilePaths(value).replace(/\r\n?/g, "\n").trim();

const sanitizeTaskForExport = (task: TokenForgeTask): TokenForgeTask => ({
  ...task,
  title: sanitizeTextForExport(task.title),
  scope: {
    included: unique(task.scope.included.map(sanitizeTextForExport)),
    excluded: unique(task.scope.excluded.map(sanitizeTextForExport)),
  },
  prompt: sanitizeTextForExport(task.prompt),
  acceptance_criteria: unique(
    task.acceptance_criteria.map(sanitizeTextForExport),
  ),
});

const sanitizePlanForExport = (
  input: TokenForgeInput,
  plan: TokenForgePlan,
): TokenForgePlan => {
  let sanitized: unknown;
  try {
    sanitized = sanitizeAllowedFields(plan, exportPlanPolicy).value;
  } catch (error) {
    if (
      error instanceof SanitizationError &&
      error.code === "sensitive-input"
    ) {
      throw new TokenForgeExportError("sensitive_content");
    }
    throw new TokenForgeExportError("invalid_plan");
  }

  const mapped = sanitized as unknown as TokenForgePlan;
  const exportPlan: TokenForgePlan = {
    ...mapped,
    tasks: mapped.tasks.map(sanitizeTaskForExport),
    unknowns: unique(mapped.unknowns.map(sanitizeTextForExport)),
    safety_notes: unique(mapped.safety_notes.map(sanitizeTextForExport)),
  };

  try {
    return validateTokenForgePlan(input, exportPlan);
  } catch {
    throw new TokenForgeExportError("invalid_export");
  }
};

const normalizeInline = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const neutralizeGitHubReferences = (value: string): string =>
  value
    .replace(/@(?=[\p{L}\p{N}_-])/gu, "@\u200b")
    .replace(/#(?=\d)/g, "#\u200b");

const escapeMarkdownInline = (value: string): string =>
  neutralizeGitHubReferences(normalizeInline(value))
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_[\]{}()#+\-.!|])/g, "\\$1");

const renderList = (items: readonly string[]): string =>
  items.map((item) => `- ${escapeMarkdownInline(item)}`).join("\n");

const renderDependencies = (dependencies: readonly string[]): string =>
  dependencies.length === 0
    ? "- 无"
    : dependencies.map((dependency) => `- \`${dependency}\``).join("\n");

const renderFencedText = (value: string): string => {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(value.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}text\n${neutralizeGitHubReferences(value)}\n${fence}`;
};

const formatInteger = (value: number): string =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const formatHours = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const modeLabel = (mode: TokenForgePlan["mode"]): string =>
  mode === "template" ? "确定性模板" : "AI 辅助（已重新验证）";

const totalTokens = (plan: TokenForgePlan): number =>
  plan.tasks.reduce((total, task) => total + task.estimated_tokens, 0);

const totalHours = (plan: TokenForgePlan): number =>
  plan.tasks.reduce((total, task) => total + task.estimated_hours, 0);

const renderTaskMarkdown = (task: TokenForgeTask, index: number): string =>
  [
    `## 任务 ${index + 1}：${escapeMarkdownInline(task.title)}`,
    "",
    `- ID：\`${task.id}\``,
    `- 规模：${task.size}`,
    `- 预计 Token：${formatInteger(task.estimated_tokens)}`,
    `- 预计工时：${formatHours(task.estimated_hours)} 小时`,
    "",
    "### 依赖",
    "",
    renderDependencies(task.dependencies),
    "",
    "### 包含范围",
    "",
    renderList(task.scope.included),
    "",
    "### 排除范围",
    "",
    renderList(task.scope.excluded),
    "",
    "### Agent Prompt",
    "",
    renderFencedText(task.prompt),
    "",
    "### 验收标准",
    "",
    renderList(task.acceptance_criteria),
  ].join("\n");

const buildPlanMarkdown = (plan: TokenForgePlan): string =>
  [
    "# Token Forge 任务计划",
    "",
    `> 生成方式：${modeLabel(plan.mode)}`,
    `> 任务数量：${plan.tasks.length}`,
    `> 预计总 Token：${formatInteger(totalTokens(plan))}`,
    `> 预计总工时：${formatHours(totalHours(plan))} 小时`,
    "",
    ...plan.tasks.flatMap((task, index) => [
      renderTaskMarkdown(task, index),
      "",
    ]),
    "## 未知项",
    "",
    ...(plan.unknowns.length > 0
      ? [renderList(plan.unknowns)]
      : ["- 无额外未知项"]),
    "",
    "## 安全说明",
    "",
    renderList(plan.safety_notes),
    "",
    "---",
    "",
    "由 Margrop Labs Token Forge 本地导出。导出内容不包含仓库 URL、文件路径、Provider 元数据或隐藏服务端指令。",
    "",
  ].join("\n");

const buildIssueBody = (task: TokenForgeTask, plan: TokenForgePlan): string =>
  [
    "## 任务",
    "",
    `- ID：\`${task.id}\``,
    `- 规模：${task.size}`,
    `- 预计 Token：${formatInteger(task.estimated_tokens)}`,
    `- 预计工时：${formatHours(task.estimated_hours)} 小时`,
    `- 生成方式：${modeLabel(plan.mode)}`,
    "",
    "## 依赖",
    "",
    renderDependencies(task.dependencies),
    "",
    "## 包含范围",
    "",
    renderList(task.scope.included),
    "",
    "## 排除范围",
    "",
    renderList(task.scope.excluded),
    "",
    "## Agent Prompt",
    "",
    renderFencedText(task.prompt),
    "",
    "## 验收标准",
    "",
    renderList(task.acceptance_criteria),
    "",
    "## 计划未知项",
    "",
    ...(plan.unknowns.length > 0
      ? [renderList(plan.unknowns)]
      : ["- 无额外未知项"]),
    "",
    "## 安全说明",
    "",
    renderList(plan.safety_notes),
    "",
    "---",
    "",
    "由 Margrop Labs Token Forge 本地生成；提交 Issue 前请人工确认范围。",
    "",
  ].join("\n");

const buildIssueTitle = (task: TokenForgeTask): string =>
  neutralizeGitHubReferences(
    `[Token Forge][${task.size}] ${normalizeInline(task.title)}`,
  )
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .slice(0, 256);

const buildIssueDrafts = (plan: TokenForgePlan): TokenForgeIssueDraft[] =>
  plan.tasks.map((task) => {
    const body = buildIssueBody(task, plan);
    const bodyBytes = utf8Length(body);
    if (bodyBytes > tokenForgeExportLimits.maxIssueBodyBytes) {
      throw new TokenForgeExportError("export_too_large");
    }

    return {
      task_id: task.id,
      title: buildIssueTitle(task),
      body,
      body_bytes: bodyBytes,
    };
  });

const buildIssueBundleMarkdown = (
  issues: readonly TokenForgeIssueDraft[],
): string =>
  [
    "# Token Forge · GitHub Issue 草稿",
    "",
    "> 以下内容不会自动写入 GitHub。请逐条复制标题和正文，并在提交前人工确认。",
    "",
    ...issues.flatMap((issue, index) => [
      `## Issue ${index + 1} · \`${issue.task_id}\``,
      "",
      "### 标题",
      "",
      issue.title,
      "",
      "### 正文",
      "",
      issue.body,
      "",
      "---",
      "",
    ]),
  ].join("\n");

const buildArtifact = (
  fileName: string,
  content: string,
): TokenForgeMarkdownArtifact => {
  const normalizedFileName = normalizeMarkdownFileName(fileName);
  const contentBytes = utf8Length(content);
  if (contentBytes > tokenForgeExportLimits.maxArtifactBytes) {
    throw new TokenForgeExportError("export_too_large");
  }

  return {
    file_name: normalizedFileName,
    mime_type: "text/markdown;charset=utf-8",
    content,
    content_bytes: contentBytes,
  };
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

const validateExportSchema: ValidateFunction<TokenForgeExportBundle> =
  ajv.compile(exportSchema as AnySchema);

export const validateTokenForgeExport = (
  candidate: unknown,
): TokenForgeExportBundle => {
  if (!validateExportSchema(candidate)) {
    throw new TokenForgeExportError("invalid_export");
  }

  const bundle = candidate as TokenForgeExportBundle;
  const artifacts = [bundle.markdown, bundle.github_issues];
  if (
    artifacts.some(
      (artifact) =>
        artifact.file_name !== normalizeMarkdownFileName(artifact.file_name) ||
        artifact.content_bytes !== utf8Length(artifact.content),
    ) ||
    bundle.github_issues.issues.some(
      (issue) => issue.body_bytes !== utf8Length(issue.body),
    )
  ) {
    throw new TokenForgeExportError("invalid_export");
  }

  return bundle;
};

export const buildTokenForgeExports = (
  inputCandidate: unknown,
  planCandidate: unknown,
): TokenForgeExportBundle => {
  let input: TokenForgeInput;
  let plan: TokenForgePlan;
  try {
    input = validateTokenForgeInput(inputCandidate);
    plan = validateTokenForgePlan(input, planCandidate);
  } catch {
    throw new TokenForgeExportError("invalid_plan");
  }

  const exportPlan = sanitizePlanForExport(input, plan);
  const markdown = buildArtifact(
    "token-forge-plan.md",
    buildPlanMarkdown(exportPlan),
  );
  const issues = buildIssueDrafts(exportPlan);
  const issueArtifact = buildArtifact(
    "token-forge-github-issues.md",
    buildIssueBundleMarkdown(issues),
  );

  return validateTokenForgeExport({
    schema_version: "1.0",
    markdown,
    github_issues: {
      ...issueArtifact,
      issues,
    },
  });
};
