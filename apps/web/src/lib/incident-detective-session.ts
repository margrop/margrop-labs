import {
  type IncidentDetectiveAttempt,
  type IncidentDetectiveScenario,
  type IncidentEvidence,
  type IncidentSafetyAction,
  type IncidentTimelineEvent,
  validateIncidentDetectiveAttempt,
  validateIncidentDetectiveScenario,
} from "./incident-detective-contracts";

export type IncidentDetectiveSession = {
  scenario_id: string;
  selected_evidence_ids: string[];
  spent_budget: number;
};

export type IncidentEvidenceStatus =
  "available" | "locked" | "insufficient_budget" | "selected";

export type IncidentEvidenceState = {
  evidence: IncidentEvidence;
  status: IncidentEvidenceStatus;
  missing_prerequisite_ids: string[];
  remaining_budget: number;
};

export type IncidentDetectiveHypothesisDraft = {
  summary: string;
  suspected_service_ids: string[];
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  confidence: "low" | "medium" | "high";
  next_action: string;
  safety_actions: IncidentSafetyAction[];
};

export type IncidentDetectiveSessionErrorCode =
  | "invalid_session"
  | "unknown_evidence"
  | "already_selected"
  | "evidence_locked"
  | "insufficient_budget"
  | "invalid_attempt";

export class IncidentDetectiveSessionError extends Error {
  override name = "IncidentDetectiveSessionError";

  constructor(
    public readonly code: IncidentDetectiveSessionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const validateSession = (
  scenario: IncidentDetectiveScenario,
  session: IncidentDetectiveSession,
): IncidentDetectiveSession => {
  if (
    session.scenario_id !== scenario.id ||
    !Array.isArray(session.selected_evidence_ids) ||
    !Number.isInteger(session.spent_budget) ||
    session.spent_budget < 0
  ) {
    throw new IncidentDetectiveSessionError(
      "invalid_session",
      "当前取证进度与场景不匹配，请重新开始本局。",
    );
  }

  if (
    new Set(session.selected_evidence_ids).size !==
    session.selected_evidence_ids.length
  ) {
    throw new IncidentDetectiveSessionError(
      "invalid_session",
      "当前取证进度包含重复证据，请重新开始本局。",
    );
  }

  const evidenceById = new Map(
    scenario.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const selected = new Set<string>();
  let spentBudget = 0;

  for (const evidenceId of session.selected_evidence_ids) {
    const evidence = evidenceById.get(evidenceId);
    if (!evidence) {
      throw new IncidentDetectiveSessionError(
        "invalid_session",
        "当前取证进度引用了未知证据，请重新开始本局。",
      );
    }
    if (
      evidence.unlocks_after.some((dependency) => !selected.has(dependency))
    ) {
      throw new IncidentDetectiveSessionError(
        "invalid_session",
        "当前取证顺序没有满足证据前置条件，请重新开始本局。",
      );
    }

    spentBudget += evidence.acquisition_cost;
    selected.add(evidenceId);
  }

  if (
    spentBudget !== session.spent_budget ||
    spentBudget > scenario.evidence_budget
  ) {
    throw new IncidentDetectiveSessionError(
      "invalid_session",
      "当前取证进度的预算不一致，请重新开始本局。",
    );
  }

  return session;
};

export const createIncidentDetectiveSession = (
  scenarioCandidate: unknown,
): IncidentDetectiveSession => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);

  return {
    scenario_id: scenario.id,
    selected_evidence_ids: [],
    spent_budget: 0,
  };
};

export const getIncidentEvidenceStates = (
  scenarioCandidate: unknown,
  sessionCandidate: IncidentDetectiveSession,
): IncidentEvidenceState[] => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const session = validateSession(scenario, sessionCandidate);
  const selected = new Set(session.selected_evidence_ids);
  const remainingBudget = scenario.evidence_budget - session.spent_budget;

  return scenario.evidence.map((evidence) => {
    const missingPrerequisites = evidence.unlocks_after.filter(
      (dependency) => !selected.has(dependency),
    );
    let status: IncidentEvidenceStatus = "available";

    if (selected.has(evidence.id)) {
      status = "selected";
    } else if (missingPrerequisites.length > 0) {
      status = "locked";
    } else if (evidence.acquisition_cost > remainingBudget) {
      status = "insufficient_budget";
    }

    return {
      evidence,
      status,
      missing_prerequisite_ids: missingPrerequisites,
      remaining_budget: remainingBudget,
    };
  });
};

export const selectIncidentEvidence = (
  scenarioCandidate: unknown,
  sessionCandidate: IncidentDetectiveSession,
  evidenceId: string,
): IncidentDetectiveSession => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const session = validateSession(scenario, sessionCandidate);
  const state = getIncidentEvidenceStates(scenario, session).find(
    ({ evidence }) => evidence.id === evidenceId,
  );

  if (!state) {
    throw new IncidentDetectiveSessionError(
      "unknown_evidence",
      "这份证据不属于当前合成场景。",
    );
  }
  if (state.status === "selected") {
    throw new IncidentDetectiveSessionError(
      "already_selected",
      "这份证据已经获取；证据不会退款或重复计费。",
    );
  }
  if (state.status === "locked") {
    throw new IncidentDetectiveSessionError(
      "evidence_locked",
      "这份证据仍有未满足的前置条件。",
    );
  }
  if (state.status === "insufficient_budget") {
    throw new IncidentDetectiveSessionError(
      "insufficient_budget",
      "剩余证据预算不足，不能获取这份证据。",
    );
  }

  return {
    scenario_id: session.scenario_id,
    selected_evidence_ids: [
      ...session.selected_evidence_ids,
      state.evidence.id,
    ],
    spent_budget: session.spent_budget + state.evidence.acquisition_cost,
  };
};

export const getVisibleIncidentTimeline = (
  scenarioCandidate: unknown,
  sessionCandidate: IncidentDetectiveSession,
): IncidentTimelineEvent[] => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const session = validateSession(scenario, sessionCandidate);
  const selected = new Set(session.selected_evidence_ids);

  return scenario.timeline.filter(
    (event) =>
      event.visibility === "initial" ||
      (event.evidence_id !== undefined && selected.has(event.evidence_id)),
  );
};

export const buildIncidentDetectiveAttempt = (
  scenarioCandidate: unknown,
  sessionCandidate: IncidentDetectiveSession,
  draft: IncidentDetectiveHypothesisDraft,
): IncidentDetectiveAttempt => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const session = validateSession(scenario, sessionCandidate);
  const attemptCandidate: IncidentDetectiveAttempt = {
    schema_version: "1.0",
    scenario_id: scenario.id,
    selected_evidence_ids: [...session.selected_evidence_ids],
    spent_budget: session.spent_budget,
    ordered_timeline_event_ids: getVisibleIncidentTimeline(
      scenario,
      session,
    ).map(({ id }) => id),
    safety_actions: [...draft.safety_actions],
    hypothesis: {
      summary: draft.summary,
      suspected_service_ids: [...draft.suspected_service_ids],
      supporting_evidence_ids: [...draft.supporting_evidence_ids],
      contradicting_evidence_ids: [...draft.contradicting_evidence_ids],
      confidence: draft.confidence,
      next_action: draft.next_action,
    },
  };

  try {
    return validateIncidentDetectiveAttempt(scenario, attemptCandidate);
  } catch {
    throw new IncidentDetectiveSessionError(
      "invalid_attempt",
      "推理还不符合 Attempt v1：请检查字数、服务、证据角色、安全动作和下一步。",
    );
  }
};
