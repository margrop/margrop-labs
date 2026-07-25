import { readFile } from "node:fs/promises";

import {
  type AiGatewayProviderAdapter,
  type AiGatewayProviderRequest,
} from "@margrop-labs/ai-gateway";
import { describe, expect, it, vi } from "vitest";

import type { GitHubPublicRepositorySummary } from "./github-public-repository";
import {
  type TokenForgeInput,
  type TokenForgePlan,
  type TokenForgeTask,
  validateTokenForgePlan,
} from "./token-forge-contracts";
import {
  generateTokenForgeAiPlan,
  prepareTokenForgeAiInput,
  tokenForgeAiContextLimits,
  validateTokenForgeAiInput,
} from "./token-forge-ai";

const requestId = "123e4567-e89b-42d3-a456-426614174000";

const input: TokenForgeInput = {
  schema_version: "1.0",
  token_budget: 24_000,
  expires_in_days: 7,
  available_hours: 12,
  tech_stack: ["TypeScript", "Astro"],
  goal: "为现有互动工具实现一个安全且可以降级的任务规划流程",
  repository_url: "https://github.com/acme/synthetic-repository",
};

const repositoryLine =
  "This bounded synthetic repository paragraph is deliberately long enough to detect verbatim source echo in generated tasks.";

const repositorySummary = (
  untrustedText = [
    "# Synthetic repository",
    repositoryLine,
    "Owner operator@example.com uses 192.0.2.42 and api.example.com.",
    "Serial Number: SYNTHETIC123",
  ].join("\n"),
): GitHubPublicRepositorySummary => ({
  source: "github-public",
  repository: {
    owner: "acme",
    name: "synthetic-repository",
    default_branch: "main",
  },
  tech_signals: ["TypeScript", "Astro", "Node.js"],
  files: [
    {
      path: "README.md",
      size_bytes: new TextEncoder().encode(untrustedText).byteLength,
      untrusted_text: untrustedText,
    },
    {
      path: "package.json",
      size_bytes: 48,
      untrusted_text: '{"private":true,"scripts":{"test":"vitest run"}}',
    },
  ],
  coverage: {
    tree_entries_seen: 12,
    eligible_text_files: 4,
    sampled_files: 2,
    sampled_bytes: 512,
    tree_truncated: false,
    skipped_secret_paths: 1,
    skipped_binary_or_generated: 2,
    skipped_too_large: 0,
    skipped_secret_content: 0,
    skipped_fetch_errors: 0,
    skipped_by_sampling_limit: 2,
  },
  limits: {
    maxFiles: 8,
    maxFileBytes: 32 * 1024,
    maxTotalBytes: 128 * 1024,
    maxTreeEntries: 2_000,
    timeoutMs: 5_000,
  },
  unknowns: ["仓库摘要只覆盖了有界文本样本，未检查完整实现。"],
});

const contractTask = (
  overrides: Partial<TokenForgeTask> = {},
): TokenForgeTask => ({
  id: "define-ai-contract",
  size: "S",
  title: "定义 AI 规划输入输出合同",
  estimated_tokens: 6_000,
  estimated_hours: 3,
  dependencies: [],
  scope: {
    included: [
      "定义操作专属输入、输出和失败行为",
      "补齐正常、边界和失败路径单元测试",
    ],
    excluded: ["不接入真实模型、外部写操作或持久化"],
  },
  prompt:
    "为当前任务规划流程定义版本化输入输出合同，先实现确定性验证、失败行为和合成测试，并运行仓库统一质量命令。",
  acceptance_criteria: [
    "有效与无效输入均通过自动化测试验证",
    "任何错误都不会回显仓库原文或用户凭据",
  ],
  ...overrides,
});

