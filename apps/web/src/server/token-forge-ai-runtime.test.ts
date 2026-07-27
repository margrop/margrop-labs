import { describe, expect, it, vi } from "vitest";

import type { TokenForgePlan } from "../lib/token-forge-contracts";
import {
  prepareTokenForgeAiInput,
  tokenForgeAiOperationId,
} from "../lib/token-forge-ai";
import {
  createMemoryTokenForgePolicyStore,
  createOpenAiCompatibleProvider,
  handleTokenForgeAiRequest,
  tokenForgeAiEndpointPath,
  tokenForgeAiGatewayPolicy,
  tokenForgeAiPreviewTrafficPolicy,
  tokenForgeAiProductionTrafficPolicy,
} from "./token-forge-ai-runtime";

const firstRequestId = "123e4567-e89b-42d3-a456-426614174000";
const secondRequestId = "123e4567-e89b-42d3-a456-426614174001";

const input = {
  schema_version: "1.0" as const,
  token_budget: 24_000,
  expires_in_days: 7,
  available_hours: 12,
  tech_stack: ["TypeScript", "Astro"],
  goal: "为公开互动工具生成有边界、可测试并可安全降级的开发任务",
};

const plan: TokenForgePlan = {
  schema_version: "1.0",
  mode: "ai-assisted",
  tasks: [
    {
      id: "define-runtime-contract",
      size: "S",
      title: "定义服务端运行时合同与失败边界",
      estimated_tokens: 6_000,
      estimated_hours: 3,
      dependencies: [],
      scope: {
        included: ["定义固定输入输出合同与合成失败测试"],
        excluded: ["不读取凭据或直接修改生产环境"],
      },
      prompt:
        "在独立分支中定义版本化的服务端运行时合同、允许字段、失败代码和合成测试，并运行仓库统一质量命令确认边界有效。",
      acceptance_criteria: ["所有正常、无效和超限输入都由自动化测试覆盖"],
    },
    {
      id: "implement-runtime-path",
      size: "M",
      title: "实现受保护且可降级的规划路径",
      estimated_tokens: 12_000,
      estimated_hours: 6,
      dependencies: ["define-runtime-contract"],
      scope: {
        included: ["实现固定 Provider 调用、重新验证与模板降级"],
        excluded: ["不执行部署、发布或任何外部写操作"],
      },
      prompt:
        "基于已验证合同实现一次受限模型调用，将候选计划重新通过预算、依赖和安全校验；任一失败都返回确定性模板而不是原始错误。",
      acceptance_criteria: ["有效响应通过合同，无效响应保留可导出的模板结果"],
    },
  ],
  unknowns: ["尚未执行代码与测试，实际工作量需要实施后确认。"],
  safety_notes: ["只允许在本地、测试环境或独立分支执行任务。"],
};

const environment = {
  TOKEN_FORGE_AI_BASE_URL: "https://api-gpt.speedtest.margrop.net:16666/v1",
  TOKEN_FORGE_AI_MODEL: "qwen-latest",
  TOKEN_FORGE_AI_FALLBACK_MODEL: "minimax-latest",
  TOKEN_FORGE_AI_BUDGET_MULTIPLIER: "1",
  TOKEN_FORGE_AI_API_KEY: "synthetic-provider-key",
  TOKEN_FORGE_ACTOR_KEY_SECRET: "synthetic-actor-key-secret",
};

const openAiSuccess = (
  content = JSON.stringify(plan),
  finishReason = "stop",
): Response =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content,
          },
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: 800,
        completion_tokens: 600,
        total_tokens: 1_400,
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    },
  );

