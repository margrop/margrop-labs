import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import planSchema from "../../../../schemas/interview-plan-v1.schema.json";
import {
  type InterviewInputBundle,
  type InterviewRequirementCategory,
  validateInterviewInputBundle,
} from "./interview-contracts";
import {
  type InterviewMatchResult,
  validateInterviewMatchResult,
} from "./interview-matching";

export type InterviewPlanDuration = 30 | 45 | 60;
export type InterviewPlanMode = "interviewer" | "candidate";
export type InterviewPlanSegmentId =
  "opening" | "qualification" | "deep_dive" | "behavioral" | "closing";
export type InterviewPlanKind = InterviewPlanSegmentId;
export type InterviewPlanEvidenceGoal =
  | "requirement_confirmation"
  | "technical_depth"
  | "domain_context"
  | "scope"
  | "ownership"
  | "tradeoffs"
  | "metrics"
  | "failure_recovery"
  | "collaboration"
  | "candidate_questions";

export type InterviewPlanQuestion = Readonly<{
  question_id: string;
  segment_id: InterviewPlanSegmentId;
  kind: InterviewPlanKind;
  minutes: number;
  requirement_ids: string[];
  evidence_goals: InterviewPlanEvidenceGoal[];
  prompt: string;
  follow_ups: string[];
  scoring_anchor: {
    low: string;
    meets: string;
    strong: string;
  };
}>;

export type InterviewPlanSegment = Readonly<{
  segment_id: InterviewPlanSegmentId;
  minutes: number;
  question_ids: string[];
}>;

export type InterviewPlan = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  plan_id: string;
  mode: InterviewPlanMode;
  duration_minutes: InterviewPlanDuration;
  segments: InterviewPlanSegment[];
  questions: InterviewPlanQuestion[];
  early_gate:
    | {
        enabled: false;
        requirement_ids: [];
        question_ids: [];
        termination_rule: "disabled";
        confirmation_required: true;
      }
    | {
        enabled: true;
        requirement_ids: string[];
        question_ids: string[];
        termination_rule: "user_selected_must_have_only";
        confirmation_required: true;
      };
  unknown_requirement_ids: string[];
  conflict_requirement_ids: string[];
  candidate_preparation: {
    real_evidence_only: true;
    unknown_allowed: true;
    fabrication_allowed: false;
  };
  human_review: {
    required: true;
    reasons: Array<
      | "unknown_requirements"
      | "conflicting_evidence"
      | "user_must_confirm_early_gate"
      | "no_automatic_decision"
    >;
  };
}>;

export type InterviewPlanOptions = Readonly<{
  duration_minutes?: InterviewPlanDuration;
  mode?: InterviewPlanMode;
  early_gate_requirement_ids?: readonly string[];
  plan_id?: string;
}>;

export class InterviewPlanError extends Error {
  override name = "InterviewPlanError";
}

const BLUEPRINTS: Record<
  InterviewPlanDuration,
  ReadonlyArray<
    Readonly<{ segment_id: InterviewPlanSegmentId; minutes: number }>
  >
> = {
  30: [
    { segment_id: "opening", minutes: 3 },
    { segment_id: "qualification", minutes: 7 },
    { segment_id: "deep_dive", minutes: 15 },
    { segment_id: "closing", minutes: 5 },
  ],
  45: [
    { segment_id: "opening", minutes: 5 },
    { segment_id: "qualification", minutes: 10 },
    { segment_id: "deep_dive", minutes: 22 },
    { segment_id: "behavioral", minutes: 5 },
    { segment_id: "closing", minutes: 3 },
  ],
  60: [
    { segment_id: "opening", minutes: 5 },
    { segment_id: "qualification", minutes: 10 },
    { segment_id: "deep_dive", minutes: 30 },
    { segment_id: "behavioral", minutes: 10 },
    { segment_id: "closing", minutes: 5 },
  ],
};

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
const validatePlanSchema = ajv.compile<InterviewPlan>(planSchema as AnySchema);

