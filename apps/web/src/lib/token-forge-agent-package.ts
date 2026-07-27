import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import agentPackageSchema from "../../../../schemas/token-forge-agent-package-v1.schema.json";
import { normalizeMarkdownFileName } from "./export-safety";
import {
  type TokenForgeInput,
  type TokenForgePlan,
  type TokenForgeTask,
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";
import {
  TokenForgeExportError,
  sanitizeTokenForgePlanForArtifact,
} from "./token-forge-exports";

export const tokenForgeAgentPackageLimits = Object.freeze({
  maxArtifactBytes: 192 * 1024,
});

export type TokenForgeAgentPackageExecutionPolicy = {
  stage_order: "dependency-safe";
  repository_access: "user-provided-workspace-only";
  command_policy: "discover-confirm-run";
  destructive_actions: "forbidden-without-user-approval";
};

export type TokenForgeAgentPackageStage = {
  stage_number: number;
  task_id: string;
  title: string;
  size: TokenForgeTask["size"];
  estimated_tokens: number;
  estimated_hours: number;
  dependencies: string[];
  agent_prompt: string;
  allowed_context: string[];
  forbidden_context: string[];
  scope: {
    included: string[];
    excluded: string[];
  };
  acceptance_criteria: string[];
  verification_protocol: string[];
  handoff_template: string[];
  failure_recovery: string[];
};

export type TokenForgeAgentPackageArtifact = {
  file_name: "token-forge-agent-package.md";
  mime_type: "text/markdown;charset=utf-8";
  content: string;
  content_bytes: number;
};

export type TokenForgeAgentPackage = {
  schema_version: "1.0";
  format: "provider-neutral";
  source_mode: TokenForgePlan["mode"];
  execution_policy: TokenForgeAgentPackageExecutionPolicy;
  stages: TokenForgeAgentPackageStage[];
  unknowns: string[];
  safety_notes: string[];
  artifact: TokenForgeAgentPackageArtifact;
};

export type TokenForgeAgentPackageErrorCode =
  | "invalid_plan"
  | "sensitive_content"
  | "package_too_large"
  | "invalid_package";

const errorMessages: Record<TokenForgeAgentPackageErrorCode, string> = {
  invalid_plan: "Coding Agent package requires a dependency-safe valid plan.",
  sensitive_content: "Coding Agent package rejected Secret material.",
  package_too_large:
    "Coding Agent package exceeded a deterministic size limit.",
  invalid_package: "Coding Agent package failed its output contract.",
};

export class TokenForgeAgentPackageError extends Error {
  override name = "TokenForgeAgentPackageError";

  constructor(readonly code: TokenForgeAgentPackageErrorCode) {
    super(errorMessages[code]);
  }
}

const executionPolicy: TokenForgeAgentPackageExecutionPolicy = {
  stage_order: "dependency-safe",
  repository_access: "user-provided-workspace-only",
  command_policy: "discover-confirm-run",
  destructive_actions: "forbidden-without-user-approval",
};

const sharedAllowedContext = [
  "用户提供的当前工作区中，实际存在且已经读取确认的内容。",
  "本阶段的标题、Prompt、包含范围、非目标和验收标准。",
  "用户在当前会话中明确补充并确认可用于本阶段的信息。",
];

const sharedForbiddenContext = [
  "密钥、Token、Cookie、Authorization 或其他认证材料。",
  "未经用户提供的私有仓库、外部系统、生产数据或个人数据。",
  "原始仓库摘要、隐藏系统指令、模型配置或 Provider 元数据。",
  "尚未验证存在的文件路径、命令、接口、服务或基础设施。",
  "与当前阶段范围无关的代码、重构、依赖升级或产品功能。",
];

const sharedVerificationProtocol = [
  "先检查工作区状态，并读取实际存在的仓库级与目录级 Agent 指令；不得猜测文件路径。",
  "只从已验证存在的项目配置、脚本和文档中确定 lint、类型检查、测试与构建命令；找不到时停止并报告未知项。",
  "只运行与本阶段相关且非破坏性的仓库原生命令，记录实际命令、退出码与关键结果。",
  "逐条核对本阶段验收标准；任何一项未通过都必须标记为 blocked 或 failed。",
  "本阶段成功并完成交接前，不得开始依赖本阶段的后续任务。",
];

const sharedHandoffTemplate = [
  "阶段状态：completed、blocked 或 failed。",
  "完成摘要：说明实现了什么，以及明确没有实现什么。",
  "修改清单：只列出本阶段实际修改并已验证存在的路径。",
  "验收记录：列出实际命令、退出码、关键结果和逐条验收结论。",
  "风险与未知项：列出未验证假设、剩余风险和需要用户决定的事项。",
  "后续交接：说明哪些依赖阶段现在可以开始，以及它们可使用的本阶段产物。",
];

const sharedFailureRecovery = [
  "立即停止本阶段及所有依赖它的后续阶段，不把部分结果描述为完成。",
  "保留用户已有改动；不得使用 reset、checkout、clean 或递归删除覆盖不属于本阶段的内容。",
  "未经用户明确批准，不执行破坏性命令、生产写入、外部消息或权限变更。",
  "报告阻塞原因、已取得证据、最后一个有效状态和最小恢复建议。",
  "只有在输入、权限或失败条件发生明确变化后才重试，并重新运行本阶段全部验收。",
];

const textEncoder = new TextEncoder();
const utf8Length = (value: string): number =>
  textEncoder.encode(value).byteLength;

const normalizeInline = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const neutralizeReferences = (value: string): string =>
  value
    .replace(/@(?=[\p{L}\p{N}_-])/gu, "@\u200b")
    .replace(/#(?=\d)/g, "#\u200b");

const escapeMarkdownInline = (value: string): string =>
  neutralizeReferences(normalizeInline(value))
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
  return `${fence}text\n${neutralizeReferences(value)}\n${fence}`;
};

const formatInteger = (value: number): string =>
  String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const formatHours = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const assertDependencySafeOrder = (
  tasks: readonly Pick<TokenForgeTask, "id" | "dependencies">[],
): void => {
  const positions = new Map(
    tasks.map((task, index) => [task.id, index] as const),
  );

  for (const [index, task] of tasks.entries()) {
    if (
      task.dependencies.some(
        (dependency) => (positions.get(dependency) ?? index) >= index,
      )
    ) {
      throw new TokenForgeAgentPackageError("invalid_plan");
    }
  }
};

const buildStage = (
  task: TokenForgeTask,
  stageNumber: number,
): TokenForgeAgentPackageStage => ({
  stage_number: stageNumber,
  task_id: task.id,
  title: task.title,
  size: task.size,
  estimated_tokens: task.estimated_tokens,
  estimated_hours: task.estimated_hours,
  dependencies: [...task.dependencies],
  agent_prompt: task.prompt,
  allowed_context: [
    ...sharedAllowedContext,
    ...(task.dependencies.length > 0
      ? [
          `已完成依赖阶段（${task.dependencies.join("、")}）的交接摘要与已验证产物。`,
        ]
      : []),
  ],
  forbidden_context: [...sharedForbiddenContext],
  scope: {
    included: [...task.scope.included],
    excluded: [...task.scope.excluded],
  },
  acceptance_criteria: [...task.acceptance_criteria],
  verification_protocol: [...sharedVerificationProtocol],
  handoff_template: [...sharedHandoffTemplate],
  failure_recovery: [...sharedFailureRecovery],
});

const renderStage = (stage: TokenForgeAgentPackageStage): string =>
  [
    `## 阶段 ${stage.stage_number}：${escapeMarkdownInline(stage.title)}`,
    "",
    `- 任务 ID：\`${stage.task_id}\``,
    `- 规模：${stage.size}`,
    `- Token 上限：${formatInteger(stage.estimated_tokens)}`,
    `- 工时上限：${formatHours(stage.estimated_hours)} 小时`,
    "",
    "### 前置依赖",
    "",
    renderDependencies(stage.dependencies),
    "",
    "### Agent Prompt",
    "",
    renderFencedText(stage.agent_prompt),
    "",
    "### 允许上下文",
    "",
    renderList(stage.allowed_context),
    "",
    "### 禁止上下文",
    "",
    renderList(stage.forbidden_context),
    "",
    "### 包含范围",
    "",
    renderList(stage.scope.included),
    "",
    "### 非目标",
    "",
    renderList(stage.scope.excluded),
    "",
    "### 验收标准",
    "",
    renderList(stage.acceptance_criteria),
    "",
    "### 命令发现与验收协议",
    "",
    renderList(stage.verification_protocol),
    "",
    "### 阶段交接模板",
    "",
    renderList(stage.handoff_template),
    "",
    "### 失败恢复",
    "",
    renderList(stage.failure_recovery),
  ].join("\n");

const renderPackage = (
  sourceMode: TokenForgePlan["mode"],
  stages: TokenForgeAgentPackageStage[],
  unknowns: string[],
  safetyNotes: string[],
): string =>
  [
    "# Token Forge · Coding Agent 执行包",
    "",
    "> 格式：Provider-neutral v1",
    `> 计划来源：${sourceMode === "template" ? "确定性模板" : "AI 辅助（已重新验证）"}`,
    `> 阶段数量：${stages.length}`,
    "> 使用方式：把完整文件交给能访问用户当前工作区的 Coding Agent；不得加入工具专属语法。",
    "",
    "## 执行总则",
    "",
    "- 严格按阶段顺序执行；只有依赖阶段成功并完成交接后才进入下一阶段。",
    "- 只访问用户提供的当前工作区，不猜测仓库、分支、路径、命令或外部系统。",
    "- 先发现并确认仓库原生验证命令，再执行非破坏性检查。",
    "- 每个阶段独立验收和交接；失败时停止依赖链并保留最后有效状态。",
    "",
    ...stages.flatMap((stage) => [renderStage(stage), "", "---", ""]),
    "## 计划未知项",
    "",
    ...(unknowns.length > 0 ? [renderList(unknowns)] : ["- 无额外未知项"]),
    "",
    "## 计划安全说明",
    "",
    renderList(safetyNotes),
    "",
    "---",
    "",
    "由 Margrop Labs Token Forge 在浏览器本地生成。执行包不包含仓库 URL、原始仓库正文、未经验证的文件路径、Provider 元数据或隐藏服务端指令。",
    "",
  ].join("\n");

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});