const runtimeRequest = (
  requestId = firstRequestId,
  ipAddress = "192.0.2.10",
  origin = "https://lab.margrop.net",
): Request =>
  new Request(`https://lab.margrop.net${tokenForgeAiEndpointPath}`, {
    method: "POST",
    headers: {
      "cf-connecting-ip": ipAddress,
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({
      schema_version: "1.0",
      request_id: requestId,
      lab_id: "token-forge",
      operation: tokenForgeAiOperationId,
      input: prepareTokenForgeAiInput(input),
    }),
  });

describe("OpenAI-compatible Token Forge Provider", () => {
  it("keeps the API key in the Authorization header and maps standard usage", async () => {
    const fetchProvider = vi.fn().mockResolvedValue(openAiSuccess());
    const provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: fetchProvider,
    });

    const result = await provider.generate(
      {
        request_id: firstRequestId,
        lab_id: "token-forge",
        operation: tokenForgeAiOperationId,
        input: prepareTokenForgeAiInput(input),
        limits: {
          max_input_tokens: tokenForgeAiGatewayPolicy.maxInputTokens,
          max_output_tokens: tokenForgeAiGatewayPolicy.maxOutputTokens,
        },
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      output: plan,
      finish_reason: "stop",
      usage: {
        input_tokens: 800,
        output_tokens: 600,
        total_tokens: 1_400,
      },
    });

    const [url, init] = fetchProvider.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api-gpt.speedtest.margrop.net:16666/v1/chat/completions",
    );
    expect(init.headers).toMatchObject({
      authorization: `Bearer ${environment.TOKEN_FORGE_AI_API_KEY}`,
    });
    const body = JSON.parse(String(init.body)) as {
      model: string;
      max_tokens: number;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("qwen-latest");
    expect(body.max_tokens).toBe(2_000);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.content).toContain("Token Forge Plan v1");
    expect(JSON.stringify(body)).not.toContain(
      environment.TOKEN_FORGE_AI_API_KEY,
    );
  });

  it.each([
    [401, "policy_blocked"],
    [402, "budget_exhausted"],
    [403, "policy_blocked"],
  ])(
    "does not fall back for terminal HTTP %i responses",
    async (status, code) => {
      const fetchProvider = vi.fn().mockResolvedValue(
        new Response("unsafe upstream detail", {
          status,
          headers: { "retry-after": "30" },
        }),
      );
      const provider = createOpenAiCompatibleProvider({
        baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
        primaryModel: environment.TOKEN_FORGE_AI_MODEL,
        fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
        apiKey: environment.TOKEN_FORGE_AI_API_KEY,
        fetch: fetchProvider,
      });

      const result = await provider.generate(
        {
          request_id: firstRequestId,
          lab_id: "token-forge",
          operation: tokenForgeAiOperationId,
          input: prepareTokenForgeAiInput(input),
          limits: {
            max_input_tokens: 22_000,
            max_output_tokens: 2_000,
          },
        },
        { signal: new AbortController().signal },
      );

      expect(result).toMatchObject({
        ok: false,
        error: { code },
      });
      expect(fetchProvider).toHaveBeenCalledTimes(1);
    },
  );

  it.each([429, 500])(
    "falls back to minimax-latest after retryable HTTP %i",
    async (status) => {
      const fetchProvider = vi
        .fn()
        .mockResolvedValueOnce(
          new Response("unsafe upstream detail", { status }),
        )
        .mockResolvedValueOnce(openAiSuccess());
      const provider = createOpenAiCompatibleProvider({
        baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
        primaryModel: environment.TOKEN_FORGE_AI_MODEL,
        fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
        apiKey: environment.TOKEN_FORGE_AI_API_KEY,
        fetch: fetchProvider,
      });

      await expect(
        provider.generate(
          {
            request_id: firstRequestId,
            lab_id: "token-forge",
            operation: tokenForgeAiOperationId,
            input: prepareTokenForgeAiInput(input),
            limits: {
              max_input_tokens: 22_000,
              max_output_tokens: 2_000,
            },
          },
          { signal: new AbortController().signal },
        ),
      ).resolves.toMatchObject({
        ok: true,
        output: plan,
      });

      const models = fetchProvider.mock.calls.map(([, init]) => {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          model: string;
        };
        return body.model;
      });
      expect(models).toEqual(["qwen-latest", "minimax-latest"]);
      expect(provider.getAccountingTokenFloor()).toBe(48_000);
    },
  );

  it("falls back after a primary network failure", async () => {
    const fetchProvider = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("synthetic network failure"))
      .mockResolvedValueOnce(openAiSuccess());
    const provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: fetchProvider,
    });

    await expect(
      provider.generate(
        {
          request_id: firstRequestId,
          lab_id: "token-forge",
          operation: tokenForgeAiOperationId,
          input: prepareTokenForgeAiInput(input),
          limits: {
            max_input_tokens: 22_000,
            max_output_tokens: 2_000,
          },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      ok: true,
      output: plan,
    });
    expect(fetchProvider).toHaveBeenCalledTimes(2);
    expect(provider.getAccountingTokenFloor()).toBe(
      tokenForgeAiProductionTrafficPolicy.max_request_billable_tokens,
    );
  });

  it("accepts one complete JSON fence without relaxing the plan contract", async () => {
    const provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: vi
        .fn()
        .mockResolvedValue(
          openAiSuccess(`\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``),
        ),
    });

    await expect(
      provider.generate(
        {
          request_id: firstRequestId,
          lab_id: "token-forge",
          operation: tokenForgeAiOperationId,
          input: prepareTokenForgeAiInput(input),
          limits: {
            max_input_tokens: 22_000,
            max_output_tokens: 2_000,
          },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      ok: true,
      output: plan,
    });
  });

  it("falls back when the primary response contains invalid fenced JSON", async () => {
    const fetchProvider = vi
      .fn()
      .mockResolvedValueOnce(
        openAiSuccess(
          `Here is the result:\n\`\`\`json\n${JSON.stringify(plan)}\n\`\`\``,
        ),
      )
      .mockResolvedValueOnce(openAiSuccess());
    const provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: fetchProvider,
    });

    await expect(
      provider.generate(
        {
          request_id: firstRequestId,
          lab_id: "token-forge",
          operation: tokenForgeAiOperationId,
          input: prepareTokenForgeAiInput(input),
          limits: {
            max_input_tokens: 22_000,
            max_output_tokens: 2_000,
          },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({
      ok: true,
      output: plan,
    });
    expect(fetchProvider).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the fallback response is also invalid", async () => {
    const fetchProvider = vi
      .fn()
      .mockResolvedValueOnce(openAiSuccess("not-json"))
      .mockResolvedValueOnce(openAiSuccess("still-not-json"));
    const provider = createOpenAiCompatibleProvider({
      baseUrl: environment.TOKEN_FORGE_AI_BASE_URL,
      primaryModel: environment.TOKEN_FORGE_AI_MODEL,
      fallbackModel: environment.TOKEN_FORGE_AI_FALLBACK_MODEL,
      apiKey: environment.TOKEN_FORGE_AI_API_KEY,
      fetch: fetchProvider,
    });

    await expect(
      provider.generate(
        {
          request_id: firstRequestId,
          lab_id: "token-forge",
          operation: tokenForgeAiOperationId,
          input: prepareTokenForgeAiInput(input),
          limits: {
            max_input_tokens: 22_000,
            max_output_tokens: 2_000,
          },
        },
        { signal: new AbortController().signal },
      ),
    ).resolves.toBeUndefined();
    expect(fetchProvider).toHaveBeenCalledTimes(2);
  });

  it("keeps a truncated fallback response closed", async () => {
    const fetchProvider = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 500 }))
      .mockResolvedValueOnce(openAiSuccess(JSON.stringify(plan), "length"));
    const response = await handleTokenForgeAiRequest(runtimeRequest(), {
      store: createMemoryTokenForgePolicyStore(),
      environment,
      fetch: fetchProvider,
      now: () => Date.UTC(2026, 6, 26, 12),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      error: {
        code: "output_token_limit_exceeded",
      },
    });
    expect(fetchProvider).toHaveBeenCalledTimes(2);
  });
});

