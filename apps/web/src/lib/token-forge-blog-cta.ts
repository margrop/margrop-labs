import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import blogCtaSchema from "../../../../schemas/token-forge-blog-cta-v1.schema.json";

export type TokenForgeBlogCtaAction = {
  label: string;
  url: string;
};

export type TokenForgeBlogCta = {
  schema_version: "1.0";
  lab_id: "token-forge";
  title: string;
  summary: string;
  compact_note: string;
  proof_points: [string, string, string];
  privacy_note: string;
  primary_action: TokenForgeBlogCtaAction;
  source_action: TokenForgeBlogCtaAction;
  offline_action: TokenForgeBlogCtaAction;
};

export class TokenForgeBlogCtaError extends Error {
  override name = "TokenForgeBlogCtaError";

  constructor() {
    super("Token Forge blog CTA did not match its versioned contract.");
  }
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateSchema: ValidateFunction<TokenForgeBlogCta> = ajv.compile(
  blogCtaSchema as AnySchema,
);

export const validateTokenForgeBlogCta = (
  candidate: unknown,
): TokenForgeBlogCta => {
  if (!validateSchema(candidate)) {
    throw new TokenForgeBlogCtaError();
  }
  return candidate;
};

const escapeMarkdownCopy = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll(/([*_`])/gu, "\\$1");

const markdownLink = (action: TokenForgeBlogCtaAction): string =>
  `[${escapeMarkdownCopy(action.label)}](${action.url})`;

export const renderTokenForgeBlogCtaInline = (candidate: unknown): string => {
  const cta = validateTokenForgeBlogCta(candidate);
  return [
    "<!-- token-forge-cta:v1:inline:start -->",
    `> **${escapeMarkdownCopy(cta.title)}**`,
    ">",
    `> ${escapeMarkdownCopy(cta.summary)}`,
    ">",
    `> [${escapeMarkdownCopy(cta.primary_action.label)} →](${cta.primary_action.url})`,
    ">",
    `> ${escapeMarkdownCopy(cta.compact_note)}`,
    "<!-- token-forge-cta:v1:inline:end -->",
    "",
  ].join("\n");
};

export const renderTokenForgeBlogCtaFooter = (candidate: unknown): string => {
  const cta = validateTokenForgeBlogCta(candidate);
  return [
    "<!-- token-forge-cta:v1:footer:start -->",
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
      markdownLink(cta.offline_action),
    ].join(" · "),
    "",
    `隐私提示：${escapeMarkdownCopy(cta.privacy_note)}`,
    "<!-- token-forge-cta:v1:footer:end -->",
    "",
  ].join("\n");
};
