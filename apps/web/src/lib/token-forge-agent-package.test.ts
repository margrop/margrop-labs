import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { TokenForgeInput, TokenForgePlan } from "./token-forge-contracts";
import {
  TokenForgeAgentPackageError,
  buildTokenForgeAgentPackage,
  validateTokenForgeAgentPackage,
} from "./token-forge-agent-package";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const fixtureUrl = (name: string): URL =>
  new URL(`../../../../labs/token-forge/fixtures/${name}`, import.meta.url);

const readJsonFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const readInput = async (): Promise<TokenForgeInput> =>
  (await readJsonFixture("input.valid.json")) as TokenForgeInput;

const serialized = (candidate: unknown): string => JSON.stringify(candidate);

describe("Token Forge Coding Agent package contract", () => {
  it("accepts the versioned synthetic fixture and exact UTF-8 bytes", async () => {
    const result = validateTokenForgeAgentPackage(
      await readJsonFixture("token-forge-agent-package.valid.json"),
    );

    expect(result).toMatchObject({
      schema_version: "1.0",
      format: "provider-neutral",
      source_mode: "template",
    });
    expect(result.artifact.content_bytes).toBe(
      new TextEncoder().encode(result.artifact.content).byteLength,
    );
  });

  it("rejects invalid byte metadata, stage numbers and dependency order", async () => {
    const fixture = (await readJsonFixture(
      "token-forge-agent-package.valid.json",
    )) as Record<string, unknown>;
    const invalidBytes = structuredClone(fixture) as {
      artifact: { content_bytes: number };
    };
    invalidBytes.artifact.content_bytes += 1;

    expect(() => validateTokenForgeAgentPackage(invalidBytes)).toThrow(
      TokenForgeAgentPackageError,
    );

    const invalidStage = structuredClone(fixture) as {
      stages: Array<{
        stage_number: number;
        task_id: string;
        dependencies: string[];
      }>;
    };
    invalidStage.stages[0]!.stage_number = 2;
    invalidStage.stages.push({
      ...invalidStage.stages[0]!,
      stage_number: 2,
      task_id: "dependent-stage",
      dependencies: ["missing-stage"],
    });
    expect(() => validateTokenForgeAgentPackage(invalidStage)).toThrow(
      TokenForgeAgentPackageError,
    );
  });
});

