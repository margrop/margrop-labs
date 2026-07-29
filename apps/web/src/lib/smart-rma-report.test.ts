import { describe, expect, it } from "vitest";

import { loadSmartRmaFixtureCorpus } from "./smart-rma-fixtures";
import { assessSmartRmaHealth } from "./smart-rma-health";
import {
  createSmartRmaReportBundle,
  validateSmartRmaReportBundle,
} from "./smart-rma-report";
import { redactSmartctlText } from "./smart-rma-redaction";

describe("SMART / RMA deterministic reports", () => {
  it("generates stable Chinese and English Markdown for every fixture", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    for (const fixture of corpus.fixtures) {
      const preview = redactSmartctlText(fixture.raw);
      const assessment = assessSmartRmaHealth(preview.projection);
      const first = createSmartRmaReportBundle(preview.projection, assessment);
      const second = createSmartRmaReportBundle(preview.projection, assessment);

      expect(first).toEqual(second);
      expect(validateSmartRmaReportBundle(first)).toEqual(first);
      expect(first.chinese_summary_markdown).toContain("规则结论");
      expect(first.english_rma_markdown).toContain("Observed SMART Evidence");
      expect(first.english_rma_markdown).toContain(
        "does not determine warranty eligibility",
      );
      expect(first.contains_raw_input).toBe(false);
    }
  });

  it("never exports raw identifiers or secret-like input", () => {
    const raw = [
      "smartctl 7.4 synthetic",
      "Device Model: MARGROP LABS SYNTHETIC SAFE",
      "Serial Number: SECRET-SERIAL-123",
      "LU WWN Device Id: 5 000000 000000001",
      "Host Name: private-host.example.com",
      "Authorization: Bearer secret-token-value",
      "SMART support is: Available - device has SMART capability.",
      "SMART overall-health self-assessment test result: PASSED",
      "Temperature_Celsius     30",
      "Power_On_Hours          10",
      "",
    ].join("\n");
    const preview = redactSmartctlText(raw);
    const report = createSmartRmaReportBundle(
      preview.projection,
      assessSmartRmaHealth(preview.projection),
    );
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "SECRET-SERIAL-123",
      "5 000000 000000001",
      "private-host.example.com",
      "secret-token-value",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