const parsePlan = (candidate: unknown): InterviewPlan => {
  if (!validatePlanSchema(candidate)) {
    throw new InterviewPlanError(
      `interview-plan-v1 validation failed: ${formatValidationErrors(validatePlanSchema.errors)}`,
    );
  }
  return candidate as InterviewPlan;
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new InterviewPlanError(`${label} ids must be unique.`);
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

const expectedSegmentIds = (
  duration: InterviewPlanDuration,
): readonly InterviewPlanSegmentId[] =>
  BLUEPRINTS[duration].map(({ segment_id }) => segment_id);

const validatePlanReferences = (
  plan: InterviewPlan,
  bundle?: InterviewInputBundle,
  match?: InterviewMatchResult,
): void => {
  const segmentIds = plan.segments.map(({ segment_id }) => segment_id);
  assertUnique(segmentIds, "Plan segment");
  if (!sameSet(segmentIds, expectedSegmentIds(plan.duration_minutes))) {
    throw new InterviewPlanError(
      "Plan segments do not match the selected duration template.",
    );
  }
  if (
    plan.segments.reduce((total, segment) => total + segment.minutes, 0) !==
    plan.duration_minutes
  ) {
    throw new InterviewPlanError("Plan segment minutes must close exactly.");
  }

  const questionsById = new Map(
    plan.questions.map((question) => [question.question_id, question]),
  );
  const questionIds = plan.questions.map(({ question_id }) => question_id);
  assertUnique(questionIds, "Plan question");
  const referencedQuestionIds = plan.segments.flatMap(
    ({ question_ids }) => question_ids,
  );
  assertUnique(referencedQuestionIds, "Segment question");
  if (!sameSet(questionIds, referencedQuestionIds)) {
    throw new InterviewPlanError(
      "Plan segments and questions must contain the same question IDs.",
    );
  }

  for (const segment of plan.segments) {
    const segmentQuestions = segment.question_ids.flatMap((id) => {
      const question = questionsById.get(id);
      return question ? [question] : [];
    });
    if (segmentQuestions.length !== segment.question_ids.length) {
      throw new InterviewPlanError(
        "Plan segment references an unknown question.",
      );
    }
    if (
      segmentQuestions.reduce(
        (total, question) => total + question.minutes,
        0,
      ) !== segment.minutes
    ) {
      throw new InterviewPlanError(
        "Plan question minutes must close each segment exactly.",
      );
    }
    for (const question of segmentQuestions) {
      if (
        question.segment_id !== segment.segment_id ||
        question.kind !== segment.segment_id
      ) {
        throw new InterviewPlanError(
          "Plan question kind and segment references must agree.",
        );
      }
      if (
        question.kind !== "opening" &&
        question.kind !== "closing" &&
        question.requirement_ids.length === 0
      ) {
        throw new InterviewPlanError(
          "Qualification, deep-dive, and behavioral questions must reference a requirement.",
        );
      }
    }
  }

  const requirementIds = new Set(
    bundle?.requirements.map(({ requirement_id }) => requirement_id) ?? [],
  );
  if (bundle) {
    const validatedBundle = validateInterviewInputBundle(bundle);
    const sourceRequirementIds = validatedBundle.requirements.map(
      ({ requirement_id }) => requirement_id,
    );
    const questionRequirementIds = plan.questions.flatMap(
      ({ requirement_ids }) => requirement_ids,
    );
    if (!sameSet(questionRequirementIds, sourceRequirementIds)) {
      throw new InterviewPlanError(
        "Plan questions must cover every input requirement exactly by reference.",
      );
    }
    for (const question of plan.questions) {
      if (question.requirement_ids.some((id) => !requirementIds.has(id))) {
        throw new InterviewPlanError(
          "Plan question references an unknown requirement.",
        );
      }
    }
    if (match) {
      const validatedMatch = validateInterviewMatchResult(
        match,
        validatedBundle,
      );
      if (
        !sameSet(
          plan.unknown_requirement_ids,
          validatedMatch.unknowns.map(({ requirement_id }) => requirement_id),
        ) ||
        !sameSet(
          plan.conflict_requirement_ids,
          validatedMatch.conflicts.map(({ requirement_id }) => requirement_id),
        )
      ) {
        throw new InterviewPlanError(
          "Plan unknown and conflict references must match the match result.",
        );
      }
    }
  }

  const earlyGate = plan.early_gate;
  if (earlyGate.enabled) {
    if (
      earlyGate.requirement_ids.some((id) => !requirementIds.has(id)) ||
      earlyGate.question_ids.some((id) => !questionsById.has(id))
    ) {
      throw new InterviewPlanError(
        "Early-gate references must target known requirements and questions.",
      );
    }
    const requirementsById = new Map(
      bundle?.requirements.map((requirement) => [
        requirement.requirement_id,
        requirement,
      ]),
    );
    for (const requirementId of earlyGate.requirement_ids) {
      const requirement = requirementsById.get(requirementId);
      if (
        !requirement ||
        requirement.category !== "must_have" ||
        requirement.priority !== "must"
      ) {
        throw new InterviewPlanError(
          "Early gate may use only user-selected must-have requirements.",
        );
      }
    }
    if (
      earlyGate.question_ids.some(
        (questionId) =>
          questionsById.get(questionId)?.kind !== "qualification" ||
          !questionsById
            .get(questionId)
            ?.requirement_ids.some((id) =>
              earlyGate.requirement_ids.includes(id),
            ),
      )
    ) {
      throw new InterviewPlanError(
        "Early-gate questions must be qualification questions for selected requirements.",
      );
    }
  } else if (
    plan.early_gate.requirement_ids.length > 0 ||
    plan.early_gate.question_ids.length > 0
  ) {
    throw new InterviewPlanError(
      "Disabled early gate cannot contain requirement or question references.",
    );
  }

  const reasons = plan.human_review.reasons;
  if (!reasons.includes("no_automatic_decision")) {
    throw new InterviewPlanError(
      "Interview plans must require user confirmation and prohibit automatic decisions.",
    );
  }
  if (
    plan.unknown_requirement_ids.length > 0 &&
    !reasons.includes("unknown_requirements")
  ) {
    throw new InterviewPlanError(
      "Plans with unknown requirements must preserve the unknown review reason.",
    );
  }
  if (
    plan.conflict_requirement_ids.length > 0 &&
    !reasons.includes("conflicting_evidence")
  ) {
    throw new InterviewPlanError(
      "Plans with conflicts must preserve the conflict review reason.",
    );
  }
  if (
    plan.early_gate.enabled &&
    !reasons.includes("user_must_confirm_early_gate")
  ) {
    throw new InterviewPlanError(
      "Enabled early gates must require explicit user confirmation.",
    );
  }

  if (
    !plan.candidate_preparation.real_evidence_only ||
    !plan.candidate_preparation.unknown_allowed ||
    plan.candidate_preparation.fabrication_allowed
  ) {
    throw new InterviewPlanError(
      "Candidate preparation must use real evidence, preserve unknowns, and forbid fabrication.",
    );
  }
  if (
    /(?:full[_ -]?name|email|phone|mobile|address|住址|姓名|身份证|账号|token|cookie|authorization)/iu.test(
      JSON.stringify(plan),
    )
  ) {
    throw new InterviewPlanError(
      "Interview plan contains a prohibited identifier field.",
    );
  }
};

export const validateInterviewPlan = (
  candidate: unknown,
  bundle?: InterviewInputBundle,
  match?: InterviewMatchResult,
): InterviewPlan => {
  const plan = parsePlan(candidate);
  validatePlanReferences(plan, bundle, match);
  return plan;
};

const allocateMinutes = (total: number, count: number): number[] => {
  if (count < 1 || count > total) {
    throw new InterviewPlanError(
      "Plan question count cannot fit its time budget.",
    );
  }
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from(
    { length: count },
    (_, index) => base + (index < remainder ? 1 : 0),
  );
};

const groupRequirementIds = (
  ids: readonly string[],
  minutes: number,
): string[][] => {
  const safeIds = ids.length > 0 ? [...ids] : [];
  const minimumGroups = Math.max(
    1,
    Math.ceil(safeIds.length / 8),
    Math.ceil(minutes / 15),
  );
  const count = Math.max(
    minimumGroups,
    Math.min(Math.max(1, safeIds.length), minutes),
  );
  if (safeIds.length === 1 && count > 1) {
    return Array.from({ length: count }, () => [safeIds[0]!]);
  }
  const groups = Array.from({ length: count }, () => [] as string[]);
  safeIds.forEach((id, index) => {
    groups[index % count]!.push(id);
  });
  return groups;
};

const goalsForCategory = (
  category: InterviewRequirementCategory,
  kind: InterviewPlanKind,
): InterviewPlanEvidenceGoal[] => {
  if (kind === "behavioral") {
    return ["collaboration", "tradeoffs", "metrics"];
  }
  if (kind === "qualification") {
    return category === "must_have"
      ? ["requirement_confirmation", "ownership", "metrics"]
      : ["requirement_confirmation", "ownership", "metrics"];
  }
  if (category === "technical") {
    return ["technical_depth", "tradeoffs", "failure_recovery"];
  }
  if (category === "domain") {
    return ["domain_context", "tradeoffs", "metrics"];
  }
  if (category === "scope") {
    return ["scope", "ownership", "metrics"];
  }
  if (category === "collaboration") {
    return ["collaboration", "tradeoffs", "metrics"];
  }
  return ["requirement_confirmation", "technical_depth", "tradeoffs"];
};

const scoringAnchor = {
  low: "无法提供可验证的真实例子，或无法区分本人责任与团队工作。",
  meets: "能说明本人责任、关键决策和结果，并能回答必要追问。",
  strong: "能用具体证据解释取舍、风险、指标和复盘，并清楚说明边界。",
};

const promptFor = (
  kind: InterviewPlanKind,
  mode: InterviewPlanMode,
): string => {
  const candidate = mode === "candidate";
  if (kind === "opening") {
    return candidate
      ? "请准备一段与你目标岗位最相关的真实经历，说明你的职责范围和可验证结果。"
      : "请概述与你目标岗位最相关的一段真实经历和本人职责。";
  }
  if (kind === "qualification") {
    return candidate
      ? "请准备一个与该要求相关的真实经历，说明你负责的范围、关键决策和可验证结果；没有材料时明确说未知。"
      : "请说明一个与该要求相关的真实经历：你本人负责什么、做了哪些关键决策、结果如何验证？";
  }
  if (kind === "deep_dive") {
    return candidate
      ? "请准备真实项目的技术细节、取舍、失败恢复和结果指标；不要补写无法确认的经历。"
      : "请深入说明一个真实项目中的技术方案、取舍、失败恢复和结果指标；区分本人工作与团队工作。";
  }
  if (kind === "behavioral") {
    return "请说明一次真实的跨团队协作或冲突处理，包含你的行动、取舍和结果。";
  }
  return "还有哪些与岗位相关的信息或问题需要补充？";
};

const followUpsFor = (kind: InterviewPlanKind): string[] => {
  if (kind === "opening") {
    return ["请补充一项你本人可以验证的结果。"];
  }
  if (kind === "qualification") {
    return ["你本人具体负责哪一部分？", "如何验证结果？"];
  }
  if (kind === "deep_dive") {
    return ["当时有哪些取舍？", "如果重做会改变什么？"];
  }
  if (kind === "behavioral") {
    return ["冲突如何处理？", "如何让相关团队达成共识？"];
  }
  return ["还有没有未覆盖的事实或待确认项？"];
};

const buildQuestion = (
  questionId: string,
  segmentId: InterviewPlanSegmentId,
  minutes: number,
  requirementIds: readonly string[],
  categories: readonly InterviewRequirementCategory[],
  mode: InterviewPlanMode,
): InterviewPlanQuestion => {
  const evidenceGoals =
    segmentId === "opening"
      ? (["ownership", "metrics"] as InterviewPlanEvidenceGoal[])
      : segmentId === "closing"
        ? (["candidate_questions"] as InterviewPlanEvidenceGoal[])
        : unique(
            categories.flatMap((category) =>
              goalsForCategory(category, segmentId),
            ),
          ).slice(0, 4);
  return {
    question_id: questionId,
    segment_id: segmentId,
    kind: segmentId,
    minutes,
    requirement_ids: [...requirementIds],
    evidence_goals: evidenceGoals,
    prompt: promptFor(segmentId, mode),
    follow_ups: followUpsFor(segmentId),
    scoring_anchor: scoringAnchor,
  };
};

export const buildInterviewPlan = (
  bundle: InterviewInputBundle,
  match: InterviewMatchResult,
  options: InterviewPlanOptions = {},
): InterviewPlan => {
  const validatedBundle = validateInterviewInputBundle(bundle);
  const validatedMatch = validateInterviewMatchResult(match, validatedBundle);
  const duration = options.duration_minutes ?? 45;
  const mode = options.mode ?? "interviewer";
  const requirementIds = validatedBundle.requirements.map(
    ({ requirement_id }) => requirement_id,
  );
  const requirementById = new Map(
    validatedBundle.requirements.map((requirement) => [
      requirement.requirement_id,
      requirement,
    ]),
  );
  const earlyRequirementIds = unique(options.early_gate_requirement_ids ?? []);
  if (
    earlyRequirementIds.some((id) => !requirementById.has(id)) ||
    earlyRequirementIds.some((id) => {
      const requirement = requirementById.get(id);
      return (
        requirement?.category !== "must_have" || requirement.priority !== "must"
      );
    })
  ) {
    throw new InterviewPlanError(
      "Early gate may use only user-selected must-have requirements.",
    );
  }

  const qualificationRequirementIds =
    earlyRequirementIds.length > 0 ? earlyRequirementIds : [requirementIds[0]!];
  const remainingRequirementIds = requirementIds.filter(
    (id) => !qualificationRequirementIds.includes(id),
  );
  const deepRequirementIds =
    remainingRequirementIds.length > 0
      ? remainingRequirementIds
      : [requirementIds[0]!];
  const blueprint = BLUEPRINTS[duration];
  const questions: InterviewPlanQuestion[] = [];
  const segments: InterviewPlanSegment[] = [];

  for (const segment of blueprint) {
    const segmentQuestions: InterviewPlanQuestion[] = [];
    if (segment.segment_id === "opening") {
      segmentQuestions.push(
        buildQuestion(
          "question-opening",
          "opening",
          segment.minutes,
          [],
          [],
          mode,
        ),
      );
    } else if (segment.segment_id === "qualification") {
      const groups = groupRequirementIds(
        qualificationRequirementIds,
        segment.minutes,
      );
      const minutes = allocateMinutes(segment.minutes, groups.length);
      groups.forEach((group, index) => {
        const categories = group.flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement ? [requirement.category] : [];
        });
        segmentQuestions.push(
          buildQuestion(
            `question-qualification-${index + 1}`,
            "qualification",
            minutes[index]!,
            group,
            categories,
            mode,
          ),
        );
      });
    } else if (segment.segment_id === "deep_dive") {
      const groups = groupRequirementIds(deepRequirementIds, segment.minutes);
      const minutes = allocateMinutes(segment.minutes, groups.length);
      groups.forEach((group, index) => {
        const categories = group.flatMap((id) => {
          const requirement = requirementById.get(id);
          return requirement ? [requirement.category] : [];
        });
        segmentQuestions.push(
          buildQuestion(
            `question-deep-dive-${index + 1}`,
            "deep_dive",
            minutes[index]!,
            group,
            categories,
            mode,
          ),
        );
      });
    } else if (segment.segment_id === "behavioral") {
      const collaboration = validatedBundle.requirements.find(
        ({ category }) => category === "collaboration",
      );
      const requirement = collaboration ?? validatedBundle.requirements[0]!;
      segmentQuestions.push(
        buildQuestion(
          "question-behavioral",
          "behavioral",
          segment.minutes,
          [requirement.requirement_id],
          [requirement.category],
          mode,
        ),
      );
    } else {
      segmentQuestions.push(
        buildQuestion(
          "question-closing",
          "closing",
          segment.minutes,
          [],
          [],
          mode,
        ),
      );
    }
    questions.push(...segmentQuestions);
    segments.push({
      segment_id: segment.segment_id,
      minutes: segment.minutes,
      question_ids: segmentQuestions.map(({ question_id }) => question_id),
    });
  }

  const earlyQuestionIds =
    earlyRequirementIds.length > 0
      ? questions
          .filter(
            (question) =>
              question.kind === "qualification" &&
              question.requirement_ids.some((id) =>
                earlyRequirementIds.includes(id),
              ),
          )
          .map(({ question_id }) => question_id)
      : [];
  const earlyGate: InterviewPlan["early_gate"] =
    earlyRequirementIds.length > 0
      ? {
          enabled: true,
          requirement_ids: earlyRequirementIds,
          question_ids: earlyQuestionIds,
          termination_rule: "user_selected_must_have_only",
          confirmation_required: true,
        }
      : {
          enabled: false,
          requirement_ids: [],
          question_ids: [],
          termination_rule: "disabled",
          confirmation_required: true,
        };
  const reasons: InterviewPlan["human_review"]["reasons"] = [];
  if (validatedMatch.unknowns.length > 0) {
    reasons.push("unknown_requirements");
  }
  if (validatedMatch.conflicts.length > 0) {
    reasons.push("conflicting_evidence");
  }
  if (earlyGate.enabled) {
    reasons.push("user_must_confirm_early_gate");
  }
  reasons.push("no_automatic_decision");

  const plan: InterviewPlan = {
    schema_version: "1.0",
    sensitivity: "sensitive",
    plan_id: options.plan_id ?? "plan-local",
    mode,
    duration_minutes: duration,
    segments,
    questions,
    early_gate: earlyGate,
    unknown_requirement_ids: validatedMatch.unknowns.map(
      ({ requirement_id }) => requirement_id,
    ),
    conflict_requirement_ids: validatedMatch.conflicts.map(
      ({ requirement_id }) => requirement_id,
    ),
    candidate_preparation: {
      real_evidence_only: true,
      unknown_allowed: true,
      fabrication_allowed: false,
    },
    human_review: { required: true, reasons },
  };
  return validateInterviewPlan(plan, validatedBundle, validatedMatch);
};
