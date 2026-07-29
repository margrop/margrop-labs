import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import type { JsonObject } from "@margrop-labs/ai-gateway";

import boundarySchema from "../../../../schemas/interview-boundary-projection-v1.schema.json";
import conclusionInputSchema from "../../../../schemas/interview-ai-conclusion-input-v1.schema.json";
import matchInputSchema from "../../../../schemas/interview-ai-match-input-v1.schema.json";
import planInputSchema from "../../../../schemas/interview-ai-plan-input-v1.schema.json";
import matchSchema from "../../../../schemas/interview-match-v1.schema.json";
import {
  type InterviewBoundaryProjection,
  INTERVIEW_BOUNDARY_OMITTED_FIELDS,
  type InterviewInputBundle,
  buildInterviewBoundaryProjection,
  redactInterviewLocalText,
  validateInterviewInputBundle,
} from "../lib/interview-contracts";
import {
  type InterviewMatchResult,
  validateInterviewMatchResult,
} from "../lib/interview-matching";
import {
  type InterviewPlan,
  type InterviewPlanDuration,
  type InterviewPlanMode,
  validateInterviewPlan,
} from "../lib/interview-planning";
import {
  type InterviewConclusion,
  type InterviewRecord,
  validateInterviewConclusion,
  validateInterviewRecord,
} from "../lib/interview-recording";

export const interviewAiLabId = "interview-workbench";
export const interviewAiOperationIds = Object.freeze({
  match: "interview-workbench.match-v1",
  plan: "interview-workbench.plan-v1",
  conclusion: "interview-workbench.conclusion-v1",
});

export type InterviewAiSafeguards = Readonly<{
  unknown_is_not_negative: true;
  protected_attribute_inference: false;
  automatic_decision: false;
}>;

export type InterviewAiMatchInput = Readonly<{
  schema_version: "1.0";
  boundary: InterviewBoundaryProjection;
  safeguards: InterviewAiSafeguards;
}>;

export type InterviewAiPlanInput = Readonly<{
  schema_version: "1.0";
  boundary: InterviewBoundaryProjection;
  match: InterviewMatchResult;
  mode: InterviewPlanMode;
  duration_minutes: InterviewPlanDuration;
  early_gate_requirement_ids: string[];
  safeguards: InterviewAiSafeguards;
}>;

export type InterviewAiPlanProjection = Readonly<{
  plan_id: string;
  mode: InterviewPlanMode;
  duration_minutes: InterviewPlanDuration;
  questions: Array<{
    question_id: string;
    requirement_ids: string[];
  }>;
}>;

export type InterviewAiRecordProjection = Readonly<{
  record_id: string;
  plan_id: string;
  mode: InterviewPlanMode;
  duration_minutes: InterviewPlanDuration;
  status: "draft" | "confirmed";
  entries: Array<{
    entry_id: string;
    question_id: string;
    requirement_ids: string[];
    response_status:
      "answered" | "partially_answered" | "not_asked" | "declined" | "unknown";
    fact_ids: string[];
    counterevidence_ids: string[];
    unknown_reason:
      "not_asked" | "no_answer" | "not_verified" | "not_applicable" | null;
  }>;
}>;

export type InterviewAiConclusionInput = Readonly<{
  schema_version: "1.0";
  plan_projection: InterviewAiPlanProjection;
  record_projection: InterviewAiRecordProjection;
  safeguards: InterviewAiSafeguards;
}>;

export class InterviewAiContractError extends Error {
  override name = "InterviewAiContractError";
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addSchema(boundarySchema as AnySchema);
ajv.addSchema(matchSchema as AnySchema);
const validateBoundarySchema = ajv.compile<InterviewBoundaryProjection>(
  boundarySchema as AnySchema,
);
const validateMatchInputSchema = ajv.compile<InterviewAiMatchInput>(
  matchInputSchema as AnySchema,
);
const validatePlanInputSchema = ajv.compile<InterviewAiPlanInput>(
  planInputSchema as AnySchema,
);
const validateConclusionInputSchema = ajv.compile<InterviewAiConclusionInput>(
  conclusionInputSchema as AnySchema,
);

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
    )
    .join("; ");

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

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

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const assertUniqueIds = (values: readonly string[], label: string): void => {
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new InterviewAiContractError(
      `${label} IDs must be unique and non-empty.`,
    );
  }
};

