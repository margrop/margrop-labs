import legacySnapshotSchema from "../../../../schemas/token-forge-analytics-snapshot-v1.schema.json";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import {
  tokenForgeAnalyticsEndpointPath,
  type TokenForgeDeviceCategory,
  type TokenForgeEvent,
  type TokenForgeEventName,
} from "../lib/token-forge-analytics";
import {
  handleLabAnalyticsRequest,
  labAnalyticsMaxRequestBytes,
  labAnalyticsRetentionDays,
  migrateTokenForgeAnalyticsSnapshot,
  recordLabAnalyticsEvent,
  type LabAnalyticsSnapshot,
} from "./lab-analytics";

export { tokenForgeAnalyticsEndpointPath };
export const tokenForgeAnalyticsRetentionDays = labAnalyticsRetentionDays;
export const tokenForgeAnalyticsMaxRequestBytes = labAnalyticsMaxRequestBytes;

export type TokenForgeAnalyticsCount = {
  event_name: TokenForgeEventName;
  device_category: TokenForgeDeviceCategory;
  count: number;
};
export type TokenForgeAnalyticsDay = {
  date: string;
  counts: TokenForgeAnalyticsCount[];
};
export type TokenForgeAnalyticsSnapshot = {
  schema_version: "1.0";
  days: TokenForgeAnalyticsDay[];
};
export type TokenForgeAnalyticsMutation<T> = {
  snapshot: TokenForgeAnalyticsSnapshot;
  result: T;
};
export type TokenForgeAnalyticsStore = {
  mutate<T>(
    mutation: (
      snapshot: TokenForgeAnalyticsSnapshot | undefined,
    ) => TokenForgeAnalyticsMutation<T>,
  ): Promise<T>;
};
export type TokenForgeAnalyticsRuntime = {
  store: TokenForgeAnalyticsStore;
  now?: () => number;
};

export class TokenForgeAnalyticsSnapshotError extends Error {
  override name = "TokenForgeAnalyticsSnapshotError";

  constructor() {
    super("Token Forge analytics snapshot did not match its contract.");
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateLegacySchema: ValidateFunction<TokenForgeAnalyticsSnapshot> =
  ajv.compile(legacySnapshotSchema as AnySchema);

export const validateTokenForgeAnalyticsSnapshot = (
  candidate: unknown,
): TokenForgeAnalyticsSnapshot => {
  if (!validateLegacySchema(candidate)) {
    throw new TokenForgeAnalyticsSnapshotError();
  }
  const snapshot = candidate;
  const seenDays = new Set<string>();
  for (const day of snapshot.days) {
    if (seenDays.has(day.date)) {
      throw new TokenForgeAnalyticsSnapshotError();
    }
    seenDays.add(day.date);
    const seenCounts = new Set<string>();
    for (const count of day.counts) {
      const key = `${count.event_name}:${count.device_category}`;
      if (seenCounts.has(key)) {
        throw new TokenForgeAnalyticsSnapshotError();
      }
      seenCounts.add(key);
    }
  }
  return snapshot;
};

const toLegacySnapshot = (
  snapshot: LabAnalyticsSnapshot,
): TokenForgeAnalyticsSnapshot =>
  validateTokenForgeAnalyticsSnapshot({
    schema_version: "1.0",
    days: snapshot.days.map((day) => ({
      date: day.date,
      counts: day.counts
        .filter((count) => count.lab_id === "token-forge")
        .map(({ event_name, device_category, count }) => ({
          event_name,
          device_category,
          count,
        })),
    })),
  });

export const recordTokenForgeAnalyticsEvent = (
  current: TokenForgeAnalyticsSnapshot | undefined,
  event: TokenForgeEvent,
  timestamp: number,
): TokenForgeAnalyticsSnapshot =>
  toLegacySnapshot(
    recordLabAnalyticsEvent(
      migrateTokenForgeAnalyticsSnapshot(current),
      event,
      timestamp,
    ),
  );

export type MemoryTokenForgeAnalyticsStore = TokenForgeAnalyticsStore & {
  snapshot(): TokenForgeAnalyticsSnapshot | undefined;
};

export const createMemoryTokenForgeAnalyticsStore = (
  initial?: TokenForgeAnalyticsSnapshot,
): MemoryTokenForgeAnalyticsStore => {
  let current = initial;
  return {
    async mutate<T>(
      mutation: (
        snapshot: TokenForgeAnalyticsSnapshot | undefined,
      ) => TokenForgeAnalyticsMutation<T>,
    ): Promise<T> {
      const next = mutation(current);
      current = next.snapshot;
      return next.result;
    },
    snapshot: () => current,
  };
};

export const handleTokenForgeAnalyticsRequest = async (
  request: Request,
  runtime: TokenForgeAnalyticsRuntime,
): Promise<Response> =>
  handleLabAnalyticsRequest(
    request,
    {
      now: runtime.now,
      store: {
        mutate: async (mutation) =>
          runtime.store.mutate((legacy) => {
            const next = mutation(migrateTokenForgeAnalyticsSnapshot(legacy));
            return {
              snapshot: toLegacySnapshot(next.snapshot),
              result: next.result,
            };
          }),
      },
    },
    "token-forge",
  );
