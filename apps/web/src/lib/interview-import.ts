import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import importSchema from "../../../../schemas/interview-text-import-v1.schema.json";
import {
  type InterviewEvidence,
  type InterviewEvidenceKind,
  type InterviewEvidenceSupport,
  type InterviewInputBundle,
  type InterviewJobDescription,
  type InterviewLevel,
  type InterviewRequirement,
  type InterviewRequirementCategory,
  type InterviewRequirementPriority,
  type InterviewResume,
  redactInterviewLocalText,
  validateInterviewInputBundle,
} from "./interview-contracts";

export const INTERVIEW_TEXT_IMPORT_MAX_BYTES = 32 * 1024;

export type InterviewTextImport = Readonly<{
  schema_version: "1.0";
  sensitivity: "sensitive";
  resume_text: string;
  jd_text: string;
}>;

export type InterviewImportWarning =
  | "active-markup-ignored"
  | "prompt-like-content-ignored"
  | "resume-structure-incomplete"
  | "jd-structure-incomplete";

export type InterviewTextImportResult = Readonly<{
  input: InterviewTextImport;
  bundle: InterviewInputBundle;
  warnings: InterviewImportWarning[];
}>;

export class InterviewImportError extends Error {
  override name = "InterviewImportError";

  constructor(
    readonly code:
      | "invalid-input"
      | "input-too-large"
      | "invalid-control-character"
      | "protected-attribute"
      | "insufficient-content",
  ) {
    super(`Interview text import failed: ${code}.`);
  }
}

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateImportSchema = ajv.compile<InterviewTextImport>(
  importSchema as AnySchema,
);
const encoder = new TextEncoder();

const parseContract = <T>(
  candidate: unknown,
  validate: ValidateFunction<T>,
): T => {
  if (!validate(candidate)) {
    throw new InterviewImportError(
      validate.errors?.some(({ keyword }) => keyword === "maxLength")
        ? "input-too-large"
        : "invalid-input",
    );
  }
  return candidate as T;
};

export const validateInterviewTextImport = (
  candidate: unknown,
): InterviewTextImport => {
  const input = parseContract(candidate, validateImportSchema);
  for (const text of [input.resume_text, input.jd_text]) {
    if (text.includes("\u0000")) {
      throw new InterviewImportError("invalid-control-character");
    }
    if (encoder.encode(text).byteLength > INTERVIEW_TEXT_IMPORT_MAX_BYTES) {
      throw new InterviewImportError("input-too-large");
    }
  }
  return input;
};

const protectedAttributePattern =
  /(?:年龄(?:要求)?\s*[:：]?\s*\d|\d{2}\s*岁(?:以下|以上)|性别\s*[:：]|男性优先|女性优先|婚姻(?:状况)?\s*[:：]|婚育\s*[:：]|民族\s*[:：]|宗教\s*[:：]|政治面貌\s*[:：]|健康状况\s*[:：])/iu;
const promptLikePattern =
  /(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+prompt|developer\s+message|忽略(?:以上|之前|前面).{0,12}(?:指令|规则)|系统提示词|开发者消息)/iu;
const activeMarkupPattern =
  /<(?:script|iframe|object|embed|svg|math)\b|javascript\s*:/iu;
const personalLabelPattern =
  /^(?:姓名|名字|邮箱|电子邮件|电话|手机|住址|地址|身份证|证件号|账号)\s*[:：]/iu;

const normalizeText = (
  text: string,
  warnings: Set<InterviewImportWarning>,
): string[] =>
  text
    .replace(/\r\n?/gu, "\n")
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false;
      if (activeMarkupPattern.test(line)) {
        warnings.add("active-markup-ignored");
        return false;
      }
      if (promptLikePattern.test(line)) {
        warnings.add("prompt-like-content-ignored");
        return false;
      }
      return true;
    })
    .map((line) => line.replace(/<[^>]*>/gu, "").trim())
    .filter((line) => line.length > 0);

const stripListPrefix = (line: string): string =>
  line.replace(/^(?:[-*•·]|\d+[.)、])\s*/u, "").trim();

