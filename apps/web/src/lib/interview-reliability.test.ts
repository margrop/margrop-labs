import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  buildInterviewAiConclusionInput,
  buildInterviewAiMatchInput,
  buildInterviewAiPlanInput,
  validateInterviewAiConclusionOutput,
  validateInterviewAiPlanOutput,
} from "../server/interview-ai-contracts";
import {
  type InterviewInputBundle,
  validateInterviewEvidence,
  validateInterviewInputBundle,
  validateInterviewJobDescription,
  validateInterviewRequirement,
  validateInterviewResume,
} from "./interview-contracts";
import {
  buildInterviewReliabilityCorpus,
  interviewReliabilityFailureMatrix,
  interviewReliabilityPrivacySinks,
} from "./interview-reliability";
import {
  buildInterviewSyntheticLoop,
  renderInterviewSafeExportMarkdown,
} from "./interview-synthetic";

const fixtureUrl = (name: string): URL =>
  new URL(
    `../../../../labs/interview-workbench/fixtures/${name}`,
    import.meta.url,
  );

const readFixture = async (name: string): Promise<unknown> =>
  JSON.parse(await readFile(fixtureUrl(name), "utf8")) as unknown;

const loadBundle = async (): Promise<InterviewInputBundle> => {
  const resume = validateInterviewResume(
    await readFixture("resume.valid.json"),
  );
  const jd = validateInterviewJobDescription(
    await readFixture("jd.valid.json"),
  );
  const requirement = validateInterviewRequirement(
    await readFixture("requirement.valid.json"),
  );
  const evidence = validateInterviewEvidence(
    await readFixture("evidence.valid.json"),
  );
  return validateInterviewInputBundle({
    resume,
    jd,
    requirements: [
      requirement,
      ...jd.requirements.slice(1).map((item) => ({
        schema_version: "1.0" as const,
        sensitivity: "sensitive" as const,
        ...item,
      })),
    ],
    evidence: [evidence],
  });
};

