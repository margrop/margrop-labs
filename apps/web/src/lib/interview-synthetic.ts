import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import exportSchema from "../../../../schemas/interview-export-v1.schema.json";
import loopSchema from "../../../../schemas/interview-loop-v1.schema.json";
import {
  type InterviewInputBundle,
  validateInterviewInputBundle,
} from "./interview-contracts";
import {
  type InterviewMatchResult,
  type InterviewMatchStatus,
  buildInterviewMatchResult,
  validateInterviewMatchResult,
} from "./interview-matching";
import {
  type InterviewPlan,
  type InterviewPlanQuestion,
  buildInterviewPlan,
  validateInterviewPlan,
} from "./interview-planning";
import {
  type InterviewConclusion,
  type InterviewConclusionStatus,
  type InterviewRecord,
  type InterviewRecordEntry,
  buildInterviewConclusion,
  validateInterviewConclusion,
  validateInterviewRecord,
} from "./interview-recording";

export type InterviewSyntheticRole = "interviewer" | "candidate";
export type InterviewScenarioKind = "synthetic" | "local_input";

export type InterviewSafeExport = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  export_id: string;
  loop_id: string;
  role: InterviewSyntheticRole;
  match: {
    status: InterviewMatchStatus;
    match_band:
      "strong_match" | "partial_match" | "insufficient_evidence" | "conflicted";
    score: number | null;
    known_requirement_count: number;
    unknown_requirement_count: number;
    conflict_requirement_count: number;
  };
  plan: {
    duration_minutes: 30 | 45 | 60;
    segment_count: number;
    question_count: number;
    early_gate_enabled: boolean;
  };
  record: {
    status: "draft" | "confirmed";
    entry_count: number;
    answered_entry_count: number;
    partial_entry_count: number;
    unknown_entry_count: number;
    counterevidence_count: number;
  };
  conclusion: {
    status: InterviewConclusionStatus;
    recommendation:
      | "supportive_signal"
      | "partial_signal"
      | "requires_more_evidence"
      | "conflicted"
      | "not_assessed";
    judgment_count: number;
    supported_count: number;
    partial_count: number;
    unknown_count: number;
    conflict_count: number;
    unassessed_count: number;
  };
  redacted_fields: Array<
    | "resume_text"
    | "jd_text"
    | "question_text"
    | "follow_up_text"
    | "fact_text"
    | "counterevidence_text"
    | "personal_identifiers"
    | "provider_metadata"
  >;
  local_only: true;
  contains_personal_text: false;
  human_review: {
    required: true;
    confirmed: false;
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

export type InterviewSyntheticLoop = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  loop_id: string;
  scenario_kind: InterviewScenarioKind;
  match_id: string;
  roles: {
    interviewer: {
      role: "interviewer";
      plan_id: string;
      record_id: string;
      conclusion_id: string;
      export_id: string;
      status: "draft";
    };
    candidate: {
      role: "candidate";
      plan_id: string;
      record_id: string;
      conclusion_id: string;
      export_id: string;
      status: "draft";
    };
  };
  local_only: true;
  human_review: {
    required: true;
    confirmed: false;
    reasons: ["draft_requires_user_confirmation", "no_automatic_decision"];
  };
  automatic_decision: false;
}>;

export type InterviewSyntheticStage = Readonly<{
  role: InterviewSyntheticRole;
  plan: InterviewPlan;
  record: InterviewRecord;
  conclusion: InterviewConclusion;
  export: InterviewSafeExport;
}>;

export type InterviewSyntheticLoopRun = Readonly<{
  loop: InterviewSyntheticLoop;
  match: InterviewMatchResult;
  roles: {
    interviewer: InterviewSyntheticStage;
    candidate: InterviewSyntheticStage;
  };
}>;

