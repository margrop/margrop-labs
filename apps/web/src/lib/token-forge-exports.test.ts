import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type {
  TokenForgeInput,
  TokenForgePlan,
  TokenForgeTask,
} from "./token-forge-contracts";
import {
  buildTokenForgeExports,
  TokenForgeExportError,
  validateTokenForgeExport,
} from "./token-forge-exports";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const fixtureUrl = (name: string): URL =>
  new URL(`../../../../labs/token-forge/fixtures/${name}`, import.meta.url);

const readJsonFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const readInputAndPlan = async (): Promise<{
  input: TokenForgeInput;
  plan: TokenForgePlan;
}> => ({
  input: (await readJsonFixture("input.valid.json")) as TokenForgeInput,
  plan: (await readJsonFixture("plan.valid.json")) as TokenForgePlan,
});

const serialized = (candidate: unknown): string => JSON.stringify(candidate);

describe("Token Forge export contract", () => {
  it("accepts the versioned synthetic fixture with exact byte counts", async () => {
    const fixture = (await readJsonFixture(
      "token-forge-export.valid.json",
    )) as {
      markdown: { content: string; content_bytes: number };
      github_issues: {
        content: string;
        content_bytes: number;
        issues: Array<{ body: string; body_bytes: number }>;
      };
    };
    const result = validateTokenForgeExport(fixture);

    expect(result.schema_version).toBe("1.0");
    expect(result.markdown.content_bytes).toBe(
      new TextEncoder().encode(result.markdown.content).byteLength,
    );
    expect(result.github_issues.content_bytes).toBe(
      new TextEncoder().encode(result.github_issues.content).byteLength,
    );
    expect(result.github_issues.issues[0]?.body_bytes).toBe(
      new TextEncoder().encode(result.github_issues.issues[0]?.body ?? "")
        .byteLength,
    );
  });

  it("rejects byte metadata or filenames that do not match the artifact", async () => {
    const fixture = (await readJsonFixture(
      "token-forge-export.valid.json",
    )) as Record<string, unknown>;
    const invalidBytes = structuredClone(fixture) as {
      markdown: { content_bytes: number };
    };
    invalidBytes.markdown.content_bytes += 1;

    expect(() => validateTokenForgeExport(invalidBytes)).toThrow(
      TokenForgeExportError,
    );
    expect(() =>
      validateTokenForgeExport({
        ...fixture,
        markdown: {
          ...(fixture.markdown as object),
          file_name: "../../private.md",
        },
      }),
    ).toThrow(TokenForgeExportError);
  });
});

