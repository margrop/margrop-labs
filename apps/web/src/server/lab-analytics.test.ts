import { describe, expect, it, vi } from "vitest";

import type { LabAnalyticsEvent } from "../lib/lab-analytics";
import {
  createMemoryLabAnalyticsStore,
  handleLabAnalyticsRequest,
  migrateTokenForgeAnalyticsSnapshot,
  recordLabAnalyticsEvent,
  validateLabAnalyticsSnapshot,
} from "./lab-analytics";

const tokenEvent: LabAnalyticsEvent = {
  schema_version: "1.0",
  event_name: "run_success",
  lab_id: "token-forge",
  lab_version: "1.0",
  device_category: "desktop",
};

const interviewEvent: LabAnalyticsEvent = {
  schema_version: "1.0",
  event_name: "match_complete",
  lab_id: "interview-workbench",
  lab_version: "1.0",
  device_category: "mobile",
};

const request = (
  event: unknown,
  path = "/api/interview-workbench/events",
  overrides: RequestInit = {},
): Request =>
  new Request(`https://lab.margrop.net${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://lab.margrop.net",
    },
    body: JSON.stringify(event),
    ...overrides,
  });

describe("shared Lab aggregate analytics", () => {
  it("aggregates UTC date, lab, event and device independently", () => {
    const now = Date.parse("2026-07-29T12:00:00Z");
    const token = recordLabAnalyticsEvent(undefined, tokenEvent, now);
    const interview = recordLabAnalyticsEvent(token, interviewEvent, now);

    expect(interview.days[0]?.counts).toEqual([
      {
        lab_id: "interview-workbench",
        event_name: "match_complete",
        device_category: "mobile",
        count: 1,
      },
      {
        lab_id: "token-forge",
        event_name: "run_success",
        device_category: "desktop",
        count: 1,
      },
    ]);
  });

  it("migrates the legacy Token Forge snapshot without losing counts", () => {
    expect(
      migrateTokenForgeAnalyticsSnapshot({
        schema_version: "1.0",
        days: [
          {
            date: "2026-07-27",
            counts: [
              {
                event_name: "run_success",
                device_category: "desktop",
                count: 2,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      schema_version: "1.0",
      days: [
        {
          date: "2026-07-27",
          counts: [
            {
              lab_id: "token-forge",
              event_name: "run_success",
              device_category: "desktop",
              count: 2,
            },
          ],
        },
      ],
    });
  });

  it("retains 31 UTC days and saturates safe integer counts", () => {
    let snapshot = recordLabAnalyticsEvent(
      {
        schema_version: "1.0",
        days: [
          {
            date: "2026-06-29",
            counts: [
              {
                lab_id: "token-forge",
                event_name: "run_success",
                device_category: "desktop",
                count: Number.MAX_SAFE_INTEGER,
              },
            ],
          },
        ],
      },
      tokenEvent,
      Date.parse("2026-06-29T12:00:00Z"),
    );
    expect(snapshot.days[0]?.counts[0]?.count).toBe(Number.MAX_SAFE_INTEGER);

    for (let day = 0; day < 31; day += 1) {
      snapshot = recordLabAnalyticsEvent(
        snapshot,
        interviewEvent,
        Date.parse(`2026-07-${String(day + 1).padStart(2, "0")}T12:00:00Z`),
      );
    }

    expect(snapshot.days).toHaveLength(31);
    expect(snapshot.days[0]?.date).toBe("2026-07-01");
  });

  it("rejects an event whose lab does not match the route", async () => {
    const store = createMemoryLabAnalyticsStore();
    const response = await handleLabAnalyticsRequest(
      request(interviewEvent),
      { store },
      "token-forge",
    );

    expect(response.status).toBe(400);
    expect(store.snapshot()).toBeUndefined();
  });

  it("removes unknown sensitive fields before storage", async () => {
    const store = createMemoryLabAnalyticsStore();
    const response = await handleLabAnalyticsRequest(
      request({
        ...interviewEvent,
        resume: "must-not-cross",
        jd: "must-not-cross",
        record: "must-not-cross",
        prompt: "must-not-cross",
      }),
      { store, now: () => Date.parse("2026-07-29T12:00:00Z") },
      "interview-workbench",
    );

    expect(response.status).toBe(204);
    expect(JSON.stringify(store.snapshot())).not.toContain("must-not-cross");
  });

  it.each([
    [
      "cross-origin request",
      request(interviewEvent, undefined, {
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
        },
      }),
      403,
    ],
    [
      "non-JSON request",
      request(interviewEvent, undefined, {
        headers: {
          "content-type": "text/plain",
          origin: "https://lab.margrop.net",
        },
      }),
      415,
    ],
    [
      "oversized request",
      request({ ...interviewEvent, padding: "x".repeat(1_024) }),
      413,
    ],
    ["invalid event", request({}), 400],
  ])("rejects a %s without mutating storage", async (_label, input, status) => {
    const store = createMemoryLabAnalyticsStore();
    const response = await handleLabAnalyticsRequest(
      input,
      { store },
      "interview-workbench",
    );

    expect(response.status).toBe(status);
    expect(store.snapshot()).toBeUndefined();
  });

  it("allows only POST and returns a generic unavailable response", async () => {
    const getResponse = await handleLabAnalyticsRequest(
      new Request("https://lab.margrop.net/api/interview-workbench/events"),
      { store: createMemoryLabAnalyticsStore() },
      "interview-workbench",
    );
    const unavailableResponse = await handleLabAnalyticsRequest(
      request(interviewEvent),
      { store: { mutate: vi.fn().mockRejectedValue(new Error("failure")) } },
      "interview-workbench",
    );

    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.text()).toBe("");
  });

  it("rejects duplicate aggregate keys", () => {
    expect(() =>
      validateLabAnalyticsSnapshot({
        schema_version: "1.0",
        days: [
          {
            date: "2026-07-29",
            counts: [
              {
                lab_id: "interview-workbench",
                event_name: "lab_open",
                device_category: "desktop",
                count: 1,
              },
              {
                lab_id: "interview-workbench",
                event_name: "lab_open",
                device_category: "desktop",
                count: 2,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});
