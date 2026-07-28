import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import benchmarkSchema from "../../../../schemas/token-forge-benchmark-v1.schema.json";
import benchmarkCorpusDocument from "../../../../labs/token-forge/benchmarks/corpus.json";
import type {
  GitHubPublicRepositoryErrorCode,
  GitHubPublicRepositorySummary,
} from "./github-public-repository";
import { GitHubPublicRepositoryError } from "./github-public-repository";
import type {
  TokenForgeAiFallbackReason,
  TokenForgeAiPlanningResult,
} from "./token-forge-ai";
import type {
  TokenForgeInput,
  TokenForgePlan,
  TokenForgeTask,
} from "./token-forge-contracts";
import {
  validateTokenForgeInput,
  validateTokenForgePlan,
} from "./token-forge-contracts";
import {
  TokenForgeExportError,
  buildTokenForgeExports,
  validateTokenForgeExport,
} from "./token-forge-exports";
import type { TokenForgeFormValues } from "./token-forge-page";
import {
  type TokenForgeRepositoryPageResult,
  generateTokenForgeRepositoryPageResult,
} from "./token-forge-repository-page";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const aiFailureCodes = [
  "preparation_sensitive_input",
  "preparation_invalid_repository_summary",
  "preparation_input_too_large",
  "gateway_invalid_request",
  "gateway_request_too_large",
  "gateway_input_token_limit_exceeded",
  "gateway_rate_limited",
  "gateway_budget_exhausted",
  "gateway_provider_timeout",
  "gateway_provider_unavailable",
  "gateway_invalid_provider_response",
  "gateway_output_token_limit_exceeded",
  "gateway_response_too_large",
  "gateway_policy_blocked",
  "gateway_internal_error",
] as const satisfies readonly TokenForgeAiFallbackReason[];

const networkFailureCodes = [
  "invalid_repository_url",
  "not_found_or_private",
  "repository_not_public",
  "repository_unavailable",
  "rate_limited",
  "timeout",
  "network_error",
  "response_too_large",
  "invalid_response",
] as const satisfies readonly GitHubPublicRepositoryErrorCode[];

const schemaFailureCodes = [
  "invalid_input_schema",
  "invalid_plan_schema",
  "duplicate_task_id",
  "dangling_dependency",
  "cyclic_dependency",
  "token_budget_exceeded",
  "hour_budget_exceeded",
] as const;

const exportFailureCodes = [
  "invalid_plan",
  "sensitive_content",
  "export_too_large",
  "invalid_export",
] as const satisfies readonly TokenForgeExportError["code"][];

export const tokenForgePrivacySinks = [
  "url",
  "log",
  "analytics",
  "ai-request",
  "export",
] as const;

type TokenForgeBenchmarkProfile = {
  id: string;
  token_budget: number;
  expires_in_days: number;
  available_hours: number;
  tech_stack: string[];
  goal: string;
};

type TokenForgeRepositorySnapshot = {
  id: string;
  technology: string;
  tech_signals: string[];
  files: Array<{
    path: string;
    untrusted_text: string;
  }>;
};

type TokenForgePlanningScenario = {
  id: string;
  profile_id: string;
  pipeline:
    | "template"
    | "repository"
    | "network-fallback"
    | "ai-fallback"
    | "ai-success";
  snapshot_id?: string;
  fault_code?: string;
};

type TokenForgeFailureCase = {
  id: string;
  layer: "ai" | "network" | "schema" | "export";
  code: string;
  expected: "template-fallback" | "rejected";
};

export type TokenForgeBenchmarkCorpus = {
  schema_version: "1.0";
  profiles: TokenForgeBenchmarkProfile[];
  repository_snapshots: TokenForgeRepositorySnapshot[];
  planning_scenarios: TokenForgePlanningScenario[];
  failure_matrix: TokenForgeFailureCase[];
  privacy_sinks: Array<(typeof tokenForgePrivacySinks)[number]>;
};

export type TokenForgeBenchmarkPlanningResult = {
  scenario_id: string;
  pipeline: TokenForgePlanningScenario["pipeline"];
  result: TokenForgeRepositoryPageResult;
};

export type TokenForgeBenchmarkMetrics = {
  schema_version: "1.0";
  planning_scenarios: number;
  repository_snapshots: number;
  technology_profiles: number;
  contract_passed: number;
  dag_passed: number;
  budget_passed: number;
  plans_without_unverifiable_tasks: number;
  plans_flagged_for_review: number;
  fallback_scenarios: number;
  fallback_scenarios_passed: number;
  failure_cases: number;
  failure_cases_passed: number;
  privacy_sinks: number;
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateBenchmarkSchema = ajv.compile(
  benchmarkSchema as AnySchema,
) as ValidateFunction<TokenForgeBenchmarkCorpus>;

const assertUnique = (values: string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new Error(`Token Forge benchmark ${label} ids must be unique.`);
  }
};

