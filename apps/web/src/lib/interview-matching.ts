import Ajv2020, { type ErrorObject } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

import matchSchema from "../../../../schemas/interview-match-v1.schema.json";
import {
  type InterviewEvidence,
  type InterviewEvidenceSupport,
  type InterviewInputBundle,
  type InterviewRequirement,
  type InterviewRequirementCategory,
  validateInterviewInputBundle,
} from "./interview-contracts";

export type InterviewMatchStatus =
  "direct" | "partial" | "conflict" | "unknown" | "not_applicable";
export type InterviewMatchBand =
  "strong_match" | "partial_match" | "insufficient_evidence" | "conflicted";
export type InterviewMatchBasis =
  | "direct_evidence"
  | "partial_evidence"
  | "conflicting_evidence"
  | "no_evidence"
  | "unknown_evidence"
  | "not_applicable";
export type InterviewMatchDimension = InterviewRequirementCategory;
export type InterviewMatchScore = number | null;

export type InterviewMatchRequirementResult = Readonly<{
  requirement_id: string;
  status: InterviewMatchStatus;
  score: InterviewMatchScore;
  evidence_ids: string[];
  basis: InterviewMatchBasis;
}>;

export type InterviewMatchDimensionResult = Readonly<{
  dimension_id: InterviewMatchDimension;
  status: InterviewMatchStatus;
  score: InterviewMatchScore;
  requirement_ids: string[];
  evidence_ids: string[];
  unknown_requirement_ids: string[];
  conflict_requirement_ids: string[];
}>;

export type InterviewMatchResult = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  match_id: string;
  overall: {
    status: InterviewMatchStatus;
    match_band: InterviewMatchBand;
    score: InterviewMatchScore;
    known_requirement_count: number;
    unknown_requirement_count: number;
    conflict_requirement_count: number;
  };
  dimensions: InterviewMatchDimensionResult[];
  requirement_results: InterviewMatchRequirementResult[];
  unknowns: Array<{
    requirement_id: string;
    reason: "no_evidence" | "only_unknown_evidence";
  }>;
  conflicts: Array<{
    requirement_id: string;
    evidence_ids: string[];
  }>;
  human_review: {
    required: true;
    reasons: Array<
      "unknown_requirements" | "conflicting_evidence" | "no_automatic_decision"
    >;
  };
}>;

export class InterviewMatchError extends Error {
  override name = "InterviewMatchError";
}

const DIMENSIONS: readonly InterviewMatchDimension[] = [
  "must_have",
  "technical",
  "domain",
  "scope",
  "collaboration",
];

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
const validateMatchSchema = ajv.compile<InterviewMatchResult>(
  matchSchema as AnySchema,
);

