import { describe, expect, it, vi } from "vitest";

import { loadSmartRmaFixtureCorpus } from "./smart-rma-fixtures";
import { assessSmartRmaHealth } from "./smart-rma-health";
import {
  buildSmartRmaAiInput,
  requestSmartRmaAiExplanation,
  smartRmaAiOperationId,
  validateSmartRmaAiExplanation,
  validateSmartRmaAiInput,
} from "./smart-rma-ai";
import { redactSmartctlText } from "./smart-rma-redaction";

const gatewayResponse = (result: unknown): Response =>
  new Response(
    JSON.stringify({
      schema_version: "1.0",
      request_id: "123e4567-e89b-42d3-a456-426614174000",
      status: "ok",
      result,
      usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
      meta: { attempt_count: 1 },
    }),
    { headers: { "content-type": "application/json" } },
  );

describe("SMART / RMA AI boundary and graceful degradation", () => {
  it("builds a schema-valid input without raw or redacted free text", async () => {
    const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[1];
    if (!fixture) throw new Error("fixture required");
    const preview = redactSmartctlText(fixture.raw);
    const input = buildSmartRmaAiInput(
      preview.projection,
      assessSmartRmaHealth(preview.projection),
    );
    const serialized = JSON.stringify(input);

    expect(validateSmartRmaAiInput(input)).toEqual(input);
    expect(serialized).not.toContain(fixture.raw);
    expect(serialized).not.toContain("redacted_text");
    expect(serialized).not.toContain("redactions_total");
    expect(serialized).not.toContain("authorization");
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("SYNTHETIC-");
  });

  it("rejects invented references and warranty conclusions", async () => {
    const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[0];
    if (!fixture) throw new Error("fixture required");
    const preview = redactSmartctlText(fixture.raw);
    const input = buildSmartRmaAiInput(
      preview.projection,
      assessSmartRmaHealth(preview.projection),
    );
    const valid = {
      schema_version: "1.0",
      plain_language_summary: "现有结构化证据未触发已知异常规则。",
      evidence_explanations: [
        {
          rule: "healthy-baseline",
          explanation: "总体检查通过，已知异常计数没有触发规则。",
        },
      ],
      unknown_explanations: [],
      next_step_explanations: [
        { action: "continue-monitoring", explanation: "继续定期检查趋势。" },
      ],
      warranty_assessment: "not-determined",
    } as const;
    expect(validateSmartRmaAiExplanation(valid, input)).toEqual(valid);
    expect(() =>
      validateSmartRmaAiExplanation(
        {
          ...valid,
          evidence_explanations: [
            { rule: "nvme-media-errors", explanation: "输入中不存在的证据。" },
          ],
        },
        input,
      ),
    ).toThrow(/reference/);
    expect(() =>
      validateSmartRmaAiExplanation(
        { ...valid, plain_language_summary: "厂商必须保修并保证 RMA 通过。" },
        input,
      ),
    ).toThrow(/warranty/);
  });

  it.each([
    [
      "rate limit",
      new Response(
        JSON.stringify({
          schema_version: "1.0",
          status: "error",
          error: { code: "rate_limited", retryable: true },
          meta: { attempt_count: 0 },
        }),
        { status: 429 },
      ),
    ],
    ["invalid response", new Response("not-json", { status: 200 })],
  ])(
    "degrades on %s without losing deterministic results",
    async (_label, response) => {
      const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[0];
      if (!fixture) throw new Error("fixture required");
      const preview = redactSmartctlText(fixture.raw);
      const assessment = assessSmartRmaHealth(preview.projection);
      const fetchMock = vi.fn().mockResolvedValue(response);
      const result = await requestSmartRmaAiExplanation(
        preview.projection,
        assessment,
        {
          fetch: fetchMock,
          requestId: () => "123e4567-e89b-42d3-a456-426614174000",
        },
      );
      expect(result.status).toBe("unavailable");
      expect(result.assessment).toEqual(assessment);
    },
  );

  it("degrades on client timeout and keeps the deterministic assessment", async () => {
    vi.useFakeTimers();
    try {
      const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[0];
      if (!fixture) throw new Error("fixture required");
      const preview = redactSmartctlText(fixture.raw);
      const assessment = assessSmartRmaHealth(preview.projection);
      const fetchMock = vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      const pending = requestSmartRmaAiExplanation(
        preview.projection,
        assessment,
        {
          fetch: fetchMock,
          requestId: () => "123e4567-e89b-42d3-a456-426614174000",
        },
      );
      await vi.advanceTimersByTimeAsync(50_000);
      await expect(pending).resolves.toMatchObject({
        status: "unavailable",
        assessment,
        fallback_reason: "provider_timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends only the versioned minimal input and accepts a valid explanation", async () => {
    const fixture = (await loadSmartRmaFixtureCorpus()).fixtures[0];
    if (!fixture) throw new Error("fixture required");
    const preview = redactSmartctlText(fixture.raw);
    const assessment = assessSmartRmaHealth(preview.projection);
    const explanation = {
      schema_version: "1.0",
      plain_language_summary: "结构化证据未触发已知异常规则。",
      evidence_explanations: [
        { rule: "healthy-baseline", explanation: "规则基线成立。" },
      ],
      unknown_explanations: [],
      next_step_explanations: [
        { action: "continue-monitoring", explanation: "继续观察趋势。" },
      ],
      warranty_assessment: "not-determined",
    };
    const fetchMock = vi.fn().mockResolvedValue(gatewayResponse(explanation));
    const result = await requestSmartRmaAiExplanation(
      preview.projection,
      assessment,
      {
        fetch: fetchMock,
        requestId: () => "123e4567-e89b-42d3-a456-426614174000",
      },
    );
    expect(result.status).toBe("ready");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.operation).toBe(smartRmaAiOperationId);
    expect(JSON.stringify(body)).not.toContain("redacted_text");
    expect(JSON.stringify(body)).not.toContain(fixture.raw);
  });
});