describe("Token Forge AI production runtime", () => {
  it("expands only Preview daily token and cost budgets by 100 times", () => {
    expect(tokenForgeAiPreviewTrafficPolicy.daily_budgets).toEqual({
      actor_tokens: 9_600_000,
      lab_tokens: 120_000_000,
      site_tokens: 240_000_000,
      actor_cost_microusd: 400,
      lab_cost_microusd: 5_000,
      site_cost_microusd: 10_000,
      actor_requests: 4,
      lab_requests: 50,
      site_requests: 100,
    });
    expect(tokenForgeAiPreviewTrafficPolicy.rate_limit).toEqual(
      tokenForgeAiProductionTrafficPolicy.rate_limit,
    );
    expect(tokenForgeAiPreviewTrafficPolicy.concurrency).toEqual(
      tokenForgeAiProductionTrafficPolicy.concurrency,
    );
    expect(tokenForgeAiProductionTrafficPolicy.daily_budgets).toMatchObject({
      actor_tokens: 96_000,
      lab_tokens: 1_200_000,
      site_tokens: 2_400_000,
      actor_cost_microusd: 4,
      lab_cost_microusd: 50,
      site_cost_microusd: 100,
    });
  });

  it("admits, validates, settles, and returns a no-store Gateway response", async () => {
    const fetchProvider = vi.fn().mockResolvedValue(openAiSuccess());
    const response = await handleTokenForgeAiRequest(runtimeRequest(), {
      store: createMemoryTokenForgePolicyStore(),
      environment,
      fetch: fetchProvider,
      now: () => Date.UTC(2026, 6, 26, 12),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      schema_version: "1.0",
      request_id: firstRequestId,
      status: "ok",
      result: {
        mode: "ai-assisted",
      },
      usage: {
        total_tokens: 1_400,
      },
      meta: {
        attempt_count: 1,
      },
    });
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });

  it("persists the anonymous actor rate limit without storing the raw IP", async () => {
    const store = createMemoryTokenForgePolicyStore();
    const fetchProvider = vi.fn().mockResolvedValue(openAiSuccess());
    const options = {
      store,
      environment,
      fetch: fetchProvider,
      now: () => Date.UTC(2026, 6, 26, 12),
    };

    expect(
      (await handleTokenForgeAiRequest(runtimeRequest(), options)).status,
    ).toBe(200);
    const denied = await handleTokenForgeAiRequest(
      runtimeRequest(secondRequestId),
      options,
    );

    expect(denied.status).toBe(429);
    await expect(denied.json()).resolves.toMatchObject({
      request_id: secondRequestId,
      status: "error",
      error: {
        code: "rate_limited",
      },
      meta: {
        attempt_count: 0,
      },
    });
    expect(fetchProvider).toHaveBeenCalledTimes(1);
  });

  it("enforces the shared concurrency reservation before a third Provider call", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchProvider = vi.fn(async () => {
      await gate;
      return openAiSuccess();
    });
    const options = {
      store: createMemoryTokenForgePolicyStore(),
      environment,
      fetch: fetchProvider,
      now: () => Date.UTC(2026, 6, 26, 12),
    };

    const first = handleTokenForgeAiRequest(
      runtimeRequest(firstRequestId, "192.0.2.11"),
      options,
    );
    const second = handleTokenForgeAiRequest(
      runtimeRequest(secondRequestId, "192.0.2.12"),
      options,
    );
    await vi.waitFor(() => expect(fetchProvider).toHaveBeenCalledTimes(2));

    const third = await handleTokenForgeAiRequest(
      runtimeRequest("123e4567-e89b-42d3-a456-426614174002", "192.0.2.13"),
      options,
    );
    expect(third.status).toBe(429);
    expect(fetchProvider).toHaveBeenCalledTimes(2);

    release?.();
    await Promise.all([first, second]);
  });

  it("opens the shared circuit after three invalid Provider results", async () => {
    let nowMs = Date.UTC(2026, 6, 26, 12);
    const fetchProvider = vi.fn().mockImplementation(
      () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "{}",
                },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 10,
              total_tokens: 110,
            },
          }),
        ),
    );
    const options = {
      store: createMemoryTokenForgePolicyStore(),
      environment,
      fetch: fetchProvider,
      now: () => nowMs,
    };

    for (let index = 0; index < 3; index += 1) {
      const suffix = String(index + 3).padStart(3, "0");
      const response = await handleTokenForgeAiRequest(
        runtimeRequest(
          `123e4567-e89b-42d3-a456-426614174${suffix}`,
          `192.0.2.${20 + index}`,
        ),
        options,
      );
      expect(response.status).toBe(502);
      nowMs += 61_000;
    }

    const denied = await handleTokenForgeAiRequest(
      runtimeRequest("123e4567-e89b-42d3-a456-426614174006", "192.0.2.30"),
      options,
    );
    expect(denied.status).toBe(503);
    await expect(denied.json()).resolves.toMatchObject({
      status: "error",
      error: {
        code: "provider_unavailable",
      },
      meta: {
        attempt_count: 0,
      },
    });
    expect(fetchProvider).toHaveBeenCalledTimes(3);
  });

  it("fails closed before admission when the secret or trusted edge IP is missing", async () => {
    const fetchProvider = vi.fn();
    const request = runtimeRequest();
    request.headers.delete("cf-connecting-ip");
    const response = await handleTokenForgeAiRequest(request, {
      store: createMemoryTokenForgePolicyStore(),
      environment: {
        ...environment,
        TOKEN_FORGE_AI_API_KEY: "",
      },
      fetch: fetchProvider,
    });

    expect(response.status).toBe(503);
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("fails closed before admission for an unknown budget multiplier", async () => {
    const fetchProvider = vi.fn();
    const response = await handleTokenForgeAiRequest(runtimeRequest(), {
      store: createMemoryTokenForgePolicyStore(),
      environment: {
        ...environment,
        TOKEN_FORGE_AI_BUDGET_MULTIPLIER: "2",
      },
      fetch: fetchProvider,
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      request_id: firstRequestId,
      status: "error",
      error: {
        code: "provider_unavailable",
      },
      meta: {
        attempt_count: 0,
      },
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before reading or forwarding the input", async () => {
    const fetchProvider = vi.fn();
    const response = await handleTokenForgeAiRequest(
      runtimeRequest(firstRequestId, "192.0.2.10", "https://example.com"),
      {
        store: createMemoryTokenForgePolicyStore(),
        environment,
        fetch: fetchProvider,
      },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      status: "error",
      error: {
        code: "policy_blocked",
      },
    });
    expect(fetchProvider).not.toHaveBeenCalled();
  });
});
