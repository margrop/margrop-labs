import { readFile } from "node:fs/promises";

import {
  type AiGatewayProviderAdapter,
  type AiGatewayProviderRequest,
} from "@margrop-labs/ai-gateway";
import { describe, expect, it, vi } from "vitest";

import {
  type IncidentDetectiveCaseGenerationInput,
  type IncidentDetectiveCaseProposal,
  type IncidentDetectiveCaseReview,
  IncidentDetectiveCaseGenerationError,
  generateIncidentDetectiveCaseProposal,
  incidentDetectiveCaseGenerationOperationId,
  reviewIncidentDetectiveCaseProposal,
  validateIncidentDetectiveCaseGenerationInput,
  validateIncidentDetectiveCaseProposal,
  validateIncidentDetectiveCaseReview,
} from "./incident-detective-case-generation";
import {
  type IncidentDetectiveScenario,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/fixtures/${name}`,
    import.meta.url,
  );
const caseUrl = (name: string): URL =>
  new URL(
    `../../../../labs/incident-detective/cases/mysql-leading-wildcard/${name}`,
    import.meta.url,
  );

const readJson = async <T>(url: URL): Promise<T> =>
  JSON.parse(await readFile(url, "utf8")) as T;

const loadFixtures = async (): Promise<{
  input: IncidentDetectiveCaseGenerationInput;
  proposal: IncidentDetectiveCaseProposal;
  review: IncidentDetectiveCaseReview;
  scenario: IncidentDetectiveScenario;
}> => ({
  input: validateIncidentDetectiveCaseGenerationInput(
    await readJson<unknown>(fixtureUrl("case-generation-input.valid.json")),
  ),
  proposal: validateIncidentDetectiveCaseProposal(
    await readJson<unknown>(fixtureUrl("case-proposal.valid.json")),
  ),
  review: validateIncidentDetectiveCaseReview(
    await readJson<unknown>(fixtureUrl("case-review.valid.json")),
  ),
  scenario: validateIncidentDetectiveScenario(
    await readJson<unknown>(caseUrl("scenario.json")),
  ),
});

const requestId = "b2e4832d-060a-49b6-b920-e311b4208e8c";

const providerSuccess = (output: unknown) => ({
  ok: true,
  output,
  finish_reason: "stop",
  usage: {
    input_tokens: 300,
    output_tokens: 900,
    total_tokens: 1_200,
  },
});

const createProvider = (
  generate: AiGatewayProviderAdapter["generate"],
): AiGatewayProviderAdapter & {
  generate: ReturnType<typeof vi.fn<AiGatewayProviderAdapter["generate"]>>;
} => ({
  adapterId: "synthetic-case-proposal-adapter",
  generate: vi.fn(generate),
});

describe("Incident Detective case proposal contracts", () => {
  it("validates the generation input, proposal and explicit human review fixtures", async () => {
    const { input, proposal, review } = await loadFixtures();
    const outcome = reviewIncidentDetectiveCaseProposal(proposal, review);

    expect(input.target_sources).toHaveLength(5);
    expect(proposal.requires_human_review).toBe(true);
    expect(outcome).toMatchObject({
      status: "approved",
      publishable: false,
    });
  });

  it("requires unique ids, known service references and all evidence roles", async () => {
    const { proposal } = await loadFixtures();
    const duplicate = structuredClone(proposal);
    duplicate.evidence_outline[1]!.id = duplicate.evidence_outline[0]!.id;
    expect(() => validateIncidentDetectiveCaseProposal(duplicate)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );

    const unknownService = structuredClone(proposal);
    unknownService.evidence_outline[0]!.service_id = "missing-service";
    expect(() => validateIncidentDetectiveCaseProposal(unknownService)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );

    const missingCounterevidence = structuredClone(proposal);
    for (const evidence of missingCounterevidence.evidence_outline) {
      if (evidence.role === "counterevidence") {
        evidence.role = "context";
      }
    }
    expect(() =>
      validateIncidentDetectiveCaseProposal(missingCounterevidence),
    ).toThrow(IncidentDetectiveCaseGenerationError);
  });

  it("requires a valid unlock DAG, reachable evidence and a real budget tradeoff", async () => {
    const { proposal } = await loadFixtures();
    const cyclic = structuredClone(proposal);
    cyclic.evidence_outline[0]!.unlocks_after = ["checkout-latency"];
    expect(() => validateIncidentDetectiveCaseProposal(cyclic)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );

    const unreachable = structuredClone(proposal);
    unreachable.evidence_outline.find(
      ({ id }) => id === "mysql-read-shape",
    )!.acquisition_cost = 3;
    unreachable.evidence_outline.find(
      ({ id }) => id === "checkout-trace",
    )!.acquisition_cost = 3;
    unreachable.evidence_budget = 7;
    expect(() => validateIncidentDetectiveCaseProposal(unreachable)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );

    const noTradeoff = structuredClone(proposal);
    noTradeoff.evidence_budget = 12;
    expect(() => validateIncidentDetectiveCaseProposal(noTradeoff)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );
  });

  it("rejects scoring fields and writable evidence access", async () => {
    const { proposal } = await loadFixtures();

    expect(() =>
      validateIncidentDetectiveCaseProposal({
        ...proposal,
        evidence_weights: {
          "checkout-trace": 10,
        },
      }),
    ).toThrow(IncidentDetectiveCaseGenerationError);

    const writable = structuredClone(proposal) as unknown as Record<
      string,
      unknown
    >;
    const outline = writable.evidence_outline as Array<Record<string, unknown>>;
    outline[0]!.access = "read-write";
    expect(() => validateIncidentDetectiveCaseProposal(writable)).toThrow(
      IncidentDetectiveCaseGenerationError,
    );
  });
});

describe("Incident Detective constrained AI generation", () => {
  it("returns only a review-required proposal and sends bounded structured constraints", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const provider = createProvider(async () => providerSuccess(proposal));
    const result = await generateIncidentDetectiveCaseProposal(input, {
      requestId,
      baseScenario: scenario,
      provider,
    });

    expect(result.status).toBe("review-required");
    expect(provider.generate).toHaveBeenCalledTimes(1);
    const providerRequest = provider.generate.mock
      .calls[0]?.[0] as AiGatewayProviderRequest;
    expect(providerRequest.operation).toBe(
      incidentDetectiveCaseGenerationOperationId,
    );
    expect(providerRequest.lab_id).toBe("incident-detective");
    expect(providerRequest.input).toMatchObject({
      proposal_id: input.proposal_id,
      base_case_id: input.base_case_id,
      guardrails: {
        synthetic_only: true,
        read_only_only: true,
        requires_human_review: true,
        scoring_rules_forbidden: true,
        automatic_publish_forbidden: true,
      },
    });

    const serialized = JSON.stringify(providerRequest);
    expect(serialized).not.toContain(scenario.title);
    expect(serialized).not.toContain(scenario.evidence[0]?.title);
    expect(serialized).not.toMatch(
      /answer\.internal|attempt\.canonical|root_cause|required_evidence_ids|score-rules/,
    );
  });

  it("replaces model safety prose with fixed server-owned guardrails", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const modelProposal = {
      ...proposal,
      safety_notes: [
        "这是一条长度足够但不应由模型控制的安全说明文本。",
        "这是一条长度足够但不应由模型控制的第二条说明。",
        "这是一条长度足够但不应由模型控制的第三条说明。",
        "这是一条长度足够但不应由模型控制的第四条说明。",
      ],
    };
    const provider = createProvider(async () => providerSuccess(modelProposal));
    const result = await generateIncidentDetectiveCaseProposal(input, {
      requestId,
      baseScenario: scenario,
      provider,
    });

    expect(result.status).toBe("review-required");
    if (result.status === "review-required") {
      expect(result.proposal.safety_notes).not.toContain(
        modelProposal.safety_notes[0],
      );
      expect(result.proposal.safety_notes).toContain(
        "评分规则必须由独立确定性合同定义，AI 候选不得携带分数或权重。",
      );
    }
  });

  it("rejects model changes to ids, constraints, sources, service kinds and learning objectives", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const variants: IncidentDetectiveCaseProposal[] = [
      { ...proposal, proposal_id: "another-proposal" },
      { ...proposal, evidence_budget: proposal.evidence_budget + 1 },
      {
        ...proposal,
        learning_objectives: [
          ...proposal.learning_objectives.slice(0, -1),
          "模型试图替换一条已经由调用方固定的学习目标，因此必须失败。",
        ],
      },
      {
        ...proposal,
        evidence_outline: proposal.evidence_outline.map((evidence, index) =>
          index === 0 ? { ...evidence, source: "prometheus" } : evidence,
        ),
      },
      {
        ...proposal,
        services: proposal.services.map((service, index) =>
          index === 0 ? { ...service, kind: "external" as const } : service,
        ),
      },
    ];

    for (const variant of variants) {
      const provider = createProvider(async () => providerSuccess(variant));
      const result = await generateIncidentDetectiveCaseProposal(input, {
        requestId,
        baseScenario: scenario,
        provider,
      });

      expect(result).toMatchObject({
        status: "generation-failed",
        failure_reason: "gateway_invalid_provider_response",
        gateway: { attempt_count: 2 },
      });
      expect(provider.generate).toHaveBeenCalledTimes(2);
    }
  });

  it("does not call the provider for sensitive input or a mismatched base case", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const provider = createProvider(async () => providerSuccess(proposal));
    const rawSecret = "case-generation-secret-must-not-echo";
    const sensitiveInput = {
      ...input,
      learning_objectives: [
        ...input.learning_objectives.slice(0, -1),
        `错误目标包含 access_token=${rawSecret}，必须在调用模型前失败关闭。`,
      ],
    };

    const sensitive = await generateIncidentDetectiveCaseProposal(
      sensitiveInput,
      {
        requestId,
        baseScenario: scenario,
        provider,
      },
    );
    const mismatch = await generateIncidentDetectiveCaseProposal(
      {
        ...input,
        base_case_id: "another-base-case",
      },
      {
        requestId,
        baseScenario: scenario,
        provider,
      },
    );

    expect(sensitive).toMatchObject({
      status: "generation-failed",
      failure_reason: "preparation_sensitive_input",
      gateway: { attempt_count: 0 },
    });
    expect(JSON.stringify(sensitive)).not.toContain(rawSecret);
    expect(mismatch).toMatchObject({
      status: "generation-failed",
      failure_reason: "preparation_base_case_mismatch",
      gateway: { attempt_count: 0 },
    });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("rejects sensitive or real-infrastructure model output after bounded retries", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const rawSecret = "provider-case-secret-must-not-echo";
    const sensitiveProposal = {
      ...proposal,
      summary: `这个候选错误地包含 authorization=Bearer ${rawSecret}，必须被整体拒绝且不能回显。`,
    };
    const provider = createProvider(async () =>
      providerSuccess(sensitiveProposal),
    );

    const result = await generateIncidentDetectiveCaseProposal(input, {
      requestId,
      baseScenario: scenario,
      provider,
    });

    expect(result).toMatchObject({
      status: "generation-failed",
      failure_reason: "gateway_invalid_provider_response",
      gateway: { attempt_count: 2 },
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(provider.generate).toHaveBeenCalledTimes(2);
  });

  it("returns a stable failure with no proposal when the gateway is unavailable", async () => {
    const { input, scenario } = await loadFixtures();
    const provider = createProvider(async () => ({
      ok: false,
      error: {
        code: "unavailable",
      },
    }));

    const result = await generateIncidentDetectiveCaseProposal(input, {
      requestId,
      baseScenario: scenario,
      provider,
    });

    expect(result).toMatchObject({
      status: "generation-failed",
      failure_reason: "gateway_provider_unavailable",
      gateway: { attempt_count: 2 },
    });
    expect(result).not.toHaveProperty("proposal");
  });

  it("has no network, storage or logging side effects outside the injected adapter", async () => {
    const { input, proposal, scenario } = await loadFixtures();
    const fetchMock = vi.fn();
    const storageMock = vi.fn();
    const logMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("localStorage", {
      getItem: storageMock,
      setItem: storageMock,
    });
    const provider = createProvider(async () => providerSuccess(proposal));

    try {
      await generateIncidentDetectiveCaseProposal(input, {
        requestId,
        baseScenario: scenario,
        provider,
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(storageMock).not.toHaveBeenCalled();
      expect(logMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      logMock.mockRestore();
    }
  });
});

describe("Incident Detective human review gate", () => {
  it("never marks an approved proposal as automatically publishable", async () => {
    const { proposal, review } = await loadFixtures();
    const result = reviewIncidentDetectiveCaseProposal(proposal, review);

    expect(result.status).toBe("approved");
    expect(result.publishable).toBe(false);
  });

  it("requires every checklist item and no outstanding changes for approval", async () => {
    const { proposal, review } = await loadFixtures();

    expect(() =>
      reviewIncidentDetectiveCaseProposal(proposal, {
        ...review,
        checklist: {
          ...review.checklist,
          privacy_confirmed: false,
        },
      }),
    ).toThrow(IncidentDetectiveCaseGenerationError);
    expect(() =>
      reviewIncidentDetectiveCaseProposal(proposal, {
        ...review,
        required_changes: [
          "需要补充一份与主要假设相互独立的合成反证后才能批准。",
        ],
      }),
    ).toThrow(IncidentDetectiveCaseGenerationError);
  });

  it("requires concrete changes for changes_requested and matches proposal ids", async () => {
    const { proposal, review } = await loadFixtures();

    expect(() =>
      reviewIncidentDetectiveCaseProposal(proposal, {
        ...review,
        decision: "changes_requested",
        required_changes: [],
      }),
    ).toThrow(IncidentDetectiveCaseGenerationError);
    expect(() =>
      reviewIncidentDetectiveCaseProposal(proposal, {
        ...review,
        proposal_id: "another-proposal",
      }),
    ).toThrow(IncidentDetectiveCaseGenerationError);

    const changesRequested = reviewIncidentDetectiveCaseProposal(proposal, {
      ...review,
      decision: "changes_requested",
      checklist: {
        ...review.checklist,
        counterevidence_confirmed: false,
      },
      required_changes: ["增加一份能够反驳整体数据库下线假设的独立合成证据。"],
    });
    expect(changesRequested).toMatchObject({
      status: "changes_requested",
      publishable: false,
    });
  });

  it("requires server-owned safety notes before accepting a review", async () => {
    const { proposal, review } = await loadFixtures();
    const changedSafety = {
      ...proposal,
      safety_notes: [
        "这是一条结构有效但没有经过服务端固定的候选安全说明。",
        ...proposal.safety_notes.slice(1),
      ],
    };

    expect(() =>
      reviewIncidentDetectiveCaseProposal(changedSafety, review),
    ).toThrow(IncidentDetectiveCaseGenerationError);
  });
});
