import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import analyticsSnapshotSchema from "../../../../schemas/token-forge-analytics-snapshot-v1.schema.json";
import {
  type TokenForgeDeviceCategory,
  type TokenForgeEvent,
  type TokenForgeEventName,
  tokenForgeAnalyticsEndpointPath,
  tokenForgeEventNames,
  validateTokenForgeEvent,
} from "../lib/token-forge-analytics";

export { tokenForgeAnalyticsEndpointPath };

export const tokenForgeAnalyticsRetentionDays = 31;
export const tokenForgeAnalyticsMaxRequestBytes = 1_024;

const deviceCategories: readonly TokenForgeDeviceCategory[] = [
  "mobile",
  "tablet",
  "desktop",
  "unknown",
];
const millisecondsPerDay = 86_400_000;

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

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateSnapshotSchema: ValidateFunction<TokenForgeAnalyticsSnapshot> =
  ajv.compile(analyticsSnapshotSchema as AnySchema);

export const validateTokenForgeAnalyticsSnapshot = (
  candidate: unknown,
): TokenForgeAnalyticsSnapshot => {
  if (!validateSnapshotSchema(candidate)) {
    throw new TokenForgeAnalyticsSnapshotError();
  }

  const snapshot = candidate as TokenForgeAnalyticsSnapshot;
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

const dayKey = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    throw new TokenForgeAnalyticsSnapshotError();
  }
  return new Date(timestamp).toISOString().slice(0, 10);
};

const countOrder = (count: TokenForgeAnalyticsCount): number =>
  tokenForgeEventNames.indexOf(count.event_name) * deviceCategories.length +
  deviceCategories.indexOf(count.device_category);

export const recordTokenForgeAnalyticsEvent = (
  current: TokenForgeAnalyticsSnapshot | undefined,
  event: TokenForgeEvent,
  timestamp: number,
): TokenForgeAnalyticsSnapshot => {
  const snapshot = validateTokenForgeAnalyticsSnapshot(
    current ?? { schema_version: "1.0", days: [] },
  );
  const date = dayKey(timestamp);
  const cutoff = dayKey(
    timestamp - (tokenForgeAnalyticsRetentionDays - 1) * millisecondsPerDay,
  );
  const days = snapshot.days
    .filter((day) => day.date >= cutoff && day.date <= date)
    .map((day) => ({
      date: day.date,
      counts: day.counts.map((count) => ({ ...count })),
    }));

  let day = days.find((candidate) => candidate.date === date);
  if (!day) {
    day = { date, counts: [] };
    days.push(day);
  }

  const existing = day.counts.find(
    (count) =>
      count.event_name === event.event_name &&
      count.device_category === event.device_category,
  );
  if (existing) {
    existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1);
  } else {
    day.counts.push({
      event_name: event.event_name,
      device_category: event.device_category,
      count: 1,
    });
  }

  day.counts.sort((left, right) => countOrder(left) - countOrder(right));
  days.sort((left, right) => left.date.localeCompare(right.date));

  return validateTokenForgeAnalyticsSnapshot({
    schema_version: "1.0",
    days,
  });
};

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

const responseHeaders = {
  "cache-control": "no-store",
  "cross-origin-resource-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

const emptyResponse = (
  status: number,
  headers: Record<string, string> = {},
): Response =>
  new Response(null, {
    status,
    headers: {
      ...responseHeaders,
      ...headers,
    },
  });

export const handleTokenForgeAnalyticsRequest = async (
  request: Request,
  runtime: TokenForgeAnalyticsRuntime,
): Promise<Response> => {
  if (request.method !== "POST") {
    return emptyResponse(405, { allow: "POST" });
  }

  const requestUrl = new URL(request.url);
  if (request.headers.get("origin") !== requestUrl.origin) {
    return emptyResponse(403);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  if (contentType?.trim().toLowerCase() !== "application/json") {
    return emptyResponse(415);
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > tokenForgeAnalyticsMaxRequestBytes
  ) {
    return emptyResponse(413);
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return emptyResponse(400);
  }
  if (
    new TextEncoder().encode(rawBody).byteLength >
    tokenForgeAnalyticsMaxRequestBytes
  ) {
    return emptyResponse(413);
  }

  let analyticsEvent: TokenForgeEvent;
  try {
    analyticsEvent = validateTokenForgeEvent(JSON.parse(rawBody) as unknown);
  } catch {
    return emptyResponse(400);
  }

  try {
    await runtime.store.mutate((snapshot) => ({
      snapshot: recordTokenForgeAnalyticsEvent(
        snapshot,
        analyticsEvent,
        (runtime.now ?? Date.now)(),
      ),
      result: undefined,
    }));
  } catch {
    return emptyResponse(503);
  }

  return emptyResponse(204);
};
