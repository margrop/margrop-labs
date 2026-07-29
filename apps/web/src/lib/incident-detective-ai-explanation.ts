import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import explanationInputSchema from "../../../../schemas/incident-detective-ai-explanation-input-v1.schema.json";
import explanationSchema from "../../../../schemas/incident-detective-ai-explanation-v1.schema.json";
import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
  validateIncidentDetectiveSyntheticPrivacy,
} from "./incident-detective-contracts";
import {
  type IncidentDetectiveScoreResult,
  validateIncidentDetectiveScoreResult,
} from "./incident-detective-scoring";

export const incidentDetectiveExplanationOperationId =
  "incident-detective.explanation-v1";

export type IncidentDetectiveExplanationInput = {
  schema_version: "1.0";
  scenario_id: string;
  score: {
    total_score: number;
    max_score: 100;
    band: IncidentDetectiveScoreResult["band"];
    dimensions: Array<{
      id: string;
      label: string;
      score: number;
      max_score: number;
      findings: Array<{
        rule_id: string;
        status: "met" | "missed" | "penalty" | "avoided";
        message: string;
      }>;
    }>;
  };
  evidence_catalog: Array<{
    id: string;
    title: string;
    source: "prometheus" | "loki" | "mysql" | "runbook" | "topology";
    service_id?: string;
    acquisition_cost: number;
    acquired: boolean;
  }>;
  safeguards: {
    synthetic_only: true;
    score_is_authoritative: true;
    facts_must_not_be_invented: true;
    read_only_guidance_only: true;
    attempt_text_excluded: true;
    evidence_payload_excluded: true;
  };
};

export type IncidentDetectiveExplanation = {
  schema_version: "1.0";
  scenario_id: string;
  total_score: number;
  headline: string;
  strengths: Array<{
    finding_rule_id: string;
    explanation: string;
  }>;
  gaps: Array<{
    finding_rule_id: string;
    explanation: string;
    evidence_ids: string[];
  }>;
  safe_next_steps: Array<{
    title: string;
    rationale: string;
    evidence_ids: string[];
    safety: "read-only" | "approval-required";
  }>;
  unknowns: string[];
  disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。";
};

export class IncidentDetectiveExplanationError extends Error {
  override name = "IncidentDetectiveExplanationError";
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateInputSchema: ValidateFunction<IncidentDetectiveExplanationInput> =
  ajv.compile(explanationInputSchema as AnySchema);
const validateOutputSchema: ValidateFunction<IncidentDetectiveExplanation> =
  ajv.compile(explanationSchema as AnySchema);

const assertUnique = (values: readonly string[]): void => {
  if (new Set(values).size !== values.length) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation references must be unique.",
    );
  }
};

const assertSyntheticPrivacy = (candidate: unknown): void => {
  try {
    validateIncidentDetectiveSyntheticPrivacy(candidate);
  } catch {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation rejected sensitive content.",
    );
  }
};

export const validateIncidentDetectiveExplanationInput = (
  candidate: unknown,
): IncidentDetectiveExplanationInput => {
  if (!validateInputSchema(candidate)) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation input schema validation failed.",
    );
  }

  const input = candidate as IncidentDetectiveExplanationInput;
  assertSyntheticPrivacy(input);
  assertUnique(input.evidence_catalog.map(({ id }) => id));
  assertUnique(input.score.dimensions.map(({ id }) => id));
  assertUnique(
    input.score.dimensions.flatMap(({ findings }) =>
      findings.map(({ rule_id: ruleId }) => ruleId),
    ),
  );

  const dimensionMaximum = input.score.dimensions.reduce(
    (total, dimension) => total + dimension.max_score,
    0,
  );
  const totalScore = input.score.dimensions.reduce(
    (total, dimension) => total + dimension.score,
    0,
  );
  if (
    dimensionMaximum !== input.score.max_score ||
    totalScore !== input.score.total_score
  ) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation score projection must reconcile.",
    );
  }

  return input;
};

