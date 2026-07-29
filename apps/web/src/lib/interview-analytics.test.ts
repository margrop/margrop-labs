import { expect, it, vi } from "vitest";

import {
  emitInterviewAnalyticsEvent,
  interviewAnalyticsEndpointPath,
} from "./interview-analytics";

it("emits the fixed interview event contract", () => {
  const sink = vi.fn();

  expect(emitInterviewAnalyticsEvent("plan_complete", "tablet", sink)).toEqual({
    schema_version: "1.0",
    event_name: "plan_complete",
    lab_id: "interview-workbench",
    lab_version: "1.0",
    device_category: "tablet",
  });
  expect(interviewAnalyticsEndpointPath).toBe(
    "/api/interview-workbench/events",
  );
});