describe("Token Forge Markdown and GitHub Issue exports", () => {
  it("exports the deterministic template path end to end without AI", async () => {
    const { input } = await readInputAndPlan();
    const plan = generateTokenForgeTemplatePlan(input);
    const result = buildTokenForgeExports(input, plan);

    expect(plan.mode).toBe("template");
    expect(result.markdown.content).toContain("生成方式：确定性模板");
    expect(result.github_issues.issues.map((issue) => issue.task_id)).toEqual(
      plan.tasks.map((task) => task.id),
    );
  });

  it("builds stable Markdown and one copyable Issue draft per task", async () => {
    const { input, plan } = await readInputAndPlan();
    const first = buildTokenForgeExports(input, plan);
    const second = buildTokenForgeExports(input, plan);

    expect(first).toEqual(second);
    expect(first.markdown.file_name).toBe("token-forge-plan.md");
    expect(first.markdown.content).toContain("# Token Forge 任务计划");
    expect(first.markdown.content).toContain("## 任务 1");
    expect(first.markdown.content).toContain("### Agent Prompt");
    expect(first.markdown.content).toContain("## 未知项");
    expect(first.markdown.content).toContain("## 安全说明");
    expect(first.github_issues.file_name).toBe("token-forge-github-issues.md");
    expect(first.github_issues.issues).toHaveLength(plan.tasks.length);
    expect(first.github_issues.issues[1]).toMatchObject({
      task_id: "build-offline-prototype",
      title: "[Token Forge][M] 实现离线可运行的互动工具原型",
    });
    expect(first.github_issues.issues[1]?.body).toContain(
      "`define-tool-contract`",
    );
  });

  it("redacts identifiers from every export surface", async () => {
    const { input, plan } = await readInputAndPlan();
    const rawValues = [
      "operator@example.com",
      "192.0.2.42",
      "api.example.com",
      "SYNTHETIC123",
      "0x5000000000000001",
    ];
    plan.tasks[0]!.scope.included = [
      `联系 ${rawValues[0]}，检查 ${rawValues[1]} 和 ${rawValues[2]}`,
    ];
    plan.unknowns = [`Serial Number: ${rawValues[3]}`];
    plan.safety_notes = [`WWN: ${rawValues[4]} 仅用于合成测试`];

    const result = buildTokenForgeExports(input, plan);
    const output = serialized(result);

    for (const value of rawValues) {
      expect(output).not.toContain(value);
    }
    expect(output).toContain("REDACTED:EMAIL");
    expect(output).toContain("REDACTED:IP");
    expect(output).toContain("REDACTED:DOMAIN");
    expect(output).toContain("REDACTED:SERIAL");
    expect(output).toContain("NUMBER");
    expect(output).toContain("REDACTED:WWN");
  });

  it("rejects Secret content without returning it in the error", async () => {
    const { input, plan } = await readInputAndPlan();
    const rawSecret = "synthetic-token-value";
    plan.tasks[0]!.prompt = `在完全合成环境中验证导出边界，并尝试使用 api_key=${rawSecret}；该值必须在导出前被拒绝，不能进入文件或剪贴板。`;

    let error: unknown;
    try {
      buildTokenForgeExports(input, plan);
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(TokenForgeExportError);
    expect(error).toMatchObject({ code: "sensitive_content" });
    expect(String(error)).not.toContain(rawSecret);
  });

  it("redacts absolute, relative and standalone file paths", async () => {
    const { input, plan } = await readInputAndPlan();
    const rawPaths = [
      "src/private/index.ts",
      "/srv/private/config.yaml",
      "C:\\Users\\operator\\secret.json",
      "README.md",
    ];
    plan.tasks[0]!.scope.included = [`检查 ${rawPaths[0]}`];
    plan.tasks[0]!.scope.excluded = [`不读取 ${rawPaths[1]}`];
    plan.tasks[0]!.prompt = `只在合成环境中处理 ${rawPaths[2]}，不得访问真实文件系统；输出时还要移除 ${rawPaths[3]}，并运行完全离线的合同测试。`;

    const result = buildTokenForgeExports(input, plan);
    const output = serialized(result);

    for (const path of rawPaths) {
      expect(output).not.toContain(path);
    }
    expect(output).toContain("REDACTED:FILE_PATH");
  });

  it("does not include the repository URL or accept hidden provider fields", async () => {
    const { input, plan } = await readInputAndPlan();
    const repositoryUrl = "https://github.com/acme/private-context";
    const result = buildTokenForgeExports(
      { ...input, repository_url: repositoryUrl },
      plan,
    );

    expect(serialized(result)).not.toContain(repositoryUrl);
    expect(() =>
      buildTokenForgeExports(input, {
        ...plan,
        provider: "synthetic",
        system_prompt: "must-not-export",
        repository_context: "must-not-export",
      }),
    ).toThrow(TokenForgeExportError);
  });

  it("escapes Markdown and neutralizes GitHub mentions and issue references", async () => {
    const { input, plan } = await readInputAndPlan();
    plan.tasks[0]!.title =
      "修复 <script>alert(1)</script> 并通知 @octocat 关联 #123";

    const result = buildTokenForgeExports(input, plan);
    const output = serialized(result);

    expect(output).not.toContain("<script>");
    expect(output).not.toContain("@octocat");
    expect(output).not.toContain("#123");
    expect(result.markdown.content).toContain("&lt;script&gt;");
    expect(result.github_issues.issues[0]?.title).toContain("@\u200boctocat");
    expect(result.github_issues.issues[0]?.title).toContain("#\u200b123");
  });

  it("uses a longer fence when a visible Agent Prompt contains backticks", async () => {
    const { input, plan } = await readInputAndPlan();
    plan.tasks[0]!.prompt = [
      "在本地合成项目中验证 Markdown 导出，不调用网络或外部服务。",
      "```ts",
      "const result = runSyntheticCheck();",
      "```",
      "完成后运行合同测试并记录可验证结果。",
    ].join("\n");

    const result = buildTokenForgeExports(input, plan);

    expect(result.markdown.content).toContain("````text");
    expect(result.markdown.content).toContain(
      "const result = runSyntheticCheck();",
    );
  });

  it("fails closed when the plan exceeds its contract", async () => {
    const { input, plan } = await readInputAndPlan();
    const rawText = "x".repeat(4_001);
    plan.tasks[0]!.prompt = rawText;

    let error: unknown;
    try {
      buildTokenForgeExports(input, plan);
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toMatchObject({ code: "invalid_plan" });
    expect(String(error)).not.toContain(rawText);
  });

  it("enforces the final UTF-8 artifact size limit", async () => {
    const { input } = await readInputAndPlan();
    const largeItem = (taskIndex: number, itemIndex: number): string =>
      `合成内容${taskIndex}-${itemIndex}-${"界".repeat(270)}`;
    const tasks: TokenForgeTask[] = Array.from(
      { length: 6 },
      (_, taskIndex) => ({
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
      }),
    );
    const largePlan: TokenForgePlan = {
      schema_version: "1.0",
      mode: "template",
      tasks,
      unknowns: ["这是完全合成的超长导出边界测试。"],
      safety_notes: ["测试不得调用网络、写入生产环境或使用真实凭据。"],
    };

    let error: unknown;
    try {
      buildTokenForgeExports(
        {
          ...input,
          token_budget: 60_000,
          available_hours: 80,
        },
        largePlan,
      );
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(TokenForgeExportError);
    expect(error).toMatchObject({ code: "export_too_large" });
  });

  it("does not call the network while building either export", async () => {
    const { input, plan } = await readInputAndPlan();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      buildTokenForgeExports(input, plan);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
