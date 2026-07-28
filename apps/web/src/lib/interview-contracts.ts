import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";
import { redactTextWithReport } from "@margrop-labs/redaction";

import evidenceSchema from "../../../../schemas/interview-evidence-v1.schema.json";
import jdSchema from "../../../../schemas/interview-jd-v1.schema.json";
import requirementSchema from "../../../../schemas/interview-requirement-v1.schema.json";
import resumeSchema from "../../../../schemas/interview-resume-v1.schema.json";

export type InterviewLevel = "junior" | "mid" | "senior" | "lead" | "unknown";
export type InterviewRequirementCategory =
  "must_have" | "technical" | "domain" | "scope" | "collaboration";
export type InterviewRequirementPriority = "must" | "should" | "nice";
export type InterviewEvidenceSource =
  "resume" | "interview_record" | "candidate_preparation";
export type InterviewEvidenceKind =
  "experience" | "project" | "skill" | "behavior" | "unknown";
export type InterviewEvidenceSupport =
  "direct" | "partial" | "conflict" | "unknown";

export type InterviewScope = Readonly<{
  team_size: number;
  ownership: string;
  scale: string;
}>;

export type InterviewExperience = Readonly<{
  experience_id: string;
  role: string;
  domain: string;
  summary: string;
  technologies: string[];
  scope: InterviewScope;
  achievements: string[];
}>;

export type InterviewResume = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  resume_id: string;
  headline: string;
  experiences: InterviewExperience[];
  skills: string[];
}>;

export type InterviewRequirement = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  requirement_id: string;
  category: InterviewRequirementCategory;
  priority: InterviewRequirementPriority;
  statement: string;
  evidence_signals: string[];
}>;

export type InterviewJobDescription = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  jd_id: string;
  role_title: string;
  level: InterviewLevel;
  responsibilities: string[];
  requirements: Array<
    Omit<InterviewRequirement, "schema_version" | "sensitivity">
  >;
}>;

export type InterviewEvidence = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  evidence_id: string;
  source: InterviewEvidenceSource;
  kind: InterviewEvidenceKind;
  summary: string;
  requirement_ids: string[];
  support: InterviewEvidenceSupport;
}>;

export type InterviewInputBundle = Readonly<{
  resume: InterviewResume;
  jd: InterviewJobDescription;
  requirements: InterviewRequirement[];
  evidence: InterviewEvidence[];
}>;

