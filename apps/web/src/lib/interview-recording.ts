import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import conclusionSchema from "../../../../schemas/interview-conclusion-v1.schema.json";
import recordSchema from "../../../../schemas/interview-record-v1.schema.json";
import {
  type InterviewPlan,
  validateInterviewPlan,
} from "./interview-planning";

export type InterviewRecordResponseStatus =
  "answered" | "partially_answered" | "not_asked" | "declined" | "unknown";
export type InterviewRecordFactKind =
  "candidate_statement" | "interviewer_observation" | "verifiable_artifact";
export type InterviewRecordUnknownReason =
  "not_asked" | "no_answer" | "not_verified" | "not_applicable";

export type InterviewRecordFact = Readonly<{
  fact_id: string;
  kind: InterviewRecordFactKind;
  text: string;
}>;

export type InterviewRecordCounterevidence = Readonly<{
  counterevidence_id: string;
  text: string;
}>;

export type InterviewRecordEntry = Readonly<{
  entry_id: string;
  question_id: string;
  requirement_ids: string[];
  response_status: InterviewRecordResponseStatus;
  facts: InterviewRecordFact[];
  counterevidence: InterviewRecordCounterevidence[];
  unknown_reason: InterviewRecordUnknownReason | null;
  user_confirmed: boolean;
}>;

export type InterviewRecord = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  record_id: string;
  plan_id: string;
  mode: "interviewer" | "candidate";
  duration_minutes: 30 | 45 | 60;
  status: "draft" | "confirmed";
  entries: InterviewRecordEntry[];
  local_only: true;
  human_review: {
    required: true;
    confirmed: boolean;
    reasons: Array<
      "draft_requires_user_confirmation" | "no_automatic_decision"
    >;
  };
}>;

export type InterviewConclusionStatus =
  "supported" | "partial" | "conflict" | "unknown" | "not_assessed";
export type InterviewConclusionInferenceCode =
  | "fact_supported"
  | "partial_facts"
  | "conflicting_facts"
  | "not_enough_evidence"
  | "not_assessed";

export type InterviewConclusionJudgment = Readonly<{
  judgment_id: string;
  requirement_id: string;
  status: InterviewConclusionStatus;
  record_entry_ids: string[];
  fact_ids: string[];
  counterevidence_ids: string[];
  inference_code: InterviewConclusionInferenceCode;
  review_state: "draft";
}>;

export type InterviewConclusion = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  conclusion_id: string;
  record_id: string;
  status: "draft" | "confirmed";
  overall: {
    status: InterviewConclusionStatus;
    recommendation:
      | "supportive_signal"
      | "partial_signal"
      | "requires_more_evidence"
      | "conflicted"
      | "not_assessed";
    judgment_ids: string[];
  };
  judgments: InterviewConclusionJudgment[];
  unassessed_requirement_ids: string[];
  unknown_requirement_ids: string[];
  conflict_requirement_ids: string[];
  evidence_summary: {
    fact_ids: string[];
    counterevidence_ids: string[];
    unknown_requirement_ids: string[];
  };
  next_steps: Array<{
    requirement_id: string;
    action: "ask_follow_up" | "verify_artifact" | "review_conflict";
    source: "record_gap" | "unknown" | "conflict";
  }>;
  human_review: {
    required: true;
    confirmed: boolean;
    reasons: Array<
      | "unassessed_requirements"
      | "unknown_requirements"
      | "conflicting_evidence"
      | "draft_requires_user_confirmation"
      | "no_automatic_decision"
    >;
  };
  automatic_decision: false;
}>;

