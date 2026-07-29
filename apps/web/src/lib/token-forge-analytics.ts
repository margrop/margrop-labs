import {
  classifyLabDevice,
  emitLabAnalyticsEvent,
  labAnalyticsEndpointPaths,
  sendLabAnalyticsEvent,
  type LabAnalyticsEventFetch,
  type LabAnalyticsDeviceCategory,
  type TokenForgeAnalyticsEventName,
  validateLabAnalyticsEvent,
} from "./lab-analytics";

export const tokenForgeAnalyticsEndpointPath =
  labAnalyticsEndpointPaths["token-forge"];

export const tokenForgeEventNames = [
  "lab_open",
  "run_success",
  "run_failure",
  "export",
  "blog_click",
  "github_click",
] as const;

export type TokenForgeEventName = TokenForgeAnalyticsEventName;
export type TokenForgeDeviceCategory = LabAnalyticsDeviceCategory;

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

export const validateTokenForgeEvent = (
  candidate: unknown,
): TokenForgeEvent => {
  try {
    const event = validateLabAnalyticsEvent(candidate);
    if (event.lab_id !== "token-forge") {
      throw new TokenForgeEventError();
    }
    return event;
  } catch {
    throw new TokenForgeEventError();
  }
};

export const classifyTokenForgeDevice = classifyLabDevice;

export type TokenForgeEventFetch = LabAnalyticsEventFetch;

export const sendTokenForgeEvent = async (
  event: TokenForgeEvent,
  fetchImpl: TokenForgeEventFetch = fetch,
): Promise<void> => {
  await sendLabAnalyticsEvent(event, fetchImpl);
};

export type TokenForgeEventSink = (
  event: TokenForgeEvent,
) => void | Promise<void>;

export const emitTokenForgeEvent = (
  eventName: TokenForgeEventName,
  deviceCategory: TokenForgeDeviceCategory,
  sink: TokenForgeEventSink = sendTokenForgeEvent,
): TokenForgeEvent => {
  return emitLabAnalyticsEvent(
    "token-forge",
    eventName,
    deviceCategory,
    (event) => sink(event as TokenForgeEvent),
  ) as TokenForgeEvent;
};