const assertBoundarySemantics = (
  boundary: InterviewBoundaryProjection,
): void => {
  const experienceIds = boundary.resume.experience_signals.map(
    ({ experience_id }) => experience_id,
  );
  assertUniqueIds(experienceIds, "Boundary experience");
  const requirementSignals = boundary.job.requirement_signals;
  const requirementIds = requirementSignals.map(
    ({ requirement_id }) => requirement_id,
  );
  assertUniqueIds(requirementIds, "Boundary requirement");
  const evidenceIds = boundary.evidence.map(({ evidence_id }) => evidence_id);
  if (evidenceIds.length > 0) {
    assertUniqueIds(evidenceIds, "Boundary evidence");
  }
  const requirementSet = new Set(requirementIds);
  for (const evidence of boundary.evidence) {
    if (evidence.requirement_ids.some((id) => !requirementSet.has(id))) {
      throw new InterviewAiContractError(
        "Boundary evidence references an unknown requirement.",
      );
    }
  }
  if (
    !INTERVIEW_BOUNDARY_OMITTED_FIELDS.every((field) =>
      boundary.omitted_fields.includes(field),
    )
  ) {
    throw new InterviewAiContractError(
      "Boundary projection must declare every omitted narrative and identifier field.",
    );
  }
};

const assertMatchBoundaryReferences = (
  match: InterviewMatchResult,
  boundary: InterviewBoundaryProjection,
): void => {
  const evidenceById = new Map(
    boundary.evidence.map((evidence) => [evidence.evidence_id, evidence]),
  );
  for (const requirement of match.requirement_results) {
    for (const evidenceId of requirement.evidence_ids) {
      const evidence = evidenceById.get(evidenceId);
      if (
        !evidence ||
        !evidence.requirement_ids.includes(requirement.requirement_id)
      ) {
        throw new InterviewAiContractError(
          "Match evidence references must belong to a boundary requirement.",
        );
      }
    }
  }
};

const parseWithSchema = <T>(
  candidate: unknown,
  validate: ValidateFunction<T>,
  name: string,
): T => {
  if (!validate(candidate)) {
    throw new InterviewAiContractError(
      `${name} validation failed: ${formatValidationErrors(validate.errors)}`,
    );
  }
  return candidate as T;
};

const safeBoundaryText = (value: string, maxLength = 160): string => {
  const redacted = redactInterviewLocalText(value).text.trim();
  return (redacted.length > 0 ? redacted : "unknown").slice(0, maxLength);
};

const buildSafeBoundary = (
  bundle: InterviewInputBundle,
): InterviewBoundaryProjection => {
  const projection = buildInterviewBoundaryProjection(bundle);
  const boundary: InterviewBoundaryProjection = {
    ...projection,
    resume: {
      experience_signals: projection.resume.experience_signals.map(
        (experience) => ({
          ...experience,
          role: safeBoundaryText(experience.role),
          domain: safeBoundaryText(experience.domain),
          technologies: experience.technologies.map((value) =>
            safeBoundaryText(value),
          ),
          scope: {
            ...experience.scope,
            ownership: safeBoundaryText(experience.scope.ownership),
            scale: safeBoundaryText(experience.scope.scale),
          },
        }),
      ),
      skills: projection.resume.skills.map((value) => safeBoundaryText(value)),
    },
    job: {
      ...projection.job,
      role_title: safeBoundaryText(projection.job.role_title),
    },
  };

  if (!validateBoundarySchema(boundary)) {
    throw new InterviewAiContractError(
      `interview-boundary-projection-v1 validation failed: ${formatValidationErrors(validateBoundarySchema.errors)}`,
    );
  }
  return boundary;
};

const safeguards: InterviewAiSafeguards = Object.freeze({
  unknown_is_not_negative: true,
  protected_attribute_inference: false,
  automatic_decision: false,
});

export const buildInterviewAiMatchInput = (
  bundle: InterviewInputBundle,
): InterviewAiMatchInput => {
  const validatedBundle = validateInterviewInputBundle(bundle);
  const input: InterviewAiMatchInput = {
    schema_version: "1.0",
    boundary: buildSafeBoundary(validatedBundle),
    safeguards,
  };
  return validateInterviewAiMatchInput(input);
};

export const validateInterviewAiMatchInput = (
  candidate: unknown,
): InterviewAiMatchInput => {
  const input = parseWithSchema<InterviewAiMatchInput>(
    candidate,
    validateMatchInputSchema,
    "interview-ai-match-input-v1",
  );
  assertBoundarySemantics(input.boundary);
  return input;
};

