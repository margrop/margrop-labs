import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import policySchema from "../../../schemas/token-forge-ai-policy-v1.schema.json";
import type { AiGatewayErrorCode, AiGatewayFailureResponse } from "./index";

export type TokenForgeAiTrafficPolicy = {
  schema_version: "1.0";
  lab_id: "token-forge";
  operation: "token-forge.plan-v1";
  max_request_billable_tokens: number;
  max_request_cost_microusd: number;
  daily_budgets: {
    actor_tokens: number;
    lab_tokens: number;
    site_tokens: number;
    actor_cost_microusd: number;
    lab_cost_microusd: number;
    site_cost_microusd: number;
    actor_requests: number;
    lab_requests: number;
    site_requests: number;
  };
  rate_limit: {
    window_seconds: number;
    actor_requests: number;
    lab_requests: number;
    site_requests: number;
  };
  concurrency: {
    actor_in_flight: number;
    lab_in_flight: number;
    site_in_flight: number;
  };
  circuit_breaker: {
    consecutive_failures: number;
    open_seconds: number;
    half_open_requests: 1;
  };
  reservation_ttl_seconds: number;
};

type UsageCounter = {
  tokens: number;
  cost_microusd: number;
  requests: number;
};

type DayBucket = {
  actors: Record<string, UsageCounter>;
  lab: UsageCounter;
  site: UsageCounter;
};

type Reservation = {
  actor_key: string;
  day_key: string;
  reserved_tokens: number;
  reserved_cost_microusd: number;
  expires_at_ms: number;
  circuit_probe: boolean;
};

type CircuitSnapshot = {
  state: "closed" | "open" | "half_open";
  consecutive_failures: number;
  opened_at_ms?: number;
  half_open_request_id?: string;
};

export type TokenForgeAiPolicySnapshot = {
  schema_version: "1.0";
  last_seen_at_ms: number;
  days: Record<string, DayBucket>;
  rate_events: {
    actors: Record<string, number[]>;
    lab: number[];
    site: number[];
  };
  reservations: Record<string, Reservation>;
  completed_request_ids: Record<string, number>;
  circuit: CircuitSnapshot;
};

export type TokenForgeAiAdmissionRequest = {
  request_id: string;
  actor_key: string;
  lab_id: "token-forge";
  operation: "token-forge.plan-v1";
  now_ms: number;
  reserved_tokens: number;
  reserved_cost_microusd: number;
};

export type TokenForgeAiAdmissionDenialReason =
  | "invalid_context"
  | "duplicate_request"
  | "actor_daily_budget"
  | "lab_daily_budget"
  | "site_daily_budget"
  | "actor_rate_limit"
  | "lab_rate_limit"
  | "site_rate_limit"
  | "actor_concurrency"
  | "lab_concurrency"
  | "site_concurrency"
  | "circuit_open";

export type TokenForgeAiAdmissionDecision =
  | {
      status: "allowed";
      request_id: string;
      reservation: {
        reserved_tokens: number;
        reserved_cost_microusd: number;
        expires_at_ms: number;
      };
      circuit_state: "closed" | "half_open";
    }
  | {
      status: "denied";
      reason: TokenForgeAiAdmissionDenialReason;
      gateway_error_code:
        | "invalid_request"
        | "rate_limited"
        | "budget_exhausted"
        | "provider_unavailable";
      retry_after_seconds?: number;
    };

export type TokenForgeAiSettlementRequest =
  | {
      request_id: string;
      now_ms: number;
      outcome: {
        status: "success";
        actual_tokens: number;
        actual_cost_microusd: number;
      };
    }
  | {
      request_id: string;
      now_ms: number;
      outcome: {
        status: "failure";
        error_code: AiGatewayErrorCode;
      };
    };

export type TokenForgeAiSettlementResult =
  | {
      status: "settled";
      charged_tokens: number;
      charged_cost_microusd: number;
      circuit_state: CircuitSnapshot["state"];
    }
  | {
      status: "already_settled";
    }
  | {
      status: "rejected";
      reason:
        | "invalid_context"
        | "unknown_reservation"
        | "usage_exceeded_reservation";
    };

export class TokenForgeAiPolicyContractError extends Error {
  override name = "TokenForgeAiPolicyContractError";
}

