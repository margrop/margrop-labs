import { describe, expect, it } from "vitest";

import {
  type AllowedFieldMap,
  SanitizationError,
  redactText,
  redactTextWithReport,
  sanitizeAllowedFields,
} from "./index";

const boundaryPolicy = {
  goal_summary: {
    required: true,
    rule: { type: "text", maxLength: 500 },
  },
  token_budget: {
    required: true,
    rule: {
      type: "number",
      integer: true,
      minimum: 2_000,
      maximum: 60_000,
    },
  },
  tech_stack: {
    required: true,
    rule: {
      type: "array",
      maxItems: 8,
      items: { type: "text", maxLength: 40 },
    },
  },
  mode: {
    required: true,
    rule: {
      type: "enum",
      values: ["template", "ai-assisted"],
    },
  },
  sample_mode: {
    rule: { type: "boolean" },
  },
} as const satisfies AllowedFieldMap;

describe("redactText", () => {
  it("redacts IP addresses, domains and email addresses", () => {
    const source = [
      "Owner: operator@example.com",
      "Public endpoint: https://api.example.com:8443/v1",
      "IPv4: 192.0.2.25",
      "IPv6: 2001:db8::25",
    ].join("\n");

    const result = redactTextWithReport(source);

    expect(result.text).toContain("Owner: [REDACTED:EMAIL]");
    expect(result.text).toContain("https://[REDACTED:DOMAIN]:8443/v1");
    expect(result.text).toContain("IPv4: [REDACTED:IP]");
    expect(result.text).toContain("IPv6: [REDACTED:IP]");
    expect(result.text).not.toContain("operator@example.com");
    expect(result.text).not.toContain("api.example.com");
    expect(result.text).not.toContain("192.0.2.25");
    expect(result.text).not.toContain("2001:db8::25");
    expect(result.report).toEqual({
      total: 4,
      counts: {
        email: 1,
        ip: 2,
        domain: 1,
      },
    });
  });

  it("redacts authorization, cookie and labelled token values", () => {
    const values = {
      authorization: "Bearer synthetic-authorization-value",
      cookie: "session=synthetic-cookie-value",
      token: "synthetic-token-value",
    };
    const source = [
      `Authorization: ${values.authorization}`,
      `Cookie: ${values.cookie}`,
      `api_key=${values.token}`,
    ].join("\n");

    const result = redactTextWithReport(source);

    expect(result.text).toContain("Authorization: [REDACTED:AUTHORIZATION]");
    expect(result.text).toContain("Cookie: [REDACTED:COOKIE]");
    expect(result.text).toContain("api_key=[REDACTED:TOKEN]");
    for (const value of Object.values(values)) {
      expect(result.text).not.toContain(value);
    }
    expect(result.report).toEqual({
      total: 3,
      counts: {
        authorization: 1,
        cookie: 1,
        token: 1,
      },
    });
  });

  it("redacts labelled Cookie and Authorization assignments outside headers", () => {
    const result = redactTextWithReport(
      "authorization=synthetic-auth-value cookie=session-value",
    );

    expect(result.text).toBe(
      "authorization=[REDACTED:AUTHORIZATION] cookie=[REDACTED:COOKIE]",
    );
    expect(result.report).toEqual({
      total: 2,
      counts: {
        authorization: 1,
        cookie: 1,
      },
    });
  });

  it("redacts labelled serial numbers and WWNs without retaining values", () => {
    const serial = "SYNTHETIC123";
    const wwn = "0x5000000000000001";
    const result = redactTextWithReport(
      `Serial Number: ${serial}\nWWN: ${wwn}`,
    );

    expect(result.text).toBe(
      "Serial Number: [REDACTED:SERIAL_NUMBER]\nWWN: [REDACTED:WWN]",
    );
    expect(result.text).not.toContain(serial);
    expect(result.text).not.toContain(wwn);
    expect(result.report).toEqual({
      total: 2,
      counts: {
        "serial-number": 1,
        wwn: 1,
      },
    });
  });

  it("covers smartctl identifier labels and common host-name variants", () => {
    const values = [
      "SYNTHETIC SERIAL EDGE 0001",
      "0 000000 000000001",
      "SYNTHETIC_HOST_01",
      "storage-node-02.example.com",
    ];
    const result = redactTextWithReport(
      [
        `Device Serial No. = ${values[0]}`,
        `LU WWN Device Id: ${values[1]}`,
        `Host Name: ${values[2]}`,
        `Computer_Name=${values[3]}`,
      ].join("\n"),
    );

    expect(result.text).toBe(
      [
        "Device Serial No. = [REDACTED:SERIAL_NUMBER]",
        "LU WWN Device Id: [REDACTED:WWN]",
        "Host Name: [REDACTED:DOMAIN]",
        "Computer_Name=[REDACTED:DOMAIN]",
      ].join("\n"),
    );
    for (const value of values) {
      expect(result.text).not.toContain(value);
    }
    expect(result.report).toEqual({
      total: 4,
      counts: {
        domain: 2,
        "serial-number": 1,
        wwn: 1,
      },
    });
  });

  it("does not treat common source file names or invalid IPs as secrets", () => {
    const source =
      "Inspect src/index.ts, schema.json, version 999.2.3.4 and separator :::.";

    expect(redactText(source)).toBe(source);
  });

  it("redacts labelled internal hosts and public country-code domains", () => {
    expect(redactText("host=nas01 domain=db.internal mirror.example.de")).toBe(
      "host=[REDACTED:DOMAIN] domain=[REDACTED:DOMAIN] [REDACTED:DOMAIN]",
    );
  });

  it("is idempotent and never counts its own placeholders", () => {
    const once = redactText(
      "operator@example.com uses host api.example.com at 192.0.2.1",
    );
    const twice = redactTextWithReport(once);

    expect(twice.text).toBe(once);
    expect(twice.report.total).toBe(0);
  });
});

