import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { validateAiGatewayResponse } from "./index";
import {
  type TokenForgeAiAdmissionRequest,
  type TokenForgeAiTrafficPolicy,
  TokenForgeAiPolicyContractError,
  TokenForgeAiPolicyLedger,
  admissionDecisionToAiGatewayFailure,
  tokenForgeAiTrafficHardPolicy,
  validateTokenForgeAiPolicySnapshot,
  validateTokenForgeAiTrafficPolicy,
} from "./token-forge-policy";

const fixtureUrl = new URL(
  "../../../labs/token-forge/fixtures/token-forge-ai-policy.valid.json",
  import.meta.url,
);
const startMs = Date.UTC(2026, 0, 2, 0, 0, 0);
const actorA = `anon_${"a".repeat(32)}`;
const actorB = `anon_${"b".repeat(32)}`;
const actorC = `anon_${"c".repeat(32)}`;

const requestId = (sequence: number): string =>
  `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;

const admission = (
  sequence: number,
  overrides: Partial<TokenForgeAiAdmissionRequest> = {},
): TokenForgeAiAdmissionRequest => ({
  request_id: requestId(sequence),
  actor_key: actorA,
  lab_id: "token-forge",
  operation: "token-forge.plan-v1",
  now_ms: startMs,
  reserved_tokens: 100,
  reserved_cost_microusd: 100,
  ...overrides,
});

const policyWith = (
  mutate: (policy: TokenForgeAiTrafficPolicy) => void,
): TokenForgeAiTrafficPolicy => {
  const policy = JSON.parse(
    JSON.stringify(tokenForgeAiTrafficHardPolicy),
  ) as TokenForgeAiTrafficPolicy;
  mutate(policy);
  return policy;
};

const expectAllowed = (
  decision: ReturnType<TokenForgeAiPolicyLedger["admit"]>,
): Extract<typeof decision, { status: "allowed" }> => {
  expect(decision.status).toBe("allowed");
  if (decision.status !== "allowed") {
    throw new Error("Expected the synthetic admission to be allowed.");
  }
  return decision;
};

const settleSuccess = (
  ledger: TokenForgeAiPolicyLedger,
  sequence: number,
  nowMs: number,
  actualTokens = 50,
  actualCost = 50,
) =>
  ledger.settle({
    request_id: requestId(sequence),
    now_ms: nowMs,
    outcome: {
      status: "success",
      actual_tokens: actualTokens,
      actual_cost_microusd: actualCost,
    },
  });

const settleFailure = (
  ledger: TokenForgeAiPolicyLedger,
  sequence: number,
  nowMs: number,
) =>
  ledger.settle({
    request_id: requestId(sequence),
    now_ms: nowMs,
    outcome: {
      status: "failure",
      error_code: "provider_unavailable",
    },
  });

describe("Token Forge AI traffic policy v1", () => {
  it("accepts the published policy fixture and rejects loosened or unknown fields", async () => {
    const fixture = JSON.parse(await readFile(fixtureUrl, "utf8")) as unknown;
    expect(validateTokenForgeAiTrafficPolicy(fixture)).toEqual(
      tokenForgeAiTrafficHardPolicy,
    );

    const loosened = {
      ...(fixture as TokenForgeAiTrafficPolicy),
      max_request_cost_microusd: 100_001,
    };
    expect(() => validateTokenForgeAiTrafficPolicy(loosened)).toThrow(
      TokenForgeAiPolicyContractError,
    );

    expect(() =>
      validateTokenForgeAiTrafficPolicy({
        ...(fixture as TokenForgeAiTrafficPolicy),
        provider_api_key: "synthetic-secret-value",
      }),
    ).toThrow(/additional properties/);
    try {
      validateTokenForgeAiTrafficPolicy({
        ...(fixture as TokenForgeAiTrafficPolicy),
        provider_api_key: "synthetic-secret-value",
      });
    } catch (error) {
      expect((error as Error).message).not.toContain("synthetic-secret-value");
    }
  });

  it("reserves worst-case tokens and micro-USD before allowing a request", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    const allowed = expectAllowed(ledger.admit(admission(1)));
    const snapshot = ledger.exportSnapshot();
    const actorUsage = snapshot.days["2026-01-02"]?.actors[actorA];

    expect(allowed).toEqual({
      status: "allowed",
      request_id: requestId(1),
      reservation: {
        reserved_tokens: 100,
        reserved_cost_microusd: 100,
        expires_at_ms: startMs + 60_000,
      },
      circuit_state: "closed",
    });
    expect(actorUsage).toEqual({
      tokens: 100,
      cost_microusd: 100,
      requests: 1,
    });
  });

  it("enforces actor token, lab cost, and shared site daily budgets", () => {
    const actorPolicy = policyWith((policy) => {
      policy.max_request_billable_tokens = 100;
      policy.daily_budgets.actor_tokens = 100;
    });
    const actorLedger = new TokenForgeAiPolicyLedger(actorPolicy);
    expectAllowed(actorLedger.admit(admission(1)));
    expect(
      actorLedger.admit(
        admission(2, {
          actor_key: actorB,
          reserved_tokens: 101,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "invalid_context",
    });
    expect(
      actorLedger.admit(
        admission(2, {
          now_ms: startMs + 1,
          reserved_tokens: 1,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "actor_concurrency",
    });
    settleSuccess(actorLedger, 1, startMs + 2, 100, 50);
    expect(
      actorLedger.admit(
        admission(2, {
          now_ms: startMs + 3,
          reserved_tokens: 1,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "actor_daily_budget",
      gateway_error_code: "budget_exhausted",
    });

    const labPolicy = policyWith((policy) => {
      policy.max_request_cost_microusd = 100;
      policy.daily_budgets.actor_cost_microusd = 100;
      policy.daily_budgets.lab_cost_microusd = 150;
    });
    const labLedger = new TokenForgeAiPolicyLedger(labPolicy);
    expectAllowed(labLedger.admit(admission(10, { actor_key: actorA })));
    expect(
      labLedger.admit(
        admission(11, {
          actor_key: actorB,
          now_ms: startMs + 1,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "lab_daily_budget",
    });

    const sitePolicy = policyWith((policy) => {
      policy.max_request_billable_tokens = 100;
      policy.daily_budgets.actor_tokens = 100;
      policy.daily_budgets.lab_tokens = 200;
      policy.daily_budgets.site_tokens = 250;
    });
    const seed = new TokenForgeAiPolicyLedger(sitePolicy).exportSnapshot();
    seed.days["2026-01-02"] = {
      actors: {},
      lab: { tokens: 0, cost_microusd: 0, requests: 0 },
      site: { tokens: 200, cost_microusd: 0, requests: 0 },
    };
    seed.last_seen_at_ms = startMs;
    const siteLedger = new TokenForgeAiPolicyLedger(sitePolicy, seed);
    expect(
      siteLedger.admit(
        admission(20, {
          actor_key: actorC,
          reserved_tokens: 100,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "site_daily_budget",
    });
  });

  it("refunds unused reservation capacity after trusted success settlement", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));

    expect(settleSuccess(ledger, 1, startMs + 1, 25, 30)).toEqual({
      status: "settled",
      charged_tokens: 25,
      charged_cost_microusd: 30,
      circuit_state: "closed",
    });

    const usage = ledger.exportSnapshot().days["2026-01-02"]?.actors[actorA];
    expect(usage).toEqual({
      tokens: 25,
      cost_microusd: 30,
      requests: 1,
    });
  });

  it("keeps the full reservation charged on failures and expired calls", () => {
    const policy = policyWith((candidate) => {
      candidate.reservation_ttl_seconds = 5;
    });
    const ledger = new TokenForgeAiPolicyLedger(policy);
    expectAllowed(ledger.admit(admission(1)));
    expect(settleFailure(ledger, 1, startMs + 1)).toMatchObject({
      status: "settled",
      charged_tokens: 100,
      charged_cost_microusd: 100,
    });

    expectAllowed(
      ledger.admit(
        admission(2, {
          actor_key: actorB,
          now_ms: startMs + 2,
        }),
      ),
    );
    expectAllowed(
      ledger.admit(
        admission(3, {
          actor_key: actorB,
          now_ms: startMs + 5_002,
        }),
      ),
    );
    expect(ledger.exportSnapshot().days["2026-01-02"]?.actors[actorB]).toEqual({
      tokens: 200,
      cost_microusd: 200,
      requests: 2,
    });
  });

  it("enforces sliding rate limits and releases concurrency after settlement", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));
    expect(ledger.admit(admission(2, { now_ms: startMs + 1 }))).toMatchObject({
      status: "denied",
      reason: "actor_concurrency",
      gateway_error_code: "rate_limited",
    });

    settleSuccess(ledger, 1, startMs + 2);
    expectAllowed(ledger.admit(admission(2, { now_ms: startMs + 3 })));
    settleSuccess(ledger, 2, startMs + 4);
    expect(ledger.admit(admission(3, { now_ms: startMs + 5 }))).toMatchObject({
      status: "denied",
      reason: "actor_rate_limit",
      retry_after_seconds: 60,
    });

    expectAllowed(ledger.admit(admission(3, { now_ms: startMs + 60_001 })));
  });

  it("enforces Lab rate, concurrency, and non-refundable daily request caps", () => {
    const ratePolicy = policyWith((policy) => {
      policy.rate_limit.lab_requests = 2;
      policy.rate_limit.site_requests = 3;
    });
    const rateLedger = new TokenForgeAiPolicyLedger(ratePolicy);
    expectAllowed(rateLedger.admit(admission(1, { actor_key: actorA })));
    settleSuccess(rateLedger, 1, startMs + 1);
    expectAllowed(
      rateLedger.admit(
        admission(2, {
          actor_key: actorB,
          now_ms: startMs + 2,
        }),
      ),
    );
    settleSuccess(rateLedger, 2, startMs + 3);
    expect(
      rateLedger.admit(
        admission(3, {
          actor_key: actorC,
          now_ms: startMs + 4,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "lab_rate_limit",
    });

    const concurrencyPolicy = policyWith((policy) => {
      policy.concurrency.lab_in_flight = 2;
      policy.concurrency.site_in_flight = 3;
    });
    const concurrencyLedger = new TokenForgeAiPolicyLedger(concurrencyPolicy);
    expectAllowed(
      concurrencyLedger.admit(admission(10, { actor_key: actorA })),
    );
    expectAllowed(
      concurrencyLedger.admit(
        admission(11, {
          actor_key: actorB,
          now_ms: startMs + 1,
        }),
      ),
    );
    expect(
      concurrencyLedger.admit(
        admission(12, {
          actor_key: actorC,
          now_ms: startMs + 2,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "lab_concurrency",
    });

    const requestPolicy = policyWith((policy) => {
      policy.daily_budgets.actor_requests = 2;
    });
    const requestLedger = new TokenForgeAiPolicyLedger(requestPolicy);
    expectAllowed(requestLedger.admit(admission(20)));
    settleSuccess(requestLedger, 20, startMs + 1, 0, 0);
    expectAllowed(
      requestLedger.admit(
        admission(21, {
          now_ms: startMs + 60_001,
        }),
      ),
    );
    settleSuccess(requestLedger, 21, startMs + 60_002, 0, 0);
    expect(
      requestLedger.admit(
        admission(22, {
          now_ms: startMs + 120_002,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "actor_daily_budget",
    });
  });

  it("prevents duplicate request IDs from reserving or settling twice", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));
    expect(ledger.admit(admission(1, { now_ms: startMs + 1 }))).toMatchObject({
      status: "denied",
      reason: "duplicate_request",
    });

    expect(settleSuccess(ledger, 1, startMs + 2)).toMatchObject({
      status: "settled",
    });
    expect(settleSuccess(ledger, 1, startMs + 3)).toEqual({
      status: "already_settled",
    });
    expect(
      ledger.exportSnapshot().days["2026-01-02"]?.actors[actorA],
    ).toMatchObject({ requests: 1 });
  });

  it("opens the circuit, permits one half-open probe, and closes on success", () => {
    const policy = policyWith((candidate) => {
      candidate.circuit_breaker.consecutive_failures = 2;
    });
    const ledger = new TokenForgeAiPolicyLedger(policy);

    expectAllowed(ledger.admit(admission(1)));
    settleFailure(ledger, 1, startMs + 1);
    expectAllowed(
      ledger.admit(
        admission(2, {
          actor_key: actorB,
          now_ms: startMs + 2,
        }),
      ),
    );
    settleFailure(ledger, 2, startMs + 3);

    expect(
      ledger.admit(
        admission(3, {
          actor_key: actorC,
          now_ms: startMs + 4,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "circuit_open",
      gateway_error_code: "provider_unavailable",
      retry_after_seconds: 60,
    });

    const probeTime = startMs + 60_004;
    expect(
      expectAllowed(
        ledger.admit(
          admission(3, {
            actor_key: actorC,
            now_ms: probeTime,
          }),
        ),
      ).circuit_state,
    ).toBe("half_open");
    expect(
      ledger.admit(
        admission(4, {
          actor_key: actorA,
          now_ms: probeTime + 1,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "circuit_open",
    });

    expect(settleSuccess(ledger, 3, probeTime + 2)).toMatchObject({
      status: "settled",
      circuit_state: "closed",
    });
    expectAllowed(
      ledger.admit(
        admission(4, {
          actor_key: actorA,
          now_ms: probeTime + 3,
        }),
      ),
    );
  });

  it("reopens the circuit when the half-open probe fails", () => {
    const policy = policyWith((candidate) => {
      candidate.circuit_breaker.consecutive_failures = 1;
    });
    const ledger = new TokenForgeAiPolicyLedger(policy);

    expectAllowed(ledger.admit(admission(1)));
    settleFailure(ledger, 1, startMs + 1);
    const probeTime = startMs + 60_001;
    expectAllowed(
      ledger.admit(
        admission(2, {
          actor_key: actorB,
          now_ms: probeTime,
        }),
      ),
    );
    settleFailure(ledger, 2, probeTime + 1);
    expect(
      ledger.admit(
        admission(3, {
          actor_key: actorC,
          now_ms: probeTime + 2,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "circuit_open",
      retry_after_seconds: 60,
    });
  });

  it("restores budgets and circuit state from a bounded privacy-safe snapshot", () => {
    const policy = policyWith((candidate) => {
      candidate.circuit_breaker.consecutive_failures = 1;
    });
    const ledger = new TokenForgeAiPolicyLedger(policy);
    expectAllowed(ledger.admit(admission(1)));
    settleFailure(ledger, 1, startMs + 1);

    const serialized = JSON.stringify(ledger.exportSnapshot());
    expect(serialized).not.toMatch(
      /goal|repository|url|prompt|cookie|ip_address|user_agent|provider_error/i,
    );

    const restored = new TokenForgeAiPolicyLedger(
      policy,
      JSON.parse(serialized),
    );
    expect(
      restored.admit(
        admission(2, {
          actor_key: actorB,
          now_ms: startMs + 2,
        }),
      ),
    ).toMatchObject({
      status: "denied",
      reason: "circuit_open",
    });
  });

  it("rejects malformed snapshots and time rollback without echoing values", () => {
    const snapshot = new TokenForgeAiPolicyLedger().exportSnapshot();
    expect(() =>
      validateTokenForgeAiPolicySnapshot({
        ...snapshot,
        raw_prompt: "synthetic-sensitive-value",
      }),
    ).toThrow("snapshot validation failed");

    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1, { now_ms: startMs + 10 })));
    expect(
      ledger.admit(
        admission(2, {
          now_ms: startMs + 9,
        }),
      ),
    ).toEqual({
      status: "denied",
      reason: "invalid_context",
      gateway_error_code: "invalid_request",
    });
  });

  it("fails closed when trusted usage exceeds the reservation", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));
    expect(settleSuccess(ledger, 1, startMs + 1, 101, 100)).toEqual({
      status: "rejected",
      reason: "usage_exceeded_reservation",
    });
    expect(ledger.exportSnapshot().days["2026-01-02"]?.actors[actorA]).toEqual({
      tokens: 100,
      cost_microusd: 100,
      requests: 1,
    });
  });

  it("maps internal denials to the existing safe Gateway failure envelope", () => {
    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));
    const denial = ledger.admit(admission(2, { now_ms: startMs + 1 }));
    expect(denial.status).toBe("denied");
    if (denial.status !== "denied") {
      throw new Error("Expected a synthetic admission denial.");
    }

    const failure = admissionDecisionToAiGatewayFailure(denial, requestId(2));
    expect(validateAiGatewayResponse(failure)).toEqual(failure);
    expect(failure).toEqual({
      schema_version: "1.0",
      request_id: requestId(2),
      status: "error",
      error: {
        code: "rate_limited",
        retryable: true,
        retry_after_seconds: 60,
      },
      meta: {
        attempt_count: 0,
      },
    });
  });

  it("has no network, persistence, or logging side effects", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const ledger = new TokenForgeAiPolicyLedger();
    expectAllowed(ledger.admit(admission(1)));
    settleSuccess(ledger, 1, startMs + 1);
    ledger.exportSnapshot();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
