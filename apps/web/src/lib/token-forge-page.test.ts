import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  buildTokenForgeInputFromForm,
  classifyTokenForgeDevice,
  emitTokenForgeEvent,
  TokenForgeEventError,
  TokenForgeFormError,
  tokenForgeSyntheticFormValues,
  validateTokenForgeEvent,
} from "./token-forge-page";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";
import { buildTokenForgeExports } from "./token-forge-exports";

describe("Token Forge page input", () => {
  it("runs the synthetic form through template generation and export", () => {
    const input = buildTokenForgeInputFromForm({
      ...tokenForgeSyntheticFormValues,
    });
    const plan = generateTokenForgeTemplatePlan(input);
    const exports = buildTokenForgeExports(input, plan);

    expect(input.repository_url).toBeUndefined();
    expect(plan.mode).toBe("template");
    expect(exports.markdown.content).toContain("确定性模板");
    expect(exports.github_issues.issues).toHaveLength(plan.tasks.length);
  });

  it("normalizes stack separators and removes duplicates", () => {
    const input = buildTokenForgeInputFromForm({
      ...tokenForgeSyntheticFormValues,
      tech_stack: "TypeScript，Astro\nTypeScript; Vitest",
    });

    expect(input.tech_stack).toEqual(["TypeScript", "Astro", "Vitest"]);
  });

  it("normalizes an optional canonical public repository URL", () => {
    const input = buildTokenForgeInputFromForm({
      ...tokenForgeSyntheticFormValues,
      repository_url: "  https://github.com/acme/synthetic-repository.git  ",
    });

    expect(input.repository_url).toBe(
      "https://github.com/acme/synthetic-repository",
    );
  });

  it("redacts identifiers before they enter a plan", () => {
    const rawEmail = "operator@example.com";
    const rawIp = "192.0.2.42";
    const input = buildTokenForgeInputFromForm({
      ...tokenForgeSyntheticFormValues,
      goal: `为 ${rawEmail} 在 ${rawIp} 的合成环境创建可验证互动工具`,
    });

    expect(JSON.stringify(input)).not.toContain(rawEmail);
    expect(JSON.stringify(input)).not.toContain(rawIp);
    expect(input.goal).toContain("[REDACTED:EMAIL]");
    expect(input.goal).toContain("[REDACTED:IP]");
  });

  it("rejects Secret input without including its value in the error", () => {
    const rawSecret = "synthetic-token-value";
    let error: unknown;
    try {
      buildTokenForgeInputFromForm({
        ...tokenForgeSyntheticFormValues,
        goal: `使用 api_key=${rawSecret} 构建互动工具，并完成离线测试与导出`,
      });
    } catch (candidate) {
      error = candidate;
    }

    expect(error).toBeInstanceOf(TokenForgeFormError);
    expect(error).toMatchObject({ code: "sensitive_input" });
    expect(String(error)).not.toContain(rawSecret);
  });

  it.each([
    [{ token_budget: "1999" }, "invalid_token_budget"],
    [{ expires_in_days: "31" }, "invalid_expiry"],
    [{ available_hours: "1.2" }, "invalid_hours"],
    [{ tech_stack: "" }, "invalid_stack"],
    [{ goal: "太短" }, "invalid_goal"],
    [
      {
        repository_url:
          "https://github.com/acme/synthetic-repository/tree/main",
      },
      "invalid_repository_url",
    ],
  ])("returns a stable error for invalid form values", (override, code) => {
    expect(() =>
      buildTokenForgeInputFromForm({
        ...tokenForgeSyntheticFormValues,
        ...override,
      }),
    ).toThrow(expect.objectContaining({ code }));
  });
});

describe("Token Forge minimal events", () => {
  it("accepts the synthetic event fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../../labs/token-forge/fixtures/token-forge-event.valid.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;

    expect(validateTokenForgeEvent(fixture)).toEqual(fixture);
  });

  it("drops form, repository, plan and error fields before the event boundary", () => {
    const event = validateTokenForgeEvent({
      schema_version: "1.0",
      event_name: "export",
      lab_id: "token-forge",
      lab_version: "1.0",
      device_category: "mobile",
      goal: "must-not-cross",
      repository_url: "https://github.com/acme/private-context",
      plan: { prompt: "must-not-cross" },
      error: "must-not-cross",
      api_key: "must-not-cross",
    });

    expect(event).toEqual({
      schema_version: "1.0",
      event_name: "export",
      lab_id: "token-forge",
      lab_version: "1.0",
      device_category: "mobile",
    });
    expect(JSON.stringify(event)).not.toContain("must-not-cross");
  });

  it("rejects unknown event names and high-cardinality device data", () => {
    expect(() =>
      validateTokenForgeEvent({
        schema_version: "1.0",
        event_name: "form_change",
        lab_id: "token-forge",
        lab_version: "1.0",
        device_category: "390x844",
      }),
    ).toThrow(TokenForgeEventError);
  });

  it.each([
    [390, "mobile"],
    [768, "tablet"],
    [1_024, "desktop"],
    [-1, "unknown"],
    [undefined, "unknown"],
  ])("classifies width %j as %s", (width, expected) => {
    expect(classifyTokenForgeDevice(width)).toBe(expected);
  });

  it("emits only the validated event and ignores sink failures", () => {
    const sink = vi.fn();
    const event = emitTokenForgeEvent("run_success", "desktop", sink);

    expect(sink).toHaveBeenCalledWith(event);
    expect(() =>
      emitTokenForgeEvent("run_failure", "unknown", () => {
        throw new Error("synthetic sink failure");
      }),
    ).not.toThrow();
  });

  it("does not use network, storage or console for the default sink", () => {
    const fetchMock = vi.fn();
    const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    try {
      emitTokenForgeEvent("lab_open", "desktop");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      consoleMock.mockRestore();
    }
  });
});
