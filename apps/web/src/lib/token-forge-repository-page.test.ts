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
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

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
    expect(result.quality).toMatchObject({
      schema_version: "1.0",
      status: "ready",
      review_task_count: 0,
      evidence: {
        rule_id: "QF-E01",
      },
    });
    expect(result.plan.tasks.map((task) => task.id)).toEqual(
      result.quality.ordered_task_ids,
    );
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

  it("uses a transient sanitized summary for AI and rebuilds exports from the final plan", async () => {
    const summary = syntheticSummary({
      tree_truncated: false,
      skipped_secret_paths: 0,
      skipped_secret_content: 0,
    });
    const enhancePlan = vi.fn(async (input) => ({
      status: "ai-assisted" as const,
      plan: {
        ...generateTokenForgeTemplatePlan(input),
        mode: "ai-assisted" as const,
      },
      gateway: {
        usage: {
          input_tokens: 500,
          output_tokens: 400,
          total_tokens: 900,
        },
        attempt_count: 1,
      },
    }));

    const result = await generateTokenForgeRepositoryPageResult(
      {
        ...tokenForgeSyntheticFormValues,
        repository_url: repositoryUrl,
      },
      {
        summarizeRepository: vi.fn().mockResolvedValue(summary),
        enhancePlan,
      },
    );

    expect(enhancePlan).toHaveBeenCalledWith(result.input, summary);
    expect(result.ai.status).toBe("ai-assisted");
    expect(result.plan.mode).toBe("ai-assisted");
    expect(result.quality.evidence.rule_id).toBe("QF-E02");
    expect(result.quality.tasks).toHaveLength(result.plan.tasks.length);
    expect(result.exports.markdown.content).toContain("AI 辅助（已重新验证）");
    expect(JSON.stringify(result.repository)).not.toContain(rawPath);
    expect(JSON.stringify(result.repository)).not.toContain(rawContent);
  });

  it("uses the dependency-safe quality order for the page and both exports", async () => {
    const result = await generateTokenForgeRepositoryPageResult(
      { ...tokenForgeSyntheticFormValues },
      {
        enhancePlan: vi.fn(async () => ({
          status: "ai-assisted" as const,
          plan: {
            schema_version: "1.0" as const,
            mode: "ai-assisted" as const,
            tasks: [
              {
                id: "vague-work",
                size: "S" as const,
                title: "优化相关功能",
                estimated_tokens: 4_000,
                estimated_hours: 2,
                dependencies: [],
                scope: {
                  included: ["对相关功能做适当优化"],
                  excluded: ["其他事项根据实际情况处理"],
                },
                prompt:
                  "请对相关功能进行适当优化，根据实际情况处理发现的问题，并尽量让整体效果有所改善；完成后自行判断是否达到预期要求。",
                acceptance_criteria: ["整体效果有所改善并达到预期要求"],
              },
              {
                id: "quality-core",
                size: "S" as const,
                title: "实现可重复验证的质量规则",
                estimated_tokens: 5_000,
                estimated_hours: 3,
                dependencies: [],
                scope: {
                  included: [
                    "实现与页面分离的确定性评分函数",
                    "覆盖正常、模糊和排序测试",
                  ],
                  excluded: ["不调用模型、网络、存储或生产写操作"],
                },
                prompt:
                  "实现一个无副作用的质量评分函数，先验证输入与计划合同，再为正常、模糊和排序场景补齐单元测试，最后运行统一质量命令验证类型、测试与构建。",
                acceptance_criteria: [
                  "相同输入重复运行会得到完全一致的分数和任务顺序",
                  "统一质量命令通过类型检查、单元测试、构建和静态合同验证",
                ],
              },
            ],
            unknowns: ["当前测试不读取仓库，无法判断现有实现状态。"],
            safety_notes: ["只使用合成输入执行确定性质量规则。"],
          },
          gateway: {
            usage: {
              input_tokens: 500,
              output_tokens: 400,
              total_tokens: 900,
            },
            attempt_count: 1,
          },
        })),
      },
    );

    expect(result.plan.tasks.map((task) => task.id)).toEqual([
      "quality-core",
      "vague-work",
    ]);
    expect(result.quality).toMatchObject({
      status: "review",
      review_task_count: 1,
      ordered_task_ids: ["quality-core", "vague-work"],
    });
    expect(
      result.exports.github_issues.issues.map((issue) => issue.task_id),
    ).toEqual(["quality-core", "vague-work"]);
    expect(
      result.exports.markdown.content.indexOf("实现可重复验证的质量规则"),
    ).toBeLessThan(result.exports.markdown.content.indexOf("优化相关功能"));
  });

  it("fails closed to the existing template when an enhancer throws", async () => {
    const result = await generateTokenForgeRepositoryPageResult(
      { ...tokenForgeSyntheticFormValues },
      {
        enhancePlan: vi
          .fn()
          .mockRejectedValue(new Error(`unsafe ${rawContent}`)),
      },
    );

    expect(result.ai).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_provider_unavailable",
      gateway: {
        attempt_count: 0,
      },
    });
    expect(result.plan.mode).toBe("template");
    expect(result.quality.evidence.rule_id).toBe("QF-E01");
    expect(JSON.stringify(result)).not.toContain(rawContent);
  });
});