export class InterviewSyntheticError extends Error {
  override name = "InterviewSyntheticError";
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
const validateExportSchema = ajv.compile<InterviewSafeExport>(
  exportSchema as AnySchema,
);
const validateLoopSchema = ajv.compile<InterviewSyntheticLoop>(
  loopSchema as AnySchema,
);

const parseExport = (candidate: unknown): InterviewSafeExport => {
  if (!validateExportSchema(candidate)) {
    throw new InterviewSyntheticError(
      `interview-export-v1 validation failed: ${formatValidationErrors(validateExportSchema.errors)}`,
    );
  }
  return candidate as InterviewSafeExport;
};

const parseLoop = (candidate: unknown): InterviewSyntheticLoop => {
  if (!validateLoopSchema(candidate)) {
    throw new InterviewSyntheticError(
      `interview-loop-v1 validation failed: ${formatValidationErrors(validateLoopSchema.errors)}`,
    );
  }
  return candidate as InterviewSyntheticLoop;
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

const REDACTED_FIELDS: InterviewSafeExport["redacted_fields"] = [
  "resume_text",
  "jd_text",
  "question_text",
  "follow_up_text",
  "fact_text",
  "counterevidence_text",
  "personal_identifiers",
  "provider_metadata",
];

const statusForRequirements = (
  requirementIds: readonly string[],
  matchById: ReadonlyMap<string, InterviewMatchStatus>,
): InterviewMatchStatus => {
  const statuses = requirementIds.map(
    (requirementId) => matchById.get(requirementId) ?? "unknown",
  );
  if (statuses.includes("conflict")) {
    return "conflict";
  }
  if (statuses.includes("unknown")) {
    return "unknown";
  }
  if (statuses.includes("partial")) {
    return "partial";
  }
  if (statuses.includes("direct")) {
    return "direct";
  }
  return "not_applicable";
};

const questionEntries = (plan: InterviewPlan): InterviewPlanQuestion[] => {
  const seenRequirements = new Set<string>();
  return plan.questions.filter((question) => {
    if (question.requirement_ids.length === 0) {
      return false;
    }
    const unseen = question.requirement_ids.some(
      (requirementId) => !seenRequirements.has(requirementId),
    );
    question.requirement_ids.forEach((requirementId) =>
      seenRequirements.add(requirementId),
    );
    return unseen;
  });
};

const buildSyntheticRecord = (
  role: InterviewSyntheticRole,
  plan: InterviewPlan,
  match: InterviewMatchResult,
  recordId: string,
): InterviewRecord => {
  const matchById = new Map(
    match.requirement_results.map(({ requirement_id, status }) => [
      requirement_id,
      status,
    ]),
  );
  const entries: InterviewRecordEntry[] = questionEntries(plan).map(
    (question, index) => {
      const status = statusForRequirements(question.requirement_ids, matchById);
      const candidateCanUseEvidence =
        role === "candidate" && (status === "conflict" || status === "unknown");
      const effectiveStatus = candidateCanUseEvidence ? "unknown" : status;
      const known =
        effectiveStatus === "direct" ||
        effectiveStatus === "partial" ||
        (role === "interviewer" && effectiveStatus === "conflict");
      const factKind =
        role === "candidate"
          ? "candidate_statement"
          : "interviewer_observation";
      const facts = known
        ? [
            {
              fact_id: `${role}-fact-${index + 1}`,
              kind: factKind as
                "candidate_statement" | "interviewer_observation",
              text:
                role === "candidate"
                  ? "合成面试者只复述已有的真实证据、职责范围和可验证结果。"
                  : "合成面试记录观察到候选人说明了职责范围和可验证结果。",
            },
          ]
        : [];
      const conflict = role === "interviewer" && effectiveStatus === "conflict";
      const counterevidence = conflict
        ? [
            {
              counterevidence_id: `${role}-counter-${index + 1}`,
              text: "合成记录仍缺少可独立核验的材料，需人工复核。",
            },
          ]
        : [];
      const responseStatus = known
        ? effectiveStatus === "partial"
          ? ("partially_answered" as const)
          : ("answered" as const)
        : ("unknown" as const);
      return {
        entry_id: `${role}-entry-${index + 1}`,
        question_id: question.question_id,
        requirement_ids: [...question.requirement_ids],
        response_status: responseStatus,
        facts,
        counterevidence,
        unknown_reason: known ? null : ("not_verified" as const),
        user_confirmed: false,
      };
    },
  );
  if (entries.length === 0) {
    const firstQuestion = plan.questions[0];
    if (!firstQuestion) {
      throw new InterviewSyntheticError(
        "Synthetic plans require at least one question.",
      );
    }
    entries.push({
      entry_id: `${role}-entry-1`,
      question_id: firstQuestion.question_id,
      requirement_ids: [],
      response_status: "unknown",
      facts: [],
      counterevidence: [],
      unknown_reason: "not_asked",
      user_confirmed: false,
    });
  }
  return validateInterviewRecord(
    {
      schema_version: "1.0",
      sensitivity: "sensitive",
      record_id: recordId,
      plan_id: plan.plan_id,
      mode: role,
      duration_minutes: plan.duration_minutes,
      status: "draft",
      entries,
      local_only: true,
      human_review: {
        required: true,
        confirmed: false,
        reasons: ["draft_requires_user_confirmation", "no_automatic_decision"],
      },
    },
    plan,
  );
};

const conclusionCounts = (conclusion: InterviewConclusion) => {
  const counts = {
    supported: 0,
    partial: 0,
    unknown: 0,
    conflict: 0,
    not_assessed: 0,
  };
  for (const judgment of conclusion.judgments) {
    counts[judgment.status] += 1;
  }
  return counts;
};

export const validateInterviewSafeExport = (
  candidate: unknown,
): InterviewSafeExport => {
  const exportData = parseExport(candidate);
  if (!sameSet(exportData.redacted_fields, REDACTED_FIELDS)) {
    throw new InterviewSyntheticError(
      "Safe interview exports must declare every omitted text and metadata field.",
    );
  }
  if (
    !exportData.local_only ||
    exportData.contains_personal_text ||
    exportData.automatic_decision ||
    !exportData.human_review.required ||
    exportData.human_review.confirmed
  ) {
    throw new InterviewSyntheticError(
      "Safe interview exports must remain local, text-free and unconfirmed.",
    );
  }
  if (
    !exportData.human_review.reasons.includes(
      "draft_requires_user_confirmation",
    ) ||
    !exportData.human_review.reasons.includes("no_automatic_decision")
  ) {
    throw new InterviewSyntheticError(
      "Safe interview exports must preserve the human review boundary.",
    );
  }
  if (
    exportData.record.entry_count !==
    exportData.record.answered_entry_count +
      exportData.record.partial_entry_count +
      exportData.record.unknown_entry_count
  ) {
    throw new InterviewSyntheticError(
      "Safe interview export record counts must close exactly.",
    );
  }
  if (
    exportData.conclusion.judgment_count !==
    exportData.conclusion.supported_count +
      exportData.conclusion.partial_count +
      exportData.conclusion.unknown_count +
      exportData.conclusion.conflict_count
  ) {
    throw new InterviewSyntheticError(
      "Safe interview export conclusion counts must close exactly.",
    );
  }
  return exportData;
};

export const validateInterviewSyntheticLoop = (
  candidate: unknown,
  run?: InterviewSyntheticLoopRun,
): InterviewSyntheticLoop => {
  const loop = parseLoop(candidate);
  const stages = [loop.roles.interviewer, loop.roles.candidate];
  const ids = stages.flatMap(
    ({ plan_id, record_id, conclusion_id, export_id }) => [
      plan_id,
      record_id,
      conclusion_id,
      export_id,
    ],
  );
  if (new Set(ids).size !== ids.length) {
    throw new InterviewSyntheticError(
      "Synthetic loop stage IDs must be unique.",
    );
  }
  if (
    loop.roles.interviewer.role !== "interviewer" ||
    loop.roles.candidate.role !== "candidate"
  ) {
    throw new InterviewSyntheticError(
      "Synthetic loop roles must remain explicit.",
    );
  }
  if (run) {
    validateInterviewMatchResult(run.match);
    if (run.loop !== loop && run.loop.loop_id !== loop.loop_id) {
      throw new InterviewSyntheticError(
        "Synthetic run envelope does not match its loop.",
      );
    }
    for (const role of ["interviewer", "candidate"] as const) {
      const stage = run.roles[role];
      const summary = loop.roles[role];
      validateInterviewPlan(stage.plan, undefined, run.match);
      validateInterviewRecord(stage.record, stage.plan);
      validateInterviewConclusion(stage.conclusion, stage.record, stage.plan);
      validateInterviewSafeExport(stage.export);
      if (
        stage.role !== role ||
        stage.plan.plan_id !== summary.plan_id ||
        stage.record.record_id !== summary.record_id ||
        stage.conclusion.conclusion_id !== summary.conclusion_id ||
        stage.export.export_id !== summary.export_id ||
        stage.export.loop_id !== loop.loop_id ||
        stage.export.role !== role
      ) {
        throw new InterviewSyntheticError(
          "Synthetic loop stage references must match the derived outputs.",
        );
      }
    }
    if (run.match.match_id !== loop.match_id) {
      throw new InterviewSyntheticError(
        "Synthetic loop match reference must match its result.",
      );
    }
  }
  return loop;
};

export const buildInterviewSafeExport = (
  loopId: string,
  role: InterviewSyntheticRole,
  match: InterviewMatchResult,
  plan: InterviewPlan,
  record: InterviewRecord,
  conclusion: InterviewConclusion,
  exportId: string,
): InterviewSafeExport => {
  validateInterviewMatchResult(match);
  validateInterviewPlan(plan);
  validateInterviewRecord(record, plan);
  validateInterviewConclusion(conclusion, record, plan);
  const recordCounts = record.entries.reduce(
    (counts, entry) => {
      if (entry.response_status === "answered") {
        counts.answered_entry_count += 1;
      } else if (entry.response_status === "partially_answered") {
        counts.partial_entry_count += 1;
      } else {
        counts.unknown_entry_count += 1;
      }
      counts.counterevidence_count += entry.counterevidence.length;
      return counts;
    },
    {
      answered_entry_count: 0,
      partial_entry_count: 0,
      unknown_entry_count: 0,
      counterevidence_count: 0,
    },
  );
  const counts = conclusionCounts(conclusion);
  const reasons: InterviewSafeExport["human_review"]["reasons"] = [];
  if (conclusion.unassessed_requirement_ids.length > 0) {
    reasons.push("unassessed_requirements");
  }
  if (conclusion.unknown_requirement_ids.length > 0) {
    reasons.push("unknown_requirements");
  }
  if (conclusion.conflict_requirement_ids.length > 0) {
    reasons.push("conflicting_evidence");
  }
  reasons.push("draft_requires_user_confirmation", "no_automatic_decision");
  return validateInterviewSafeExport({
    schema_version: "1.0",
    sensitivity: "sensitive",
    export_id: exportId,
    loop_id: loopId,
    role,
    match: {
      status: match.overall.status,
      match_band: match.overall.match_band,
      score: match.overall.score,
      known_requirement_count: match.overall.known_requirement_count,
      unknown_requirement_count: match.overall.unknown_requirement_count,
      conflict_requirement_count: match.overall.conflict_requirement_count,
    },
    plan: {
      duration_minutes: plan.duration_minutes,
      segment_count: plan.segments.length,
      question_count: plan.questions.length,
      early_gate_enabled: plan.early_gate.enabled,
    },
    record: {
      status: record.status,
      entry_count: record.entries.length,
      ...recordCounts,
    },
    conclusion: {
      status: conclusion.overall.status,
      recommendation: conclusion.overall.recommendation,
      judgment_count: conclusion.judgments.length,
      supported_count: counts.supported,
      partial_count: counts.partial,
      unknown_count: counts.unknown,
      conflict_count: counts.conflict,
      unassessed_count: conclusion.unassessed_requirement_ids.length,
    },
    redacted_fields: [...REDACTED_FIELDS],
    local_only: true,
    contains_personal_text: false,
    human_review: { required: true, confirmed: false, reasons },
    automatic_decision: false,
  });
};

const buildSyntheticStage = (
  loopId: string,
  role: InterviewSyntheticRole,
  bundle: InterviewInputBundle,
  match: InterviewMatchResult,
): InterviewSyntheticStage => {
  const plan = buildInterviewPlan(bundle, match, {
    mode: role,
    plan_id: `plan-${role}-${loopId}`,
  });
  const record = buildSyntheticRecord(
    role,
    plan,
    match,
    `record-${role}-${loopId}`,
  );
  const conclusion = buildInterviewConclusion(
    record,
    plan,
    `conclusion-${role}-${loopId}`,
  );
  const exportData = buildInterviewSafeExport(
    loopId,
    role,
    match,
    plan,
    record,
    conclusion,
    `export-${role}-${loopId}`,
  );
  return { role, plan, record, conclusion, export: exportData };
};

const buildInterviewLoop = (
  bundle: InterviewInputBundle,
  loopId: string,
  scenarioKind: InterviewScenarioKind,
): InterviewSyntheticLoopRun => {
  const validatedBundle = validateInterviewInputBundle(bundle);
  const match = buildInterviewMatchResult(validatedBundle, `match-${loopId}`);
  const roles = {
    interviewer: buildSyntheticStage(
      loopId,
      "interviewer",
      validatedBundle,
      match,
    ),
    candidate: buildSyntheticStage(loopId, "candidate", validatedBundle, match),
  };
  const loop = validateInterviewSyntheticLoop({
    schema_version: "1.0",
    sensitivity: "sensitive",
    loop_id: loopId,
    scenario_kind: scenarioKind,
    match_id: match.match_id,
    roles: {
      interviewer: {
        role: "interviewer",
        plan_id: roles.interviewer.plan.plan_id,
        record_id: roles.interviewer.record.record_id,
        conclusion_id: roles.interviewer.conclusion.conclusion_id,
        export_id: roles.interviewer.export.export_id,
        status: "draft",
      },
      candidate: {
        role: "candidate",
        plan_id: roles.candidate.plan.plan_id,
        record_id: roles.candidate.record.record_id,
        conclusion_id: roles.candidate.conclusion.conclusion_id,
        export_id: roles.candidate.export.export_id,
        status: "draft",
      },
    },
    local_only: true,
    human_review: {
      required: true,
      confirmed: false,
      reasons: ["draft_requires_user_confirmation", "no_automatic_decision"],
    },
    automatic_decision: false,
  });
  const run = { loop, match, roles };
  validateInterviewSyntheticLoop(loop, run);
  return run;
};

export const buildInterviewSyntheticLoop = (
  bundle: InterviewInputBundle,
  loopId = "loop-synthetic-001",
): InterviewSyntheticLoopRun => buildInterviewLoop(bundle, loopId, "synthetic");

export const buildInterviewLocalInputLoop = (
  bundle: InterviewInputBundle,
  loopId = "loop-local-input-001",
): InterviewSyntheticLoopRun =>
  buildInterviewLoop(bundle, loopId, "local_input");

export const renderInterviewSafeExportMarkdown = (
  candidate: unknown,
): string => {
  const exportData = validateInterviewSafeExport(candidate);
  return [
    "# AI 面试工作台结构化摘要",
    "",
    `- 角色：${exportData.role === "interviewer" ? "面试官" : "面试者"}`,
    `- 面试时长：${exportData.plan.duration_minutes} 分钟`,
    `- 岗位匹配：${exportData.match.match_band}`,
    `- 记录：${exportData.record.entry_count} 条（已回答 ${exportData.record.answered_entry_count}，部分回答 ${exportData.record.partial_entry_count}，未知 ${exportData.record.unknown_entry_count}）`,
    `- 结论草稿：${exportData.conclusion.status} / ${exportData.conclusion.recommendation}`,
    `- 待人工确认：${exportData.human_review.confirmed ? "否" : "是"}`,
    "",
    "## 隐私边界",
    "",
    "本摘要仅包含结构化计数和状态；简历、JD、问题、事实、反证、个人标识和 Provider 元数据均未导出。",
    "最终决定不由此摘要或系统自动生成。",
  ].join("\n");
};
