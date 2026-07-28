import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import type { TokenForgeEvent } from "../lib/token-forge-analytics";
import {
  createMemoryTokenForgeAnalyticsStore,
  handleTokenForgeAnalyticsRequest,
  recordTokenForgeAnalyticsEvent,
  tokenForgeAnalyticsEndpointPath,
  validateTokenForgeAnalyticsSnapshot,
} from "./token-forge-analytics";

const event = (
  eventName: TokenForgeEvent["event_name"] = "run_success",
): TokenForgeEvent => ({
  schema_version: "1.0",
  event_name: eventName,
  lab_id: "token-forge",
  lab_version: "1.0",
  device_category: "desktop",
});

const request = (body: unknown, overrides: RequestInit = {}): Request =>
  new Request(`https://lab.margrop.net${tokenForgeAnalyticsEndpointPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://lab.margrop.net",
    },
    body: JSON.stringify(body),
    ...overrides,
  });

describe("Token Forge aggregate analytics", () => {
  it("accepts the versioned aggregate-only snapshot fixture", async () => {
    const fixture = JSON.parse(
      await readFile(
        new URL(
          "../../../../labs/token-forge/fixtures/token-forge-analytics-snapshot.valid.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown;

    expect(validateTokenForgeAnalyticsSnapshot(fixture)).toEqual(fixture);
  });

  it("increments only the UTC day, event and coarse device tuple", () => {
    const first = recordTokenForgeAnalyticsEvent(
      undefined,
      event(),
      Date.parse("2026-07-27T23:59:59Z"),
    );
    const second = recordTokenForgeAnalyticsEvent(
      first,
      event(),
      Date.parse("2026-07-27T23:59:59Z"),
    );

    expect(second).toEqual({
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
    });
  });

  it("retains only 31 UTC days and never stores raw event dimensions", () => {
    let snapshot = recordTokenForgeAnalyticsEvent(
      undefined,
      event("lab_open"),
      Date.parse("2026-06-27T12:00:00Z"),
    );

    for (let day = 0; day < 31; day += 1) {
      snapshot = recordTokenForgeAnalyticsEvent(
        snapshot,
        event("export"),
        Date.parse(`2026-07-${String(day + 1).padStart(2, "0")}T12:00:00Z`),
      );
    }

    expect(snapshot.days).toHaveLength(31);
    expect(snapshot.days[0]?.date).toBe("2026-07-01");
    expect(JSON.stringify(snapshot)).not.toMatch(
      /goal|repository|prompt|response|error|ip|hostname|visitor|session/iu,
    );
  });

  it("sanitizes unknown sensitive fields before persisting a count", async () => {
    const store = createMemoryTokenForgeAnalyticsStore();
    const response = await handleTokenForgeAnalyticsRequest(
      request({
        ...event("export"),
        goal: "must-not-cross",
        repository_url: "https://github.com/acme/private-context",
        prompt: "must-not-cross",
        response: "must-not-cross",
        error: "must-not-cross",
      }),
      {
        store,
        now: () => Date.parse("2026-07-27T12:00:00Z"),
      },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(store.snapshot()).toEqual({
      schema_version: "1.0",
      days: [
        {
          date: "2026-07-27",
          counts: [
            {
              event_name: "export",
              device_category: "desktop",
              count: 1,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(store.snapshot())).not.toContain("must-not-cross");
  });

  it.each([
    [
      "cross-origin request",
      request(event(), {
        headers: {
          "content-type": "application/json",
          origin: "https://example.com",
        },
      }),
      403,
    ],
    [
      "non-JSON request",
      request(event(), {
        headers: {
          "content-type": "text/plain",
          origin: "https://lab.margrop.net",
        },
      }),
      415,
    ],
    [
      "oversized request",
      request({ ...event(), padding: "x".repeat(1_024) }),
      413,
    ],
    ["invalid event", request({}), 400],
  ])("rejects a %s without mutating storage", async (_label, input, status) => {
    const store = createMemoryTokenForgeAnalyticsStore();

    const response = await handleTokenForgeAnalyticsRequest(input, { store });

    expect(response.status).toBe(status);
    expect(store.snapshot()).toBeUndefined();
  });

  it("allows only POST and returns a generic unavailable response on storage failure", async () => {
    const getResponse = await handleTokenForgeAnalyticsRequest(
      new Request(`https://lab.margrop.net${tokenForgeAnalyticsEndpointPath}`),
      { store: createMemoryTokenForgeAnalyticsStore() },
    );
    const unavailableResponse = await handleTokenForgeAnalyticsRequest(
      request(event()),
      {
        store: {
          mutate: vi.fn().mockRejectedValue(new Error("synthetic failure")),
        },
      },
    );

    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");
    expect(unavailableResponse.status).toBe(503);
    expect(await unavailableResponse.text()).toBe("");
  });
});