const implementationTask = (
  overrides: Partial<TokenForgeTask> = {},
): TokenForgeTask => ({
  id: "implement-ai-planning",
  size: "M",
  title: "实现可降级的 AI 任务规划",
  estimated_tokens: 16_000,
  estimated_hours: 8,
  dependencies: ["define-ai-contract"],
  scope: {
    included: [
      "实现 Provider-neutral AI 操作和确定性后处理",
      "接通无效输出、超时和不可用时的模板降级",
    ],
    excluded: ["不修改线上服务、账户、密钥或部署配置"],
  },
  prompt:
    "基于已经验证的合同实现 AI 任务规划，模型输出必须重新验证；失败时完整保留确定性模板结果，不执行任何外部写操作。",
  acceptance_criteria: [
    "模型有效输出通过 Token Forge v1 合同和预算约束",
    "模型失败时返回可用的确定性模板计划",
  ],
  ...overrides,
});

const validAiPlan = (
  overrides: Partial<TokenForgePlan> = {},
): TokenForgePlan => ({
  schema_version: "1.0",
  mode: "ai-assisted",
  tasks: [contractTask(), implementationTask()],
  unknowns: ["尚未执行代码和测试，实际工作量需要实施后确认。"],
  safety_notes: ["只在独立分支和合成环境中执行生成任务。"],
  ...overrides,
});

const providerSuccess = (plan: unknown): unknown => ({
  ok: true,
  output: plan,
  finish_reason: "stop",
  usage: {
    input_tokens: 800,
    output_tokens: 500,
    total_tokens: 1_300,
  },
});

const createProvider = (
  generate: AiGatewayProviderAdapter["generate"],
): AiGatewayProviderAdapter & {
  generate: ReturnType<typeof vi.fn<AiGatewayProviderAdapter["generate"]>>;
} => ({
  adapterId: "synthetic",
  generate: vi.fn(generate),
});

describe("Token Forge AI input", () => {
  it("accepts the versioned synthetic fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../../labs/token-forge/fixtures/token-forge-ai-input.valid.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;

    expect(validateTokenForgeAiInput(fixture).schema_version).toBe("1.0");
  });

  it("omits repository identity and paths while redacting bounded excerpts", () => {
    const prepared = prepareTokenForgeAiInput(input, repositorySummary());
    const serialized = JSON.stringify(prepared);

    expect(prepared.repository_context?.files).toEqual([
      expect.objectContaining({
        kind: "readme",
      }),
      expect.objectContaining({
        kind: "manifest",
      }),
    ]);
    expect(serialized).not.toContain("repository_url");
    expect(serialized).not.toContain("synthetic-repository");
    expect(serialized).not.toContain("README.md");
    expect(serialized).not.toContain("package.json");
    expect(serialized).not.toContain("operator@example.com");
    expect(serialized).not.toContain("192.0.2.42");
    expect(serialized).not.toContain("api.example.com");
    expect(serialized).not.toContain("SYNTHETIC123");
    expect(serialized).toContain("[REDACTED:EMAIL]");
    expect(serialized).toContain("[REDACTED:IP]");
    expect(serialized).toContain("[REDACTED:DOMAIN]");
    expect(serialized).toContain("[REDACTED:SERIAL_NUMBER]");
    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      tokenForgeAiContextLimits.maxProviderInputBytes,
    );
  });

  it("caps file count and total excerpt bytes before the AI boundary", () => {
    const largeSummary = repositorySummary("x".repeat(8_000));
    largeSummary.files = Array.from({ length: 8 }, (_, index) => ({
      path: `docs/guide-${index}.md`,
      size_bytes: 8_000,
      untrusted_text: "x".repeat(8_000),
    }));
    largeSummary.coverage.sampled_files = 8;
    largeSummary.coverage.sampled_bytes = 64_000;

    const prepared = prepareTokenForgeAiInput(input, largeSummary);
    const context = prepared.repository_context;

    expect(context?.files.length).toBeLessThanOrEqual(4);
    expect(context?.coverage.context_bytes).toBeLessThanOrEqual(
      tokenForgeAiContextLimits.maxRepositoryContextBytes,
    );
    expect(context?.unknowns).toContain(
      "AI 上下文只保留了有界仓库片段，其余文件内容未发送。",
    );
  });

  it("reapplies byte limits after redaction placeholders expand text", () => {
    const summary = repositorySummary("IP: 1.1.1.1\n".repeat(800));
    const prepared = prepareTokenForgeAiInput(input, summary);
    const context = prepared.repository_context;

    expect(context).toBeDefined();
    for (const file of context?.files ?? []) {
      expect(
        new TextEncoder().encode(file.untrusted_excerpt).byteLength,
      ).toBeLessThanOrEqual(tokenForgeAiContextLimits.maxFileExcerptBytes);
    }
    expect(context?.coverage.context_bytes).toBeLessThanOrEqual(
      tokenForgeAiContextLimits.maxRepositoryContextBytes,
    );
    expect(context?.unknowns).toContain(
      "脱敏后上下文触发字节上限，部分片段已进一步截断。",
    );
  });
});