const emptyUsage = (): UsageCounter => ({
  tokens: 0,
  cost_microusd: 0,
  requests: 0,
});

const emptySnapshot = (): TokenForgeAiPolicySnapshot => ({
  schema_version: "1.0",
  last_seen_at_ms: 0,
  days: {},
  rate_events: {
    actors: {},
    lab: [],
    site: [],
  },
  reservations: {},
  completed_request_ids: {},
  circuit: {
    state: "closed",
    consecutive_failures: 0,
  },
});

const hardPolicyCandidate: TokenForgeAiTrafficPolicy = {
  schema_version: "1.0",
  lab_id: "token-forge",
  operation: "token-forge.plan-v1",
  max_request_billable_tokens: 56_000,
  max_request_cost_microusd: 100_000,
  daily_budgets: {
    actor_tokens: 224_000,
    lab_tokens: 2_240_000,
    site_tokens: 5_600_000,
    actor_cost_microusd: 250_000,
    lab_cost_microusd: 5_000_000,
    site_cost_microusd: 10_000_000,
    actor_requests: 12,
    lab_requests: 200,
    site_requests: 400,
  },
  rate_limit: {
    window_seconds: 60,
    actor_requests: 2,
    lab_requests: 20,
    site_requests: 40,
  },
  concurrency: {
    actor_in_flight: 1,
    lab_in_flight: 4,
    site_in_flight: 6,
  },
  circuit_breaker: {
    consecutive_failures: 5,
    open_seconds: 60,
    half_open_requests: 1,
  },
  reservation_ttl_seconds: 60,
};

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const policyValidator = ajv.compile<TokenForgeAiTrafficPolicy>(
  policySchema as AnySchema,
);
const textEncoder = new TextEncoder();
const maxSnapshotBytes = 256 * 1024;
const completedRequestTtlMs = 24 * 60 * 60 * 1_000;
const maxTimestampMs = 8_640_000_000_000_000;
const maxOperationalTimestampMs = maxTimestampMs - completedRequestTtlMs;
const actorKeyPattern = /^anon_[A-Za-z0-9_-]{32,64}$/;
const requestIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dayKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

const hasOnlyKeys = (
  candidate: Record<string, unknown>,
  allowed: readonly string[],
): boolean => Object.keys(candidate).every((key) => allowed.includes(key));

const hasExactKeys = (
  candidate: Record<string, unknown>,
  required: readonly string[],
): boolean =>
  Object.keys(candidate).length === required.length &&
  required.every((key) => Object.hasOwn(candidate, key));

const isSafeInteger = (
  candidate: unknown,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): candidate is number =>
  typeof candidate === "number" &&
  Number.isSafeInteger(candidate) &&
  candidate >= minimum &&
  candidate <= maximum;

const cloneJson = <T>(candidate: T, contractName: string): T => {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    throw new TokenForgeAiPolicyContractError(
      `${contractName} must be serializable JSON.`,
    );
  }

  if (
    serialized === undefined ||
    textEncoder.encode(serialized).byteLength > maxSnapshotBytes
  ) {
    throw new TokenForgeAiPolicyContractError(
      `${contractName} exceeded the serialization limit.`,
    );
  }

  return JSON.parse(serialized) as T;
};

