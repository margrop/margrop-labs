import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import scoringRulesSchema from "../../../../labs/incident-detective/internal/scoring-rules-v1.schema.json";
import scoreSchema from "../../../../schemas/incident-detective-score-v1.schema.json";
import {
  type IncidentDetectiveAttempt,
  type IncidentSafetyAction,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
  validateIncidentDetectiveSyntheticPrivacy,
} from "./incident-detective-contracts";

type PositiveRuleBase = {
  id: string;
  points: number;
  met_message: string;
  missed_message: string;
};

export type IncidentDetectiveScoringRule =
  | (PositiveRuleBase & {
      kind: "evidence_selected";
      evidence_id: string;
    })
  | (PositiveRuleBase & {
      kind: "evidence_any_selected";
      evidence_ids: string[];
    })
  | (PositiveRuleBase & {
      kind: "evidence_supporting";
      evidence_id: string;
    })
  | (PositiveRuleBase & {
      kind: "evidence_any_contradicting";
      evidence_ids: string[];
    })
  | (PositiveRuleBase & {
      kind: "evidence_before";
      before_evidence_id: string;
      after_evidence_id: string;
    })
  | (PositiveRuleBase & {
      kind: "service_suspected";
      service_id: string;
    })
  | (PositiveRuleBase & {
      kind: "suspected_services_within";
      service_ids: string[];
    })
  | (PositiveRuleBase & {
      kind: "safety_selected";
      action: Extract<
        IncidentSafetyAction,
        | "read_only_first"
        | "preserve_evidence"
        | "least_privilege"
        | "request_approval"
      >;
    })
  | {
      id: string;
      kind: "unsafe_selected";
      points: number;
      action: Extract<
        IncidentSafetyAction,
        "production_write" | "restart_service" | "delete_data"
      >;
      triggered_message: string;
      avoided_message: string;
    };

export type IncidentDetectiveScoringRules = {
  schema_version: "1.0";
  scenario_id: string;
  dimensions: Array<{
    id: string;
    label: string;
    max_points: number;
    rules: IncidentDetectiveScoringRule[];
  }>;
};

export type IncidentDetectiveScoreFinding = {
  rule_id: string;
  status: "met" | "missed" | "penalty" | "avoided";
  points_awarded: number;
  message: string;
};

export type IncidentDetectiveScoreResult = {
  schema_version: "1.0";
  scenario_id: string;
  total_score: number;
  max_score: 100;
  band: "needs-evidence" | "developing" | "evidence-led" | "excellent";
  dimensions: Array<{
    id: string;
    label: string;
    score: number;
    max_score: number;
    findings: IncidentDetectiveScoreFinding[];
  }>;
  strengths: string[];
  improvements: string[];
};

export class IncidentDetectiveScoringError extends Error {
  override name = "IncidentDetectiveScoringError";
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateRulesSchema: ValidateFunction<IncidentDetectiveScoringRules> =
  ajv.compile(scoringRulesSchema as AnySchema);
const validateScoreSchema: ValidateFunction<IncidentDetectiveScoreResult> =
  ajv.compile(scoreSchema as AnySchema);

const assertSyntheticPrivacy = (candidate: unknown, label: string): void => {
  try {
    validateIncidentDetectiveSyntheticPrivacy(candidate);
  } catch {
    throw new IncidentDetectiveScoringError(
      `${label} rejected sensitive or real infrastructure content.`,
    );
  }
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new IncidentDetectiveScoringError(`${label} must be unique.`);
  }
};

const referencedEvidenceIds = (
  rule: IncidentDetectiveScoringRule,
): string[] => {
  switch (rule.kind) {
    case "evidence_selected":
    case "evidence_supporting":
      return [rule.evidence_id];
    case "evidence_any_selected":
    case "evidence_any_contradicting":
      return rule.evidence_ids;
    case "evidence_before":
      return [rule.before_evidence_id, rule.after_evidence_id];
    default:
      return [];
  }
};

