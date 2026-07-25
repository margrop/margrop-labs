import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { redactTextWithReport } from "@margrop-labs/redaction";

import attemptSchema from "../../../../schemas/incident-detective-attempt-v1.schema.json";
import scenarioSchema from "../../../../schemas/incident-detective-scenario-v1.schema.json";

export type IncidentDifficulty = "foundation" | "intermediate" | "advanced";

export type IncidentService = {
  id: string;
  label: string;
  kind:
    | "application"
    | "database"
    | "cache"
    | "observability"
    | "infrastructure"
    | "external";
};

export type IncidentMetricData = {
  kind: "metric";
  query: string;
  unit: string;
  series: Array<{
    label: string;
    labels: Record<string, string>;
    points: Array<{ timestamp: string; value: number }>;
  }>;
};

export type IncidentLogData = {
  kind: "log";
  stream: string;
  entries: Array<{
    timestamp: string;
    level: "debug" | "info" | "warning" | "error" | "critical";
    message: string;
  }>;
};

export type IncidentTableCell = string | number | boolean | null;

export type IncidentTableData = {
  kind: "table";
  query: string;
  columns: string[];
  rows: IncidentTableCell[][];
};

export type IncidentDocumentData = {
  kind: "document";
  sections: Array<{ heading: string; body: string }>;
};

export type IncidentTopologyData = {
  kind: "topology";
  nodes: Array<{ service_id: string; label: string }>;
  edges: Array<{ from: string; to: string; label: string }>;
};

export type IncidentEvidenceData =
  | IncidentMetricData
  | IncidentLogData
  | IncidentTableData
  | IncidentDocumentData
  | IncidentTopologyData;

export type IncidentEvidence = {
  id: string;
  source: "prometheus" | "loki" | "mysql" | "runbook" | "topology";
  title: string;
  purpose: string;
  acquisition_cost: number;
  service_id?: string;
  unlocks_after: string[];
  data: IncidentEvidenceData;
};

export type IncidentTimelineEvent = {
  id: string;
  occurred_at: string;
  category: "change" | "symptom" | "observation" | "recovery";
  visibility: "initial" | "revealed";
  summary: string;
  evidence_id?: string;
};

export type IncidentDetectiveScenario = {
  schema_version: "1.0";
  id: string;
  title: string;
  summary: string;
  difficulty: IncidentDifficulty;
  evidence_budget: number;
  services: IncidentService[];
  objectives: string[];
  incident_window: {
    starts_at: string;
    ends_at: string;
  };
  evidence: IncidentEvidence[];
  timeline: IncidentTimelineEvent[];
  safety_notes: string[];
};

export type IncidentSafetyAction =
  | "read_only_first"
  | "preserve_evidence"
  | "least_privilege"
  | "request_approval"
  | "production_write"
  | "restart_service"
  | "delete_data";

export type IncidentDetectiveAttempt = {
  schema_version: "1.0";
  scenario_id: string;
  selected_evidence_ids: string[];
  spent_budget: number;
  ordered_timeline_event_ids: string[];
  safety_actions: IncidentSafetyAction[];
  hypothesis: {
    summary: string;
    suspected_service_ids: string[];
    supporting_evidence_ids: string[];
    contradicting_evidence_ids: string[];
    confidence: "low" | "medium" | "high";
    next_action: string;
  };
};

export class IncidentDetectiveContractError extends Error {
  override name = "IncidentDetectiveContractError";
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

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
});
addFormats(ajv);

const validateScenarioSchema = ajv.compile<IncidentDetectiveScenario>(
  scenarioSchema as AnySchema,
);
const validateAttemptSchema = ajv.compile<IncidentDetectiveAttempt>(
  attemptSchema as AnySchema,
);

const parseContract = <T>(
  candidate: unknown,
  contractName: string,
  validate: ValidateFunction<T>,
): T => {
  if (!validate(candidate)) {
    throw new IncidentDetectiveContractError(
      `${contractName} validation failed: ${formatValidationErrors(validate.errors)}`,
    );
  }

  return candidate as T;
};

