import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import blogCtaSchema from "../../../../schemas/interview-workbench-blog-cta-v1.schema.json";

export type InterviewWorkbenchBlogCtaAction = {
  label: string;
  url: string;
};

export type InterviewWorkbenchBlogCta = {
  schema_version: "1.0";
  lab_id: "interview-workbench";
  title: string;
  summary: string;
  proof_points: [string, string, string];
  primary_action: InterviewWorkbenchBlogCtaAction;
  source_action: InterviewWorkbenchBlogCtaAction;
  method_action: InterviewWorkbenchBlogCtaAction;
  privacy_note: string;
  compact_note: string;
};

export class InterviewWorkbenchBlogCtaError extends Error {
  override name = "InterviewWorkbenchBlogCtaError";

  constructor() {
    super("Interview Workbench blog CTA did not match its versioned contract.");
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateSchema: ValidateFunction<InterviewWorkbenchBlogCta> = ajv.compile(
  blogCtaSchema as AnySchema,
);

export const validateInterviewWorkbenchBlogCta = (
  candidate: unknown,
): InterviewWorkbenchBlogCta => {
  if (!validateSchema(candidate)) {
    throw new InterviewWorkbenchBlogCtaError();
  }
  return candidate;
};

const escapeMarkdownCopy = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll(/([*_`])/gu, "\\$1");

const markdownLink = (action: InterviewWorkbenchBlogCtaAction): string =>
  `[${escapeMarkdownCopy(action.label)}](${action.url})`;

export const renderInterviewWorkbenchBlogCtaInline = (
  candidate: unknown,
): string => {
  const cta = validateInterviewWorkbenchBlogCta(candidate);
  return [
    "<!-- interview-workbench-cta:v1:inline:start -->",
    `> **${escapeMarkdownCopy(cta.title)}**`,
    ">",
    `> ${escapeMarkdownCopy(cta.summary)}`,
    ">",
    `> [${escapeMarkdownCopy(cta.primary_action.label)} →](${cta.primary_action.url})`,
    ">",
    `> ${escapeMarkdownCopy(cta.compact_note)}`,
    "<!-- interview-workbench-cta:v1:inline:end -->",
    "",
  ].join("\n");
};

export const renderInterviewWorkbenchBlogCtaFooter = (
  candidate: unknown,
): string => {
  const cta = validateInterviewWorkbenchBlogCta(candidate);
  return [
    "<!-- interview-workbench-cta:v1:footer:start -->",
    "---",
    "",
    `## ${escapeMarkdownCopy(cta.title)}`,
    "",
    escapeMarkdownCopy(cta.summary),
    "",
    ...cta.proof_points.map(
      (proofPoint) => `- ${escapeMarkdownCopy(proofPoint)}`,
    ),
    "",
    [
      markdownLink(cta.primary_action),
      markdownLink(cta.source_action),
      markdownLink(cta.method_action),
    ].join(" · "),
    "",
    `隐私提示：${escapeMarkdownCopy(cta.privacy_note)}`,
    "<!-- interview-workbench-cta:v1:footer:end -->",
    "",
  ].join("\n");
};