describe("Token Forge Provider-neutral Coding Agent package", () => {
  it("builds a stable dependency-safe stage package from the final plan", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    const first = buildTokenForgeAgentPackage(input, plan);
    const second = buildTokenForgeAgentPackage(input, plan);

    expect(first).toEqual(second);
    expect(first.stages.map((stage) => stage.task_id)).toEqual(
      plan.tasks.map((task) => task.id),
    );
    expect(first.stages.map((stage) => stage.stage_number)).toEqual(
      plan.tasks.map((_, index) => index + 1),
    );
    expect(first.artifact.file_name).toBe("token-forge-agent-package.md");
    expect(first.artifact.content).toContain(
      "# Token Forge · Coding Agent 执行包",
    );
    expect(first.artifact.content).toContain("命令发现与验收协议");
    expect(first.artifact.content).toContain("阶段交接模板");
    expect(first.artifact.content).toContain("失败恢复");
  });

  it("contains only generic execution rules instead of provider-specific syntax", async () => {
    const input = await readInput();
    const result = buildTokenForgeAgentPackage(
      input,
      generateTokenForgeTemplatePlan(input),
    );
    const output = serialized(result).toLowerCase();

    expect(output).not.toContain("codex");
    expect(output).not.toContain("claude");
    expect(output).not.toContain("kimi");
    expect(output).not.toContain("system_prompt");
    expect(output).not.toContain('"provider":');
    expect(output).not.toContain('"model":');
    expect(result.execution_policy).toEqual({
      stage_order: "dependency-safe",
      repository_access: "user-provided-workspace-only",
      command_policy: "discover-confirm-run",
      destructive_actions: "forbidden-without-user-approval",
    });
  });

  it("redacts PII and file paths from structure and Markdown", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    const rawEmail = "operator@example.com";
    const rawIp = "192.0.2.44";
    const rawPath = "src/private/config.ts";
    plan.tasks[0]!.scope.included = [
      `联系 ${rawEmail}，检查 ${rawIp} 和 ${rawPath}`,
    ];

    const result = buildTokenForgeAgentPackage(input, plan);
    const output = serialized(result);

    expect(output).not.toContain(rawEmail);
    expect(output).not.toContain(rawIp);
    expect(output).not.toContain(rawPath);
    expect(output).toContain("REDACTED:EMAIL");
    expect(output).toContain("REDACTED:IP");
    expect(output).toContain("REDACTED:FILE_PATH");
  });

  it("escapes Markdown and neutralizes mentions and issue references", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    plan.tasks[0]!.title =
      "验证 <script>alert(1)</script> 并通知 @octocat 关联 #123";

    const result = buildTokenForgeAgentPackage(input, plan);

    expect(result.artifact.content).not.toContain("<script>");
    expect(result.artifact.content).not.toContain("@octocat");
    expect(result.artifact.content).not.toContain("#123");
    expect(result.artifact.content).toContain("&lt;script&gt;");
    expect(result.artifact.content).toContain("@\u200boctocat");
    expect(result.artifact.content).toContain("#\u200b123");
  });

  it("rejects Secret content without echoing it", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    const rawSecret = "synthetic-secret-that-must-not-cross";
    plan.tasks[0]!.prompt = `使用 api_key=${rawSecret} 完成任务，然后运行本地测试并记录结果。`;
    let error: unknown;

    try {
      buildTokenForgeAgentPackage(input, plan);
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(TokenForgeAgentPackageError);
    expect(error).toMatchObject({ code: "sensitive_content" });
    expect(String(error)).not.toContain(rawSecret);
  });

  it("omits repository URLs, hidden fields and unverified file paths", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    const repositoryUrl = "https://github.com/acme/synthetic-repository";
    const result = buildTokenForgeAgentPackage(
      { ...input, repository_url: repositoryUrl },
      plan,
    );

    expect(serialized(result)).not.toContain(repositoryUrl);
    expect(() =>
      buildTokenForgeAgentPackage(input, {
        ...plan,
        provider: "synthetic-provider",
        system_prompt: "hidden",
        repository_context: "private",
      }),
    ).toThrow(TokenForgeAgentPackageError);
  });

  it("rejects a plan whose visible order places dependencies later", async () => {
    const input = await readInput();
    const plan = (await readJsonFixture("plan.valid.json")) as TokenForgePlan;
    const reversed: TokenForgePlan = {
      ...plan,
      tasks: [...plan.tasks].reverse(),
    };

    expect(() => buildTokenForgeAgentPackage(input, reversed)).toThrow(
      expect.objectContaining({ code: "invalid_plan" }),
    );
  });

  it("enforces the final UTF-8 package size limit", async () => {
    const input = await readInput();
    const tasks: TokenForgePlan["tasks"] = Array.from(
      { length: 6 },
      (_, taskIndex) => {
        const longItem = (label: string, itemIndex: number): string =>
          `${label}${taskIndex}-${itemIndex}-${"界".repeat(280)}`;

        return {
          id: `bounded-stage-${taskIndex + 1}`,
          size: "M",
          title: `实现第 ${taskIndex + 1} 个有界执行阶段`,
          estimated_tokens: 10_000,
          estimated_hours: 10,
          dependencies: taskIndex === 0 ? [] : [`bounded-stage-${taskIndex}`],
          scope: {
            included: Array.from({ length: 10 }, (_, itemIndex) =>
              longItem("包含", itemIndex),
            ),
            excluded: Array.from({ length: 10 }, (_, itemIndex) =>
              longItem("排除", itemIndex),
            ),
          },
          prompt: "界".repeat(4_000),
          acceptance_criteria: Array.from({ length: 10 }, (_, itemIndex) =>
            longItem("验收", itemIndex),
          ),
        };
      },
    );

    expect(() =>
      buildTokenForgeAgentPackage(
        {
          ...input,
          token_budget: 60_000,
          available_hours: 80,
        },
        {
          schema_version: "1.0",
          mode: "template",
          tasks,
          unknowns: ["完全合成的超长执行包边界。"],
          safety_notes: ["不访问网络、生产系统或真实数据。"],
        },
      ),
    ).toThrow(expect.objectContaining({ code: "package_too_large" }));
  });

  it("uses no network, storage or console while building the package", async () => {
    const input = await readInput();
    const plan = generateTokenForgeTemplatePlan(input);
    const fetchMock = vi.fn();
    const storageMock = vi.fn();
    const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", { setItem: storageMock });

    try {
      buildTokenForgeAgentPackage(input, plan);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(consoleMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      consoleMock.mockRestore();
    }
  });
});