export const buildIncidentDetectiveExplanationInput = (
  scenarioCandidate: unknown,
  attemptCandidate: unknown,
  scoreCandidate: unknown,
): IncidentDetectiveExplanationInput => {
  const scenario: IncidentDetectiveScenario =
    validateIncidentDetectiveScenario(scenarioCandidate);
  const attempt: IncidentDetectiveAttempt = validateIncidentDetectiveAttempt(
    scenario,
    attemptCandidate,
  );
  const score = validateIncidentDetectiveScoreResult(scoreCandidate);

  if (score.scenario_id !== scenario.id) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation score must match the scenario.",
    );
  }

  const acquiredEvidenceIds = new Set(attempt.selected_evidence_ids);
  return validateIncidentDetectiveExplanationInput({
    schema_version: "1.0",
    scenario_id: scenario.id,
    score: {
      total_score: score.total_score,
      max_score: score.max_score,
      band: score.band,
      dimensions: score.dimensions.map((dimension) => ({
        id: dimension.id,
        label: dimension.label,
        score: dimension.score,
        max_score: dimension.max_score,
        findings: dimension.findings.map((finding) => ({
          rule_id: finding.rule_id,
          status: finding.status,
          message: finding.message,
        })),
      })),
    },
    evidence_catalog: scenario.evidence.map((evidence) => ({
      id: evidence.id,
      title: evidence.title,
      source: evidence.source,
      ...(evidence.service_id === undefined
        ? {}
        : { service_id: evidence.service_id }),
      acquisition_cost: evidence.acquisition_cost,
      acquired: acquiredEvidenceIds.has(evidence.id),
    })),
    safeguards: {
      synthetic_only: true,
      score_is_authoritative: true,
      facts_must_not_be_invented: true,
      read_only_guidance_only: true,
      attempt_text_excluded: true,
      evidence_payload_excluded: true,
    },
  });
};

export const validateIncidentDetectiveExplanation = (
  candidate: unknown,
  inputCandidate: unknown,
): IncidentDetectiveExplanation => {
  const input = validateIncidentDetectiveExplanationInput(inputCandidate);
  if (!validateOutputSchema(candidate)) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation output schema validation failed.",
    );
  }

  const explanation = candidate as IncidentDetectiveExplanation;
  assertSyntheticPrivacy(explanation);
  if (
    explanation.scenario_id !== input.scenario_id ||
    explanation.total_score !== input.score.total_score
  ) {
    throw new IncidentDetectiveExplanationError(
      "Incident Detective explanation cannot change scenario or score.",
    );
  }

  const findings = new Map(
    input.score.dimensions.flatMap(({ findings: dimensionFindings }) =>
      dimensionFindings.map((finding) => [finding.rule_id, finding] as const),
    ),
  );
  const evidenceIds = new Set(input.evidence_catalog.map(({ id }) => id));
  const outputFindingIds = [
    ...explanation.strengths.map(({ finding_rule_id: id }) => id),
    ...explanation.gaps.map(({ finding_rule_id: id }) => id),
  ];
  assertUnique(outputFindingIds);

  for (const strength of explanation.strengths) {
    const finding = findings.get(strength.finding_rule_id);
    if (finding?.status !== "met" && finding?.status !== "avoided") {
      throw new IncidentDetectiveExplanationError(
        "Explanation strengths must reference met or avoided findings.",
      );
    }
  }
  for (const gap of explanation.gaps) {
    const finding = findings.get(gap.finding_rule_id);
    if (finding?.status !== "missed" && finding?.status !== "penalty") {
      throw new IncidentDetectiveExplanationError(
        "Explanation gaps must reference missed or penalty findings.",
      );
    }
    if (gap.evidence_ids.some((id) => !evidenceIds.has(id))) {
      throw new IncidentDetectiveExplanationError(
        "Explanation gaps must reference known evidence.",
      );
    }
  }
  for (const step of explanation.safe_next_steps) {
    if (step.evidence_ids.some((id) => !evidenceIds.has(id))) {
      throw new IncidentDetectiveExplanationError(
        "Explanation next steps must reference known evidence.",
      );
    }
  }

  return explanation;
};