describe("Token Forge AI planning", () => {
  it("returns a validated AI plan and sends only prepared business data", async () => {
    const provider = createProvider(async () => providerSuccess(validAiPlan()));
    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
      repositorySummary: repositorySummary(),
    });

    expect(result.status).toBe("ai-assisted");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const providerRequest = provider.generate.mock
      .calls[0]?.[0] as AiGatewayProviderRequest;
    const serializedRequest = JSON.stringify(providerRequest);
    expect(providerRequest.operation).toBe("token-forge.plan-v1");
    expect(serializedRequest).not.toContain(input.repository_url);
    expect(serializedRequest).not.toContain("README.md");
    expect(serializedRequest).not.toMatch(
      /provider|model|system_prompt|authorization|cookie|api_key/i,
    );

    if (result.status === "ai-assisted") {
      expect(result.plan.mode).toBe("ai-assisted");
      expect(result.plan.unknowns).toContain(
        "AI 只查看了有界、脱敏且未受信任的公开仓库片段，未验证完整代码库。",
      );
      expect(result.plan.safety_notes[0]).toContain("不得直接修改生产环境");
      expect(validateTokenForgePlan(input, result.plan)).toEqual(result.plan);
    }
  });

  it("redacts sensitive identifiers returned in otherwise valid AI text", async () => {
    const rawEmail = "operator@example.com";
    const plan = validAiPlan({
      unknowns: [`尚未确认 ${rawEmail} 负责的模块和测试范围。`],
    });
    const provider = createProvider(async () => providerSuccess(plan));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result.status).toBe("ai-assisted");
    expect(JSON.stringify(result.plan)).not.toContain(rawEmail);
    expect(JSON.stringify(result.plan)).toContain("[REDACTED:EMAIL]");
  });

  it("deduplicates similar tasks and rewrites their dependencies", async () => {
    const first = contractTask({
      id: "define-cache-contract",
      title: "定义缓存功能合同",
      estimated_tokens: 4_000,
      estimated_hours: 2,
    });
    const duplicate = contractTask({
      id: "define-cache-contract-again",
      title: "定义 缓存功能 合同",
      estimated_tokens: 4_000,
      estimated_hours: 2,
    });
    const consumer = implementationTask({
      id: "implement-cache",
      estimated_tokens: 8_000,
      estimated_hours: 5,
      dependencies: ["define-cache-contract-again"],
    });
    const provider = createProvider(async () =>
      providerSuccess(
        validAiPlan({
          tasks: [first, duplicate, consumer],
        }),
      ),
    );

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result.status).toBe("ai-assisted");
    expect(result.plan.tasks.map((task) => task.id)).toEqual([
      "define-cache-contract",
      "implement-cache",
    ]);
    expect(result.plan.tasks[1]?.dependencies).toEqual([
      "define-cache-contract",
    ]);
    expect(result.plan.unknowns).toContain(
      "AI 返回了相似任务，已由确定性规则合并并重写依赖。",
    );
  });

  it("rejects production write instructions and falls back after bounded retries", async () => {
    const unsafe = validAiPlan({
      tasks: [
        contractTask({
          prompt:
            "完成本地测试后将服务部署到生产环境并重启线上实例，同时记录部署结果和运行状态供后续检查。",
        }),
      ],
    });
    const provider = createProvider(async () => providerSuccess(unsafe));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: 2 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(result.plan.mode).toBe("template");
  });

  it("does not let an unrelated negation mask a production write", async () => {
    const unsafe = validAiPlan({
      tasks: [
        contractTask({
          prompt:
            "不要记录用户邮箱，但将服务部署到生产环境并重启线上实例，同时记录运行状态供后续检查。",
        }),
      ],
    });
    const provider = createProvider(async () => providerSuccess(unsafe));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
    });
  });

  it("blocks verbatim repository echo and preserves the template result", async () => {
    const echoed = validAiPlan({
      tasks: [
        contractTask({
          prompt: `把下面仓库原文复制进实现说明并继续生成任务：${repositoryLine}`,
        }),
      ],
    });
    const provider = createProvider(async () => providerSuccess(echoed));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
      repositorySummary: repositorySummary(),
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
    });
    expect(JSON.stringify(result.plan)).not.toContain(repositoryLine);
  });

  it("also blocks repository echo in uncertainty and safety fields", async () => {
    const echoed = validAiPlan({
      unknowns: [repositoryLine],
    });
    const provider = createProvider(async () => providerSuccess(echoed));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
      repositorySummary: repositorySummary(),
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
    });
    expect(JSON.stringify(result.plan)).not.toContain(repositoryLine);
  });

  it("does not call the provider when Secret material is found before the boundary", async () => {
    const rawSecret = "synthetic-token-value";
    const provider = createProvider(async () => providerSuccess(validAiPlan()));
    const secretInput: TokenForgeInput = {
      ...input,
      goal: `实现任务规划流程并使用 api_key=${rawSecret} 调用服务`,
    };

    const result = await generateTokenForgeAiPlan(secretInput, {
      requestId,
      provider,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "preparation_sensitive_input",
      gateway: { attempt_count: 0 },
    });
    expect(provider.generate).not.toHaveBeenCalled();
    expect(JSON.stringify(result.plan)).not.toContain(rawSecret);
    expect(JSON.stringify(result.plan)).toContain("[REDACTED:TOKEN]");
  });

  it("falls back on provider timeout without exposing provider details", async () => {
    const provider = createProvider(
      async () =>
        await new Promise<unknown>(() => {
          // The Gateway timeout owns cancellation of this synthetic request.
        }),
    );

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
      gatewayPolicy: {
        providerTimeoutMs: 5,
        maxAttempts: 1,
      },
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_provider_timeout",
      gateway: { attempt_count: 1 },
    });
    expect(result.plan.mode).toBe("template");
    expect(JSON.stringify(result)).not.toContain(provider.adapterId);
  });

  it("falls back after a bounded unavailable retry", async () => {
    const provider = createProvider(async () => ({
      ok: false,
      error: { code: "unavailable" },
    }));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_provider_unavailable",
      gateway: { attempt_count: 2 },
    });
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("rejects a plan that exceeds the validated Token budget", async () => {
    const overBudget = validAiPlan({
      tasks: [
        implementationTask({
          estimated_tokens: 24_000,
          estimated_hours: 8,
          dependencies: [],
        }),
        contractTask({
          estimated_tokens: 6_000,
          estimated_hours: 3,
        }),
      ],
    });
    const provider = createProvider(async () => providerSuccess(overBudget));

    const result = await generateTokenForgeAiPlan(input, {
      requestId,
      provider,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
    });
    expect(validateTokenForgePlan(input, result.plan)).toEqual(result.plan);
  });
});