const assertExactCodes = (
  actual: string[],
  expected: readonly string[],
  layer: string,
): void => {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `Token Forge benchmark ${layer} matrix must cover every supported failure code exactly once.`,
    );
  }
};

export const validateTokenForgeBenchmarkCorpus = (
  candidate: unknown,
): TokenForgeBenchmarkCorpus => {
  if (!validateBenchmarkSchema(candidate)) {
    throw new Error("Token Forge benchmark corpus failed its v1 Schema.");
  }

  const corpus = candidate;
  assertUnique(
    corpus.profiles.map((profile) => profile.id),
    "profile",
  );
  assertUnique(
    corpus.repository_snapshots.map((snapshot) => snapshot.id),
    "snapshot",
  );
  assertUnique(
    corpus.planning_scenarios.map((scenario) => scenario.id),
    "scenario",
  );
  assertUnique(
    corpus.failure_matrix.map((failure) => failure.id),
    "failure",
  );

  const profileIds = new Set(corpus.profiles.map((profile) => profile.id));
  const snapshots = new Set(
    corpus.repository_snapshots.map((snapshot) => snapshot.id),
  );
  for (const scenario of corpus.planning_scenarios) {
    if (!profileIds.has(scenario.profile_id)) {
      throw new Error(
        `Token Forge benchmark scenario ${scenario.id} references an unknown profile.`,
      );
    }
    if (
      scenario.pipeline === "repository" &&
      (scenario.snapshot_id === undefined ||
        !snapshots.has(scenario.snapshot_id))
    ) {
      throw new Error(
        `Token Forge benchmark scenario ${scenario.id} requires a known repository snapshot.`,
      );
    }
    if (
      scenario.pipeline !== "repository" &&
      scenario.snapshot_id !== undefined
    ) {
      throw new Error(
        `Token Forge benchmark scenario ${scenario.id} has an unused repository snapshot.`,
      );
    }
    const expectsFault =
      scenario.pipeline === "network-fallback" ||
      scenario.pipeline === "ai-fallback";
    if (expectsFault !== (scenario.fault_code !== undefined)) {
      throw new Error(
        `Token Forge benchmark scenario ${scenario.id} has an invalid fault declaration.`,
      );
    }
  }

  assertExactCodes(
    corpus.failure_matrix
      .filter((failure) => failure.layer === "ai")
      .map((failure) => failure.code),
    aiFailureCodes,
    "AI",
  );
  assertExactCodes(
    corpus.failure_matrix
      .filter((failure) => failure.layer === "network")
      .map((failure) => failure.code),
    networkFailureCodes,
    "network",
  );
  assertExactCodes(
    corpus.failure_matrix
      .filter((failure) => failure.layer === "schema")
      .map((failure) => failure.code),
    schemaFailureCodes,
    "Schema",
  );
  assertExactCodes(
    corpus.failure_matrix
      .filter((failure) => failure.layer === "export")
      .map((failure) => failure.code),
    exportFailureCodes,
    "export",
  );
  assertExactCodes(
    corpus.privacy_sinks,
    tokenForgePrivacySinks,
    "privacy sink",
  );

  return corpus;
};

export const tokenForgeBenchmarkCorpus = validateTokenForgeBenchmarkCorpus(
  benchmarkCorpusDocument,
);

const toForm = (
  profile: TokenForgeBenchmarkProfile,
  repositoryUrl = "",
): TokenForgeFormValues => ({
  token_budget: String(profile.token_budget),
  expires_in_days: String(profile.expires_in_days),
  available_hours: String(profile.available_hours),
  tech_stack: profile.tech_stack.join(", "),
  goal: profile.goal,
  repository_url: repositoryUrl,
});

const snapshotUrl = (snapshotId: string): string =>
  `https://github.com/acme/${snapshotId}`;

