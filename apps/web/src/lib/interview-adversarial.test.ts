import { describe, expect, it } from "vitest";

import {
  buildInterviewP5014Report,
  interviewP5014AdversarialCorpus,
} from "./interview-adversarial";

describe("Interview Workbench P5-014 adversarial reliability corpus", () => {
  it("covers multilingual, missing, proxy, injection, markup and limit cases", () => {
    expect(interviewP5014AdversarialCorpus.map(({ id }) => id)).toEqual([
      "multilingual-english",
      "multilingual-japanese",
      "missing-information",
      "proxy-variable",
      "prompt-injection",
      "active-markup",
      "oversized-input",
      "control-character",
    ]);
    expect(
      new Set(interviewP5014AdversarialCorpus.map(({ kind }) => kind)),
    ).toEqual(
      new Set([
        "multilingual",
        "missing-information",
        "proxy-variable",
        "prompt-injection",
        "active-markup",
        "oversized-input",
        "control-character",
      ]),
    );
  });

  it("builds a passing technical report without raw input or hiring claims", () => {
    const report = buildInterviewP5014Report();

    expect(report).toMatchObject({
      report_version: "1.0",
      scope: "synthetic-only",
      corpus_version: "p5-014",
      case_count: 8,
      passed_case_count: 8,
      technical_security: { status: "pass" },
      hiring_quality_evidence: { status: "not-established" },
    });
    expect(JSON.stringify(report)).not.toContain(
      "Ignore previous instructions",
    );
    expect(JSON.stringify(report)).not.toContain("毕业年份");
    expect(JSON.stringify(report)).not.toContain("<script>");
    expect(
      report.cases.filter(({ outcome }) => outcome === "rejected"),
    ).toHaveLength(3);
    expect(
      report.cases.filter(({ outcome }) => outcome === "sanitized"),
    ).toHaveLength(2);
    expect(
      report.cases
        .filter(({ outcome }) => outcome === "accepted")
        .every(
          ({
            human_review_required,
            automatic_decision_disabled,
            privacy_sinks_clean,
          }) =>
            human_review_required &&
            automatic_decision_disabled &&
            privacy_sinks_clean,
        ),
    ).toBe(true);
    expect(
      report.cases.every(({ privacy_sinks_clean }) => privacy_sinks_clean),
    ).toBe(true);
  });

  it("fails closed for proxy variables before deterministic matching", () => {
    const proxyCase = interviewP5014AdversarialCorpus.find(
      ({ id }) => id === "proxy-variable",
    );
    const report = buildInterviewP5014Report();
    const result = report.cases.find(({ id }) => id === proxyCase?.id);

    expect(proxyCase?.expected_error).toBe("protected-attribute");
    expect(result).toMatchObject({
      outcome: "rejected",
      error_code: "protected-attribute",
      automatic_decision_disabled: true,
    });
  });
});