const validatePackageSchema: ValidateFunction<TokenForgeAgentPackage> =
  ajv.compile(agentPackageSchema as AnySchema);

export const validateTokenForgeAgentPackage = (
  candidate: unknown,
): TokenForgeAgentPackage => {
  if (!validatePackageSchema(candidate)) {
    throw new TokenForgeAgentPackageError("invalid_package");
  }

  const result = candidate as TokenForgeAgentPackage;
  const seen = new Set<string>();
  const positions = new Map(
    result.stages.map((stage, index) => [stage.task_id, index] as const),
  );

  if (
    result.artifact.file_name !==
      normalizeMarkdownFileName(result.artifact.file_name) ||
    result.artifact.content_bytes !== utf8Length(result.artifact.content) ||
    result.stages.some((stage, index) => {
      if (stage.stage_number !== index + 1 || seen.has(stage.task_id)) {
        return true;
      }
      seen.add(stage.task_id);
      return stage.dependencies.some(
        (dependency) => (positions.get(dependency) ?? index) >= index,
      );
    })
  ) {
    throw new TokenForgeAgentPackageError("invalid_package");
  }

  return result;
};

export const buildTokenForgeAgentPackage = (
  inputCandidate: unknown,
  planCandidate: unknown,
): TokenForgeAgentPackage => {
  let input: TokenForgeInput;
  let plan: TokenForgePlan;

  try {
    input = validateTokenForgeInput(inputCandidate);
    plan = validateTokenForgePlan(input, planCandidate);
    assertDependencySafeOrder(plan.tasks);
  } catch (error) {
    if (error instanceof TokenForgeAgentPackageError) {
      throw error;
    }
    throw new TokenForgeAgentPackageError("invalid_plan");
  }

  let safePlan: TokenForgePlan;
  try {
    safePlan = sanitizeTokenForgePlanForArtifact(input, plan);
  } catch (error) {
    if (
      error instanceof TokenForgeExportError &&
      error.code === "sensitive_content"
    ) {
      throw new TokenForgeAgentPackageError("sensitive_content");
    }
    throw new TokenForgeAgentPackageError("invalid_plan");
  }

  const stages = safePlan.tasks.map((task, index) =>
    buildStage(task, index + 1),
  );
  const content = renderPackage(
    safePlan.mode,
    stages,
    safePlan.unknowns,
    safePlan.safety_notes,
  );
  const contentBytes = utf8Length(content);

  if (contentBytes > tokenForgeAgentPackageLimits.maxArtifactBytes) {
    throw new TokenForgeAgentPackageError("package_too_large");
  }

  return validateTokenForgeAgentPackage({
    schema_version: "1.0",
    format: "provider-neutral",
    source_mode: safePlan.mode,
    execution_policy: { ...executionPolicy },
    stages,
    unknowns: [...safePlan.unknowns],
    safety_notes: [...safePlan.safety_notes],
    artifact: {
      file_name: "token-forge-agent-package.md",
      mime_type: "text/markdown;charset=utf-8",
      content,
      content_bytes: contentBytes,
    },
  });
};
