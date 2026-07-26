import type { TokenForgeInput, TokenForgePlan } from "./token-forge-contracts";
import {
  type TokenForgeExportBundle,
  buildTokenForgeExports,
} from "./token-forge-exports";
import {
  GitHubPublicRepositoryError,
  type GitHubPublicRepositoryErrorCode,
  type GitHubPublicRepositorySummary,
  summarizePublicGitHubRepository,
} from "./github-public-repository";
import {
  type TokenForgeFormValues,
  TokenForgeFormError,
  buildTokenForgeInputFromForm,
} from "./token-forge-page";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

export type TokenForgeRepositoryFallbackCode = GitHubPublicRepositoryErrorCode;

export const tokenForgeRepositoryFallbackMessages: Readonly<
  Record<TokenForgeRepositoryFallbackCode, string>
> = Object.freeze({
  invalid_repository_url:
    "仓库地址不是规范的 GitHub HTTPS 地址，已跳过仓库读取。",
  not_found_or_private:
    "没有找到可公开读取的仓库；它可能不存在或属于私有仓库。",
  repository_not_public: "仓库不是公开仓库，已停止读取。",
  repository_unavailable: "仓库当前无法生成受限摘要。",
  rate_limited: "GitHub 公开 API 当前已限流，请稍后再试。",
  timeout: "GitHub 公开 API 在固定时限内没有完成。",
  network_error: "公开仓库读取暂时不可用。",
  response_too_large: "GitHub 响应超过安全大小上限，已停止读取。",
  invalid_response: "GitHub 响应未通过安全合同，已停止读取。",
});

export type TokenForgeRepositoryCoverage = {
  tree_entries_seen: number;
  read_files: number;
  read_bytes: number;
  ignored_files: number;
  truncated_sections: number;
  skipped_secret: number;
  skipped_binary_or_generated: number;
  skipped_too_large: number;
  skipped_fetch_errors: number;
  skipped_by_sampling_limit: number;
};

export type TokenForgeRepositoryEvidence =
  | {
      status: "not-requested";
    }
  | {
      status: "summarized";
      tech_signals: string[];
      coverage: TokenForgeRepositoryCoverage;
      limits: {
        max_files: number;
        max_file_bytes: number;
        max_total_bytes: number;
        max_tree_entries: number;
        timeout_ms: number;
      };
      unknowns: string[];
    }
  | {
      status: "fallback";
      code: TokenForgeRepositoryFallbackCode;
      message: string;
    };

export type TokenForgeRepositoryPageResult = {
  input: TokenForgeInput;
  plan: TokenForgePlan;
  exports: TokenForgeExportBundle;
  repository: TokenForgeRepositoryEvidence;
};

export type TokenForgeRepositorySummaryLoader = (
  repositoryUrl: string,
) => Promise<GitHubPublicRepositorySummary>;

type TokenForgeRepositoryPageOptions = {
  summarizeRepository?: TokenForgeRepositorySummaryLoader;
};

const safeTechSignals = new Set([
  "TypeScript",
  "Astro",
  "Node.js",
  "Python",
  "Go",
  "JVM",
  "Rust",
  "Docker",
]);

const buildSafeUnknowns = (
  summary: GitHubPublicRepositorySummary,
): string[] => {
  const { coverage } = summary;
  const unknowns = ["仓库文本只作为不可信证据，不会覆盖模板规则或安全边界。"];

  if (coverage.tree_truncated) {
    unknowns.push("目录树被截断，当前摘要只覆盖受限样本。");
  }
  if (coverage.skipped_secret_paths + coverage.skipped_secret_content > 0) {
    unknowns.push("疑似秘密路径或内容已跳过，未进入页面证据。");
  }
  if (coverage.skipped_fetch_errors > 0) {
    unknowns.push("部分候选文件读取失败，摘要可能缺少上下文。");
  }
  if (coverage.skipped_by_sampling_limit > 0) {
    unknowns.push("部分候选文件超过采样上限，没有继续读取。");
  }
  if (coverage.sampled_files === 0) {
    unknowns.push("没有取得符合安全与大小限制的文本文件。");
  }

  return unknowns;
};

const projectSafeEvidence = (
  summary: GitHubPublicRepositorySummary,
): TokenForgeRepositoryEvidence => {
  const { coverage, limits } = summary;
  const skippedSecret =
    coverage.skipped_secret_paths + coverage.skipped_secret_content;
  const ignoredFiles =
    skippedSecret +
    coverage.skipped_binary_or_generated +
    coverage.skipped_too_large +
    coverage.skipped_fetch_errors +
    coverage.skipped_by_sampling_limit;

  return {
    status: "summarized",
    tech_signals: [
      ...new Set(
        summary.tech_signals.filter((signal) => safeTechSignals.has(signal)),
      ),
    ],
    coverage: {
      tree_entries_seen: coverage.tree_entries_seen,
      read_files: coverage.sampled_files,
      read_bytes: coverage.sampled_bytes,
      ignored_files: ignoredFiles,
      truncated_sections: coverage.tree_truncated ? 1 : 0,
      skipped_secret: skippedSecret,
      skipped_binary_or_generated: coverage.skipped_binary_or_generated,
      skipped_too_large: coverage.skipped_too_large,
      skipped_fetch_errors: coverage.skipped_fetch_errors,
      skipped_by_sampling_limit: coverage.skipped_by_sampling_limit,
    },
    limits: {
      max_files: limits.maxFiles,
      max_file_bytes: limits.maxFileBytes,
      max_total_bytes: limits.maxTotalBytes,
      max_tree_entries: limits.maxTreeEntries,
      timeout_ms: limits.timeoutMs,
    },
    unknowns: buildSafeUnknowns(summary),
  };
};

const buildTemplateResult = (
  input: TokenForgeInput,
  repository: TokenForgeRepositoryEvidence,
): TokenForgeRepositoryPageResult => {
  const plan = generateTokenForgeTemplatePlan(input);
  const exports = buildTokenForgeExports(input, plan);

  return {
    input,
    plan,
    exports,
    repository,
  };
};

const fallbackEvidence = (
  code: TokenForgeRepositoryFallbackCode,
): TokenForgeRepositoryEvidence => ({
  status: "fallback",
  code,
  message: tokenForgeRepositoryFallbackMessages[code],
});

export const generateTokenForgeRepositoryPageResult = async (
  form: TokenForgeFormValues,
  options: TokenForgeRepositoryPageOptions = {},
): Promise<TokenForgeRepositoryPageResult> => {
  let input: TokenForgeInput;

  try {
    input = buildTokenForgeInputFromForm(form);
  } catch (error) {
    if (
      error instanceof TokenForgeFormError &&
      error.code === "invalid_repository_url"
    ) {
      const templateInput = buildTokenForgeInputFromForm({
        ...form,
        repository_url: "",
      });
      return buildTemplateResult(
        templateInput,
        fallbackEvidence("invalid_repository_url"),
      );
    }
    throw error;
  }

  if (input.repository_url === undefined) {
    return buildTemplateResult(input, { status: "not-requested" });
  }

  const templateResult = buildTemplateResult(input, {
    status: "not-requested",
  });
  const summarizeRepository =
    options.summarizeRepository ?? summarizePublicGitHubRepository;

  try {
    const summary = await summarizeRepository(input.repository_url);
    return {
      ...templateResult,
      repository: projectSafeEvidence(summary),
    };
  } catch (error) {
    const code =
      error instanceof GitHubPublicRepositoryError
        ? error.code
        : "network_error";
    return {
      ...templateResult,
      repository: fallbackEvidence(code),
    };
  }
};