export const validateIncidentDetectiveScoringRules = (
  scenarioCandidate: unknown,
  rulesCandidate: unknown,
): IncidentDetectiveScoringRules => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  if (!validateRulesSchema(rulesCandidate)) {
    throw new IncidentDetectiveScoringError(
      "Internal scoring rules did not match the repository-only schema.",
    );
  }

  const rules = rulesCandidate as IncidentDetectiveScoringRules;
  assertSyntheticPrivacy(rules, "Internal scoring rules");

  if (rules.scenario_id !== scenario.id) {
    throw new IncidentDetectiveScoringError(
      "Internal scoring rules must reference the validated scenario.",
    );
  }

  assertUnique(
    rules.dimensions.map(({ id }) => id),
    "Scoring dimension ids",
  );
  assertUnique(
    rules.dimensions.flatMap(({ rules: dimensionRules }) =>
      dimensionRules.map(({ id }) => id),
    ),
    "Scoring rule ids",
  );

  const evidenceIds = new Set(scenario.evidence.map(({ id }) => id));
  const serviceIds = new Set(scenario.services.map(({ id }) => id));

  for (const dimension of rules.dimensions) {
    const positivePoints = dimension.rules.reduce(
      (total, rule) =>
        total + (rule.kind === "unsafe_selected" ? 0 : rule.points),
      0,
    );
    if (positivePoints !== dimension.max_points) {
      throw new IncidentDetectiveScoringError(
        "Each dimension's positive rule points must equal its declared maximum.",
      );
    }

    for (const rule of dimension.rules) {
      if (
        referencedEvidenceIds(rule).some(
          (evidenceId) => !evidenceIds.has(evidenceId),
        )
      ) {
        throw new IncidentDetectiveScoringError(
          "Scoring rules must reference scenario evidence.",
        );
      }
      if (
        rule.kind === "evidence_before" &&
        rule.before_evidence_id === rule.after_evidence_id
      ) {
        throw new IncidentDetectiveScoringError(
          "Evidence-order rules require two different evidence ids.",
        );
      }
      if (
        rule.kind === "service_suspected" &&
        !serviceIds.has(rule.service_id)
      ) {
        throw new IncidentDetectiveScoringError(
          "Scoring rules must reference scenario services.",
        );
      }
      if (
        rule.kind === "suspected_services_within" &&
        rule.service_ids.some((serviceId) => !serviceIds.has(serviceId))
      ) {
        throw new IncidentDetectiveScoringError(
          "Scoring rules must reference scenario services.",
        );
      }
      if (
        (rule.kind === "safety_selected" || rule.kind === "unsafe_selected") &&
        dimension.id !== "safety"
      ) {
        throw new IncidentDetectiveScoringError(
          "Safety action rules must stay in the safety dimension.",
        );
      }
    }
  }

  if (
    rules.dimensions.reduce(
      (total, dimension) => total + dimension.max_points,
      0,
    ) !== 100
  ) {
    throw new IncidentDetectiveScoringError(
      "Scoring dimensions must total 100 points.",
    );
  }

  return rules;
};

const bandForScore = (score: number): IncidentDetectiveScoreResult["band"] => {
  if (score < 40) {
    return "needs-evidence";
  }
  if (score < 70) {
    return "developing";
  }
  if (score < 95) {
    return "evidence-led";
  }
  return "excellent";
};

const evaluateRule = (
  rule: IncidentDetectiveScoringRule,
  attempt: IncidentDetectiveAttempt,
): IncidentDetectiveScoreFinding => {
  if (rule.kind === "unsafe_selected") {
    const triggered = attempt.safety_actions.includes(rule.action);

    return {
      rule_id: rule.id,
      status: triggered ? "penalty" : "avoided",
      points_awarded: triggered ? rule.points : 0,
      message: triggered ? rule.triggered_message : rule.avoided_message,
    };
  }

  const selected = new Set(attempt.selected_evidence_ids);
  const selectedIndex = new Map(
    attempt.selected_evidence_ids.map((evidenceId, index) => [
      evidenceId,
      index,
    ]),
  );
  let met = false;

  switch (rule.kind) {
    case "evidence_selected":
      met = selected.has(rule.evidence_id);
      break;
    case "evidence_any_selected":
      met = rule.evidence_ids.some((evidenceId) => selected.has(evidenceId));
      break;
    case "evidence_supporting":
      met = attempt.hypothesis.supporting_evidence_ids.includes(
        rule.evidence_id,
      );
      break;
    case "evidence_any_contradicting":
      met = rule.evidence_ids.some((evidenceId) =>
        attempt.hypothesis.contradicting_evidence_ids.includes(evidenceId),
      );
      break;
    case "evidence_before": {
      const beforeIndex = selectedIndex.get(rule.before_evidence_id);
      const afterIndex = selectedIndex.get(rule.after_evidence_id);
      met =
        beforeIndex !== undefined &&
        afterIndex !== undefined &&
        beforeIndex < afterIndex;
      break;
    }
    case "service_suspected":
      met = attempt.hypothesis.suspected_service_ids.includes(rule.service_id);
      break;
    case "suspected_services_within": {
      const allowed = new Set(rule.service_ids);
      met = attempt.hypothesis.suspected_service_ids.every((serviceId) =>
        allowed.has(serviceId),
      );
      break;
    }
    case "safety_selected":
      met = attempt.safety_actions.includes(rule.action);
      break;
  }

  return {
    rule_id: rule.id,
    status: met ? "met" : "missed",
    points_awarded: met ? rule.points : 0,
    message: met ? rule.met_message : rule.missed_message,
  };
};