const deepFreeze = <T>(candidate: T): Readonly<T> => {
  if (typeof candidate === "object" && candidate !== null) {
    for (const child of Object.values(candidate)) {
      deepFreeze(child);
    }
    Object.freeze(candidate);
  }
  return candidate;
};

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message ?? "is invalid"}`;
    })
    .join("; ");

const assertScopeOrder = (
  actor: number,
  lab: number,
  site: number,
  field: string,
): void => {
  if (actor > lab || lab > site) {
    throw new TokenForgeAiPolicyContractError(
      `${field} must increase from actor to lab to site.`,
    );
  }
};

export const validateTokenForgeAiTrafficPolicy = (
  candidate: unknown,
): TokenForgeAiTrafficPolicy => {
  const cloned = cloneJson(candidate, "Token Forge AI traffic policy");
  if (!policyValidator(cloned)) {
    throw new TokenForgeAiPolicyContractError(
      `token-forge-ai-policy-v1 validation failed: ${formatValidationErrors(policyValidator.errors)}`,
    );
  }

  const policy = cloned as TokenForgeAiTrafficPolicy;
  assertScopeOrder(
    policy.daily_budgets.actor_tokens,
    policy.daily_budgets.lab_tokens,
    policy.daily_budgets.site_tokens,
    "Daily token budgets",
  );
  assertScopeOrder(
    policy.daily_budgets.actor_cost_microusd,
    policy.daily_budgets.lab_cost_microusd,
    policy.daily_budgets.site_cost_microusd,
    "Daily cost budgets",
  );
  assertScopeOrder(
    policy.daily_budgets.actor_requests,
    policy.daily_budgets.lab_requests,
    policy.daily_budgets.site_requests,
    "Daily request budgets",
  );
  assertScopeOrder(
    policy.rate_limit.actor_requests,
    policy.rate_limit.lab_requests,
    policy.rate_limit.site_requests,
    "Rate limits",
  );
  assertScopeOrder(
    policy.concurrency.actor_in_flight,
    policy.concurrency.lab_in_flight,
    policy.concurrency.site_in_flight,
    "Concurrency limits",
  );

  if (
    policy.max_request_billable_tokens > policy.daily_budgets.actor_tokens ||
    policy.max_request_cost_microusd > policy.daily_budgets.actor_cost_microusd
  ) {
    throw new TokenForgeAiPolicyContractError(
      "Per-request reservations must fit inside the actor daily budget.",
    );
  }

  return policy;
};

export const tokenForgeAiTrafficHardPolicy: Readonly<TokenForgeAiTrafficPolicy> =
  deepFreeze(validateTokenForgeAiTrafficPolicy(hardPolicyCandidate));

const validateUsage = (candidate: unknown): candidate is UsageCounter =>
  isRecord(candidate) &&
  hasExactKeys(candidate, ["tokens", "cost_microusd", "requests"]) &&
  isSafeInteger(candidate.tokens) &&
  isSafeInteger(candidate.cost_microusd) &&
  isSafeInteger(candidate.requests);

const validateTimestampArray = (candidate: unknown): candidate is number[] =>
  Array.isArray(candidate) &&
  candidate.length <= 400 &&
  candidate.every((value) => isSafeInteger(value, 0, maxTimestampMs));

const validateSnapshotShape = (
  candidate: unknown,
): candidate is TokenForgeAiPolicySnapshot => {
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, [
      "schema_version",
      "last_seen_at_ms",
      "days",
      "rate_events",
      "reservations",
      "completed_request_ids",
      "circuit",
    ]) ||
    candidate.schema_version !== "1.0" ||
    !isSafeInteger(candidate.last_seen_at_ms, 0, maxTimestampMs) ||
    !isRecord(candidate.days) ||
    Object.keys(candidate.days).length > 2 ||
    !isRecord(candidate.rate_events) ||
    !isRecord(candidate.reservations) ||
    Object.keys(candidate.reservations).length > 6 ||
    !isRecord(candidate.completed_request_ids) ||
    Object.keys(candidate.completed_request_ids).length > 1_000 ||
    !isRecord(candidate.circuit)
  ) {
    return false;
  }

  for (const [dayKey, rawDay] of Object.entries(candidate.days)) {
    if (
      !dayKeyPattern.test(dayKey) ||
      !isRecord(rawDay) ||
      !hasExactKeys(rawDay, ["actors", "lab", "site"]) ||
      !isRecord(rawDay.actors) ||
      Object.keys(rawDay.actors).length > 1_000 ||
      !validateUsage(rawDay.lab) ||
      !validateUsage(rawDay.site)
    ) {
      return false;
    }

    for (const [actorKey, usage] of Object.entries(rawDay.actors)) {
      if (!actorKeyPattern.test(actorKey) || !validateUsage(usage)) {
        return false;
      }
    }
  }

  if (
    !hasExactKeys(candidate.rate_events, ["actors", "lab", "site"]) ||
    !isRecord(candidate.rate_events.actors) ||
    Object.keys(candidate.rate_events.actors).length > 1_000 ||
    !validateTimestampArray(candidate.rate_events.lab) ||
    !validateTimestampArray(candidate.rate_events.site)
  ) {
    return false;
  }

  for (const [actorKey, events] of Object.entries(
    candidate.rate_events.actors,
  )) {
    if (!actorKeyPattern.test(actorKey) || !validateTimestampArray(events)) {
      return false;
    }
  }

  for (const [requestId, rawReservation] of Object.entries(
    candidate.reservations,
  )) {
    if (
      !requestIdPattern.test(requestId) ||
      !isRecord(rawReservation) ||
      !hasExactKeys(rawReservation, [
        "actor_key",
        "day_key",
        "reserved_tokens",
        "reserved_cost_microusd",
        "expires_at_ms",
        "circuit_probe",
      ]) ||
      typeof rawReservation.actor_key !== "string" ||
      !actorKeyPattern.test(rawReservation.actor_key) ||
      typeof rawReservation.day_key !== "string" ||
      !dayKeyPattern.test(rawReservation.day_key) ||
      !isSafeInteger(rawReservation.reserved_tokens, 1, 56_000) ||
      !isSafeInteger(rawReservation.reserved_cost_microusd, 1, 100_000) ||
      !isSafeInteger(rawReservation.expires_at_ms, 0, maxTimestampMs) ||
      typeof rawReservation.circuit_probe !== "boolean"
    ) {
      return false;
    }
  }

  for (const [requestId, expiresAt] of Object.entries(
    candidate.completed_request_ids,
  )) {
    if (
      !requestIdPattern.test(requestId) ||
      !isSafeInteger(expiresAt, 0, maxTimestampMs)
    ) {
      return false;
    }
  }

  if (
    !hasOnlyKeys(candidate.circuit, [
      "state",
      "consecutive_failures",
      "opened_at_ms",
      "half_open_request_id",
    ]) ||
    !Object.hasOwn(candidate.circuit, "state") ||
    !Object.hasOwn(candidate.circuit, "consecutive_failures") ||
    !["closed", "open", "half_open"].includes(
      candidate.circuit.state as string,
    ) ||
    !isSafeInteger(candidate.circuit.consecutive_failures, 0, 1_000)
  ) {
    return false;
  }

  if (
    candidate.circuit.opened_at_ms !== undefined &&
    !isSafeInteger(candidate.circuit.opened_at_ms, 0, maxTimestampMs)
  ) {
    return false;
  }

  if (
    candidate.circuit.half_open_request_id !== undefined &&
    (typeof candidate.circuit.half_open_request_id !== "string" ||
      !requestIdPattern.test(candidate.circuit.half_open_request_id))
  ) {
    return false;
  }

  return true;
};

export const validateTokenForgeAiPolicySnapshot = (
  candidate: unknown,
): TokenForgeAiPolicySnapshot => {
  const cloned = cloneJson(candidate, "Token Forge AI policy snapshot");
  if (!validateSnapshotShape(cloned)) {
    throw new TokenForgeAiPolicyContractError(
      "Token Forge AI policy snapshot validation failed.",
    );
  }
  return cloned;
};

const admissionDenial = (
  reason: TokenForgeAiAdmissionDenialReason,
  gatewayErrorCode: Extract<
    AiGatewayErrorCode,
    | "invalid_request"
    | "rate_limited"
    | "budget_exhausted"
    | "provider_unavailable"
  >,
  retryAfterSeconds?: number,
): TokenForgeAiAdmissionDecision => ({
  status: "denied",
  reason,
  gateway_error_code: gatewayErrorCode,
  ...(retryAfterSeconds === undefined
    ? {}
    : {
        retry_after_seconds: Math.max(
          1,
          Math.min(Math.ceil(retryAfterSeconds), 3_600),
        ),
      }),
});

const validateAdmissionRequest = (
  candidate: unknown,
  policy: TokenForgeAiTrafficPolicy,
): candidate is TokenForgeAiAdmissionRequest =>
  isRecord(candidate) &&
  hasExactKeys(candidate, [
    "request_id",
    "actor_key",
    "lab_id",
    "operation",
    "now_ms",
    "reserved_tokens",
    "reserved_cost_microusd",
  ]) &&
  typeof candidate.request_id === "string" &&
  requestIdPattern.test(candidate.request_id) &&
  typeof candidate.actor_key === "string" &&
  actorKeyPattern.test(candidate.actor_key) &&
  candidate.lab_id === policy.lab_id &&
  candidate.operation === policy.operation &&
  isSafeInteger(candidate.now_ms, 0, maxTimestampMs) &&
  candidate.now_ms <= maxOperationalTimestampMs &&
  isSafeInteger(
    candidate.reserved_tokens,
    1,
    policy.max_request_billable_tokens,
  ) &&
  isSafeInteger(
    candidate.reserved_cost_microusd,
    1,
    policy.max_request_cost_microusd,
  );

const validateSettlementRequest = (
  candidate: unknown,
): candidate is TokenForgeAiSettlementRequest => {
  if (
    !isRecord(candidate) ||
    !hasExactKeys(candidate, ["request_id", "now_ms", "outcome"]) ||
    typeof candidate.request_id !== "string" ||
    !requestIdPattern.test(candidate.request_id) ||
    !isSafeInteger(candidate.now_ms, 0, maxTimestampMs) ||
    candidate.now_ms > maxOperationalTimestampMs ||
    !isRecord(candidate.outcome) ||
    typeof candidate.outcome.status !== "string"
  ) {
    return false;
  }

  if (candidate.outcome.status === "success") {
    return (
      hasExactKeys(candidate.outcome, [
        "status",
        "actual_tokens",
        "actual_cost_microusd",
      ]) &&
      isSafeInteger(candidate.outcome.actual_tokens) &&
      isSafeInteger(candidate.outcome.actual_cost_microusd)
    );
  }

  const errorCodes: readonly AiGatewayErrorCode[] = [
    "invalid_request",
    "request_too_large",
    "input_token_limit_exceeded",
    "rate_limited",
    "budget_exhausted",
    "provider_timeout",
    "provider_unavailable",
    "invalid_provider_response",
    "output_token_limit_exceeded",
    "response_too_large",
    "policy_blocked",
    "internal_error",
  ];

  return (
    candidate.outcome.status === "failure" &&
    hasExactKeys(candidate.outcome, ["status", "error_code"]) &&
    typeof candidate.outcome.error_code === "string" &&
    errorCodes.includes(candidate.outcome.error_code as AiGatewayErrorCode)
  );
};

const dayKeyFor = (nowMs: number): string =>
  new Date(nowMs).toISOString().slice(0, 10);

const secondsUntil = (targetMs: number, nowMs: number): number =>
  Math.max(1, Math.min(Math.ceil((targetMs - nowMs) / 1_000), 3_600));

const secondsUntilNextUtcDay = (nowMs: number): number => {
  const now = new Date(nowMs);
  const nextDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return secondsUntil(nextDay, nowMs);
};

const circuitFailureCodes = new Set<AiGatewayErrorCode>([
  "rate_limited",
  "budget_exhausted",
  "provider_timeout",
  "provider_unavailable",
  "invalid_provider_response",
  "output_token_limit_exceeded",
  "response_too_large",
  "policy_blocked",
  "internal_error",
]);

const subtractUsage = (
  usage: UsageCounter,
  tokenRefund: number,
  costRefund: number,
): void => {
  usage.tokens = Math.max(0, usage.tokens - tokenRefund);
  usage.cost_microusd = Math.max(0, usage.cost_microusd - costRefund);
};

export class TokenForgeAiPolicyLedger {
  readonly policy: Readonly<TokenForgeAiTrafficPolicy>;
  private state: TokenForgeAiPolicySnapshot;

  constructor(
    policy: unknown = tokenForgeAiTrafficHardPolicy,
    snapshot?: unknown,
  ) {
    this.policy = deepFreeze(validateTokenForgeAiTrafficPolicy(policy));
    this.state =
      snapshot === undefined
        ? emptySnapshot()
        : validateTokenForgeAiPolicySnapshot(snapshot);

    if (
      Object.values(this.state.reservations).some(
        (reservation) =>
          reservation.reserved_tokens >
            this.policy.max_request_billable_tokens ||
          reservation.reserved_cost_microusd >
            this.policy.max_request_cost_microusd,
      )
    ) {
      throw new TokenForgeAiPolicyContractError(
        "Token Forge AI policy snapshot exceeds the active policy.",
      );
    }
  }

  admit(candidate: unknown): TokenForgeAiAdmissionDecision {
    if (!validateAdmissionRequest(candidate, this.policy)) {
      return admissionDenial("invalid_context", "invalid_request");
    }

    if (candidate.now_ms < this.state.last_seen_at_ms) {
      return admissionDenial("invalid_context", "invalid_request");
    }

    this.prepare(candidate.now_ms);

    if (
      Object.hasOwn(this.state.reservations, candidate.request_id) ||
      Object.hasOwn(this.state.completed_request_ids, candidate.request_id)
    ) {
      return admissionDenial("duplicate_request", "invalid_request");
    }

    const circuitDecision = this.prepareCircuit(candidate.now_ms);
    if (circuitDecision) {
      return circuitDecision;
    }

    const windowMs = this.policy.rate_limit.window_seconds * 1_000;
    const actorEvents =
      this.state.rate_events.actors[candidate.actor_key] ?? [];
    const rateChecks = [
      {
        events: actorEvents,
        limit: this.policy.rate_limit.actor_requests,
        reason: "actor_rate_limit" as const,
      },
      {
        events: this.state.rate_events.lab,
        limit: this.policy.rate_limit.lab_requests,
        reason: "lab_rate_limit" as const,
      },
      {
        events: this.state.rate_events.site,
        limit: this.policy.rate_limit.site_requests,
        reason: "site_rate_limit" as const,
      },
    ];

    for (const check of rateChecks) {
      if (check.events.length >= check.limit) {
        const oldest = check.events[0] ?? candidate.now_ms;
        return admissionDenial(
          check.reason,
          "rate_limited",
          secondsUntil(oldest + windowMs, candidate.now_ms),
        );
      }
    }

    const activeReservations = Object.values(this.state.reservations);
    const actorActive = activeReservations.filter(
      (reservation) => reservation.actor_key === candidate.actor_key,
    );
    const concurrencyChecks = [
      {
        reservations: actorActive,
        limit: this.policy.concurrency.actor_in_flight,
        reason: "actor_concurrency" as const,
      },
      {
        reservations: activeReservations,
        limit: this.policy.concurrency.lab_in_flight,
        reason: "lab_concurrency" as const,
      },
      {
        reservations: activeReservations,
        limit: this.policy.concurrency.site_in_flight,
        reason: "site_concurrency" as const,
      },
    ];

    for (const check of concurrencyChecks) {
      if (check.reservations.length >= check.limit) {
        const earliestExpiry = Math.min(
          ...check.reservations.map((reservation) => reservation.expires_at_ms),
        );
        return admissionDenial(
          check.reason,
          "rate_limited",
          secondsUntil(earliestExpiry, candidate.now_ms),
        );
      }
    }

    const dayKey = dayKeyFor(candidate.now_ms);
    const day = this.getDay(dayKey);
    const actorUsage = day.actors[candidate.actor_key] ?? emptyUsage();
    const dailyChecks = [
      {
        usage: actorUsage,
        tokenLimit: this.policy.daily_budgets.actor_tokens,
        costLimit: this.policy.daily_budgets.actor_cost_microusd,
        requestLimit: this.policy.daily_budgets.actor_requests,
        reason: "actor_daily_budget" as const,
      },
      {
        usage: day.lab,
        tokenLimit: this.policy.daily_budgets.lab_tokens,
        costLimit: this.policy.daily_budgets.lab_cost_microusd,
        requestLimit: this.policy.daily_budgets.lab_requests,
        reason: "lab_daily_budget" as const,
      },
      {
        usage: day.site,
        tokenLimit: this.policy.daily_budgets.site_tokens,
        costLimit: this.policy.daily_budgets.site_cost_microusd,
        requestLimit: this.policy.daily_budgets.site_requests,
        reason: "site_daily_budget" as const,
      },
    ];

    for (const check of dailyChecks) {
      if (
        check.usage.tokens + candidate.reserved_tokens > check.tokenLimit ||
        check.usage.cost_microusd + candidate.reserved_cost_microusd >
          check.costLimit ||
        check.usage.requests + 1 > check.requestLimit
      ) {
        return admissionDenial(
          check.reason,
          "budget_exhausted",
          secondsUntilNextUtcDay(candidate.now_ms),
        );
      }
    }

    day.actors[candidate.actor_key] = actorUsage;
    for (const usage of [actorUsage, day.lab, day.site]) {
      usage.tokens += candidate.reserved_tokens;
      usage.cost_microusd += candidate.reserved_cost_microusd;
      usage.requests += 1;
    }

    actorEvents.push(candidate.now_ms);
    this.state.rate_events.actors[candidate.actor_key] = actorEvents;
    this.state.rate_events.lab.push(candidate.now_ms);
    this.state.rate_events.site.push(candidate.now_ms);

    const circuitProbe = this.state.circuit.state === "half_open";
    const expiresAt =
      candidate.now_ms + this.policy.reservation_ttl_seconds * 1_000;
    this.state.reservations[candidate.request_id] = {
      actor_key: candidate.actor_key,
      day_key: dayKey,
      reserved_tokens: candidate.reserved_tokens,
      reserved_cost_microusd: candidate.reserved_cost_microusd,
      expires_at_ms: expiresAt,
      circuit_probe: circuitProbe,
    };

    if (circuitProbe) {
      this.state.circuit.half_open_request_id = candidate.request_id;
    }

    return {
      status: "allowed",
      request_id: candidate.request_id,
      reservation: {
        reserved_tokens: candidate.reserved_tokens,
        reserved_cost_microusd: candidate.reserved_cost_microusd,
        expires_at_ms: expiresAt,
      },
      circuit_state: circuitProbe ? "half_open" : "closed",
    };
  }

  settle(candidate: unknown): TokenForgeAiSettlementResult {
    if (
      !validateSettlementRequest(candidate) ||
      candidate.now_ms < this.state.last_seen_at_ms
    ) {
      return { status: "rejected", reason: "invalid_context" };
    }

    this.prepare(candidate.now_ms);
    const reservation = this.state.reservations[candidate.request_id];

    if (!reservation) {
      return Object.hasOwn(
        this.state.completed_request_ids,
        candidate.request_id,
      )
        ? { status: "already_settled" }
        : { status: "rejected", reason: "unknown_reservation" };
    }

    let chargedTokens = reservation.reserved_tokens;
    let chargedCost = reservation.reserved_cost_microusd;

    if (candidate.outcome.status === "success") {
      if (
        candidate.outcome.actual_tokens > reservation.reserved_tokens ||
        candidate.outcome.actual_cost_microusd >
          reservation.reserved_cost_microusd
      ) {
        this.finishReservation(candidate.request_id, candidate.now_ms);
        this.recordCircuitFailure(candidate.now_ms);
        return {
          status: "rejected",
          reason: "usage_exceeded_reservation",
        };
      }

      chargedTokens = candidate.outcome.actual_tokens;
      chargedCost = candidate.outcome.actual_cost_microusd;
      const day = this.state.days[reservation.day_key];
      const actorUsage = day?.actors[reservation.actor_key];
      if (!day || !actorUsage) {
        this.finishReservation(candidate.request_id, candidate.now_ms);
        this.recordCircuitFailure(candidate.now_ms);
        return { status: "rejected", reason: "invalid_context" };
      }

      const tokenRefund = reservation.reserved_tokens - chargedTokens;
      const costRefund = reservation.reserved_cost_microusd - chargedCost;
      for (const usage of [actorUsage, day.lab, day.site]) {
        subtractUsage(usage, tokenRefund, costRefund);
      }
      this.finishReservation(candidate.request_id, candidate.now_ms);
      this.recordCircuitSuccess();
    } else {
      this.finishReservation(candidate.request_id, candidate.now_ms);
      if (circuitFailureCodes.has(candidate.outcome.error_code)) {
        this.recordCircuitFailure(candidate.now_ms);
      } else if (reservation.circuit_probe) {
        delete this.state.circuit.half_open_request_id;
      }
    }

    this.pruneDays(candidate.now_ms);
    return {
      status: "settled",
      charged_tokens: chargedTokens,
      charged_cost_microusd: chargedCost,
      circuit_state: this.state.circuit.state,
    };
  }

  exportSnapshot(): TokenForgeAiPolicySnapshot {
    return validateTokenForgeAiPolicySnapshot(this.state);
  }

  private prepare(nowMs: number): void {
    this.state.last_seen_at_ms = nowMs;
    const windowStart = nowMs - this.policy.rate_limit.window_seconds * 1_000;
    const keepRecent = (timestamp: number): boolean => timestamp > windowStart;

    this.state.rate_events.lab = this.state.rate_events.lab
      .filter(keepRecent)
      .sort((a, b) => a - b);
    this.state.rate_events.site = this.state.rate_events.site
      .filter(keepRecent)
      .sort((a, b) => a - b);
    for (const [actorKey, events] of Object.entries(
      this.state.rate_events.actors,
    )) {
      const recent = events.filter(keepRecent).sort((a, b) => a - b);
      if (recent.length === 0) {
        delete this.state.rate_events.actors[actorKey];
      } else {
        this.state.rate_events.actors[actorKey] = recent;
      }
    }

    for (const [requestId, expiresAt] of Object.entries(
      this.state.completed_request_ids,
    )) {
      if (expiresAt <= nowMs) {
        delete this.state.completed_request_ids[requestId];
      }
    }

    for (const [requestId, reservation] of Object.entries(
      this.state.reservations,
    )) {
      if (reservation.expires_at_ms <= nowMs) {
        this.finishReservation(requestId, nowMs);
        this.recordCircuitFailure(nowMs);
      }
    }

    this.pruneDays(nowMs);
  }

  private prepareCircuit(
    nowMs: number,
  ): TokenForgeAiAdmissionDecision | undefined {
    const circuit = this.state.circuit;
    if (circuit.state === "open") {
      const openedAt = circuit.opened_at_ms ?? nowMs;
      const retryAt =
        openedAt + this.policy.circuit_breaker.open_seconds * 1_000;
      if (nowMs < retryAt) {
        return admissionDenial(
          "circuit_open",
          "provider_unavailable",
          secondsUntil(retryAt, nowMs),
        );
      }

      circuit.state = "half_open";
      delete circuit.half_open_request_id;
    }

    if (
      circuit.state === "half_open" &&
      circuit.half_open_request_id !== undefined
    ) {
      const probe = this.state.reservations[circuit.half_open_request_id];
      return admissionDenial(
        "circuit_open",
        "provider_unavailable",
        probe
          ? secondsUntil(probe.expires_at_ms, nowMs)
          : this.policy.reservation_ttl_seconds,
      );
    }

    return undefined;
  }

  private getDay(dayKey: string): DayBucket {
    const existing = this.state.days[dayKey];
    if (existing) {
      return existing;
    }

    const created: DayBucket = {
      actors: {},
      lab: emptyUsage(),
      site: emptyUsage(),
    };
    this.state.days[dayKey] = created;
    return created;
  }

  private finishReservation(requestId: string, nowMs: number): void {
    const reservation = this.state.reservations[requestId];
    if (reservation?.circuit_probe) {
      delete this.state.circuit.half_open_request_id;
    }
    delete this.state.reservations[requestId];
    this.state.completed_request_ids[requestId] = nowMs + completedRequestTtlMs;
  }

  private recordCircuitFailure(nowMs: number): void {
    const circuit = this.state.circuit;
    circuit.consecutive_failures += 1;
    if (
      circuit.state === "half_open" ||
      circuit.consecutive_failures >=
        this.policy.circuit_breaker.consecutive_failures
    ) {
      circuit.state = "open";
      circuit.opened_at_ms = nowMs;
      delete circuit.half_open_request_id;
    }
  }

  private recordCircuitSuccess(): void {
    this.state.circuit = {
      state: "closed",
      consecutive_failures: 0,
    };
  }

  private pruneDays(nowMs: number): void {
    const currentDay = dayKeyFor(nowMs);
    const activeDays = new Set(
      Object.values(this.state.reservations).map(
        (reservation) => reservation.day_key,
      ),
    );
    for (const dayKey of Object.keys(this.state.days)) {
      if (dayKey !== currentDay && !activeDays.has(dayKey)) {
        delete this.state.days[dayKey];
      }
    }
  }
}

export const admissionDecisionToAiGatewayFailure = (
  decision: Extract<TokenForgeAiAdmissionDecision, { status: "denied" }>,
  requestId?: string,
): AiGatewayFailureResponse => {
  const retryable =
    decision.gateway_error_code === "rate_limited" ||
    decision.gateway_error_code === "provider_unavailable";

  return {
    schema_version: "1.0",
    ...(requestId !== undefined && requestIdPattern.test(requestId)
      ? { request_id: requestId }
      : {}),
    status: "error",
    error: {
      code: decision.gateway_error_code,
      retryable,
      ...(decision.retry_after_seconds === undefined
        ? {}
        : { retry_after_seconds: decision.retry_after_seconds }),
    },
    meta: {
      attempt_count: 0,
    },
  };
};