const toRepositorySummary = (
  snapshot: TokenForgeRepositorySnapshot,
): GitHubPublicRepositorySummary => {
  const files = snapshot.files.map((file) => ({
    path: file.path,
    size_bytes: new TextEncoder().encode(file.untrusted_text).byteLength,
    untrusted_text: file.untrusted_text,
  }));
  const sampledBytes = files.reduce(
    (total, file) => total + file.size_bytes,
    0,
  );

  return {
    source: "github-public",
    repository: {
      owner: "acme",
      name: snapshot.id,
      default_branch: "main",
    },
    tech_signals: snapshot.tech_signals,
    files,
    coverage: {
      tree_entries_seen: files.length,
      eligible_text_files: files.length,
      sampled_files: files.length,
      sampled_bytes: sampledBytes,
      tree_truncated: false,
      skipped_secret_paths: 0,
      skipped_binary_or_generated: 0,
      skipped_too_large: 0,
      skipped_secret_content: 0,
      skipped_fetch_errors: 0,
      skipped_by_sampling_limit: 0,
    },
    limits: {
      maxFiles: 8,
      maxFileBytes: 32 * 1024,
      maxTotalBytes: 128 * 1024,
      maxTreeEntries: 2_000,
      timeoutMs: 5_000,
    },
    unknowns: ["合成快照只覆盖固定测试文件。"],
  };
};

const fallbackResult = (
  input: TokenForgeInput,
  reason: TokenForgeAiFallbackReason,
): TokenForgeAiPlanningResult => ({
  status: "template-fallback",
  plan: generateTokenForgeTemplatePlan(input),
  fallback_reason: reason,
  gateway: {
    attempt_count: 1,
  },
});

const successResult = (input: TokenForgeInput): TokenForgeAiPlanningResult => ({
  status: "ai-assisted",
  plan: {
    ...generateTokenForgeTemplatePlan(input),
    mode: "ai-assisted",
  },
  gateway: {
    usage: {
      input_tokens: 500,
      output_tokens: 400,
      total_tokens: 900,
    },
    attempt_count: 1,
  },
});

const runPlanningScenario = async (
  corpus: TokenForgeBenchmarkCorpus,
  scenario: TokenForgePlanningScenario,
): Promise<TokenForgeBenchmarkPlanningResult> => {
  const profile = corpus.profiles.find(
    (candidate) => candidate.id === scenario.profile_id,
  );
  if (!profile) {
    throw new Error("Validated benchmark profile lookup failed.");
  }

  const snapshot =
    scenario.snapshot_id === undefined
      ? undefined
      : corpus.repository_snapshots.find(
          (candidate) => candidate.id === scenario.snapshot_id,
        );
  const requestsRepository =
    scenario.pipeline === "repository" ||
    scenario.pipeline === "network-fallback";
  const form = toForm(
    profile,
    requestsRepository ? snapshotUrl(snapshot?.id ?? "synthetic-fallback") : "",
  );

  const result = await generateTokenForgeRepositoryPageResult(form, {
    summarizeRepository:
      scenario.pipeline === "repository"
        ? async () => toRepositorySummary(snapshot!)
        : scenario.pipeline === "network-fallback"
          ? async () => {
              throw new GitHubPublicRepositoryError(
                scenario.fault_code as GitHubPublicRepositoryErrorCode,
                "Synthetic repository benchmark failure.",
              );
            }
          : undefined,
    enhancePlan:
      scenario.pipeline === "ai-fallback"
        ? async (input) =>
            fallbackResult(
              input,
              scenario.fault_code as TokenForgeAiFallbackReason,
            )
        : scenario.pipeline === "ai-success"
          ? async (input) => successResult(input)
          : undefined,
  });

  validateTokenForgePlan(result.input, result.plan);
  if (result.exports.github_issues.issues.length !== result.plan.tasks.length) {
    throw new Error(
      `Token Forge benchmark ${scenario.id} did not retain complete exports.`,
    );
  }
  return {
    scenario_id: scenario.id,
    pipeline: scenario.pipeline,
    result,
  };
};

export const runTokenForgePlanningBenchmark = async (
  corpus: TokenForgeBenchmarkCorpus = tokenForgeBenchmarkCorpus,
): Promise<TokenForgeBenchmarkPlanningResult[]> =>
  Promise.all(
    corpus.planning_scenarios.map((scenario) =>
      runPlanningScenario(corpus, scenario),
    ),
  );

const throws = (operation: () => unknown): boolean => {
  try {
    operation();
    return false;
  } catch {
    return true;
  }
};

const runAiFailureCase = async (
  code: TokenForgeAiFallbackReason,
  profile: TokenForgeBenchmarkProfile,
): Promise<boolean> => {
  const result = await generateTokenForgeRepositoryPageResult(toForm(profile), {
    enhancePlan: async (input) => fallbackResult(input, code),
  });
  return (
    result.ai.status === "template-fallback" &&
    result.ai.fallback_reason === code &&
    result.plan.mode === "template" &&
    result.exports.github_issues.issues.length === result.plan.tasks.length
  );
};

