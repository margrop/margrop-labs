import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  type AllowedFieldMap,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import eventSchema from "../../../../schemas/lab-analytics-event-v1.schema.json";

export const labAnalyticsEndpointPaths = {
  "token-forge": "/api/token-forge/events",
  "interview-workbench": "/api/interview-workbench/events",
} as const;

export type LabAnalyticsLabId = keyof typeof labAnalyticsEndpointPaths;
export type LabAnalyticsDeviceCategory =
  "mobile" | "tablet" | "desktop" | "unknown";
export type TokenForgeAnalyticsEventName =
  | "lab_open"
  | "run_success"
  | "run_failure"
  | "export"
  | "blog_click"
  | "github_click";
export type InterviewAnalyticsEventName =
  | "lab_open"
  | "match_complete"
  | "plan_complete"
  | "conclusion_complete"
  | "ai_success"
  | "ai_fallback"
  | "export";

export type LabAnalyticsEvent =
  | {
      schema_version: "1.0";
      event_name: TokenForgeAnalyticsEventName;
      lab_id: "token-forge";
      lab_version: "1.0";
      device_category: LabAnalyticsDeviceCategory;
    }
  | {
      schema_version: "1.0";
      event_name: InterviewAnalyticsEventName;
      lab_id: "interview-workbench";
      lab_version: "1.0";
      device_category: LabAnalyticsDeviceCategory;
    };

export type LabEventName<LabId extends LabAnalyticsLabId> =
  LabId extends "token-forge"
    ? TokenForgeAnalyticsEventName
    : InterviewAnalyticsEventName;

export class LabAnalyticsEventError extends Error {
  override name = "LabAnalyticsEventError";

  constructor() {
    super("Lab analytics event did not match the minimal contract.");
  }
}

const eventPolicy = {
  schema_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  event_name: {
    required: true,
    rule: {
      type: "enum",
      values: [
        "lab_open",
        "run_success",
        "run_failure",
        "export",
        "blog_click",
        "github_click",
        "match_complete",
        "plan_complete",
        "conclusion_complete",
        "ai_success",
        "ai_fallback",
      ],
    },
  },
  lab_id: {
    required: true,
    rule: {
      type: "enum",
      values: ["token-forge", "interview-workbench"],
    },
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

const eventAjv = new Ajv2020({ allErrors: true, strict: true });
const validateEventSchema: ValidateFunction<LabAnalyticsEvent> =
  eventAjv.compile(eventSchema as AnySchema);

export const validateLabAnalyticsEvent = (
  candidate: unknown,
): LabAnalyticsEvent => {
  let sanitized: unknown;
  try {
    sanitized = sanitizeAllowedFields(candidate, eventPolicy).value;
  } catch {
    throw new LabAnalyticsEventError();
  }

  if (!validateEventSchema(sanitized)) {
    throw new LabAnalyticsEventError();
  }
  return sanitized;
};

export const classifyLabDevice = (
  width: unknown,
): LabAnalyticsDeviceCategory => {
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

export type LabAnalyticsEventFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export const sendLabAnalyticsEvent = async (
  event: LabAnalyticsEvent,
  fetchImpl: LabAnalyticsEventFetch = fetch,
): Promise<void> => {
  try {
    await fetchImpl(labAnalyticsEndpointPaths[event.lab_id], {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    });
  } catch {
    // Analytics is best-effort and must never interrupt the Lab flow.
  }
};

export type LabAnalyticsEventSink = (
  event: LabAnalyticsEvent,
) => void | Promise<void>;

export const emitLabAnalyticsEvent = <LabId extends LabAnalyticsLabId>(
  labId: LabId,
  eventName: LabEventName<LabId>,
  deviceCategory: LabAnalyticsDeviceCategory,
  sink: LabAnalyticsEventSink = sendLabAnalyticsEvent,
): LabAnalyticsEvent => {
  const event = validateLabAnalyticsEvent({
    schema_version: "1.0",
    event_name: eventName,
    lab_id: labId,
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