const sensitiveKinds = [
  "authorization",
  "cookie",
  "token",
  "email",
  "serial-number",
  "wwn",
] as const;

const allowedExampleDomain = /\b(?:[a-z0-9-]+\.)*example\.com\b/giu;
const allowedExampleIpv4 =
  /\b(?:192\.0\.2|198\.51\.100|203\.0\.113)\.(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/gu;

export const validateIncidentDetectiveSyntheticPrivacy = (
  candidate: unknown,
): void => {
  const serialized = JSON.stringify(candidate);
  const originalReport = redactTextWithReport(serialized).report;

  if (sensitiveKinds.some((kind) => (originalReport.counts[kind] ?? 0) > 0)) {
    throw new IncidentDetectiveContractError(
      "Incident Detective contracts reject Secret, personal and hardware identifiers.",
    );
  }

  const withoutAllowedNetworkExamples = serialized
    .replace(allowedExampleDomain, "synthetic-domain")
    .replace(allowedExampleIpv4, "synthetic-ip");
  const networkReport = redactTextWithReport(
    withoutAllowedNetworkExamples,
  ).report;

  if (
    (networkReport.counts.ip ?? 0) > 0 ||
    (networkReport.counts.domain ?? 0) > 0
  ) {
    throw new IncidentDetectiveContractError(
      "Incident Detective fixtures only allow example.com and RFC 5737 network identifiers.",
    );
  }
};

const assertUniqueIds = (
  values: ReadonlyArray<{ id: string }>,
  label: string,
): void => {
  if (new Set(values.map(({ id }) => id)).size !== values.length) {
    throw new IncidentDetectiveContractError(`${label} ids must be unique.`);
  }
};

const parseTimestamp = (value: string): number => new Date(value).getTime();

const assertWithinWindow = (
  timestamp: string,
  startsAt: number,
  endsAt: number,
  label: string,
): void => {
  const parsed = parseTimestamp(timestamp);
  if (parsed < startsAt || parsed > endsAt) {
    throw new IncidentDetectiveContractError(
      `${label} timestamps must stay inside the incident window.`,
    );
  }
};

const assertChronological = (
  timestamps: readonly string[],
  label: string,
): void => {
  for (let index = 1; index < timestamps.length; index += 1) {
    const previous = timestamps[index - 1];
    const current = timestamps[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      parseTimestamp(current) < parseTimestamp(previous)
    ) {
      throw new IncidentDetectiveContractError(
        `${label} must be in chronological order.`,
      );
    }
  }
};

const assertEvidenceGraph = (
  evidence: readonly IncidentEvidence[],
  budget: number,
): void => {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  for (const item of evidence) {
    if (item.unlocks_after.includes(item.id)) {
      throw new IncidentDetectiveContractError(
        "Evidence cannot unlock after itself.",
      );
    }
    if (
      item.unlocks_after.some((dependency) => !evidenceById.has(dependency))
    ) {
      throw new IncidentDetectiveContractError(
        "Evidence prerequisites must reference the same scenario.",
      );
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (evidenceId: string): void => {
    if (visiting.has(evidenceId)) {
      throw new IncidentDetectiveContractError(
        "Evidence prerequisites must not contain a cycle.",
      );
    }
    if (visited.has(evidenceId)) {
      return;
    }

    visiting.add(evidenceId);
    for (const dependency of evidenceById.get(evidenceId)?.unlocks_after ??
      []) {
      visit(dependency);
    }
    visiting.delete(evidenceId);
    visited.add(evidenceId);
  };

  for (const item of evidence) {
    visit(item.id);
  }

  const collectPath = (
    evidenceId: string,
    collected: Set<string>,
  ): Set<string> => {
    if (collected.has(evidenceId)) {
      return collected;
    }
    collected.add(evidenceId);
    for (const dependency of evidenceById.get(evidenceId)?.unlocks_after ??
      []) {
      collectPath(dependency, collected);
    }
    return collected;
  };

  for (const item of evidence) {
    const path = collectPath(item.id, new Set());
    const pathCost = [...path].reduce(
      (total, evidenceId) =>
        total + (evidenceById.get(evidenceId)?.acquisition_cost ?? 0),
      0,
    );
    if (pathCost > budget) {
      throw new IncidentDetectiveContractError(
        "Every evidence unlock path must fit inside the scenario budget.",
      );
    }
  }
};

const assertEvidencePayload = (
  scenario: IncidentDetectiveScenario,
  startsAt: number,
  endsAt: number,
): void => {
  const serviceIds = new Set(scenario.services.map(({ id }) => id));

  for (const evidence of scenario.evidence) {
    if (evidence.service_id && !serviceIds.has(evidence.service_id)) {
      throw new IncidentDetectiveContractError(
        "Evidence service references must exist in the same scenario.",
      );
    }

    if (evidence.data.kind === "metric") {
      for (const series of evidence.data.series) {
        const timestamps = series.points.map(({ timestamp }) => timestamp);
        assertChronological(timestamps, "Metric points");
        for (const timestamp of timestamps) {
          assertWithinWindow(timestamp, startsAt, endsAt, "Metric points");
        }
      }
    }

    if (evidence.data.kind === "log") {
      const timestamps = evidence.data.entries.map(
        ({ timestamp }) => timestamp,
      );
      assertChronological(timestamps, "Log entries");
      for (const timestamp of timestamps) {
        assertWithinWindow(timestamp, startsAt, endsAt, "Log entries");
      }
    }

    if (evidence.data.kind === "table") {
      const table = evidence.data;
      if (table.rows.some((row) => row.length !== table.columns.length)) {
        throw new IncidentDetectiveContractError(
          "Table evidence rows must match the declared columns.",
        );
      }
    }

    if (evidence.data.kind === "topology") {
      const nodeIds = new Set(
        evidence.data.nodes.map(({ service_id }) => service_id),
      );
      if (
        nodeIds.size !== evidence.data.nodes.length ||
        [...nodeIds].some((serviceId) => !serviceIds.has(serviceId))
      ) {
        throw new IncidentDetectiveContractError(
          "Topology nodes must uniquely reference scenario services.",
        );
      }
      if (
        evidence.data.edges.some(
          (edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to),
        )
      ) {
        throw new IncidentDetectiveContractError(
          "Topology edges must reference nodes in the same evidence.",
        );
      }
    }
  }
};

export const validateIncidentDetectiveScenario = (
  candidate: unknown,
): IncidentDetectiveScenario => {
  const scenario = parseContract(
    candidate,
    "incident-detective-scenario-v1",
    validateScenarioSchema,
  );
  validateIncidentDetectiveSyntheticPrivacy(scenario);
  assertUniqueIds(scenario.services, "Scenario service");
  assertUniqueIds(scenario.evidence, "Scenario evidence");
  assertUniqueIds(scenario.timeline, "Scenario timeline");

  const startsAt = parseTimestamp(scenario.incident_window.starts_at);
  const endsAt = parseTimestamp(scenario.incident_window.ends_at);
  if (endsAt <= startsAt) {
    throw new IncidentDetectiveContractError(
      "Incident window end must be later than its start.",
    );
  }

  assertEvidenceGraph(scenario.evidence, scenario.evidence_budget);
  assertEvidencePayload(scenario, startsAt, endsAt);

  const evidenceIds = new Set(scenario.evidence.map(({ id }) => id));
  for (const event of scenario.timeline) {
    assertWithinWindow(event.occurred_at, startsAt, endsAt, "Timeline event");
    if (event.evidence_id && !evidenceIds.has(event.evidence_id)) {
      throw new IncidentDetectiveContractError(
        "Revealed timeline events must reference scenario evidence.",
      );
    }
  }
  assertChronological(
    scenario.timeline.map(({ occurred_at }) => occurred_at),
    "Scenario timeline",
  );

  return scenario;
};

const assertKnownValues = (
  values: readonly string[],
  known: ReadonlySet<string>,
  label: string,
): void => {
  if (values.some((value) => !known.has(value))) {
    throw new IncidentDetectiveContractError(
      `${label} must reference the validated scenario.`,
    );
  }
};

export const validateIncidentDetectiveAttempt = (
  scenarioCandidate: unknown,
  attemptCandidate: unknown,
): IncidentDetectiveAttempt => {
  const scenario = validateIncidentDetectiveScenario(scenarioCandidate);
  const attempt = parseContract(
    attemptCandidate,
    "incident-detective-attempt-v1",
    validateAttemptSchema,
  );
  validateIncidentDetectiveSyntheticPrivacy(attempt);

  if (attempt.scenario_id !== scenario.id) {
    throw new IncidentDetectiveContractError(
      "Attempt scenario id must match the validated scenario.",
    );
  }

  const evidenceById = new Map(
    scenario.evidence.map((evidence) => [evidence.id, evidence]),
  );
  const evidenceIds = new Set(evidenceById.keys());
  assertKnownValues(
    attempt.selected_evidence_ids,
    evidenceIds,
    "Selected evidence",
  );

  const selected = new Set<string>();
  for (const evidenceId of attempt.selected_evidence_ids) {
    const evidence = evidenceById.get(evidenceId);
    if (
      evidence?.unlocks_after.some((dependency) => !selected.has(dependency))
    ) {
      throw new IncidentDetectiveContractError(
        "Evidence selection must respect prerequisite order.",
      );
    }
    selected.add(evidenceId);
  }

  const spentBudget = attempt.selected_evidence_ids.reduce(
    (total, evidenceId) =>
      total + (evidenceById.get(evidenceId)?.acquisition_cost ?? 0),
    0,
  );
  if (
    spentBudget !== attempt.spent_budget ||
    spentBudget > scenario.evidence_budget
  ) {
    throw new IncidentDetectiveContractError(
      "Attempt budget must exactly match selected evidence and stay within the scenario limit.",
    );
  }

  const serviceIds = new Set(scenario.services.map(({ id }) => id));
  assertKnownValues(
    attempt.hypothesis.suspected_service_ids,
    serviceIds,
    "Suspected services",
  );
  assertKnownValues(
    attempt.hypothesis.supporting_evidence_ids,
    selected,
    "Supporting evidence",
  );
  assertKnownValues(
    attempt.hypothesis.contradicting_evidence_ids,
    selected,
    "Contradicting evidence",
  );

  if (
    attempt.hypothesis.supporting_evidence_ids.some((evidenceId) =>
      attempt.hypothesis.contradicting_evidence_ids.includes(evidenceId),
    )
  ) {
    throw new IncidentDetectiveContractError(
      "Evidence cannot both support and contradict the same hypothesis.",
    );
  }

  const timelineById = new Map(
    scenario.timeline.map((event) => [event.id, event]),
  );
  assertKnownValues(
    attempt.ordered_timeline_event_ids,
    new Set(timelineById.keys()),
    "Attempt timeline",
  );
  const attemptTimeline = attempt.ordered_timeline_event_ids.map((eventId) =>
    timelineById.get(eventId)!,
  );
  if (
    attemptTimeline.some(
      (event) =>
        event.visibility === "revealed" &&
        (!event.evidence_id || !selected.has(event.evidence_id)),
    )
  ) {
    throw new IncidentDetectiveContractError(
      "Attempt timeline cannot reveal events from unselected evidence.",
    );
  }
  assertChronological(
    attemptTimeline.map(({ occurred_at }) => occurred_at),
    "Attempt timeline",
  );

  return attempt;
};
