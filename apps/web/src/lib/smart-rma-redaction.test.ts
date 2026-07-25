import { describe, expect, it, vi } from "vitest";

import { loadSmartRmaFixtureCorpus } from "./smart-rma-fixtures";
import {
  SmartRmaRedactionError,
  createSmartRmaBoundaryPayload,
  redactSmartctlText,
  validateSmartRmaBoundaryProjection,
} from "./smart-rma-redaction";

const edgeCaseSmartctl = [
  "smartctl 7.4 synthetic edge case",
  "Device Model: MARGROP LABS SYNTHETIC EDGE",
  "Device Serial No. = SYNTHETIC-EDGE-SERIAL-0001",
  "serialnumber: SYNTHETIC-EDGE-SERIAL-0002",
  "S/N: SYNTHETIC-EDGE-SERIAL-0003",
  "Serial Number: SYNTHETIC EDGE SERIAL 0004",
  "LU WWN Device Id: 0 000000 000000001",
  "WWN_Device_Id=0x0000000000000001",
  "Host Name: SYNTHETIC_HOST_01",
  "Computer_Name=storage-node-02.example.com",
  "IPv4 Address: 192.0.2.44",
  "IPv6 Address: [2001:db8::44]",
  "ATA Version is: ACS-4 synthetic",
  "SMART support is: Available",
  "SMART overall-health self-assessment test result: PASSED",
  "",
].join("\n");

const edgeCaseRawValues = [
  "SYNTHETIC-EDGE-SERIAL-0001",
  "SYNTHETIC-EDGE-SERIAL-0002",
  "SYNTHETIC-EDGE-SERIAL-0003",
  "SYNTHETIC EDGE SERIAL 0004",
  "0 000000 000000001",
  "0x0000000000000001",
  "SYNTHETIC_HOST_01",
  "storage-node-02.example.com",
  "192.0.2.44",
  "2001:db8::44",
];