describe("Interview Workbench P5-008 reliability baseline", () => {
  it("runs the dual-role loop across three different job families", async () => {
    const corpus = buildInterviewReliabilityCorpus(await loadBundle());

    expect(corpus.map(({ id }) => id)).toEqual([
      "cloud-platform",
      "frontend-product",
      "data-platform",
    ]);
    expect(new Set(corpus.map(({ bundle }) => bundle.jd.role_title)).size).toBe(
      3,
    );

    for (const scenario of corpus) {
      const run = buildInterviewSyntheticLoop(
        scenario.bundle,
        `loop-p5-008-${scenario.id}`,
      );
      const requirementIds = new Set(
        scenario.bundle.requirements.map(
          ({ requirement_id }) => requirement_id,
        ),
      );

      expect(run.roles.interviewer.plan.duration_minutes).toBe(45);
      expect(run.roles.candidate.plan.duration_minutes).toBe(45);
      expect(run.roles.interviewer.record.human_review.required).toBe(true);
      expect(run.roles.candidate.record.human_review.required).toBe(true);
      expect(run.roles.interviewer.conclusion.status).toBe("draft");
      expect(run.roles.candidate.conclusion.status).toBe("draft");
      expect(run.roles.interviewer.conclusion.automatic_decision).toBe(false);
      expect(run.roles.candidate.conclusion.automatic_decision).toBe(false);
      expect(
        run.match.requirement_results.every(({ requirement_id }) =>
          requirementIds.has(requirement_id),
        ),
      ).toBe(true);
      expect(
        run.roles.interviewer.plan.segments.reduce(
          (total, segment) => total + segment.minutes,
          0,
        ),
      ).toBe(45);
      expect(
        run.roles.candidate.plan.segments.reduce(
          (total, segment) => total + segment.minutes,
          0,
        ),
      ).toBe(45);

      const interviewerExport = renderInterviewSafeExportMarkdown(
        run.roles.interviewer.export,
      );
      const candidateExport = renderInterviewSafeExportMarkdown(
        run.roles.candidate.export,
      );
      expect(interviewerExport).toContain("仅包含结构化计数和状态");
      expect(candidateExport).toContain("仅包含结构化计数和状态");
      expect(interviewerExport).not.toContain("合成平台经历");
      expect(candidateExport).not.toContain("合成平台经历");
    }
  });

  it("keeps protected attributes out of five privacy sinks", async () => {
    const base = await loadBundle();
    const markers = ["林隐私样例", "13812345678", "keep-out@example.invalid"];
    const bundle = validateInterviewInputBundle({
      ...base,
      resume: {
        ...base.resume,
        headline: "姓名：林隐私样例",
        experiences: base.resume.experiences.map((experience, index) =>
          index === 0
            ? {
                ...experience,
                role: "邮箱：keep-out@example.invalid",
                summary: "手机：13812345678；这段文本只能停留在本地。",
              }
            : experience,
        ),
      },
      jd: {
        ...base.jd,
        role_title: "候选人：林隐私样例对应的岗位",
      },
      evidence: base.evidence.map((item) => ({
        ...item,
        summary: "地址：上海市隐私测试路 1 号；仅用于脱敏回归。",
      })),
    });
    const matchInput = buildInterviewAiMatchInput(bundle);
    const run = buildInterviewSyntheticLoop(bundle, "loop-p5-008-privacy");
    const planInput = buildInterviewAiPlanInput(bundle, run.match, {
      mode: "interviewer",
      duration_minutes: 45,
    });
    const conclusionInput = buildInterviewAiConclusionInput(
      run.roles.interviewer.plan,
      run.roles.interviewer.record,
    );

    let errorText = "";
    try {
      validateInterviewAiPlanOutput(
        {
          ...run.roles.interviewer.plan,
          questions: run.roles.interviewer.plan.questions.map(
            (question, index) =>
              index === 0
                ? { ...question, prompt: "姓名：林隐私样例，请核验事实" }
                : question,
          ),
        },
        planInput,
      );
    } catch (error) {
      errorText = String(error);
    }

    const sinks: Record<
      (typeof interviewReliabilityPrivacySinks)[number],
      string
    > = {
      ai_request_boundary: JSON.stringify(matchInput),
      browser_url: new URL(
        "https://lab.margrop.net/interview-workbench/",
      ).toString(),
      analytics_payload: JSON.stringify({
        lab_id: "interview-workbench",
        event: "synthetic_view",
      }),
      safe_markdown_export: renderInterviewSafeExportMarkdown(
        run.roles.interviewer.export,
      ),
      error_or_log_text: errorText,
    };

    expect(Object.keys(sinks)).toEqual(
      expect.arrayContaining([...interviewReliabilityPrivacySinks]),
    );
    for (const sink of interviewReliabilityPrivacySinks) {
      for (const marker of markers) {
        expect(sinks[sink]).not.toContain(marker);
      }
    }
    expect(JSON.stringify(planInput)).not.toContain("事实只能停留");
    expect(JSON.stringify(conclusionInput)).not.toContain("keep-out");
    expect(errorText).toContain("prohibited");
  });

  it("fails closed for protected text and automatic decisions", async () => {
    const bundle = await loadBundle();
    const run = buildInterviewSyntheticLoop(bundle, "loop-p5-008-guards");
    const planInput = buildInterviewAiPlanInput(bundle, run.match, {
      mode: "interviewer",
      duration_minutes: 45,
    });
    expect(() =>
      validateInterviewAiPlanOutput(
        {
          ...run.roles.interviewer.plan,
          questions: run.roles.interviewer.plan.questions.map(
            (question, index) =>
              index === 0
                ? {
                    ...question,
                    prompt: "年龄：28 岁，姓名：林隐私样例，请人工核验",
                  }
                : question,
          ),
        },
        planInput,
      ),
    ).toThrow(/prohibited (?:sensitive text|identifier field)/iu);

    const conclusionInput = buildInterviewAiConclusionInput(
      run.roles.interviewer.plan,
      run.roles.interviewer.record,
    );
    expect(() =>
      validateInterviewAiConclusionOutput(
        { ...run.roles.interviewer.conclusion, automatic_decision: true },
        conclusionInput,
      ),
    ).toThrow();
    expect(run.roles.interviewer.conclusion.automatic_decision).toBe(false);
    expect(run.roles.interviewer.conclusion.human_review.confirmed).toBe(false);
  });

  it("keeps a versioned failure matrix with deterministic degradation", () => {
    expect(interviewReliabilityFailureMatrix.map(({ id }) => id)).toEqual([
      "network_unavailable",
      "provider_timeout",
      "provider_5xx",
      "rate_limited",
      "budget_exhausted",
      "invalid_provider_json",
      "schema_invalid",
      "output_too_large",
      "policy_blocked",
    ]);
    expect(
      interviewReliabilityFailureMatrix.every(({ fallback }) =>
        fallback.includes("deterministic"),
      ),
    ).toBe(true);
  });
});
