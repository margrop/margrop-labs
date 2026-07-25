import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import shareCardSchema from "../../../../schemas/incident-detective-share-card-v1.schema.json";
import {
  type IncidentDetectiveScoreResult,
  validateIncidentDetectiveScoreResult,
} from "./incident-detective-scoring";

export type IncidentDetectiveShareCard = {
  schema_version: "1.0";
  lab_id: "incident-detective";
  scenario_id: string;
  total_score: number;
  max_score: 100;
  band: IncidentDetectiveScoreResult["band"];
  dimensions: Array<{
    id: string;
    label: string;
    score: number;
    max_score: number;
  }>;
  privacy: {
    synthetic_score_only: true;
    contains_attempt_text: false;
    contains_evidence_payload: false;
    contains_answer: false;
  };
};

export class IncidentDetectiveShareCardError extends Error {
  override name = "IncidentDetectiveShareCardError";
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateShareCardSchema: ValidateFunction<IncidentDetectiveShareCard> =
  ajv.compile(shareCardSchema as AnySchema);

const expectedBand = (score: number): IncidentDetectiveShareCard["band"] => {
  if (score < 40) return "needs-evidence";
  if (score < 70) return "developing";
  if (score < 95) return "evidence-led";
  return "excellent";
};

export const validateIncidentDetectiveShareCard = (
  candidate: unknown,
): IncidentDetectiveShareCard => {
  if (!validateShareCardSchema(candidate)) {
    throw new IncidentDetectiveShareCardError(
      "Incident Detective share card validation failed.",
    );
  }

  const card = candidate as IncidentDetectiveShareCard;
  const dimensionIds = card.dimensions.map(({ id }) => id);
  const totalScore = card.dimensions.reduce(
    (total, dimension) => total + dimension.score,
    0,
  );
  const maxScore = card.dimensions.reduce(
    (total, dimension) => total + dimension.max_score,
    0,
  );
  if (
    new Set(dimensionIds).size !== dimensionIds.length ||
    card.dimensions.some(
      (dimension) => dimension.score > dimension.max_score,
    ) ||
    totalScore !== card.total_score ||
    maxScore !== card.max_score ||
    card.band !== expectedBand(card.total_score)
  ) {
    throw new IncidentDetectiveShareCardError(
      "Share card scores must reconcile with their dimensions.",
    );
  }

  return card;
};

export const createIncidentDetectiveShareCard = (
  scoreCandidate: unknown,
): IncidentDetectiveShareCard => {
  const score = validateIncidentDetectiveScoreResult(scoreCandidate);

  return validateIncidentDetectiveShareCard({
    schema_version: "1.0",
    lab_id: "incident-detective",
    scenario_id: score.scenario_id,
    total_score: score.total_score,
    max_score: 100,
    band: score.band,
    dimensions: score.dimensions.map(
      ({ id, label, score: dimensionScore, max_score: maxScore }) => ({
        id,
        label,
        score: dimensionScore,
        max_score: maxScore,
      }),
    ),
    privacy: {
      synthetic_score_only: true,
      contains_attempt_text: false,
      contains_evidence_payload: false,
      contains_answer: false,
    },
  });
};

const bandLabels: Record<IncidentDetectiveShareCard["band"], string> = {
  "needs-evidence": "证据不足",
  developing: "正在形成",
  "evidence-led": "证据驱动",
  excellent: "完整闭环",
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const renderIncidentDetectiveShareCardSvg = (
  candidate: unknown,
): string => {
  const card = validateIncidentDetectiveShareCard(candidate);
  const dimensionRows = card.dimensions
    .map((dimension, index) => {
      const y = 296 + index * 48;
      const width = Math.round((dimension.score / dimension.max_score) * 500);
      return `
    <text x="110" y="${y}" fill="#d8e2f0" font-size="22">${escapeXml(dimension.label)}</text>
    <rect x="390" y="${y - 18}" width="500" height="14" rx="7" fill="#26354a"/>
    <rect x="390" y="${y - 18}" width="${width}" height="14" rx="7" fill="#50e3d0"/>
    <text x="930" y="${y}" fill="#a9b8ca" font-size="20">${dimension.score}/${dimension.max_score}</text>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc">
  <title id="title">Incident Detective 合成案例评分 ${card.total_score} 分</title>
  <desc id="desc">只包含案例标识、总分、等级和维度分数，不含事故原文或用户输入。</desc>
  <rect width="1200" height="630" fill="#08111f"/>
  <rect x="52" y="52" width="1096" height="526" rx="30" fill="#101c2d" stroke="#2c3e55" stroke-width="2"/>
  <text x="100" y="116" fill="#50e3d0" font-family="ui-monospace, monospace" font-size="20" letter-spacing="3">MARGROP LABS · INCIDENT DETECTIVE</text>
  <text x="100" y="174" fill="#f4f7fb" font-family="system-ui, sans-serif" font-size="34" font-weight="700">${escapeXml(card.scenario_id)}</text>
  <text x="100" y="254" fill="#50e3d0" font-family="ui-monospace, monospace" font-size="74" font-weight="700">${card.total_score}<tspan fill="#8292a8" font-size="26">/${card.max_score}</tspan></text>
  <text x="390" y="246" fill="#f4c66a" font-family="system-ui, sans-serif" font-size="26" font-weight="700">${bandLabels[card.band]}</text>
  <g font-family="system-ui, sans-serif">${dimensionRows}
  </g>
  <text x="100" y="548" fill="#8292a8" font-family="system-ui, sans-serif" font-size="18">完全合成 · 仅分享结构化分数 · 不含事故原文、答案或个人输入</text>
  <text x="1000" y="548" fill="#50e3d0" font-family="ui-monospace, monospace" font-size="18" text-anchor="end">lab.margrop.net</text>
</svg>`;
};

export const incidentDetectiveShareCardFileName = (
  candidate: unknown,
): string => {
  const card = validateIncidentDetectiveShareCard(candidate);
  return `incident-detective-${card.scenario_id}-score.svg`;
};