describe("sanitizeAllowedFields", () => {
  it("maps allowed fields before redacting free text and drops unknown fields", () => {
    const sensitiveEmail = "operator@example.com";
    const ignoredRepository = "https://private.example.com/acme/repository";
    const result = sanitizeAllowedFields(
      {
        goal_summary: `Review logs from ${sensitiveEmail} at 192.0.2.55`,
        token_budget: 16_000,
        tech_stack: ["TypeScript", "api.example.com"],
        mode: "ai-assisted",
        sample_mode: false,
        repository_url: ignoredRepository,
        nested_unknown: {
          authorization: "synthetic-value",
        },
      },
      boundaryPolicy,
    );

    expect(result.value).toEqual({
      goal_summary: "Review logs from [REDACTED:EMAIL] at [REDACTED:IP]",
      token_budget: 16_000,
      tech_stack: ["TypeScript", "[REDACTED:DOMAIN]"],
      mode: "ai-assisted",
      sample_mode: false,
    });
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(sensitiveEmail);
    expect(serialized).not.toContain(ignoredRepository);
    expect(serialized).not.toContain("repository_url");
    expect(serialized).not.toContain("nested_unknown");
    expect(result.report).toEqual({
      total: 3,
      counts: {
        email: 1,
        ip: 1,
        domain: 1,
      },
    });
  });

  it.each(["url", "log", "analytics", "ai-request", "export"])(
    "keeps raw input out of the %s boundary payload",
    () => {
      const rawValues = [
        "operator@example.com",
        "192.0.2.88",
        "worker.example.com",
        "SYNTHETIC987",
        "0x5000000000000002",
      ];
      const result = sanitizeAllowedFields(
        {
          goal_summary: [
            rawValues[0],
            rawValues[1],
            rawValues[2],
            `Serial Number: ${rawValues[3]}`,
            `WWN: ${rawValues[4]}`,
          ].join(" "),
          token_budget: 8_000,
          tech_stack: ["TypeScript"],
          mode: "template",
          secret_unknown: "must-not-cross-boundary",
        },
        boundaryPolicy,
      );
      const boundaryPayload = JSON.stringify(result.value);

      for (const value of rawValues) {
        expect(boundaryPayload).not.toContain(value);
      }
      expect(boundaryPayload).not.toContain("must-not-cross-boundary");
    },
  );

  it("rejects Token, Cookie and Authorization material by default", () => {
    const secretValue = "synthetic-token-value";

    expect(() =>
      sanitizeAllowedFields(
        {
          goal_summary: `Use api_key=${secretValue} for the request`,
          token_budget: 8_000,
          tech_stack: ["TypeScript"],
          mode: "ai-assisted",
        },
        boundaryPolicy,
      ),
    ).toThrow(SanitizationError);

    try {
      sanitizeAllowedFields(
        {
          goal_summary: `Use api_key=${secretValue} for the request`,
          token_budget: 8_000,
          tech_stack: ["TypeScript"],
          mode: "ai-assisted",
        },
        boundaryPolicy,
      );
    } catch (error) {
      expect(error).toMatchObject({
        code: "sensitive-input",
        path: "input.goal_summary",
        kinds: ["token"],
      });
      expect((error as Error).message).not.toContain(secretValue);
    }
  });

  it("can redact rather than reject Secret kinds for an explicit local-only use", () => {
    const secretValue = "synthetic-cookie-value";
    const result = sanitizeAllowedFields(
      {
        goal_summary: `Cookie: session=${secretValue}`,
        token_budget: 8_000,
        tech_stack: ["TypeScript"],
        mode: "template",
      },
      boundaryPolicy,
      { rejectKinds: [] },
    );

    expect(result.value.goal_summary).toBe("Cookie: [REDACTED:COOKIE]");
    expect(JSON.stringify(result.value)).not.toContain(secretValue);
  });

  it("fails closed on missing, mistyped or oversized allowed fields", () => {
    const valid = {
      goal_summary: "Create a bounded implementation task.",
      token_budget: 8_000,
      tech_stack: ["TypeScript"],
      mode: "template",
    };

    expect(() =>
      sanitizeAllowedFields({ ...valid, token_budget: "8000" }, boundaryPolicy),
    ).toThrow(/input\.token_budget/);
    expect(() =>
      sanitizeAllowedFields(
        { ...valid, goal_summary: "x".repeat(501) },
        boundaryPolicy,
      ),
    ).toThrow(/input\.goal_summary/);
    expect(() =>
      sanitizeAllowedFields(
        {
          goal_summary: valid.goal_summary,
          token_budget: valid.token_budget,
          mode: valid.mode,
        },
        boundaryPolicy,
      ),
    ).toThrow(/input\.tech_stack/);
  });

  it("recursively allowlists nested objects and arrays", () => {
    const nestedPolicy = {
      evidence: {
        required: true,
        rule: {
          type: "object",
          fields: {
            source: {
              required: true,
              rule: {
                type: "enum",
                values: ["synthetic"],
              },
            },
            notes: {
              required: true,
              rule: {
                type: "array",
                maxItems: 2,
                items: { type: "text", maxLength: 100 },
              },
            },
          },
        },
      },
    } as const satisfies AllowedFieldMap;

    const result = sanitizeAllowedFields(
      {
        evidence: {
          source: "synthetic",
          notes: ["Host api.example.com", "IP 192.0.2.10"],
          raw: "must-be-dropped",
        },
      },
      nestedPolicy,
    );

    expect(result.value).toEqual({
      evidence: {
        source: "synthetic",
        notes: ["Host [REDACTED:DOMAIN]", "IP [REDACTED:IP]"],
      },
    });
    expect(JSON.stringify(result.value)).not.toContain("must-be-dropped");
  });
});
