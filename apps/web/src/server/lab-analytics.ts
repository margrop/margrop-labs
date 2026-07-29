import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import analyticsSnapshotSchema from "../../../../schemas/lab-analytics-snapshot-v1.schema.json";
import {
  type LabAnalyticsDeviceCategory,
  type LabAnalyticsEvent,
  type LabAnalyticsLabId,
  type TokenForgeAnalyticsEventName,
  validateLabAnalyticsEvent,
} from "../lib/lab-analytics";

export const labAnalyticsRetentionDays = 31;
export const labAnalyticsMaxRequestBytes = 1_024;

const deviceCategories: readonly LabAnalyticsDeviceCategory[] = [
  "mobile",
  "tablet",
  "desktop",
  "unknown",
];
const eventNames = {
  "interview-workbench": [
    "lab_open",
    "match_complete",
    "plan_complete",
    "conclusion_complete",
    "ai_success",
    "ai_fallback",
    "export",
  ],
  "token-forge": [
    "lab_open",
    "run_success",
    "run_failure",
    "export",
    "blog_click",
    "github_click",
  ],
} as const;
const millisecondsPerDay = 86_400_000;

export type LabAnalyticsCount = {
  lab_id: LabAnalyticsLabId;
  event_name: LabAnalyticsEvent["event_name"];
  device_category: LabAnalyticsDeviceCategory;
  count: number;
};

export type LabAnalyticsDay = {
  date: string;
  counts: LabAnalyticsCount[];
};

export type LabAnalyticsSnapshot = {
  schema_version: "1.0";
  days: LabAnalyticsDay[];
};

export type LabAnalyticsMutation<T> = {
  snapshot: LabAnalyticsSnapshot;
  result: T;
};

export type LabAnalyticsStore = {
  mutate<T>(
    mutation: (
      snapshot: LabAnalyticsSnapshot | undefined,
    ) => LabAnalyticsMutation<T>,
  ): Promise<T>;
};

export type LabAnalyticsRuntime = {
  store: LabAnalyticsStore;
  now?: () => number;
};

export type LegacyTokenForgeAnalyticsSnapshot = {
  schema_version: "1.0";
  days: Array<{
    date: string;
    counts: Array<{
      event_name: TokenForgeAnalyticsEventName;
      device_category: LabAnalyticsDeviceCategory;
      count: number;
    }>;
  }>;
};

export class LabAnalyticsSnapshotError extends Error {
  override name = "LabAnalyticsSnapshotError";

  constructor() {
    super("Lab analytics snapshot did not match its contract.");
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSnapshotSchema: ValidateFunction<LabAnalyticsSnapshot> =
  ajv.compile(analyticsSnapshotSchema as AnySchema);

export const validateLabAnalyticsSnapshot = (
  candidate: unknown,
): LabAnalyticsSnapshot => {
  if (!validateSnapshotSchema(candidate)) {
    throw new LabAnalyticsSnapshotError();
  }

  const snapshot = candidate;
  const seenDays = new Set<string>();
  for (const day of snapshot.days) {
    if (seenDays.has(day.date)) {
      throw new LabAnalyticsSnapshotError();
    }
    seenDays.add(day.date);

    const seenCounts = new Set<string>();
    for (const count of day.counts) {
      const key = `${count.lab_id}:${count.event_name}:${count.device_category}`;
      if (seenCounts.has(key)) {
        throw new LabAnalyticsSnapshotError();
      }
      seenCounts.add(key);
    }
  }
  return snapshot;
};

export const migrateTokenForgeAnalyticsSnapshot = (
  legacy: LegacyTokenForgeAnalyticsSnapshot | undefined,
): LabAnalyticsSnapshot | undefined => {
  if (!legacy) {
    return undefined;
  }
  return validateLabAnalyticsSnapshot({
    schema_version: "1.0",
    days: legacy.days.map((day) => ({
      date: day.date,
      counts: day.counts.map((count) => ({
        lab_id: "token-forge",
        ...count,
      })),
    })),
  });
};

const dayKey = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    throw new LabAnalyticsSnapshotError();
  }
  return new Date(timestamp).toISOString().slice(0, 10);
};

const countOrder = (count: LabAnalyticsCount): string => {
  const eventIndex = eventNames[count.lab_id].indexOf(
    count.event_name as never,
  );
  const deviceIndex = deviceCategories.indexOf(count.device_category);
  return `${count.lab_id}:${String(eventIndex).padStart(2, "0")}:${String(deviceIndex).padStart(2, "0")}`;
};

export const recordLabAnalyticsEvent = (
  current: LabAnalyticsSnapshot | undefined,
  event: LabAnalyticsEvent,
  timestamp: number,
): LabAnalyticsSnapshot => {
  const snapshot = validateLabAnalyticsSnapshot(
    current ?? { schema_version: "1.0", days: [] },
  );
  const date = dayKey(timestamp);
  const cutoff = dayKey(
    timestamp - (labAnalyticsRetentionDays - 1) * millisecondsPerDay,
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
      count.lab_id === event.lab_id &&
      count.event_name === event.event_name &&
      count.device_category === event.device_category,
  );
  if (existing) {
    existing.count = Math.min(Number.MAX_SAFE_INTEGER, existing.count + 1);
  } else {
    day.counts.push({
      lab_id: event.lab_id,
      event_name: event.event_name,
      device_category: event.device_category,
      count: 1,
    });
  }

  day.counts.sort((left, right) =>
    countOrder(left).localeCompare(countOrder(right)),
  );
  days.sort((left, right) => left.date.localeCompare(right.date));

  return validateLabAnalyticsSnapshot({ schema_version: "1.0", days });
};

export type MemoryLabAnalyticsStore = LabAnalyticsStore & {
  snapshot(): LabAnalyticsSnapshot | undefined;
};

export const createMemoryLabAnalyticsStore = (
  initial?: LabAnalyticsSnapshot,
): MemoryLabAnalyticsStore => {
  let current = initial;
  return {
    async mutate<T>(
      mutation: (
        snapshot: LabAnalyticsSnapshot | undefined,
      ) => LabAnalyticsMutation<T>,
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
    headers: { ...responseHeaders, ...headers },
  });

export const handleLabAnalyticsRequest = async (
  request: Request,
  runtime: LabAnalyticsRuntime,
  expectedLabId: LabAnalyticsLabId,
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
    declaredLength > labAnalyticsMaxRequestBytes
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
    new TextEncoder().encode(rawBody).byteLength > labAnalyticsMaxRequestBytes
  ) {
    return emptyResponse(413);
  }

  let event: LabAnalyticsEvent;
  try {
    event = validateLabAnalyticsEvent(JSON.parse(rawBody) as unknown);
  } catch {
    return emptyResponse(400);
  }
  if (event.lab_id !== expectedLabId) {
    return emptyResponse(400);
  }

  try {
    await runtime.store.mutate((snapshot) => ({
      snapshot: recordLabAnalyticsEvent(
        snapshot,
        event,
        (runtime.now ?? Date.now)(),
      ),
      result: undefined,
    }));
  } catch {
    return emptyResponse(503);
  }

  return emptyResponse(204);
};