export class InterviewContractError extends Error {
  override name = "InterviewContractError";
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

const validateResumeSchema = ajv.compile<InterviewResume>(
  resumeSchema as AnySchema,
);
const validateJdSchema = ajv.compile<InterviewJobDescription>(
  jdSchema as AnySchema,
);
const validateRequirementSchema = ajv.compile<InterviewRequirement>(
  requirementSchema as AnySchema,
);
const validateEvidenceSchema = ajv.compile<InterviewEvidence>(
  evidenceSchema as AnySchema,
);

const parseContract = <T>(
  candidate: unknown,
  contractName: string,
  validate: ValidateFunction<T>,
): T => {
  if (!validate(candidate)) {
    throw new InterviewContractError(
      `${contractName} validation failed: ${formatValidationErrors(validate.errors)}`,
    );
  }

  return candidate as T;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertUniqueIds = (
  values: ReadonlyArray<unknown>,
  field: string,
  label: string,
): void => {
  const ids = values.map((value) =>
    isRecord(value) ? value[field] : undefined,
  );
  if (
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length
  ) {
    throw new InterviewContractError(`${label} ids must be unique.`);
  }
};

export const validateInterviewResume = (
  candidate: unknown,
): InterviewResume => {
  const resume = parseContract(
    candidate,
    "interview-resume-v1",
    validateResumeSchema,
  );
  assertUniqueIds(resume.experiences, "experience_id", "Resume experience");
  return resume;
};

export const validateInterviewJobDescription = (
  candidate: unknown,
): InterviewJobDescription => {
  const jd = parseContract(candidate, "interview-jd-v1", validateJdSchema);
  assertUniqueIds(jd.requirements, "requirement_id", "JD requirement");
  return jd;
};

export const validateInterviewRequirement = (
  candidate: unknown,
): InterviewRequirement =>
  parseContract(
    candidate,
    "interview-requirement-v1",
    validateRequirementSchema,
  );

export const validateInterviewEvidence = (
  candidate: unknown,
): InterviewEvidence =>
  parseContract(candidate, "interview-evidence-v1", validateEvidenceSchema);

export const validateInterviewInputBundle = (
  candidate: unknown,
): InterviewInputBundle => {
  if (!isRecord(candidate)) {
    throw new InterviewContractError(
      "Interview input bundle must be an object.",
    );
  }

  const allowedKeys = new Set(["resume", "jd", "requirements", "evidence"]);
  const unknownKeys = Object.keys(candidate).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new InterviewContractError(
      "Interview input bundle contains unknown fields.",
    );
  }

  const resume = validateInterviewResume(candidate.resume);
  const jd = validateInterviewJobDescription(candidate.jd);
  if (
    !Array.isArray(candidate.requirements) ||
    !Array.isArray(candidate.evidence)
  ) {
    throw new InterviewContractError(
      "Interview input bundle requirements and evidence must be arrays.",
    );
  }

  const requirements = candidate.requirements.map(validateInterviewRequirement);
  const evidence = candidate.evidence.map(validateInterviewEvidence);
  assertUniqueIds(requirements, "requirement_id", "Input requirement");
  assertUniqueIds(evidence, "evidence_id", "Input evidence");

  const requirementIds = new Set(
    requirements.map(({ requirement_id }) => requirement_id),
  );
  const jdRequirementIds = new Set(
    jd.requirements.map(({ requirement_id }) => requirement_id),
  );
  if (
    requirementIds.size !== jdRequirementIds.size ||
    [...requirementIds].some((id) => !jdRequirementIds.has(id))
  ) {
    throw new InterviewContractError(
      "JD requirements and the requirement registry must contain the same IDs.",
    );
  }

  for (const item of evidence) {
    for (const requirementId of item.requirement_ids) {
      if (!requirementIds.has(requirementId)) {
        throw new InterviewContractError(
          "Evidence must reference a known requirement ID.",
        );
      }
    }
  }

  return { resume, jd, requirements, evidence };
};

export type InterviewBoundaryProjection = Readonly<{
  schema_version: "1.0";
  projection_version: "1.0";
  resume: {
    experience_signals: Array<{
      experience_id: string;
      role: string;
      domain: string;
      technologies: string[];
      scope: InterviewScope;
    }>;
    skills: string[];
  };
  job: {
    role_title: string;
    level: InterviewLevel;
    requirement_signals: Array<{
      requirement_id: string;
      category: InterviewRequirementCategory;
      priority: InterviewRequirementPriority;
    }>;
  };
  evidence: Array<{
    evidence_id: string;
    source: InterviewEvidenceSource;
    kind: InterviewEvidenceKind;
    requirement_ids: string[];
    support: InterviewEvidenceSupport;
  }>;
  omitted_fields: readonly string[];
}>;

export const INTERVIEW_BOUNDARY_OMITTED_FIELDS = [
  "resume.resume_id",
  "resume.headline",
  "resume.experiences[].summary",
  "resume.experiences[].achievements",
  "jd.jd_id",
  "jd.responsibilities",
  "requirements[].statement",
  "requirements[].evidence_signals",
  "evidence[].summary",
] as const;

const assertSafeBoundaryProjection = (
  projection: InterviewBoundaryProjection,
): void => {
  const serialized = JSON.stringify(projection);
  if (
    /(?:full[_ -]?name|email|phone|mobile|address|住址|姓名|身份证|账号|token|cookie|authorization)/iu.test(
      serialized,
    )
  ) {
    throw new InterviewContractError(
      "Interview boundary projection contains a prohibited identifier field.",
    );
  }
};

export const buildInterviewBoundaryProjection = (
  bundle: InterviewInputBundle,
): InterviewBoundaryProjection => {
  const projection: InterviewBoundaryProjection = {
    schema_version: "1.0",
    projection_version: "1.0",
    resume: {
      experience_signals: bundle.resume.experiences.map(
        ({ experience_id, role, domain, technologies, scope }) => ({
          experience_id,
          role,
          domain,
          technologies,
          scope,
        }),
      ),
      skills: bundle.resume.skills,
    },
    job: {
      role_title: bundle.jd.role_title,
      level: bundle.jd.level,
      requirement_signals: bundle.requirements.map(
        ({ requirement_id, category, priority }) => ({
          requirement_id,
          category,
          priority,
        }),
      ),
    },
    evidence: bundle.evidence.map(
      ({ evidence_id, source, kind, requirement_ids, support }) => ({
        evidence_id,
        source,
        kind,
        requirement_ids,
        support,
      }),
    ),
    omitted_fields: INTERVIEW_BOUNDARY_OMITTED_FIELDS,
  };

  assertSafeBoundaryProjection(projection);
  return projection;
};

export type InterviewLocalRedaction = Readonly<{
  text: string;
  redaction_count: number;
  redaction_kinds: readonly string[];
}>;

const localSensitivePatterns: ReadonlyArray<readonly [string, RegExp, string]> =
  [
    [
      "name",
      /(?:姓名|候选人|full[ _-]?name|name)(?:\s*[:：=]\s*)([^\s,，;；]+)/giu,
      "[REDACTED:NAME]",
    ],
    [
      "contact",
      /(?:手机|电话|phone|mobile|邮箱|email|地址|住址|address|账号|用户名|account)(?:\s*[:：=]\s*)([^\s,，;；]+)/giu,
      "[REDACTED:CONTACT]",
    ],
    ["phone", /(?<!\d)(?:\+?86[ -]?)?1[3-9]\d{9}(?!\d)/gu, "[REDACTED:PHONE]"],
    [
      "national-id",
      /(?<!\d)[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/gu,
      "[REDACTED:ID]",
    ],
  ];

export const redactInterviewLocalText = (
  input: string,
): InterviewLocalRedaction => {
  const shared = redactTextWithReport(input);
  let text = shared.text;
  const kinds = new Set<string>();
  let redactionCount = shared.report.total;

  for (const [kind, pattern, replacement] of localSensitivePatterns) {
    pattern.lastIndex = 0;
    const before = text;
    text = text.replace(pattern, replacement);
    if (text !== before) {
      kinds.add(kind);
      redactionCount += 1;
    }
  }

  for (const kind of Object.keys(shared.report.counts)) {
    kinds.add(kind);
  }

  return {
    text,
    redaction_count: redactionCount,
    redaction_kinds: [...kinds].sort(),
  };
};