const runNetworkFailureCase = async (
  code: GitHubPublicRepositoryErrorCode,
  profile: TokenForgeBenchmarkProfile,
): Promise<boolean> => {
  const invalidUrl = "https://github.com/acme/synthetic-repository/tree/main";
  const form = toForm(
    profile,
    code === "invalid_repository_url"
      ? invalidUrl
      : snapshotUrl("synthetic-network-fault"),
  );
  const result = await generateTokenForgeRepositoryPageResult(form, {
    summarizeRepository: async () => {
      throw new GitHubPublicRepositoryError(
        code,
        "Synthetic repository benchmark failure.",
      );
    },
  });
  return (
    result.repository.status === "fallback" &&
    result.repository.code === code &&
    result.plan.mode === "template" &&
    result.exports.github_issues.issues.length === result.plan.tasks.length
  );
};

const schemaFailureRejected = (
  code: (typeof schemaFailureCodes)[number],
  input: TokenForgeInput,
  plan: TokenForgePlan,
): boolean => {
  const candidate = structuredClone(plan);
  switch (code) {
    case "invalid_input_schema":
      return throws(() =>
        validateTokenForgeInput({ ...input, token_budget: 1 }),
      );
    case "invalid_plan_schema":
      return throws(() =>
        validateTokenForgePlan(input, { ...candidate, tasks: [] }),
      );
    case "duplicate_task_id": {
      const first = candidate.tasks[0]!;
      candidate.tasks = [first, structuredClone(first)];
      return throws(() => validateTokenForgePlan(input, candidate));
    }
    case "dangling_dependency":
      candidate.tasks[0]!.dependencies = ["missing-synthetic-task"];
      return throws(() => validateTokenForgePlan(input, candidate));
    case "cyclic_dependency":
      candidate.tasks[0]!.dependencies = [candidate.tasks[1]!.id];
      candidate.tasks[1]!.dependencies = [candidate.tasks[0]!.id];
      return throws(() => validateTokenForgePlan(input, candidate));
    case "token_budget_exceeded":
      candidate.tasks[0]!.estimated_tokens = input.token_budget;
      return throws(() => validateTokenForgePlan(input, candidate));
    case "hour_budget_exceeded":
      candidate.tasks[0]!.estimated_hours = input.available_hours;
      return throws(() => validateTokenForgePlan(input, candidate));
  }
};

const buildOversizePlan = (): {
  input: TokenForgeInput;
  plan: TokenForgePlan;
} => {
  const largeItem = (taskIndex: number, itemIndex: number): string =>
    `合成内容${taskIndex}-${itemIndex}-${"界".repeat(270)}`;
  const tasks: TokenForgeTask[] = Array.from({ length: 6 }, (_, taskIndex) => ({
    id: `bounded-task-${taskIndex + 1}`,
    size: "S",
    title: `实现第 ${taskIndex + 1} 个有界合成导出任务`,
    estimated_tokens: 6_000,
    estimated_hours: 3,
    dependencies: taskIndex === 0 ? [] : [`bounded-task-${taskIndex}`],
    scope: {
      included: Array.from({ length: 10 }, (_, itemIndex) =>
        largeItem(taskIndex, itemIndex),
      ),
      excluded: Array.from(
        { length: 10 },
        (_, itemIndex) => `排除${largeItem(taskIndex, itemIndex)}`,
      ),
    },
    prompt: "界".repeat(4_000),
    acceptance_criteria: Array.from(
      { length: 10 },
      (_, itemIndex) => `验收${largeItem(taskIndex, itemIndex)}`,
    ),
  }));
  return {
    input: {
      schema_version: "1.0",
      token_budget: 60_000,
      expires_in_days: 14,
      available_hours: 80,
      tech_stack: ["TypeScript"],
      goal: "验证完全合成的大型导出边界",
    },
    plan: {
      schema_version: "1.0",
      mode: "template",
      tasks,
      unknowns: ["这是完全合成的超长导出边界测试。"],
      safety_notes: ["测试不得调用网络、写入生产环境或使用真实凭据。"],
    },
  };
};

