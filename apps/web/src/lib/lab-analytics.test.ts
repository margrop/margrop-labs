import { describe, expect, it, vi } from "vitest";

import {
  classifyLabDevice,
  emitLabAnalyticsEvent,
  validateLabAnalyticsEvent,
} from "./lab-analytics";

describe("shared Lab analytics event contract", () => {
  it("accepts fixed Token Forge and Interview Workbench events", () => {
    expect(
      validateLabAnalyticsEvent({
        schema_version: "1.0",
        event_name: "run_success",
        lab_id: "token-forge",
        lab_version: "1.0",
        device_category: "desktop",
      }).lab_id,
    ).toBe("token-forge");
    expect(
      validateLabAnalyticsEvent({
        schema_version: "1.0",
        event_name: "match_complete",
        lab_id: "interview-workbench",
        lab_version: "1.0",
        device_category: "mobile",
      }).lab_id,
    ).toBe("interview-workbench");
  });

  it.each([
    ["token-forge", "match_complete"],
    ["interview-workbench", "run_success"],
    ["unknown-lab", "lab_open"],
  ])("rejects route-incompatible event %s/%s", (labId, eventName) => {
    expect(() =>
      validateLabAnalyticsEvent({
        schema_version: "1.0",
        event_name: eventName,
        lab_id: labId,
        lab_version: "1.0",
        device_category: "desktop",
      }),
    ).toThrow();
  });

  it("drops unknown sensitive fields and never blocks the caller", () => {
    const sink = vi.fn().mockRejectedValue(new Error("offline"));
    const event = emitLabAnalyticsEvent(
      "interview-workbench",
      "ai_fallback",
      "desktop",
      sink,
    );

    expect(event).toEqual({
      schema_version: "1.0",
      event_name: "ai_fallback",
      lab_id: "interview-workbench",
      lab_version: "1.0",
      device_category: "desktop",
    });
    expect(JSON.stringify(event)).not.toMatch(
      /resume|jd|record|prompt|response/iu,
    );
  });

  it("classifies only coarse device widths", () => {
    expect(classifyLabDevice(320)).toBe("mobile");
    expect(classifyLabDevice(800)).toBe("tablet");
    expect(classifyLabDevice(1_440)).toBe("desktop");
    expect(classifyLabDevice("320")).toBe("unknown");
  });
});