describe("SMART / RMA local redaction preview v1", () => {
  it("redacts identifiers from every indexed synthetic fixture and preserves parse evidence", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();

    for (const fixture of corpus.fixtures) {
      const preview = redactSmartctlText(fixture.raw);
      const serial = /^Serial Number:\s*(\S+)/imu.exec(fixture.raw)?.[1];
      const wwn = /^LU WWN Device Id:\s*(.+)$/imu.exec(fixture.raw)?.[1];

      for (const value of [serial, wwn]) {
        if (value) {
          expect(preview.redacted_text, fixture.id).not.toContain(value.trim());
        }
      }
      expect(preview.projection.protocol, fixture.id).toBe(fixture.protocol);
      expect(preview.projection.signals, fixture.id).toEqual(
        fixture.expected_signals,
      );
      expect(preview.projection.missing_fields, fixture.id).toEqual(
        fixture.missing_fields,
      );
    }
  });

  it("covers repeated labels, separators, case, host names and IPv4/IPv6", () => {
    const preview = redactSmartctlText(edgeCaseSmartctl);

    for (const value of edgeCaseRawValues) {
      expect(preview.redacted_text).not.toContain(value);
    }
    expect(preview.redacted_text).toContain("[REDACTED:SERIAL_NUMBER]");
    expect(preview.redacted_text).toContain("[REDACTED:WWN]");
    expect(preview.redacted_text).toContain("[REDACTED:DOMAIN]");
    expect(preview.redacted_text).toContain("[REDACTED:IP]");
    expect(preview.projection.privacy).toEqual({
      redactions_total: 10,
      counts: {
        authorization: 0,
        cookie: 0,
        token: 0,
        email: 0,
        ip: 2,
        domain: 2,
        serial_number: 4,
        wwn: 2,
      },
    });
  });

  it("normalizes privacy treatment without changing line endings or retaining secrets", () => {
    const secret = "synthetic-secret-value";
    const source = edgeCaseSmartctl
      .replaceAll("\n", "\r\n")
      .replace(
        "ATA Version is:",
        `Authorization: Bearer ${secret}\r\nToken=${secret}\r\nATA Version is:`,
      );
    const preview = redactSmartctlText(source);

    expect(preview.redacted_text).toContain("\r\n");
    expect(preview.redacted_text).toContain("[REDACTED:AUTHORIZATION]");
    expect(preview.redacted_text).toContain("[REDACTED:TOKEN]");
    expect(preview.redacted_text).not.toContain(secret);
    expect(preview.projection.privacy.counts.authorization).toBe(1);
    expect(preview.projection.privacy.counts.token).toBe(1);
  });

  it("creates an allowlisted projection without raw text or free-form attribute names", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures.find(
      ({ id }) => id === "ata-vendor-extension-7-3",
    );
    if (!fixture) {
      throw new Error("Synthetic vendor-extension fixture is required.");
    }

    const preview = redactSmartctlText(fixture.raw);
    const serialized = JSON.stringify(preview.projection);

    expect(validateSmartRmaBoundaryProjection(preview.projection)).toEqual(
      preview.projection,
    );
    expect(
      preview.projection.ata.attributes.every(({ id }) => id !== 170),
    ).toBe(true);
    expect(preview.projection).not.toHaveProperty("serial_number");
    expect(preview.projection).not.toHaveProperty("wwn");
    for (const forbidden of [
      "redacted_text",
      "raw_text",
      "Device Model",
      "Vendor_Health_Reserve",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(() =>
      validateSmartRmaBoundaryProjection({
        ...preview.projection,
        raw_text: fixture.raw,
      }),
    ).toThrow(/smart-rma-boundary-projection-v1/);
  });

  it.each(["url", "log", "analytics", "ai-request", "export"] as const)(
    "keeps raw identifiers out of the %s boundary",
    (boundary) => {
      const preview = redactSmartctlText(edgeCaseSmartctl);
      const payload = createSmartRmaBoundaryPayload(
        preview.projection,
        boundary,
      );
      const serialized = JSON.stringify(payload);

      for (const value of edgeCaseRawValues) {
        expect(serialized).not.toContain(value);
      }
      expect(serialized).not.toContain("redacted_text");
      expect(serialized).not.toContain("Device Model");
    },
  );

  it("limits URL, log and Analytics payloads to stable metadata", () => {
    const projection = redactSmartctlText(edgeCaseSmartctl).projection;

    expect(createSmartRmaBoundaryPayload(projection, "url")).toEqual({
      lab_id: "smart-rma",
      view: "workbench",
    });
    expect(createSmartRmaBoundaryPayload(projection, "log")).toEqual({
      lab_id: "smart-rma",
      action: "redact",
      outcome: "success",
      redactions_total: 10,
    });
    expect(createSmartRmaBoundaryPayload(projection, "analytics")).toEqual({
      lab_id: "smart-rma",
      event_name: "redact_success",
      protocol: "ata",
    });
  });

  it("fails closed on invalid, oversized and unsupported input without echoing it", () => {
    const privateValue = "private-input-value";
    const cases: Array<{
      input: unknown;
      code: SmartRmaRedactionError["code"];
    }> = [
      { input: null, code: "invalid-input" },
      { input: "", code: "invalid-input" },
      { input: `plain ${privateValue}`, code: "unsupported-format" },
      {
        input: `smartctl 7.4 synthetic\n${"x".repeat(65 * 1024)}`,
        code: "input-too-large",
      },
      {
        input: `smartctl 7.4 synthetic\n${"SN:a\n".repeat(10_000)}`,
        code: "output-too-large",
      },
    ];

    for (const testCase of cases) {
      let receivedError: unknown;
      try {
        redactSmartctlText(testCase.input);
      } catch (error) {
        receivedError = error;
      }

      expect(receivedError).toBeInstanceOf(SmartRmaRedactionError);
      expect((receivedError as SmartRmaRedactionError).code).toBe(
        testCase.code,
      );
      expect(String(receivedError)).not.toContain(privateValue);
    }
  });

  it("has no network, storage or console side effects", () => {
    const fetchSpy = vi.fn();
    const storageWriteSpy = vi.fn();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", {
      setItem: storageWriteSpy,
    });

    redactSmartctlText(edgeCaseSmartctl);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageWriteSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
