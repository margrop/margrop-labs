import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  type AllowedFieldMap,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import eventSchema from "../../../../schemas/token-forge-event-v1.schema.json";

export const tokenForgeAnalyticsEndpointPath = "/api/token-forge/events";

export const tokenForgeEventNames = [
  "lab_open",
  "run_success",
  "run_failure",
  "export",
  "blog_click",
  "github_click",
] as const;

export type TokenForgeEventName = (typeof tokenForgeEventNames)[number];
export type TokenForgeDeviceCategory =
  "mobile" | "tablet" | "desktop" | "unknown";

export type TokenForgeEvent = {
  schema_version: "1.0";
  event_name: TokenForgeEventName;
  lab_id: "token-forge";
  lab_version: "1.0";
  device_category: TokenForgeDeviceCategory;
};

export class TokenForgeEventError extends Error {
  override name = "TokenForgeEventError";

  constructor() {
    super("Token Forge event did not match the minimal analytics contract.");
  }
}

const eventPolicy = {
  schema_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  event_name: {
    required: true,
    rule: { type: "enum", values: tokenForgeEventNames },
  },
  lab_id: {
    required: true,
    rule: { type: "enum", values: ["token-forge"] },
  },
  lab_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  device_category: {
    required: true,
    rule: {
      type: "enum",
      values: ["mobile", "tablet", "desktop", "unknown"],
    },
  },
} as const satisfies AllowedFieldMap;

const eventAjv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateEventSchema: ValidateFunction<TokenForgeEvent> = eventAjv.compile(
  eventSchema as AnySchema,
);

export const validateTokenForgeEvent = (
  candidate: unknown,
): TokenForgeEvent => {
  let sanitized: unknown;
  try {
    sanitized = sanitizeAllowedFields(candidate, eventPolicy).value;
  } catch {
    throw new TokenForgeEventError();
  }

  if (!validateEventSchema(sanitized)) {
    throw new TokenForgeEventError();
  }
  return sanitized as TokenForgeEvent;
};

export const classifyTokenForgeDevice = (
  width: unknown,
): TokenForgeDeviceCategory => {
  if (typeof width !== "number" || !Number.isFinite(width) || width < 0) {
    return "unknown";
  }
  if (width < 768) {
    return "mobile";
  }
  if (width < 1_024) {
    return "tablet";
  }
  return "desktop";
};

export type TokenForgeEventFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const sendTokenForgeEvent = async (
  event: TokenForgeEvent,
  fetchImpl: TokenForgeEventFetch = fetch,
): Promise<void> => {
  try {
    await fetchImpl(tokenForgeAnalyticsEndpointPath, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Analytics is best-effort and must never interrupt the Lab flow.
  }
};

export type TokenForgeEventSink = (
  event: TokenForgeEvent,
) => void | Promise<void>;

export const emitTokenForgeEvent = (
  eventName: TokenForgeEventName,
  deviceCategory: TokenForgeDeviceCategory,
  sink: TokenForgeEventSink = sendTokenForgeEvent,
): TokenForgeEvent => {
  const event = validateTokenForgeEvent({
    schema_version: "1.0",
    event_name: eventName,
    lab_id: "token-forge",
    lab_version: "1.0",
    device_category: deviceCategory,
  });

  try {
    void Promise.resolve(sink(event)).catch(() => undefined);
  } catch {
    // Analytics must never interrupt the local Lab flow.
  }
  return event;
};