export class InterviewRecordingError extends Error {
  override name = "InterviewRecordingError";
}

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message ?? "is invalid"}`;
    })
    .join("; ");

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateRecordSchema = ajv.compile<InterviewRecord>(
  recordSchema as AnySchema,
);
const validateConclusionSchema = ajv.compile<InterviewConclusion>(
  conclusionSchema as AnySchema,
);

const parseRecord = (candidate: unknown): InterviewRecord => {
  if (!validateRecordSchema(candidate)) {
    throw new InterviewRecordingError(
      `interview-record-v1 validation failed: ${formatValidationErrors(validateRecordSchema.errors)}`,
    );
  }
  return candidate as InterviewRecord;
};

const parseConclusion = (candidate: unknown): InterviewConclusion => {
  if (!validateConclusionSchema(candidate)) {
    throw new InterviewRecordingError(
      `interview-conclusion-v1 validation failed: ${formatValidationErrors(validateConclusionSchema.errors)}`,
    );
  }
  return candidate as InterviewConclusion;
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new InterviewRecordingError(`${label} ids must be unique.`);
  }
};

const sameSet = (
  left: readonly string[],
  right: readonly string[],
): boolean => {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

const validateRecordReferences = (
  record: InterviewRecord,
  plan?: InterviewPlan,
): void => {
  const entryIds = record.entries.map(({ entry_id }) => entry_id);
  assertUnique(entryIds, "Record entry");
  const factIds = record.entries.flatMap(({ facts }) =>
    facts.map(({ fact_id }) => fact_id),
  );
  const counterevidenceIds = record.entries.flatMap(({ counterevidence }) =>
    counterevidence.map(({ counterevidence_id }) => counterevidence_id),
  );
  assertUnique(factIds, "Record fact");
  assertUnique(counterevidenceIds, "Record counterevidence");
  if (
    new Set([...factIds, ...counterevidenceIds]).size !==
    factIds.length + counterevidenceIds.length
  ) {
    throw new InterviewRecordingError(
      "Record fact and counterevidence IDs must be distinct.",
    );
  }

  for (const entry of record.entries) {
    if (
      ["not_asked", "declined", "unknown"].includes(entry.response_status) &&
      entry.unknown_reason === null
    ) {
      throw new InterviewRecordingError(
        "Unanswered record entries must preserve an explicit unknown reason.",
      );
    }
    if (
      entry.response_status === "answered" &&
      entry.facts.length === 0 &&
      entry.counterevidence.length === 0
    ) {
      throw new InterviewRecordingError(
        "Answered record entries must contain a fact or counterevidence.",
      );
    }
  }
  if (record.status === "confirmed") {
    if (!record.human_review.confirmed) {
      throw new InterviewRecordingError(
        "Confirmed records must have explicit human confirmation.",
      );
    }
    if (record.entries.some(({ user_confirmed }) => !user_confirmed)) {
      throw new InterviewRecordingError(
        "Confirmed records require confirmation for every entry.",
      );
    }
  } else if (record.human_review.confirmed) {
    throw new InterviewRecordingError(
      "Draft records cannot be marked as human-confirmed.",
    );
  }

  if (plan) {
    const validatedPlan = validateInterviewPlan(plan);
    if (
      record.plan_id !== validatedPlan.plan_id ||
      record.mode !== validatedPlan.mode ||
      record.duration_minutes !== validatedPlan.duration_minutes
    ) {
      throw new InterviewRecordingError(
        "Record metadata must match the interview plan.",
      );
    }
    const questionsById = new Map(
      validatedPlan.questions.map((question) => [
        question.question_id,
        question,
      ]),
    );
    for (const entry of record.entries) {
      const question = questionsById.get(entry.question_id);
      if (!question) {
        throw new InterviewRecordingError(
          "Record entry references an unknown plan question.",
        );
      }
      if (
        entry.requirement_ids.some(
          (id) => !question.requirement_ids.includes(id),
        )
      ) {
        throw new InterviewRecordingError(
          "Record entry requirement references must match its plan question.",
        );
      }
    }
  }
};

export const validateInterviewRecord = (
  candidate: unknown,
  plan?: InterviewPlan,
): InterviewRecord => {
  const record = parseRecord(candidate);
  validateRecordReferences(record, plan);
  return record;
};

const validateConclusionReferences = (
  conclusion: InterviewConclusion,
  record?: InterviewRecord,
  plan?: InterviewPlan,
): void => {
  const judgmentIds = conclusion.judgments.map(
    ({ judgment_id }) => judgment_id,
  );
  assertUnique(judgmentIds, "Conclusion judgment");
  if (!sameSet(judgmentIds, conclusion.overall.judgment_ids)) {
    throw new InterviewRecordingError(
      "Conclusion overall judgment references must match its judgments.",
    );
  }
  const judgedRequirementIds = conclusion.judgments.map(
    ({ requirement_id }) => requirement_id,
  );
  assertUnique(judgedRequirementIds, "Conclusion requirement");
  const unknownIds = conclusion.unknown_requirement_ids;
  const conflictIds = conclusion.conflict_requirement_ids;
  assertUnique(unknownIds, "Conclusion unknown requirement");
  assertUnique(conflictIds, "Conclusion conflict requirement");
  if (
    unknownIds.some((id) => conflictIds.includes(id)) ||
    !unknownIds.every((id) => judgedRequirementIds.includes(id)) ||
    !conflictIds.every((id) => judgedRequirementIds.includes(id))
  ) {
    throw new InterviewRecordingError(
      "Conclusion unknown and conflict references must target distinct judgments.",
    );
  }
  const expectedUnknownIds = conclusion.judgments
    .filter(({ status }) => status === "unknown")
    .map(({ requirement_id }) => requirement_id);
  const expectedConflictIds = conclusion.judgments
    .filter(({ status }) => status === "conflict")
    .map(({ requirement_id }) => requirement_id);
  if (
    !sameSet(unknownIds, expectedUnknownIds) ||
    !sameSet(conflictIds, expectedConflictIds) ||
    !sameSet(conclusion.evidence_summary.unknown_requirement_ids, unknownIds)
  ) {
    throw new InterviewRecordingError(
      "Conclusion unknown and conflict summaries must match judgment statuses.",
    );
  }
  for (const judgment of conclusion.judgments) {
    const expectedCode =
      judgment.status === "supported"
        ? "fact_supported"
        : judgment.status === "partial"
          ? "partial_facts"
          : judgment.status === "conflict"
            ? "conflicting_facts"
            : judgment.status === "unknown"
              ? "not_enough_evidence"
              : "not_assessed";
    if (judgment.inference_code !== expectedCode) {
      throw new InterviewRecordingError(
        "Conclusion inference code must remain separate and consistent with status.",
      );
    }
    if (judgment.review_state !== "draft") {
      throw new InterviewRecordingError(
        "Conclusion judgments must remain editable drafts.",
      );
    }
  }

  if (record) {
    const validatedRecord = validateInterviewRecord(record, plan);
    if (conclusion.record_id !== validatedRecord.record_id) {
      throw new InterviewRecordingError(
        "Conclusion record_id must match the source record.",
      );
    }
    const entryById = new Map(
      validatedRecord.entries.map((entry) => [entry.entry_id, entry]),
    );
    const facts = new Map<string, string>();
    const counters = new Map<string, string>();
    for (const entry of validatedRecord.entries) {
      for (const fact of entry.facts) {
        facts.set(fact.fact_id, entry.entry_id);
      }
      for (const counter of entry.counterevidence) {
        counters.set(counter.counterevidence_id, entry.entry_id);
      }
    }
    for (const judgment of conclusion.judgments) {
      if (
        judgment.record_entry_ids.some((entryId) => !entryById.has(entryId))
      ) {
        throw new InterviewRecordingError(
          "Conclusion judgment references an unknown record entry.",
        );
      }
      if (
        judgment.fact_ids.some((factId) => !facts.has(factId)) ||
        judgment.counterevidence_ids.some(
          (counterId) => !counters.has(counterId),
        )
      ) {
        throw new InterviewRecordingError(
          "Conclusion evidence references must exist in the source record.",
        );
      }
      if (
        judgment.fact_ids.some(
          (factId) => !judgment.record_entry_ids.includes(facts.get(factId)!),
        ) ||
        judgment.counterevidence_ids.some(
          (counterId) =>
            !judgment.record_entry_ids.includes(counters.get(counterId)!),
        )
      ) {
        throw new InterviewRecordingError(
          "Conclusion evidence references must belong to cited record entries.",
        );
      }
      if (
        judgment.record_entry_ids.some((entryId) => {
          const entry = entryById.get(entryId)!;
          return !entry.requirement_ids.includes(judgment.requirement_id);
        })
      ) {
        throw new InterviewRecordingError(
          "Conclusion judgments must cite entries that target the same requirement.",
        );
      }
    }
    if (
      conclusion.evidence_summary.fact_ids.some(
        (factId) => !facts.has(factId),
      ) ||
      conclusion.evidence_summary.counterevidence_ids.some(
        (counterId) => !counters.has(counterId),
      ) ||
      !sameSet(
        conclusion.evidence_summary.fact_ids,
        conclusion.judgments.flatMap(({ fact_ids }) => fact_ids),
      ) ||
      !sameSet(
        conclusion.evidence_summary.counterevidence_ids,
        conclusion.judgments.flatMap(
          ({ counterevidence_ids }) => counterevidence_ids,
        ),
      )
    ) {
      throw new InterviewRecordingError(
        "Conclusion evidence summary must match cited record evidence.",
      );
    }
  }

  if (plan) {
    const validatedPlan = validateInterviewPlan(plan);
    const planRequirementIds = unique(
      validatedPlan.questions.flatMap(({ requirement_ids }) => requirement_ids),
    );
    if (
      judgedRequirementIds.some((id) => !planRequirementIds.includes(id)) ||
      conclusion.unassessed_requirement_ids.some(
        (id) => !planRequirementIds.includes(id),
      ) ||
      !sameSet(
        unique([
          ...judgedRequirementIds,
          ...conclusion.unassessed_requirement_ids,
        ]),
        planRequirementIds,
      )
    ) {
      throw new InterviewRecordingError(
        "Conclusion requirement references must cover the plan requirements exactly.",
      );
    }
  }

  const judgmentByStatus = conclusion.judgments.reduce(
    (counts, judgment) => {
      counts[judgment.status] += 1;
      return counts;
    },
    {
      supported: 0,
      partial: 0,
      conflict: 0,
      unknown: 0,
      not_assessed: 0,
    } as Record<InterviewConclusionStatus, number>,
  );
  const expectedOverall =
    judgmentByStatus.conflict > 0
      ? { status: "conflict" as const, recommendation: "conflicted" as const }
      : judgmentByStatus.supported + judgmentByStatus.partial === 0
        ? conclusion.unassessed_requirement_ids.length > 0
          ? {
              status: "not_assessed" as const,
              recommendation: "not_assessed" as const,
            }
          : {
              status: "unknown" as const,
              recommendation: "requires_more_evidence" as const,
            }
        : conclusion.unassessed_requirement_ids.length > 0 ||
            judgmentByStatus.unknown > 0 ||
            judgmentByStatus.partial > 0
          ? {
              status: "partial" as const,
              recommendation: "partial_signal" as const,
            }
          : {
              status: "supported" as const,
              recommendation: "supportive_signal" as const,
            };
  if (
    conclusion.overall.status !== expectedOverall.status ||
    conclusion.overall.recommendation !== expectedOverall.recommendation
  ) {
    throw new InterviewRecordingError(
      "Conclusion overall status must match its cited record judgments.",
    );
  }

  const reasons = conclusion.human_review.reasons;
  if (
    !reasons.includes("draft_requires_user_confirmation") ||
    !reasons.includes("no_automatic_decision")
  ) {
    throw new InterviewRecordingError(
      "Conclusion must remain a draft requiring explicit human confirmation.",
    );
  }
  if (
    conclusion.unassessed_requirement_ids.length > 0 &&
    !reasons.includes("unassessed_requirements")
  ) {
    throw new InterviewRecordingError(
      "Conclusion must preserve unassessed requirements as a review reason.",
    );
  }
  if (
    conclusion.unknown_requirement_ids.length > 0 &&
    !reasons.includes("unknown_requirements")
  ) {
    throw new InterviewRecordingError(
      "Conclusion must preserve unknown requirements as a review reason.",
    );
  }
  if (
    conclusion.conflict_requirement_ids.length > 0 &&
    !reasons.includes("conflicting_evidence")
  ) {
    throw new InterviewRecordingError(
      "Conclusion must preserve conflicts as a review reason.",
    );
  }
  if (conclusion.status === "draft" && conclusion.human_review.confirmed) {
    throw new InterviewRecordingError(
      "Draft conclusions cannot be marked as confirmed.",
    );
  }
  if (conclusion.status === "confirmed" && !conclusion.human_review.confirmed) {
    throw new InterviewRecordingError(
      "Confirmed conclusions require explicit human confirmation.",
    );
  }
};

export const validateInterviewConclusion = (
  candidate: unknown,
  record?: InterviewRecord,
  plan?: InterviewPlan,
): InterviewConclusion => {
  const conclusion = parseConclusion(candidate);
  validateConclusionReferences(conclusion, record, plan);
  return conclusion;
};

const classifyRecordEntries = (
  entries: readonly InterviewRecordEntry[],
): {
  status: InterviewConclusionStatus;
  inference_code: InterviewConclusionInferenceCode;
  fact_ids: string[];
  counterevidence_ids: string[];
} => {
  const factIds = entries.flatMap(({ facts }) =>
    facts.map(({ fact_id }) => fact_id),
  );
  const counterevidenceIds = entries.flatMap(({ counterevidence }) =>
    counterevidence.map(({ counterevidence_id }) => counterevidence_id),
  );
  if (counterevidenceIds.length > 0) {
    return {
      status: "conflict",
      inference_code: "conflicting_facts",
      fact_ids: unique(factIds),
      counterevidence_ids: unique(counterevidenceIds),
    };
  }
  if (factIds.length === 0) {
    return {
      status: "unknown",
      inference_code: "not_enough_evidence",
      fact_ids: [],
      counterevidence_ids: [],
    };
  }
  const partial = entries.some(
    ({ response_status }) => response_status === "partially_answered",
  );
  return {
    status: partial ? "partial" : "supported",
    inference_code: partial ? "partial_facts" : "fact_supported",
    fact_ids: unique(factIds),
    counterevidence_ids: [],
  };
};

export const buildInterviewConclusion = (
  record: InterviewRecord,
  plan: InterviewPlan,
  conclusionId = "conclusion-local",
): InterviewConclusion => {
  const validatedPlan = validateInterviewPlan(plan);
  const validatedRecord = validateInterviewRecord(record, validatedPlan);
  const requirementIds = unique(
    validatedPlan.questions.flatMap(({ requirement_ids }) => requirement_ids),
  );
  const entriesByRequirement = new Map<string, InterviewRecordEntry[]>();
  for (const entry of validatedRecord.entries) {
    for (const requirementId of entry.requirement_ids) {
      const current = entriesByRequirement.get(requirementId) ?? [];
      current.push(entry);
      entriesByRequirement.set(requirementId, current);
    }
  }
  const judgments: InterviewConclusionJudgment[] = [];
  const unassessedRequirementIds: string[] = [];
  for (const requirementId of requirementIds) {
    const entries = entriesByRequirement.get(requirementId) ?? [];
    if (entries.length === 0) {
      unassessedRequirementIds.push(requirementId);
      continue;
    }
    const classification = classifyRecordEntries(entries);
    judgments.push({
      judgment_id: `judgment-${judgments.length + 1}`,
      requirement_id: requirementId,
      status: classification.status,
      record_entry_ids: unique(entries.map(({ entry_id }) => entry_id)),
      fact_ids: classification.fact_ids,
      counterevidence_ids: classification.counterevidence_ids,
      inference_code: classification.inference_code,
      review_state: "draft",
    });
  }
  const unknownRequirementIds = judgments
    .filter(({ status }) => status === "unknown")
    .map(({ requirement_id }) => requirement_id);
  const conflictRequirementIds = judgments
    .filter(({ status }) => status === "conflict")
    .map(({ requirement_id }) => requirement_id);
  const statusCounts = judgments.reduce(
    (counts, judgment) => {
      counts[judgment.status] += 1;
      return counts;
    },
    {
      supported: 0,
      partial: 0,
      conflict: 0,
      unknown: 0,
      not_assessed: 0,
    } as Record<InterviewConclusionStatus, number>,
  );
  const overall =
    statusCounts.conflict > 0
      ? { status: "conflict" as const, recommendation: "conflicted" as const }
      : statusCounts.supported + statusCounts.partial === 0
        ? unassessedRequirementIds.length > 0
          ? {
              status: "not_assessed" as const,
              recommendation: "not_assessed" as const,
            }
          : {
              status: "unknown" as const,
              recommendation: "requires_more_evidence" as const,
            }
        : unassessedRequirementIds.length > 0 ||
            statusCounts.unknown > 0 ||
            statusCounts.partial > 0
          ? {
              status: "partial" as const,
              recommendation: "partial_signal" as const,
            }
          : {
              status: "supported" as const,
              recommendation: "supportive_signal" as const,
            };
  const nextSteps = [
    ...unassessedRequirementIds.map((requirement_id) => ({
      requirement_id,
      action: "ask_follow_up" as const,
      source: "record_gap" as const,
    })),
    ...unknownRequirementIds.map((requirement_id) => ({
      requirement_id,
      action: "ask_follow_up" as const,
      source: "unknown" as const,
    })),
    ...conflictRequirementIds.map((requirement_id) => ({
      requirement_id,
      action: "review_conflict" as const,
      source: "conflict" as const,
    })),
  ];
  const reasons: InterviewConclusion["human_review"]["reasons"] = [];
  if (unassessedRequirementIds.length > 0) {
    reasons.push("unassessed_requirements");
  }
  if (unknownRequirementIds.length > 0) {
    reasons.push("unknown_requirements");
  }
  if (conflictRequirementIds.length > 0) {
    reasons.push("conflicting_evidence");
  }
  reasons.push("draft_requires_user_confirmation", "no_automatic_decision");
  const conclusion: InterviewConclusion = {
    schema_version: "1.0",
    sensitivity: "sensitive",
    conclusion_id: conclusionId,
    record_id: validatedRecord.record_id,
    status: "draft",
    overall: {
      ...overall,
      judgment_ids: judgments.map(({ judgment_id }) => judgment_id),
    },
    judgments,
    unassessed_requirement_ids: unassessedRequirementIds,
    unknown_requirement_ids: unknownRequirementIds,
    conflict_requirement_ids: conflictRequirementIds,
    evidence_summary: {
      fact_ids: unique(judgments.flatMap(({ fact_ids }) => fact_ids)),
      counterevidence_ids: unique(
        judgments.flatMap(({ counterevidence_ids }) => counterevidence_ids),
      ),
      unknown_requirement_ids: unknownRequirementIds,
    },
    next_steps: nextSteps,
    human_review: { required: true, confirmed: false, reasons },
    automatic_decision: false,
  };
  return validateInterviewConclusion(
    conclusion,
    validatedRecord,
    validatedPlan,
  );
};