const labeledValue = (
  lines: readonly string[],
  labels: readonly string[],
): string | undefined => {
  const pattern = new RegExp(
    `^(?:${labels.join("|")})\\s*[:：]\\s*(.+)$`,
    "iu",
  );
  for (const line of lines) {
    const match = pattern.exec(stripListPrefix(line));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return undefined;
};

const truncate = (value: string, maximum: number): string =>
  value.trim().slice(0, maximum);

const paragraph = (value: string, fallback: string): string => {
  const redacted = redactInterviewLocalText(value)
    .text.replace(/\s+/gu, " ")
    .trim();
  const candidate = redacted.length >= 10 ? redacted : fallback;
  return truncate(candidate, 800);
};

const shortText = (value: string, fallback: string): string => {
  const candidate = value.replace(/\s+/gu, " ").trim() || fallback;
  return truncate(candidate, 240);
};

const technologyCatalog = [
  "JavaScript",
  "TypeScript",
  "React",
  "Vue",
  "Node.js",
  "Python",
  "Java",
  "Go",
  "Rust",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Linux",
  "SQL",
  "MySQL",
  "PostgreSQL",
  "Redis",
  "Kafka",
  "Prometheus",
  "Grafana",
] as const;

const extractTechnologies = (text: string): string[] => {
  const lower = text.toLowerCase();
  const found = technologyCatalog.filter((technology) =>
    lower.includes(technology.toLowerCase()),
  );
  return found.length > 0 ? found.slice(0, 20) : ["未识别技术栈"];
};

const inferDomain = (text: string): string => {
  if (/云|cloud|kubernetes|terraform|容器/iu.test(text)) return "云平台";
  if (/数据|data|sql|kafka|仓库/iu.test(text)) return "数据平台";
  if (/前端|frontend|react|vue|用户体验/iu.test(text)) return "前端产品";
  if (/安全|security|风控/iu.test(text)) return "安全与风控";
  return "领域未明确";
};

const inferLevel = (text: string): InterviewLevel => {
  if (/负责人|lead|专家|principal|staff/iu.test(text)) return "lead";
  if (/高级|senior/iu.test(text)) return "senior";
  if (/初级|junior|应届/iu.test(text)) return "junior";
  if (/中级|mid(?:dle)?/iu.test(text)) return "mid";
  return "unknown";
};

const inferCategory = (statement: string): InterviewRequirementCategory => {
  if (/必须|至少|学历|年经验|资格/iu.test(statement)) return "must_have";
  if (/协作|沟通|推动|复盘|跨团队/iu.test(statement)) return "collaboration";
  if (/规模|负责|架构|复杂度|团队/iu.test(statement)) return "scope";
  if (/领域|业务|行业|平台/iu.test(statement)) return "domain";
  return "technical";
};

const inferPriority = (statement: string): InterviewRequirementPriority => {
  if (/必须|至少|要求|不得/iu.test(statement)) return "must";
  if (/优先|加分|最好/iu.test(statement)) return "nice";
  return "should";
};

const extractSignals = (statement: string): string[] => {
  const technologies = extractTechnologies(statement).filter(
    (value) => value !== "未识别技术栈",
  );
  const phrases = ["跨团队", "故障复盘", "项目交付", "系统设计"].filter(
    (phrase) => statement.includes(phrase),
  );
  const latinWords = statement.match(/[A-Za-z][A-Za-z0-9.+#-]{1,30}/gu) ?? [];
  const signals = [...new Set([...technologies, ...phrases, ...latinWords])];
  return signals.length > 0 ? signals.slice(0, 8) : ["人工核验"];
};

const extractRequirements = (
  lines: readonly string[],
  warnings: Set<InterviewImportWarning>,
): string[] => {
  const results: string[] = [];
  let inRequirements = false;
  for (const line of lines) {
    const cleaned = stripListPrefix(line);
    const header =
      /^(?:任职要求|岗位要求|职位要求|要求|requirements?)\s*[:：]?$/iu.test(
        cleaned,
      );
    if (header) {
      inRequirements = true;
      continue;
    }
    const inline =
      /^(?:任职要求|岗位要求|职位要求|要求|requirements?)\s*[:：]\s*(.+)$/iu.exec(
        cleaned,
      );
    if (inline?.[1]) {
      inRequirements = true;
      results.push(inline[1].trim());
      continue;
    }
    if (
      inRequirements &&
      /^(?:职责|岗位职责|工作职责|responsibilities?)\s*[:：]?$/iu.test(cleaned)
    ) {
      inRequirements = false;
      continue;
    }
    if (inRequirements && line !== cleaned) results.push(cleaned);
  }
  if (results.length === 0) {
    warnings.add("jd-structure-incomplete");
    return lines
      .map(stripListPrefix)
      .filter((line) => /必须|熟悉|具备|经验|能力|负责|优先/iu.test(line))
      .slice(0, 12);
  }
  return results.slice(0, 30);
};

const extractResponsibilities = (lines: readonly string[]): string[] => {
  const values: string[] = [];
  for (const line of lines) {
    const cleaned = stripListPrefix(line);
    const match =
      /^(?:职责|岗位职责|工作职责|responsibilities?)\s*[:：]\s*(.+)$/iu.exec(
        cleaned,
      );
    if (match?.[1]) values.push(match[1].trim());
  }
  return values.length > 0
    ? values.slice(0, 20)
    : ["当前岗位文本未能确定性拆分职责，需要用户人工核验。"];
};

const buildResume = (
  lines: readonly string[],
  sourceText: string,
  warnings: Set<InterviewImportWarning>,
): InterviewResume => {
  const headline =
    labeledValue(lines, ["职位", "目标岗位", "岗位", "role", "title"]) ??
    stripListPrefix(
      lines.find((line) => !personalLabelPattern.test(line)) ?? "",
    );
  const technologies = extractTechnologies(sourceText);
  const achievementLines = lines
    .map(stripListPrefix)
    .filter((line) => /^(?:成果|业绩|成就|achievement)\s*[:：]/iu.test(line))
    .map((line) => line.replace(/^[^:：]+[:：]\s*/u, ""));
  const safeNarrative = lines
    .filter((line) => !personalLabelPattern.test(line))
    .map(stripListPrefix)
    .join("；");
  const teamSize = Number(
    /(?:团队|team)\s*(?:规模)?\s*[:：]?\s*(\d{1,4})\s*人?/iu.exec(
      sourceText,
    )?.[1] ?? 1,
  );
  if (!labeledValue(lines, ["经历", "经验", "experience"])) {
    warnings.add("resume-structure-incomplete");
  }
  return {
    schema_version: "1.0",
    sensitivity: "sensitive",
    resume_id: "resume-local-input",
    headline: shortText(headline, "用户录入的简历"),
    experiences: [
      {
        experience_id: "experience-local-1",
        role: shortText(headline, "角色未明确"),
        domain: inferDomain(sourceText),
        summary: paragraph(
          safeNarrative,
          "当前简历文本未能确定性拆分经历摘要，需要人工核验。",
        ),
        technologies,
        scope: {
          team_size: Math.min(Math.max(teamSize, 1), 10000),
          ownership: "输入未提供可确认的完整职责范围",
          scale: "输入未提供可确认的完整系统规模",
        },
        achievements: [
          paragraph(
            achievementLines.join("；"),
            "当前简历文本未能确定性拆分成果，需要面试进一步核验。",
          ),
        ],
      },
    ],
    skills: technologies,
  };
};

const buildJob = (
  lines: readonly string[],
  sourceText: string,
  warnings: Set<InterviewImportWarning>,
): { jd: InterviewJobDescription; requirements: InterviewRequirement[] } => {
  const roleTitle =
    labeledValue(lines, ["岗位", "职位", "岗位名称", "role", "title"]) ??
    stripListPrefix(lines[0] ?? "");
  const statements = extractRequirements(lines, warnings);
  if (statements.length === 0) {
    throw new InterviewImportError("insufficient-content");
  }
  const requirements = statements.map((rawStatement, index) => {
    const statement = paragraph(
      rawStatement,
      "该岗位要求需要根据原始文本人工核验。",
    );
    return {
      schema_version: "1.0" as const,
      sensitivity: "sensitive" as const,
      requirement_id: `requirement-local-${index + 1}`,
      category: inferCategory(statement),
      priority: inferPriority(statement),
      statement,
      evidence_signals: extractSignals(statement),
    };
  });
  return {
    jd: {
      schema_version: "1.0",
      sensitivity: "sensitive",
      jd_id: "jd-local-input",
      role_title: shortText(roleTitle, "用户录入的岗位"),
      level: inferLevel(`${roleTitle}\n${sourceText}`),
      responsibilities: extractResponsibilities(lines).map((item) =>
        paragraph(item, "当前岗位职责需要根据原始文本人工核验。"),
      ),
      requirements: requirements.map(
        ({
          requirement_id,
          category,
          priority,
          statement,
          evidence_signals,
        }) => ({
          requirement_id,
          category,
          priority,
          statement,
          evidence_signals,
        }),
      ),
    },
    requirements,
  };
};

const buildEvidence = (
  requirements: readonly InterviewRequirement[],
  resumeText: string,
): InterviewEvidence[] => {
  const resumeLower = resumeText.toLowerCase();
  return requirements.map((requirement, index) => {
    const matchedSignals = requirement.evidence_signals.filter(
      (signal) =>
        signal !== "人工核验" && resumeLower.includes(signal.toLowerCase()),
    );
    const support: InterviewEvidenceSupport =
      matchedSignals.length > 0 ? "direct" : "unknown";
    const kind: InterviewEvidenceKind =
      support === "direct" ? "skill" : "unknown";
    return {
      schema_version: "1.0",
      sensitivity: "sensitive",
      evidence_id: `evidence-local-${index + 1}`,
      source: "resume",
      kind,
      summary:
        support === "direct"
          ? paragraph(
              `简历文本中发现对应信号：${matchedSignals.join("、")}`,
              "简历文本中发现可核验的对应信号。",
            )
          : "当前简历文本未提供可确认的对应证据，需要面试核验。",
      requirement_ids: [requirement.requirement_id],
      support,
    };
  });
};

export const parseInterviewTextImport = (
  candidate: unknown,
): InterviewTextImportResult => {
  const input = validateInterviewTextImport(candidate);
  if (
    protectedAttributePattern.test(`${input.resume_text}\n${input.jd_text}`)
  ) {
    throw new InterviewImportError("protected-attribute");
  }
  const warnings = new Set<InterviewImportWarning>();
  const resumeLines = normalizeText(input.resume_text, warnings);
  const jdLines = normalizeText(input.jd_text, warnings);
  if (resumeLines.length === 0 || jdLines.length === 0) {
    throw new InterviewImportError("insufficient-content");
  }
  const resume = buildResume(resumeLines, input.resume_text, warnings);
  const { jd, requirements } = buildJob(jdLines, input.jd_text, warnings);
  const evidence = buildEvidence(requirements, input.resume_text);
  const bundle = validateInterviewInputBundle({
    resume,
    jd,
    requirements,
    evidence,
  });
  return { input, bundle, warnings: [...warnings] };
};
