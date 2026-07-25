import { describe, expect, it, vi } from "vitest";

import { loadSmartRmaFixtureCorpus } from "./smart-rma-fixtures";
import {
  SmartRmaParserError,
  parseSmartctlText,
  validateSmartRmaParseResult,
} from "./smart-rma-parser";

describe("SMART / RMA browser parser v1", () => {
  it("matches every synthetic fixture protocol, version, signal and missing-field oracle", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();

    for (const fixture of corpus.fixtures) {
      const result = parseSmartctlText(fixture.raw);

      expect(result.smartctl_version, fixture.id).toBe(
        fixture.smartctl_version,
      );
      expect(result.protocol, fixture.id).toBe(fixture.protocol);
      expect(result.signals, fixture.id).toEqual(fixture.expected_signals);
      expect(result.missing_fields, fixture.id).toEqual(fixture.missing_fields);
    }
  });

  it("extracts ATA device kind, attributes and error summary without classifying health", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const healthy = corpus.fixtures.find(({ id }) => id === "ata-healthy-7-4");
    const warning = corpus.fixtures.find(({ id }) => id === "ata-warning-7-4");
    if (!healthy || !warning) {
      throw new Error("Synthetic ATA fixtures are required.");
    }

    const healthyResult = parseSmartctlText(healthy.raw);
    const warningResult = parseSmartctlText(warning.raw);

    expect(healthyResult.device_kind).toBe("ssd");
    expect(healthyResult.temperature_celsius).toBe(32);
    expect(healthyResult.power_on_hours).toBe(720);
    expect(
      healthyResult.ata.attributes.find(({ id }) => id === 5)?.raw_value,
    ).toBe(0);

    expect(warningResult.device_kind).toBe("hdd");
    expect(warningResult.reported_overall_health).toBe("passed");
    expect(warningResult.ata.error_count).toBe(2);
    expect(warningResult.ata.self_test_failure_count).toBe(1);
    expect(
      warningResult.ata.attributes.find(({ id }) => id === 197)?.raw_value,
    ).toBe(3);
    expect(warningResult).not.toHaveProperty("expected_state");
    expect(warningResult).not.toHaveProperty("health_state");
  });

  it("retains bounded vendor attributes as unknown evidence without interpreting them", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures.find(
      ({ id }) => id === "ata-vendor-extension-7-3",
    );
    if (!fixture) {
      throw new Error("Synthetic vendor-extension fixture is required.");
    }

    const result = parseSmartctlText(fixture.raw);
    const vendorAttributes = result.ata.attributes.filter(
      ({ recognized }) => !recognized,
    );

    expect(vendorAttributes.map(({ id }) => id)).toEqual([170, 171, 241]);
    expect(vendorAttributes.map(({ name }) => name)).toEqual([
      "Vendor_Health_Reserve",
      "Vendor_Program_Failures",
      "Vendor_LBAs_Written",
    ]);
    expect(result.signals).toContain("vendor-extension");
  });

  it("extracts NVMe counters and preserves reported failure separately from rules", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const healthy = corpus.fixtures.find(({ id }) => id === "nvme-healthy-7-4");
    const critical = corpus.fixtures.find(
      ({ id }) => id === "nvme-critical-7-4",
    );
    if (!healthy || !critical) {
      throw new Error("Synthetic NVMe fixtures are required.");
    }

    const healthyResult = parseSmartctlText(healthy.raw);
    const criticalResult = parseSmartctlText(critical.raw);

    expect(healthyResult.device_kind).toBe("nvme");
    expect(healthyResult.nvme).toEqual({
      critical_warning: 0,
      available_spare_percent: 100,
      available_spare_threshold_percent: 10,
      percentage_used: 2,
      media_errors: 0,
      error_log_entries: 0,
    });
    expect(criticalResult.reported_overall_health).toBe("failed");
    expect(criticalResult.temperature_celsius).toBe(71);
    expect(criticalResult.power_on_hours).toBe(28_400);
    expect(criticalResult.nvme).toEqual({
      critical_warning: 9,
      available_spare_percent: 4,
      available_spare_threshold_percent: 10,
      percentage_used: 103,
      media_errors: 27,
      error_log_entries: 41,
    });
  });

  it("returns explicit unknowns for unsupported bridges and incomplete reports", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const unavailable = corpus.fixtures.find(
      ({ id }) => id === "sat-smart-unavailable-7-4",
    );
    const incomplete = corpus.fixtures.find(
      ({ id }) => id === "ata-incomplete-6-5",
    );
    if (!unavailable || !incomplete) {
      throw new Error("Synthetic unknown-state fixtures are required.");
    }

    const unavailableResult = parseSmartctlText(unavailable.raw);
    const incompleteResult = parseSmartctlText(incomplete.raw);

    expect(unavailableResult.protocol).toBe("unknown");
    expect(unavailableResult.smart_support).toBe("unavailable");
    expect(unavailableResult.reported_overall_health).toBe("unknown");
    expect(unavailableResult.signals).toEqual(["smart-unavailable"]);

    expect(incompleteResult.protocol).toBe("ata");
    expect(incompleteResult.device_kind).toBe("unknown");
    expect(incompleteResult.smart_support).toBe("unknown");
    expect(incompleteResult.signals).toEqual(["incomplete-identification"]);
  });

  it("never copies raw text or hardware identifiers into the parse result", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();

    for (const fixture of corpus.fixtures) {
      const result = parseSmartctlText(fixture.raw);
      const serialized = JSON.stringify(result);
      const serial = /^Serial Number:\s*(\S+)/imu.exec(fixture.raw)?.[1];
      const model = /^(?:Device Model|Model Number):\s*(.+)$/imu.exec(
        fixture.raw,
      )?.[1];
      const wwn = /^LU WWN Device Id:\s*(.+)$/imu.exec(fixture.raw)?.[1];

      expect(result).not.toHaveProperty("raw");
      expect(result).not.toHaveProperty("serial_number");
      expect(result).not.toHaveProperty("wwn");
      for (const value of [serial, model, wwn]) {
        if (value) {
          expect(serialized).not.toContain(value.trim());
        }
      }
    }
  });

  it("normalizes browser line endings and ignores malformed attribute rows deterministically", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures[0];
    if (!fixture) {
      throw new Error("At least one synthetic fixture is required.");
    }

    const lfResult = parseSmartctlText(fixture.raw);
    const crlfResult = parseSmartctlText(fixture.raw.replaceAll("\n", "\r\n"));
    const malformedResult = parseSmartctlText(
      fixture.raw.replace(
        "  5 Reallocated_Sector_Ct   0x0033",
        "MALFORMED ATTRIBUTE ROW",
      ),
    );

    expect(crlfResult).toEqual(lfResult);
    expect(malformedResult.ata.attributes).toHaveLength(
      lfResult.ata.attributes.length - 1,
    );
    expect(malformedResult.signals).not.toContain("ata-reallocated-sectors");
  });

  it("rejects empty, oversized, binary-like and non-smartctl inputs without echoing them", () => {
    const secretValue = "not-smartctl-sensitive-value";
    const cases: Array<{
      input: unknown;
      code: SmartRmaParserError["code"];
    }> = [
      { input: null, code: "invalid-input" },
      { input: "", code: "invalid-input" },
      { input: `plain ${secretValue}`, code: "unsupported-format" },
      {
        input: `smartctl 7.4 synthetic\n${"x".repeat(65 * 1024)}`,
        code: "input-too-large",
      },
      {
        input: "smartctl 7.4 synthetic\0hidden",
        code: "invalid-input",
      },
    ];

    for (const testCase of cases) {
      let receivedError: unknown;
      try {
        parseSmartctlText(testCase.input);
      } catch (error) {
        receivedError = error;
      }

      expect(receivedError).toBeInstanceOf(SmartRmaParserError);
      expect((receivedError as SmartRmaParserError).code).toBe(testCase.code);
      expect(String(receivedError)).not.toContain(secretValue);
    }
  });

  it("validates the public result contract and rejects identifier or raw-text additions", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures[0];
    if (!fixture) {
      throw new Error("At least one synthetic fixture is required.");
    }
    const result = parseSmartctlText(fixture.raw);

    expect(validateSmartRmaParseResult(result)).toEqual(result);
    expect(() =>
      validateSmartRmaParseResult({
        ...result,
        raw_text: fixture.raw,
      }),
    ).toThrow(/smart-rma-parse-result-v1/);
    expect(() =>
      validateSmartRmaParseResult({
        ...result,
        serial_number: "must-not-enter-result",
      }),
    ).toThrow(/smart-rma-parse-result-v1/);
  });

  it("runs without network, storage or console side effects", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures[0];
    if (!fixture) {
      throw new Error("At least one synthetic fixture is required.");
    }
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

    parseSmartctlText(fixture.raw);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageWriteSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