export const buildInterviewAiPlanInput = (
  bundle: InterviewInputBundle,
  match: InterviewMatchResult,
  options: {
    mode?: InterviewPlanMode;
    duration_minutes?: InterviewPlanDuration;
    early_gate_requirement_ids?: readonly string[];
  } = {},
): InterviewAiPlanInput => {
  const validatedBundle = validateInterviewInputBundle(bundle);
  const validatedMatch = validateInterviewMatchResult(match, validatedBundle);
  const requirementIds = new Set(
    validatedBundle.requirements.map(({ requirement_id }) => requirement_id),
  );
  const earlyGateRequirementIds = unique(
    options.early_gate_requirement_ids ?? [],
  ).filter((id) => {
    if (!requirementIds.has(id)) {
      throw new InterviewAiContractError(
        "Early-gate input references an unknown requirement.",
      );
    }
    return true;
  });
  const input: InterviewAiPlanInput = {
    schema_version: "1.0",
    boundary: buildSafeBoundary(validatedBundle),
    match: validatedMatch,
    mode: options.mode ?? "interviewer",
    duration_minutes: options.duration_minutes ?? 45,
    early_gate_requirement_ids: earlyGateRequirementIds,
    safeguards,
  };
  return validateInterviewAiPlanInput(input);
};

export const validateInterviewAiPlanInput = (
  candidate: unknown,
): InterviewAiPlanInput => {
  const input = parseWithSchema<InterviewAiPlanInput>(
    candidate,
    validatePlanInputSchema,
    "interview-ai-plan-input-v1",
  );
  assertBoundarySemantics(input.boundary);
  const match = validateInterviewMatchResult(input.match);
  assertMatchBoundaryReferences(input.match, input.boundary);
  const requirementSignals = input.boundary.job.requirement_signals;
  const requirementIds = requirementSignals.map(
    ({ requirement_id }) => requirement_id,
  );
  if (
    !sameSet(
      match.requirement_results.map(({ requirement_id }) => requirement_id),
      requirementIds,
    )
  ) {
    throw new InterviewAiContractError(
      "Plan input match references must match the boundary requirements.",
    );
  }
  const signalById = new Map(
    requirementSignals.map((signal) => [signal.requirement_id, signal]),
  );
  if (
    input.early_gate_requirement_ids.some((id) => {
      const signal = signalById.get(id);
      return signal?.category !== "must_have" || signal.priority !== "must";
    })
  ) {
    throw new InterviewAiContractError(
      "Plan input early gates may use only must-have requirements.",
    );
  }
  return input;
};

export const buildInterviewAiConclusionInput = (
  plan: InterviewPlan,
  record: InterviewRecord,
): InterviewAiConclusionInput => {
  const validatedPlan = validateInterviewPlan(plan);
  const validatedRecord = validateInterviewRecord(record, validatedPlan);
  const input: InterviewAiConclusionInput = {
    schema_version: "1.0",
    plan_projection: {
      plan_id: validatedPlan.plan_id,
      mode: validatedPlan.mode,
      duration_minutes: validatedPlan.duration_minutes,
      questions: validatedPlan.questions.map(
        ({ question_id, requirement_ids }) => ({
          question_id,
          requirement_ids: [...requirement_ids],
        }),
      ),
    },
    record_projection: {
      record_id: validatedRecord.record_id,
      plan_id: validatedRecord.plan_id,
      mode: validatedRecord.mode,
      duration_minutes: validatedRecord.duration_minutes,
      status: validatedRecord.status,
      entries: validatedRecord.entries.map((entry) => ({
        entry_id: entry.entry_id,
        question_id: entry.question_id,
        requirement_ids: [...entry.requirement_ids],
        response_status: entry.response_status,
        fact_ids: entry.facts.map(({ fact_id }) => fact_id),
        counterevidence_ids: entry.counterevidence.map(
          ({ counterevidence_id }) => counterevidence_id,
        ),
        unknown_reason: entry.unknown_reason,
      })),
    },
    safeguards,
  };
  return validateInterviewAiConclusionInput(input);
};