export const validateIncidentDetectiveScoreResult = (
  candidate: unknown,
): IncidentDetectiveScoreResult => {
  if (!validateScoreSchema(candidate)) {
    throw new IncidentDetectiveScoringError(
      "Incident Detective score schema validation failed.",
    );
  }

  const result = candidate as IncidentDetectiveScoreResult;
  assertSyntheticPrivacy(result, "Incident Detective score");
  assertUnique(
    result.dimensions.map(({ id }) => id),
    "Score dimension ids",
  );
  assertUnique(
    result.dimensions.flatMap(({ findings }) =>
      findings.map(({ rule_id: ruleId }) => ruleId),
    ),
    "Score finding rule ids",
  );

  for (const dimension of result.dimensions) {
    const expectedScore = Math.max(
      0,
      Math.min(
        dimension.max_score,
        dimension.findings.reduce(
          (total, finding) => total + finding.points_awarded,
          0,
        ),
      ),
    );
    if (dimension.score !== expectedScore) {
      throw new IncidentDetectiveScoringError(
        "Dimension score must reconcile with its findings.",
      );
    }
  }

  const maxScore = result.dimensions.reduce(
    (total, dimension) => total + dimension.max_score,
    0,
  );
  const totalScore = result.dimensions.reduce(
    (total, dimension) => total + dimension.score,
    0,
  );
  if (
    maxScore !== result.max_score ||
    totalScore !== result.total_score ||
    result.band !== bandForScore(result.total_score)
  ) {
    throw new IncidentDetectiveScoringError(
      "Score totals and band must reconcile with dimension results.",
    );
  }

  return result;
};

export const scoreIncidentDetectiveAttempt = (
  scenarioCandidate: unknown,
  attemptCandidate: unknown,
  rulesCandidate: unknown,
): IncidentDetectiveScoreResult => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const attempt = validateIncidentDetectiveAttempt(scenario, attemptCandidate);
  const rules = validateIncidentDetectiveScoringRules(scenario, rulesCandidate);

  const dimensions = rules.dimensions.map((dimension) => {
    const findings = dimension.rules.map((rule) => evaluateRule(rule, attempt));
    const rawScore = findings.reduce(
      (total, finding) => total + finding.points_awarded,
      0,
    );

    return {
      id: dimension.id,
      label: dimension.label,
      score: Math.max(0, Math.min(dimension.max_points, rawScore)),
      max_score: dimension.max_points,
      findings,
    };
  });
  const totalScore = dimensions.reduce(
    (total, dimension) => total + dimension.score,
    0,
  );
  const result: IncidentDetectiveScoreResult = {
    schema_version: "1.0",
    scenario_id: scenario.id,
    total_score: totalScore,
    max_score: 100,
    band: bandForScore(totalScore),
    dimensions,
    strengths: dimensions.flatMap(({ findings }) =>
      findings
        .filter(
          (finding) => finding.status === "met" && finding.points_awarded > 0,
        )
        .map(({ message }) => message),
    ),
    improvements: dimensions.flatMap(({ findings }) =>
      findings
        .filter(
          (finding) =>
            finding.status === "missed" || finding.status === "penalty",
        )
        .map(({ message }) => message),
    ),
  };

  return validateIncidentDetectiveScoreResult(result);
};
