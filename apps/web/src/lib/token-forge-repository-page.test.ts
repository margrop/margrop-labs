import { describe, expect, it, vi } from "vitest";

import {
  GitHubPublicRepositoryError,
  type GitHubPublicRepositoryErrorCode,
  type GitHubPublicRepositorySummary,
} from "./github-public-repository";
import {
  tokenForgeSyntheticFormValues,
  TokenForgeFormError,
} from "./token-forge-page";
import { generateTokenForgeRepositoryPageResult } from "./token-forge-repository-page";

const repositoryUrl = "https://github.com/acme/synthetic-repository";
const rawPath = "private/context.ts";
const rawContent = "api_key=synthetic-secret-that-must-not-cross";

const syntheticSummary = (
  override: Partial<GitHubPublicRepositorySummary["coverage"]> = {},
): GitHubPublicRepositorySummary => ({
  source: "github-public",
  repository: {
    owner: "acme",
    name: "synthetic-repository",
    default_branch: "main",
  },
  tech_signals: ["TypeScript", rawContent],
  files: [
    {
      path: rawPath,
      size_bytes: rawContent.length,
      untrusted_text: rawContent,
    },
  ],
  coverage: {
    tree_entries_seen: 30,
    eligible_text_files: 20,
    sampled_files: 2,
    sampled_bytes: 2_048,
    tree_truncated: true,
    skipped_secret_paths: 1,
    skipped_binary_or_generated: 2,
    skipped_too_large: 3,
    skipped_secret_content: 4,
    skipped_fetch_errors: 5,
    skipped_by_sampling_limit: 6,
    ...override,
  },
  limits: {
    maxFiles: 8,
    maxFileBytes: 32 * 1024,
    maxTotalBytes: 128 * 1024,
    maxTreeEntries: 2_000,
    timeoutMs: 5_000,
  },
  unknowns: [rawContent],
});

describe("Token Forge repository page orchestration", () => {
  it("keeps the synthetic path fully local when no repository is provided", async () => {
    const summarizeRepository = vi.fn();
    const result = await generateTokenForgeRepositoryPageResult(
      { ...tokenForgeSyntheticFormValues },
      { summarizeRepository },
    );

    expect(summarizeRepository).not.toHaveBeenCalled();
    expect(result.repository).toEqual({ status: "not-requested" });
    expect(result.plan.mode).toBe("template");
    expect(result.exports.github_issues.issues).toHaveLength(
      result.plan.tasks.length,
    );
  });

  it("projects only safe counts and fixed technology labels from a summary", async () => {
    const summarizeRepository = vi.fn().mockResolvedValue(syntheticSummary());
    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url: repositoryUrl,
      },
      { summarizeRepository },
    );

    expect(summarizeRepository).toHaveBeenCalledWith(repositoryUrl);
    expect(result.repository).toMatchObject({
      status: "summarized",
      tech_signals: ["TypeScript"],
      coverage: {
        tree_entries_seen: 30,
        read_files: 2,
        read_bytes: 2_048,
        ignored_files: 21,
        truncated_sections: 1,
        skipped_secret: 5,
      },
    });

    const projected = JSON.stringify(result.repository);
    expect(projected).not.toContain(repositoryUrl);
    expect(projected).not.toContain(rawPath);
    expect(projected).not.toContain(rawContent);
    expect(result.exports.markdown.content).not.toContain(repositoryUrl);
    expect(result.exports.github_issues.content).not.toContain(repositoryUrl);
  });

  it("shows skipped Secret content as an unknown while retaining exports", async () => {
    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url: repositoryUrl,
      },
      {
        summarizeRepository: vi
          .fn()
          .mockResolvedValue(
            syntheticSummary({ tree_truncated: false, sampled_files: 0 }),
          ),
      },
    );

    expect(result.repository).toMatchObject({
      status: "summarized",
      coverage: {
        read_files: 0,
        skipped_secret: 5,
      },
    });
    if (result.repository.status === "summarized") {
      expect(result.repository.unknowns).toContain(
        "疑似秘密路径或内容已跳过，未进入页面证据。",
      );
      expect(result.repository.unknowns).toContain(
        "没有取得符合安全与大小限制的文本文件。",
      );
    }
    expect(result.plan.mode).toBe("template");
    expect(result.exports.markdown.content.length).toBeGreaterThan(0);
  });

  it.each<GitHubPublicRepositoryErrorCode>([
    "not_found_or_private",
    "repository_not_public",
    "repository_unavailable",
    "rate_limited",
    "timeout",
    "network_error",
    "response_too_large",
    "invalid_response",
  ])("retains the template and exports after %s", async (code) => {
    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url: repositoryUrl,
      },
      {
        summarizeRepository: vi
          .fn()
          .mockRejectedValue(
            new GitHubPublicRepositoryError(
              code,
              `unsafe error detail ${rawContent}`,
            ),
          ),
      },
    );

    expect(result.repository).toMatchObject({ status: "fallback", code });
    expect(JSON.stringify(result.repository)).not.toContain(rawContent);
    expect(result.plan.mode).toBe("template");
    expect(result.exports.github_issues.issues).toHaveLength(
      result.plan.tasks.length,
    );
  });

  it("treats an invalid repository URL as a local template fallback", async () => {
    const summarizeRepository = vi.fn();
    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url:
          "https://github.com/acme/synthetic-repository/tree/main",
      },
      { summarizeRepository },
    );

    expect(summarizeRepository).not.toHaveBeenCalled();
    expect(result.input.repository_url).toBeUndefined();
    expect(result.repository).toMatchObject({
      status: "fallback",
      code: "invalid_repository_url",
    });
    expect(result.plan.mode).toBe("template");
  });

  it("rejects sensitive goal input before any repository request", async () => {
    const summarizeRepository = vi.fn();

    await expect(
      generateTokenForgeRepositoryPageResult(
        {
          ...tokenForgeSyntheticFormValues,
          repository_url: repositoryUrl,
          goal: `使用 api_key=${rawContent} 构建并验证公开演示工具`,
        },
        { summarizeRepository },
      ),
    ).rejects.toBeInstanceOf(TokenForgeFormError);
    expect(summarizeRepository).not.toHaveBeenCalled();
  });

  it("maps unexpected loader errors to a stable fallback without echoing them", async () => {
    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url: repositoryUrl,
      },
      {
        summarizeRepository: vi
          .fn()
          .mockRejectedValue(new Error(`unexpected ${rawContent}`)),
      },
    );

    expect(result.repository).toMatchObject({
      status: "fallback",
      code: "network_error",
    });
    expect(JSON.stringify(result.repository)).not.toContain(rawContent);
  });
});