export const validateInterviewAiConclusionInput = (
  candidate: unknown,
): InterviewAiConclusionInput => {
  const input = parseWithSchema<InterviewAiConclusionInput>(
    candidate,
    validateConclusionInputSchema,
    "interview-ai-conclusion-input-v1",
  );
  const plan = input.plan_projection;
  const record = input.record_projection;
  if (
    record.plan_id !== plan.plan_id ||
    record.mode !== plan.mode ||
    record.duration_minutes !== plan.duration_minutes
  ) {
    throw new InterviewAiContractError(
      "Conclusion input record metadata must match the plan projection.",
    );
  }
  const questionIds = plan.questions.map(({ question_id }) => question_id);
  assertUniqueIds(questionIds, "Conclusion plan question");
  const entryIds = record.entries.map(({ entry_id }) => entry_id);
  assertUniqueIds(entryIds, "Conclusion record entry");
  const questionSet = new Set(questionIds);
  const factIds = record.entries.flatMap(({ fact_ids }) => fact_ids);
  const counterevidenceIds = record.entries.flatMap(
    ({ counterevidence_ids }) => counterevidence_ids,
  );
  if (
    new Set([...factIds, ...counterevidenceIds]).size !==
    factIds.length + counterevidenceIds.length
  ) {
    throw new InterviewAiContractError(
      "Conclusion facts and counterevidence IDs must be distinct.",
    );
  }
  for (const entry of record.entries) {
    const question = plan.questions.find(
      ({ question_id }) => question_id === entry.question_id,
    );
    if (
      !question ||
      entry.requirement_ids.some((id) => !question.requirement_ids.includes(id))
    ) {
      throw new InterviewAiContractError(
        "Conclusion record entries must reference their plan question requirements.",
      );
    }
    if (
      ["not_asked", "declined", "unknown"].includes(entry.response_status) &&
      entry.unknown_reason === null
    ) {
      throw new InterviewAiContractError(
        "Conclusion unknown record entries must preserve an unknown reason.",
      );
    }
  }
  if (record.entries.some(({ question_id }) => !questionSet.has(question_id))) {
    throw new InterviewAiContractError(
      "Conclusion record references an unknown plan question.",
    );
  }
  return input;
};

