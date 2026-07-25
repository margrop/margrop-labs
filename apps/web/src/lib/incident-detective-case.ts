import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import answerDraftSchema from "../../../../labs/incident-detective/internal/answer-draft-v1.schema.json";
import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  type IncidentSafetyAction,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
  validateIncidentDetectiveSyntheticPrivacy,
} from "./incident-detective-contracts";

export type IncidentDetectiveAnswerDraft = {
  schema_version: "draft-1";
  scenario_id: string;
  root_cause: {
    service_ids: string[];
    summary: string;
    mechanism: string;
  };
  required_evidence_ids: string[];
  supporting_evidence_ids: string[];
  counterevidence_ids: string[];
  unsafe_without_approval: Extract<
    IncidentSafetyAction,
    "production_write" | "restart_service" | "delete_data"
  >[];
  recommended_next_actions: string[];
  known_unknowns: string[];
};

export type IncidentDetectiveCaseBundle = {
  scenario: IncidentDetectiveScenario;
  answer: IncidentDetectiveAnswerDraft;
  canonical_attempt: IncidentDetectiveAttempt;
};

export class IncidentDetectiveCaseError extends Error {
  override name = "IncidentDetectiveCaseError";
}

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateAnswerSchema: ValidateFunction<IncidentDetectiveAnswerDraft> =
  ajv.compile(answerDraftSchema as AnySchema);

const assertKnownIds = (
  values: readonly string[],
  known: ReadonlySet<string>,
  message: string,
): void => {
  if (values.some((value) => !known.has(value))) {
    throw new IncidentDetectiveCaseError(message);
  }
};

export const validateIncidentDetectiveAnswerDraft = (
  scenarioCandidate: unknown,
  answerCandidate: unknown,
): IncidentDetectiveAnswerDraft => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  if (!validateAnswerSchema(answerCandidate)) {
    throw new IncidentDetectiveCaseError(
      "Internal answer draft did not match its repository-only schema.",
    );
  }

  const answer = answerCandidate as IncidentDetectiveAnswerDraft;
  validateIncidentDetectiveSyntheticPrivacy(answer);

  if (answer.scenario_id !== scenario.id) {
    throw new IncidentDetectiveCaseError(
      "Internal answer draft must reference the validated scenario.",
    );
  }

  const serviceIds = new Set(scenario.services.map(({ id }) => id));
  const evidenceIds = new Set(scenario.evidence.map(({ id }) => id));
  assertKnownIds(
    answer.root_cause.service_ids,
    serviceIds,
    "Root-cause services must exist in the scenario.",
  );
  assertKnownIds(
    answer.required_evidence_ids,
    evidenceIds,
    "Required evidence must exist in the scenario.",
  );
  assertKnownIds(
    answer.supporting_evidence_ids,
    evidenceIds,
    "Supporting evidence must exist in the scenario.",
  );
  assertKnownIds(
    answer.counterevidence_ids,
    evidenceIds,
    "Counterevidence must exist in the scenario.",
  );

  if (
    answer.required_evidence_ids.some(
      (evidenceId) => !answer.supporting_evidence_ids.includes(evidenceId),
    )
  ) {
    throw new IncidentDetectiveCaseError(
      "Required evidence must be a subset of supporting evidence.",
    );
  }
  if (
    answer.supporting_evidence_ids.some((evidenceId) =>
      answer.counterevidence_ids.includes(evidenceId),
    )
  ) {
    throw new IncidentDetectiveCaseError(
      "Supporting evidence and counterevidence must be disjoint.",
    );
  }

  return answer;
};

export const validateIncidentDetectiveCaseBundle = (
  scenarioCandidate: unknown,
  answerCandidate: unknown,
  attemptCandidate: unknown,
): IncidentDetectiveCaseBundle => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const answer = validateIncidentDetectiveAnswerDraft(
    scenario,
    answerCandidate,
  );
  const canonicalAttempt = validateIncidentDetectiveAttempt(
    scenario,
    attemptCandidate,
  );

  const sources = new Set(scenario.evidence.map(({ source }) => source));
  if (
    !sources.has("prometheus") ||
    !sources.has("loki") ||
    !sources.has("mysql")
  ) {
    throw new IncidentDetectiveCaseError(
      "A playable observability case must include Prometheus, Loki and MySQL evidence.",
    );
  }

  const totalEvidenceCost = scenario.evidence.reduce(
    (total, evidence) => total + evidence.acquisition_cost,
    0,
  );
  if (totalEvidenceCost <= scenario.evidence_budget) {
    throw new IncidentDetectiveCaseError(
      "A playable case must force at least one evidence tradeoff.",
    );
  }

  if (
    answer.required_evidence_ids.some(
      (evidenceId) =>
        !canonicalAttempt.selected_evidence_ids.includes(evidenceId),
    )
  ) {
    throw new IncidentDetectiveCaseError(
      "The canonical attempt must select every required evidence item.",
    );
  }

  const requiredSafetyActions: IncidentSafetyAction[] = [
    "read_only_first",
    "preserve_evidence",
    "least_privilege",
    "request_approval",
  ];
  if (
    requiredSafetyActions.some(
      (action) => !canonicalAttempt.safety_actions.includes(action),
    )
  ) {
    throw new IncidentDetectiveCaseError(
      "The canonical attempt must preserve the complete read-only safety path.",
    );
  }

  return {
    scenario,
    answer,
    canonical_attempt: canonicalAttempt,
  };
};