const exportFailureRejected = (
  code: (typeof exportFailureCodes)[number],
  input: TokenForgeInput,
  plan: TokenForgePlan,
): boolean => {
  let error: unknown;
  try {
    switch (code) {
      case "invalid_plan":
        buildTokenForgeExports(input, { ...plan, tasks: [] });
        break;
      case "sensitive_content": {
        const sensitivePlan = structuredClone(plan);
        sensitivePlan.tasks[0]!.prompt =
          "在完全合成环境中验证导出边界，并尝试使用 api_key=synthetic-token-value；该值必须在导出前被拒绝，不能进入文件或剪贴板。";
        buildTokenForgeExports(input, sensitivePlan);
        break;
      }
      case "export_too_large": {
        const oversized = buildOversizePlan();
        buildTokenForgeExports(oversized.input, oversized.plan);
        break;
      }
      case "invalid_export":
        validateTokenForgeExport({});
        break;
    }
  } catch (candidate) {
    error = candidate;
  }
  return error instanceof TokenForgeExportError && error.code === code;
};

export const runTokenForgeFailureMatrix = async (
  corpus: TokenForgeBenchmarkCorpus = tokenForgeBenchmarkCorpus,
): Promise<{
  passed: number;
  total: number;
  by_layer: Record<string, number>;
}> => {
  const profile = corpus.profiles.find(
    (candidate) => candidate.id === "go-gin-large",
  );
  if (!profile) {
    throw new Error("Token Forge benchmark requires its large base profile.");
  }
  const input = validateTokenForgeInput({
    schema_version: "1.0",
    token_budget: profile.token_budget,
    expires_in_days: profile.expires_in_days,
    available_hours: profile.available_hours,
    tech_stack: profile.tech_stack,
    goal: profile.goal,
  });
  const plan = generateTokenForgeTemplatePlan(input);
  const byLayer: Record<string, number> = {
    ai: 0,
    network: 0,
    schema: 0,
    export: 0,
  };
  let passed = 0;

  for (const failure of corpus.failure_matrix) {
    let didPass = false;
    switch (failure.layer) {
      case "ai":
        didPass = await runAiFailureCase(
          failure.code as TokenForgeAiFallbackReason,
          profile,
        );
        break;
      case "network":
        didPass = await runNetworkFailureCase(
          failure.code as GitHubPublicRepositoryErrorCode,
          profile,
        );
        break;
      case "schema":
        didPass = schemaFailureRejected(
          failure.code as (typeof schemaFailureCodes)[number],
          input,
          plan,
        );
        break;
      case "export":
        didPass = exportFailureRejected(
          failure.code as (typeof exportFailureCodes)[number],
          input,
          plan,
        );
        break;
    }
    if (!didPass) {
      throw new Error(
        `Token Forge benchmark failure case ${failure.id} did not reach ${failure.expected}.`,
      );
    }
    passed += 1;
    byLayer[failure.layer] = (byLayer[failure.layer] ?? 0) + 1;
  }

  return {
    passed,
    total: corpus.failure_matrix.length,
    by_layer: byLayer,
  };
};

export const buildTokenForgeBenchmarkMetrics = async (
  privacySinkPassCount: number,
  corpus: TokenForgeBenchmarkCorpus = tokenForgeBenchmarkCorpus,
): Promise<TokenForgeBenchmarkMetrics> => {
  const planning = await runTokenForgePlanningBenchmark(corpus);
  const failures = await runTokenForgeFailureMatrix(corpus);
  const fallbackScenarios = planning.filter(
    (scenario) =>
      scenario.pipeline === "network-fallback" ||
      scenario.pipeline === "ai-fallback",
  );
  const fallbackPassed = fallbackScenarios.filter((scenario) => {
    const { result } = scenario;
    return (
      result.plan.mode === "template" &&
      result.exports.github_issues.issues.length === result.plan.tasks.length
    );
  }).length;
  const plansWithoutUnverifiableTasks = planning.filter(
    (scenario) => scenario.result.quality.review_task_count === 0,
  ).length;

  return {
    schema_version: "1.0",
    planning_scenarios: planning.length,
    repository_snapshots: corpus.repository_snapshots.length,
    technology_profiles: corpus.profiles.length,
    contract_passed: planning.length,
    dag_passed: planning.length,
    budget_passed: planning.length,
    plans_without_unverifiable_tasks: plansWithoutUnverifiableTasks,
    plans_flagged_for_review: planning.length - plansWithoutUnverifiableTasks,
    fallback_scenarios: fallbackScenarios.length,
    fallback_scenarios_passed: fallbackPassed,
    failure_cases: failures.total,
    failure_cases_passed: failures.passed,
    privacy_sinks: privacySinkPassCount,
  };
};