const assertSafeAiOutput = (candidate: unknown): void => {
  let serialized: string;
  try {
    serialized = JSON.stringify(candidate);
  } catch {
    throw new InterviewAiContractError("AI output must be serializable JSON.");
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/iu.test(
      serialized,
    ) ||
    /(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password|authorization|cookie)\s*[:=]/iu.test(
      serialized,
    ) ||
    /(?:email|phone|mobile|address|住址|姓名|身份证|账号)\s*[:：=]/iu.test(
      serialized,
    ) ||
    /(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/u.test(serialized)
  ) {
    throw new InterviewAiContractError(
      "AI output contains prohibited sensitive text.",
    );
  }
};

export const validateInterviewAiMatchOutput = (
  candidate: unknown,
  input?: Pick<InterviewAiMatchInput, "boundary">,
): InterviewMatchResult => {
  const output = validateInterviewMatchResult(candidate);
  if (input) {
    assertMatchBoundaryReferences(output, input.boundary);
  }
  assertSafeAiOutput(output);
  return output;
};

export const validateInterviewAiPlanOutput = (
  candidate: unknown,
  input: InterviewAiPlanInput,
): InterviewPlan => {
  const plan = validateInterviewPlan(candidate);
  if (
    plan.mode !== input.mode ||
    plan.duration_minutes !== input.duration_minutes
  ) {
    throw new InterviewAiContractError(
      "AI plan mode or duration drifted from the request.",
    );
  }
  const requirementSignals = input.boundary.job.requirement_signals;
  const requirementIds = requirementSignals.map(
    ({ requirement_id }) => requirement_id,
  );
  const questionRequirementIds = unique(
    plan.questions.flatMap(({ requirement_ids }) => requirement_ids),
  );
  if (!sameSet(questionRequirementIds, requirementIds)) {
    throw new InterviewAiContractError(
      "AI plan must cover every requirement exactly by reference.",
    );
  }
  if (
    plan.questions.some(({ requirement_ids }) =>
      requirement_ids.some((id) => !requirementIds.includes(id)),
    ) ||
    plan.unknown_requirement_ids.some((id) => !requirementIds.includes(id)) ||
    plan.conflict_requirement_ids.some((id) => !requirementIds.includes(id))
  ) {
    throw new InterviewAiContractError(
      "AI plan contains an unknown requirement reference.",
    );
  }
  if (
    !sameSet(
      plan.unknown_requirement_ids,
      input.match.unknowns.map(({ requirement_id }) => requirement_id),
    )
  ) {
    throw new InterviewAiContractError(
      "AI plan unknown references must match the match result.",
    );
  }
  if (
    !sameSet(
      plan.conflict_requirement_ids,
      input.match.conflicts.map(({ requirement_id }) => requirement_id),
    )
  ) {
    throw new InterviewAiContractError(
      "AI plan conflict references must match the match result.",
    );
  }
  if (plan.early_gate.enabled) {
    const selected = new Set(input.early_gate_requirement_ids);
    if (
      !sameSet(
        plan.early_gate.requirement_ids,
        input.early_gate_requirement_ids,
      ) ||
      plan.early_gate.requirement_ids.some((id) => !selected.has(id))
    ) {
      throw new InterviewAiContractError(
        "AI early gate must match the user-selected requirements.",
      );
    }
    const signalsById = new Map(
      requirementSignals.map((signal) => [signal.requirement_id, signal]),
    );
    if (
      plan.early_gate.requirement_ids.some((id) => {
        const signal = signalsById.get(id);
        return signal?.category !== "must_have" || signal.priority !== "must";
      })
    ) {
      throw new InterviewAiContractError(
        "AI early gate may use only selected must-have requirements.",
      );
    }
  } else if (input.early_gate_requirement_ids.length > 0) {
    throw new InterviewAiContractError(
      "A selected early gate cannot be silently disabled.",
    );
  }
  assertSafeAiOutput(plan);
  return plan;
};

export const validateInterviewAiConclusionOutput = (
  candidate: unknown,
  input: InterviewAiConclusionInput,
): InterviewConclusion => {
  const conclusion = validateInterviewConclusion(candidate);
  if (
    conclusion.status !== "draft" ||
    conclusion.record_id !== input.record_projection.record_id
  ) {
    throw new InterviewAiContractError(
      "AI conclusion must remain a draft for the source record.",
    );
  }
  const requirementIds = unique(
    input.plan_projection.questions.flatMap(
      ({ requirement_ids }) => requirement_ids,
    ),
  );
  const entryIds = new Set(
    input.record_projection.entries.map(({ entry_id }) => entry_id),
  );
  const factIds = new Set(
    input.record_projection.entries.flatMap(({ fact_ids }) => fact_ids),
  );
  const counterevidenceIds = new Set(
    input.record_projection.entries.flatMap(
      ({ counterevidence_ids }) => counterevidence_ids,
    ),
  );
  const factEntryIds = new Map<string, string>();
  const counterevidenceEntryIds = new Map<string, string>();
  for (const entry of input.record_projection.entries) {
    for (const factId of entry.fact_ids) {
      factEntryIds.set(factId, entry.entry_id);
    }
    for (const counterevidenceId of entry.counterevidence_ids) {
      counterevidenceEntryIds.set(counterevidenceId, entry.entry_id);
    }
  }
  const judgedIds = conclusion.judgments.map(
    ({ requirement_id }) => requirement_id,
  );
  if (
    judgedIds.some((id) => !requirementIds.includes(id)) ||
    conclusion.unassessed_requirement_ids.some(
      (id) => !requirementIds.includes(id),
    ) ||
    !sameSet(
      [...judgedIds, ...conclusion.unassessed_requirement_ids],
      requirementIds,
    )
  ) {
    throw new InterviewAiContractError(
      "AI conclusion requirement references must cover the plan requirements.",
    );
  }
  for (const judgment of conclusion.judgments) {
    if (
      judgment.record_entry_ids.some((id) => !entryIds.has(id)) ||
      judgment.fact_ids.some((id) => !factIds.has(id)) ||
      judgment.counterevidence_ids.some((id) => !counterevidenceIds.has(id))
    ) {
      throw new InterviewAiContractError(
        "AI conclusion contains an unknown record or evidence reference.",
      );
    }
    if (
      judgment.fact_ids.some(
        (factId) =>
          !judgment.record_entry_ids.includes(factEntryIds.get(factId) ?? ""),
      ) ||
      judgment.counterevidence_ids.some(
        (counterevidenceId) =>
          !judgment.record_entry_ids.includes(
            counterevidenceEntryIds.get(counterevidenceId) ?? "",
          ),
      )
    ) {
      throw new InterviewAiContractError(
        "AI conclusion evidence must belong to its cited record entries.",
      );
    }
    if (
      judgment.record_entry_ids.some(
        (entryId) =>
          !input.record_projection.entries
            .find(({ entry_id }) => entry_id === entryId)
            ?.requirement_ids.includes(judgment.requirement_id),
      )
    ) {
      throw new InterviewAiContractError(
        "AI conclusion cites an entry for the wrong requirement.",
      );
    }
  }
  assertSafeAiOutput(conclusion);
  return conclusion;
};

export const toInterviewAiGatewayInput = (
  input:
    InterviewAiMatchInput | InterviewAiPlanInput | InterviewAiConclusionInput,
): JsonObject => input as unknown as JsonObject;

export const isInterviewAiInputObject = (
  candidate: unknown,
): candidate is JsonObject => isRecord(candidate);