const parseMatchResult = (candidate: unknown): InterviewMatchResult => {
  if (!validateMatchSchema(candidate)) {
    throw new InterviewMatchError(
      `interview-match-v1 validation failed: ${formatValidationErrors(validateMatchSchema.errors)}`,
    );
  }

  return candidate as InterviewMatchResult;
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new InterviewMatchError(`${label} ids must be unique.`);
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

const unique = (values: readonly string[]): string[] => [...new Set(values)];

const assertKnownReferences = (
  result: InterviewMatchResult,
  source?: InterviewInputBundle,
): void => {
  const requirementResults = result.requirement_results;
  const requirementIds = requirementResults.map(
    ({ requirement_id }) => requirement_id,
  );
  assertUnique(requirementIds, "Match requirement");

  const dimensionIds = result.dimensions.map(
    ({ dimension_id }) => dimension_id,
  );
  assertUnique(dimensionIds, "Match dimension");
  if (!sameSet(dimensionIds, DIMENSIONS)) {
    throw new InterviewMatchError(
      "Match dimensions must contain each supported requirement category exactly once.",
    );
  }

  const dimensionRequirementIds = result.dimensions.flatMap(
    ({ requirement_ids }) => requirement_ids,
  );
  assertUnique(dimensionRequirementIds, "Dimension requirement");
  if (!sameSet(dimensionRequirementIds, requirementIds)) {
    throw new InterviewMatchError(
      "Match dimensions and requirement results must contain the same requirement IDs.",
    );
  }

  const unknownIds = result.unknowns.map(
    ({ requirement_id }) => requirement_id,
  );
  const conflictIds = result.conflicts.map(
    ({ requirement_id }) => requirement_id,
  );
  assertUnique(unknownIds, "Unknown requirement");
  assertUnique(conflictIds, "Conflict requirement");
  if (
    !unknownIds.every((id) => requirementIds.includes(id)) ||
    !conflictIds.every((id) => requirementIds.includes(id)) ||
    unknownIds.some((id) => conflictIds.includes(id))
  ) {
    throw new InterviewMatchError(
      "Match unknown and conflict references must target distinct known requirements.",
    );
  }

  const resultById = new Map(
    requirementResults.map((requirement) => [
      requirement.requirement_id,
      requirement,
    ]),
  );
  for (const requirement of requirementResults) {
    const isUnknown = requirement.status === "unknown";
    const isConflict = requirement.status === "conflict";
    if (isUnknown !== unknownIds.includes(requirement.requirement_id)) {
      throw new InterviewMatchError(
        "Match unknown references must agree with requirement statuses.",
      );
    }
    if (isConflict !== conflictIds.includes(requirement.requirement_id)) {
      throw new InterviewMatchError(
        "Match conflict references must agree with requirement statuses.",
      );
    }
    const expectedScore =
      requirement.status === "direct"
        ? 100
        : requirement.status === "partial"
          ? 60
          : null;
    if (requirement.score !== expectedScore) {
      throw new InterviewMatchError(
        "Match requirement scores must agree with deterministic evidence statuses.",
      );
    }
    const expectedBasis: InterviewMatchBasis =
      requirement.status === "direct"
        ? "direct_evidence"
        : requirement.status === "partial"
          ? "partial_evidence"
          : requirement.status === "conflict"
            ? "conflicting_evidence"
            : requirement.status === "unknown"
              ? requirement.basis
              : "not_applicable";
    if (
      requirement.status === "unknown" &&
      requirement.basis !== "no_evidence" &&
      requirement.basis !== "unknown_evidence"
    ) {
      throw new InterviewMatchError(
        "Unknown match requirements must identify an unknown-evidence basis.",
      );
    }
    if (
      requirement.status !== "unknown" &&
      requirement.basis !== expectedBasis
    ) {
      throw new InterviewMatchError(
        "Match requirement basis must agree with deterministic evidence statuses.",
      );
    }
  }

  const statusCounts = requirementResults.reduce(
    (counts, requirement) => {
      counts[requirement.status] += 1;
      return counts;
    },
    {
      direct: 0,
      partial: 0,
      conflict: 0,
      unknown: 0,
      not_applicable: 0,
    } as Record<InterviewMatchStatus, number>,
  );
  const { overall } = result;
  if (
    overall.known_requirement_count !==
      statusCounts.direct + statusCounts.partial ||
    overall.unknown_requirement_count !== statusCounts.unknown ||
    overall.conflict_requirement_count !== statusCounts.conflict
  ) {
    throw new InterviewMatchError(
      "Match overall counts do not match requirement results.",
    );
  }

  const expectedBand: InterviewMatchBand =
    statusCounts.conflict > 0
      ? "conflicted"
      : statusCounts.direct + statusCounts.partial === 0
        ? "insufficient_evidence"
        : statusCounts.unknown > 0
          ? "partial_match"
          : statusCounts.direct === requirementResults.length
            ? "strong_match"
            : "partial_match";
  if (overall.match_band !== expectedBand) {
    throw new InterviewMatchError(
      "Match band does not match requirement statuses.",
    );
  }
  const expectedStatus: InterviewMatchStatus =
    statusCounts.conflict > 0
      ? "conflict"
      : statusCounts.direct + statusCounts.partial === 0
        ? "unknown"
        : statusCounts.unknown > 0
          ? "partial"
          : statusCounts.direct === requirementResults.length
            ? "direct"
            : "partial";
  if (overall.status !== expectedStatus) {
    throw new InterviewMatchError(
      "Match overall status does not match requirement statuses.",
    );
  }

  const reasons = result.human_review.reasons;
  if (
    !reasons.includes("no_automatic_decision") ||
    (statusCounts.unknown > 0 && !reasons.includes("unknown_requirements")) ||
    (statusCounts.conflict > 0 && !reasons.includes("conflicting_evidence"))
  ) {
    throw new InterviewMatchError(
      "Match human-review reasons must preserve unknown, conflict, and manual-decision boundaries.",
    );
  }

  if (source) {
    const validatedSource = validateInterviewInputBundle(source);
    const sourceRequirementIds = validatedSource.requirements.map(
      ({ requirement_id }) => requirement_id,
    );
    if (!sameSet(sourceRequirementIds, requirementIds)) {
      throw new InterviewMatchError(
        "Match requirement references must match the input requirement registry.",
      );
    }
    const sourceEvidenceIds = new Set(
      validatedSource.evidence.map(({ evidence_id }) => evidence_id),
    );
    for (const requirement of requirementResults) {
      if (
        requirement.evidence_ids.some(
          (evidenceId) => !sourceEvidenceIds.has(evidenceId),
        )
      ) {
        throw new InterviewMatchError(
          "Match evidence references must match the input evidence registry.",
        );
      }
      for (const evidenceId of requirement.evidence_ids) {
        const sourceEvidence = validatedSource.evidence.find(
          ({ evidence_id }) => evidence_id === evidenceId,
        );
        if (
          !sourceEvidence?.requirement_ids.includes(requirement.requirement_id)
        ) {
          throw new InterviewMatchError(
            "Match evidence references must target their requirement.",
          );
        }
      }
    }
    for (const conflict of result.conflicts) {
      if (
        conflict.evidence_ids.some(
          (evidenceId) => !sourceEvidenceIds.has(evidenceId),
        )
      ) {
        throw new InterviewMatchError(
          "Match conflict evidence references must match the input evidence registry.",
        );
      }
      const requirement = resultById.get(conflict.requirement_id);
      if (
        !requirement ||
        !sameSet(conflict.evidence_ids, requirement.evidence_ids)
      ) {
        throw new InterviewMatchError(
          "Match conflict evidence references must match the conflict requirement result.",
        );
      }
    }
  }

  for (const dimension of result.dimensions) {
    for (const requirementId of dimension.requirement_ids) {
      if (!resultById.has(requirementId)) {
        throw new InterviewMatchError(
          "Match dimension references an unknown requirement.",
        );
      }
    }
    if (
      !sameSet(
        dimension.unknown_requirement_ids,
        dimension.requirement_ids.filter(
          (id) => resultById.get(id)?.status === "unknown",
        ),
      ) ||
      !sameSet(
        dimension.conflict_requirement_ids,
        dimension.requirement_ids.filter(
          (id) => resultById.get(id)?.status === "conflict",
        ),
      )
    ) {
      throw new InterviewMatchError(
        "Match dimension unknown and conflict references do not match requirement statuses.",
      );
    }
    if (
      !sameSet(
        dimension.evidence_ids,
        dimension.requirement_ids.flatMap(
          (id) => resultById.get(id)?.evidence_ids ?? [],
        ),
      )
    ) {
      throw new InterviewMatchError(
        "Match dimension evidence references must match its requirement results.",
      );
    }
  }
};

export const validateInterviewMatchResult = (
  candidate: unknown,
  source?: InterviewInputBundle,
): InterviewMatchResult => {
  const result = parseMatchResult(candidate);
  assertKnownReferences(result, source);
  return result;
};

const evidenceForRequirement = (
  evidence: readonly InterviewEvidence[],
  requirementId: string,
): InterviewEvidence[] =>
  evidence.filter((item) => item.requirement_ids.includes(requirementId));

const classifyEvidence = (
  evidence: readonly InterviewEvidence[],
): Pick<InterviewMatchRequirementResult, "status" | "score" | "basis"> => {
  if (evidence.length === 0) {
    return { status: "unknown", score: null, basis: "no_evidence" };
  }

  const support = new Set<InterviewEvidenceSupport>(
    evidence.map(({ support: value }) => value),
  );
  if (support.has("conflict")) {
    return {
      status: "conflict",
      score: null,
      basis: "conflicting_evidence",
    };
  }
  if (support.has("direct")) {
    return { status: "direct", score: 100, basis: "direct_evidence" };
  }
  if (support.has("partial")) {
    return { status: "partial", score: 60, basis: "partial_evidence" };
  }
  return { status: "unknown", score: null, basis: "unknown_evidence" };
};

const averageKnownScores = (
  requirements: readonly InterviewMatchRequirementResult[],
): number | null => {
  const scores = requirements.flatMap(({ score }) =>
    typeof score === "number" ? [score] : [],
  );
  if (scores.length === 0) {
    return null;
  }
  return Math.round(
    scores.reduce((total, score) => total + score, 0) / scores.length,
  );
};

const aggregateStatus = (
  requirements: readonly InterviewMatchRequirementResult[],
): InterviewMatchStatus => {
  if (requirements.length === 0) {
    return "not_applicable";
  }
  if (requirements.some(({ status }) => status === "conflict")) {
    return "conflict";
  }
  const known = requirements.filter(
    ({ status }) => status === "direct" || status === "partial",
  );
  if (known.length === 0) {
    return "unknown";
  }
  if (requirements.some(({ status }) => status === "unknown")) {
    return "partial";
  }
  return known.every(({ status }) => status === "direct")
    ? "direct"
    : "partial";
};

const aggregateDimension = (
  dimensionId: InterviewMatchDimension,
  requirementIds: readonly string[],
  byRequirement: ReadonlyMap<string, InterviewMatchRequirementResult>,
): InterviewMatchDimensionResult => {
  const requirements = requirementIds.flatMap((id) => {
    const result = byRequirement.get(id);
    return result ? [result] : [];
  });
  const status = aggregateStatus(requirements);
  return {
    dimension_id: dimensionId,
    status,
    score: averageKnownScores(requirements),
    requirement_ids: [...requirementIds],
    evidence_ids: unique(
      requirements.flatMap(({ evidence_ids }) => evidence_ids),
    ),
    unknown_requirement_ids: requirements
      .filter(({ status: value }) => value === "unknown")
      .map(({ requirement_id }) => requirement_id),
    conflict_requirement_ids: requirements
      .filter(({ status: value }) => value === "conflict")
      .map(({ requirement_id }) => requirement_id),
  };
};

export const buildInterviewMatchResult = (
  bundle: InterviewInputBundle,
  matchId = "match-local",
): InterviewMatchResult => {
  const validatedBundle = validateInterviewInputBundle(bundle);
  const requirementResults = validatedBundle.requirements.map(
    (requirement: InterviewRequirement): InterviewMatchRequirementResult => {
      const evidence = evidenceForRequirement(
        validatedBundle.evidence,
        requirement.requirement_id,
      );
      const classification = classifyEvidence(evidence);
      return {
        requirement_id: requirement.requirement_id,
        ...classification,
        evidence_ids: evidence.map(({ evidence_id }) => evidence_id),
      };
    },
  );
  const byRequirement = new Map(
    requirementResults.map((requirement) => [
      requirement.requirement_id,
      requirement,
    ]),
  );
  const requirementsByDimension = new Map<InterviewMatchDimension, string[]>(
    DIMENSIONS.map((dimension) => [dimension, []]),
  );
  for (const requirement of validatedBundle.requirements) {
    requirementsByDimension
      .get(requirement.category)
      ?.push(requirement.requirement_id);
  }
  const dimensions = DIMENSIONS.map((dimension) =>
    aggregateDimension(
      dimension,
      requirementsByDimension.get(dimension) ?? [],
      byRequirement,
    ),
  );

  const unknowns = requirementResults.flatMap((requirement) => {
    if (requirement.status !== "unknown") {
      return [];
    }
    return [
      {
        requirement_id: requirement.requirement_id,
        reason:
          requirement.basis === "no_evidence"
            ? ("no_evidence" as const)
            : ("only_unknown_evidence" as const),
      },
    ];
  });
  const conflicts = requirementResults.flatMap((requirement) =>
    requirement.status === "conflict"
      ? [
          {
            requirement_id: requirement.requirement_id,
            evidence_ids: [...requirement.evidence_ids],
          },
        ]
      : [],
  );
  const knownRequirements = requirementResults.filter(
    ({ status }) => status === "direct" || status === "partial",
  );
  const overallStatus = aggregateStatus(requirementResults);
  const overall: InterviewMatchResult["overall"] = {
    status: overallStatus,
    match_band:
      conflicts.length > 0
        ? "conflicted"
        : knownRequirements.length === 0
          ? "insufficient_evidence"
          : unknowns.length > 0
            ? "partial_match"
            : knownRequirements.every(({ status }) => status === "direct")
              ? "strong_match"
              : "partial_match",
    score: averageKnownScores(requirementResults),
    known_requirement_count: knownRequirements.length,
    unknown_requirement_count: unknowns.length,
    conflict_requirement_count: conflicts.length,
  };
  const reasons: InterviewMatchResult["human_review"]["reasons"] = [];
  if (unknowns.length > 0) {
    reasons.push("unknown_requirements");
  }
  if (conflicts.length > 0) {
    reasons.push("conflicting_evidence");
  }
  reasons.push("no_automatic_decision");

  const result: InterviewMatchResult = {
    schema_version: "1.0",
    sensitivity: "sensitive",
    match_id: matchId,
    overall,
    dimensions,
    requirement_results: requirementResults,
    unknowns,
    conflicts,
    human_review: { required: true, reasons },
  };
  return validateInterviewMatchResult(result, validatedBundle);
};
