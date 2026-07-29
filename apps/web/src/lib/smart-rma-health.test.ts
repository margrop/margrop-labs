import { describe, expect, it, vi } from "vitest";

import { loadSmartRmaFixtureCorpus } from "./smart-rma-fixtures";
import {
  assessSmartRmaHealth,
  validateSmartRmaHealthAssessment,
} from "./smart-rma-health";
import { redactSmartctlText } from "./smart-rma-redaction";

describe("SMART / RMA deterministic health rules", () => {
  it("matches every synthetic fixture expected state", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();

    for (const fixture of corpus.fixtures) {
      const projection = redactSmartctlText(fixture.raw).projection;
      expect(assessSmartRmaHealth(projection).state, fixture.id).toBe(
        fixture.expected_state,
      );
    }
  });

  it("keeps PASSED separate from warning evidence", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures.find(({ id }) => id === "ata-warning-7-4");
    if (!fixture) throw new Error("warning fixture required");

    const assessment = assessSmartRmaHealth(
      redactSmartctlText(fixture.raw).projection,
    );
    expect(assessment.reported_overall_health).toBe("passed");
    expect(assessment.state).toBe("warning");
    expect(assessment.conflicts).toEqual([
      "reported-passed-with-warning-evidence",
    ]);
    expect(assessment.triggered_rules).toEqual([
      "ata-reallocated-sectors",
      "ata-pending-sectors",
      "ata-uncorrectable-sectors",
      "ata-error-log",
      "ata-self-test-failures",
    ]);
  });

  it("does not interpret vendor extensions as failures", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures.find(
      ({ id }) => id === "ata-vendor-extension-7-3",
    );
    if (!fixture) throw new Error("vendor fixture required");

    const assessment = assessSmartRmaHealth(
      redactSmartctlText(fixture.raw).projection,
    );
    expect(assessment.state).toBe("healthy");
    expect(assessment.confidence).toBe("partial");
    expect(assessment.unknown_reasons).toContain(
      "vendor-extension-uninterpreted",
    );
  });

  it("fails closed for extra fields and has no side effects", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const fixture = corpus.fixtures[0];
    if (!fixture) throw new Error("fixture required");
    const fetchSpy = vi.fn();
    const storageSpy = vi.fn();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", { setItem: storageSpy });

    const assessment = assessSmartRmaHealth(
      redactSmartctlText(fixture.raw).projection,
    );
    expect(validateSmartRmaHealthAssessment(assessment)).toEqual(assessment);
    expect(() =>
      validateSmartRmaHealthAssessment({
        ...assessment,
        raw_text: fixture.raw,
      }),
    ).toThrow(/smart-rma-health-assessment-v1/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageSpy).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
