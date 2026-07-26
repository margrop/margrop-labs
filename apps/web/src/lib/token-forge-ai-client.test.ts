import { describe, expect, it, vi } from "vitest";

import type { TokenForgePlan } from "./token-forge-contracts";
import { requestTokenForgeAiPlan } from "./token-forge-ai-client";

const requestId = "123e4567-e89b-42d3-a456-426614174000";
const input = {
  schema_version: "1.0" as const,
  token_budget: 12_000,
  expires_in_days: 5,
  available_hours: 8,
  tech_stack: ["TypeScript"],
  goal: "为公开工具实现一条可测试、可安全降级的 AI 规划路径",
};

const plan: TokenForgePlan = {
  schema_version: "1.0",
  mode: "ai-assisted",
  tasks: [
    {
      id: "implement-safe-path",
      size: "M",
      title: "实现可验证且能降级的规划路径",
      estimated_tokens: 10_000,
      estimated_hours: 6,
      dependencies: [],
      scope: {
        included: ["实现固定合同、结果验证和模板降级测试"],
        excluded: ["不执行部署、生产写入或凭据读取"],
      },
      prompt:
        "在独立分支中实现固定输入输出合同、候选计划重新验证和模板降级，并使用合成数据覆盖有效、无效与超时路径。",
      acceptance_criteria: ["有效和失败路径均通过自动化测试与统一质量命令"],
    },
  ],
  unknowns: ["尚未执行实现，实际范围仍需在分支中确认。"],
  safety_notes: ["所有工作只允许在本地、测试环境或独立分支中进行。"],
};

describe("Token Forge AI browser client", () => {
  it("sends only the fixed Gateway envelope and revalidates the plan", async () => {
    const fetchGateway = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: "1.0",
          request_id: requestId,
          status: "ok",
          result: plan,
          usage: {
            input_tokens: 500,
            output_tokens: 400,
            total_tokens: 900,
          },
          meta: {
            attempt_count: 1,
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    const result = await requestTokenForgeAiPlan(input, undefined, {
      fetch: fetchGateway,
      requestId: () => requestId,
    });

    expect(result).toMatchObject({
      status: "ai-assisted",
      plan,
      gateway: {
        usage: {
          total_tokens: 900,
        },
        attempt_count: 1,
      },
    });
    const [url, init] = fetchGateway.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/token-forge/plan");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      schema_version: "1.0",
      request_id: requestId,
      lab_id: "token-forge",
      operation: "token-forge.plan-v1",
    });
    expect(JSON.stringify(body)).not.toContain("api_key");
    expect(JSON.stringify(body)).not.toContain("model");
  });

  it("keeps a valid template when the Gateway response is invalid", async () => {
    const result = await requestTokenForgeAiPlan(input, undefined, {
      fetch: vi.fn().mockResolvedValue(
        new Response("unsafe raw provider body", {
          status: 502,
        }),
      ),
      requestId: () => requestId,
    });

    expect(result).toMatchObject({
      status: "template-fallback",
      fallback_reason: "gateway_invalid_provider_response",
      plan: {
        mode: "template",
      },
    });
  });

  it("rejects a mismatched response request id", async () => {
    const result = await requestTokenForgeAiPlan(input, undefined, {
      fetch: vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            schema_version: "1.0",
            request_id: "123e4567-e89b-42d3-a456-426614174099",
            status: "ok",
            result: plan,
            usage: {
              input_tokens: 500,
              output_tokens: 400,
              total_tokens: 900,
            },
            meta: {
              attempt_count: 1,
            },
          }),
        ),
      ),
      requestId: () => requestId,
    });

    expect(result.status).toBe("template-fallback");
    if (result.status === "template-fallback") {
      expect(result.fallback_reason).toBe("gateway_invalid_provider_response");
    }
  });
});
