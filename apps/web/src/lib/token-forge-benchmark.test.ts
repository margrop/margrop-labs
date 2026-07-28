import { describe, expect, it, vi } from "vitest";

import benchmarkReport from "../../../../labs/token-forge/benchmarks/report.json";
import {
  prepareTokenForgeAiInput,
  type TokenForgeAiProviderInput,
} from "./token-forge-ai";
import {
  buildTokenForgeBenchmarkMetrics,
  runTokenForgeFailureMatrix,
  runTokenForgePlanningBenchmark,
  tokenForgeBenchmarkCorpus,
  tokenForgePrivacySinks,
} from "./token-forge-benchmark";
import type { TokenForgeInput } from "./token-forge-contracts";
import { buildTokenForgeExports } from "./token-forge-exports";
import { validateTokenForgeEvent } from "./token-forge-page";
import { generateTokenForgeRepositoryPageResult } from "./token-forge-repository-page";
import { generateTokenForgeTemplatePlan } from "./token-forge-templates";

const privacyRawValues = [
  "operator@example.com",
  "192.0.2.42",
  "api.example.com",
  "SYNTHETIC123",
  "0x5000000000000001",
] as const;

const privacyInput: TokenForgeInput = {
  schema_version: "1.0",
  token_budget: 16_000,
  expires_in_days: 5,
  available_hours: 8,
  tech_stack: ["TypeScript", "Vitest"],
  goal: [
    `联系 ${privacyRawValues[0]}`,
    `检查 ${privacyRawValues[1]} 与 ${privacyRawValues[2]}`,
    `Serial Number: ${privacyRawValues[3]}`,
    `WWN: ${privacyRawValues[4]}`,
    "并为完全合成的边界补充自动化测试",
  ].join("；"),
};

const expectNoRawValues = (candidate: unknown): void => {
  const serialized =
    typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  for (const rawValue of privacyRawValues) {
    expect(serialized).not.toContain(rawValue);
  }
};

const runPrivacySinkMatrix = async (): Promise<number> => {
  let passed = 0;
  const route = new URL("/token-forge/", "https://lab.example.com");
  expectNoRawValues(route.href);
  passed += 1;

  const consoleSpies = [
    vi.spyOn(console, "log").mockImplementation(() => {}),
    vi.spyOn(console, "info").mockImplementation(() => {}),
    vi.spyOn(console, "warn").mockImplementation(() => {}),
    vi.spyOn(console, "error").mockImplementation(() => {}),
  ];
  try {
    await generateTokenForgeRepositoryPageResult({
      token_budget: String(privacyInput.token_budget),
      expires_in_days: String(privacyInput.expires_in_days),
      available_hours: String(privacyInput.available_hours),
      tech_stack: privacyInput.tech_stack.join(", "),
      goal: privacyInput.goal,
      repository_url: "",
    });
    expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(true);
    passed += 1;
  } finally {
    for (const spy of consoleSpies) {
      spy.mockRestore();
    }
  }

  const analytics = validateTokenForgeEvent({
    schema_version: "1.0",
    event_name: "run_success",
    lab_id: "token-forge",
    lab_version: "1.0",
    device_category: "desktop",
    goal: privacyInput.goal,
    repository_url: "https://github.com/acme/synthetic-private-context",
    plan: { prompt: privacyInput.goal },
  });
  expectNoRawValues(analytics);
  passed += 1;

  const aiRequest = prepareTokenForgeAiInput(
    privacyInput,
  ) as TokenForgeAiProviderInput;
  expectNoRawValues(aiRequest);
  passed += 1;

  const plan = generateTokenForgeTemplatePlan(privacyInput);
  const exports = buildTokenForgeExports(privacyInput, plan);
  expectNoRawValues(exports);
  passed += 1;

  return passed;
};

describe("Token Forge end-to-end benchmark", () => {
  it("runs at least 30 planning scenarios across the synthetic stack catalog", async () => {
    const results = await runTokenForgePlanningBenchmark();

    expect(results).toHaveLength(31);
    expect(tokenForgeBenchmarkCorpus.repository_snapshots).toHaveLength(8);
    expect(tokenForgeBenchmarkCorpus.profiles).toHaveLength(15);
    expect(
      results.every(
        ({ result }) =>
          result.exports.github_issues.issues.length ===
            result.plan.tasks.length &&
          result.agent_package.stages.length === result.plan.tasks.length,
      ),
    ).toBe(true);
  });

  it("passes every AI, network, Schema and export failure case", async () => {
    const result = await runTokenForgeFailureMatrix();

    expect(result).toEqual({
      passed: 35,
      total: 35,
      by_layer: {
        ai: 15,
        network: 9,
        schema: 7,
        export: 4,
      },
    });
  });

  it("keeps sensitive values out of all five named sinks", async () => {
    expect(tokenForgeBenchmarkCorpus.privacy_sinks).toEqual(
      tokenForgePrivacySinks,
    );
    expect(await runPrivacySinkMatrix()).toBe(5);
  });

  it("meets the deterministic plan quality and downgrade thresholds", async () => {
    const metrics = await buildTokenForgeBenchmarkMetrics(5);
    const qualityRatio =
      metrics.plans_without_unverifiable_tasks / metrics.planning_scenarios;

    expect(metrics).toEqual({
      schema_version: "1.0",
      planning_scenarios: 31,
      repository_snapshots: 8,
      technology_profiles: 15,
      contract_passed: 31,
      dag_passed: 31,
      budget_passed: 31,
      plans_without_unverifiable_tasks: 31,
      plans_flagged_for_review: 0,
      fallback_scenarios: 7,
      fallback_scenarios_passed: 7,
      failure_cases: 35,
      failure_cases_passed: 35,
      privacy_sinks: 5,
    });
    expect(qualityRatio).toBeGreaterThanOrEqual(0.9);
    expect(metrics.fallback_scenarios_passed).toBe(metrics.fallback_scenarios);
    expect(benchmarkReport.metrics).toEqual(metrics);
    expect(benchmarkReport.browser_critical_paths).toEqual([
      "local-sample-export",
      "repository-rate-limit-fallback",
      "ai-rate-limit-fallback",
      "mobile-keyboard-reduced-motion",
    ]);
  });
});
