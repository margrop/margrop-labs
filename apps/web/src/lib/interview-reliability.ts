import {
  type InterviewInputBundle,
  validateInterviewInputBundle,
} from "./interview-contracts";

export type InterviewReliabilityScenario = Readonly<{
  id: string;
  label: string;
  bundle: InterviewInputBundle;
}>;

export const interviewReliabilityPrivacySinks = [
  "ai_request_boundary",
  "browser_url",
  "analytics_payload",
  "safe_markdown_export",
  "error_or_log_text",
] as const;

export type InterviewReliabilityPrivacySink =
  (typeof interviewReliabilityPrivacySinks)[number];

export const interviewReliabilityFailureMatrix = [
  {
    id: "network_unavailable",
    source: "fetch / Provider",
    fallback: "deterministic result",
  },
  {
    id: "provider_timeout",
    source: "gateway timeout",
    fallback: "deterministic result",
  },
  {
    id: "provider_5xx",
    source: "Provider 5xx",
    fallback: "fallback model, then deterministic result",
  },
  {
    id: "rate_limited",
    source: "rate/concurrency/circuit admission",
    fallback: "deterministic result",
  },
  {
    id: "budget_exhausted",
    source: "AI policy budget",
    fallback: "deterministic result",
  },
  {
    id: "invalid_provider_json",
    source: "Provider response parse",
    fallback: "fallback model, then deterministic result",
  },
  {
    id: "schema_invalid",
    source: "operation output contract",
    fallback: "fallback model, then deterministic result",
  },
  {
    id: "output_too_large",
    source: "token/response size guard",
    fallback: "deterministic result",
  },
  {
    id: "policy_blocked",
    source: "secret/protected-text guard",
    fallback: "deterministic result",
  },
] as const;

type ScenarioSpec = Readonly<{
  id: string;
  label: string;
  roleTitle: string;
  level: InterviewInputBundle["jd"]["level"];
  responsibilities: [string, string];
  headline: string;
  skills: string[];
  experiences: [
    Readonly<{
      role: string;
      domain: string;
      technologies: string[];
      ownership: string;
      scale: string;
    }>,
    Readonly<{
      role: string;
      domain: string;
      technologies: string[];
      ownership: string;
      scale: string;
    }>,
  ];
  requirements: [
    Readonly<{ statement: string; evidence_signals: string[] }>,
    Readonly<{ statement: string; evidence_signals: string[] }>,
    Readonly<{ statement: string; evidence_signals: string[] }>,
    Readonly<{ statement: string; evidence_signals: string[] }>,
  ];
  evidenceSummary: string;
}>;

const scenarioSpecs: readonly ScenarioSpec[] = [
  {
    id: "cloud-platform",
    label: "云平台",
    roleTitle: "云端机器人平台工程师",
    level: "senior",
    responsibilities: [
      "设计云端机器人系统的任务、状态和报告服务。",
      "与产品、机器人和测试团队协作，持续提升稳定性、性能和可扩展性。",
    ],
    headline: "云平台与机器人系统工程师",
    skills: [
      "Java",
      "Go",
      "Spring",
      "Kafka",
      "MySQL",
      "Kubernetes",
      "Prometheus",
    ],
    experiences: [
      {
        role: "云平台工程师",
        domain: "机器人云服务",
        technologies: ["Java", "Go", "Kafka", "Kubernetes"],
        ownership: "平台服务与接口稳定性",
        scale: "多租户机器人任务系统",
      },
      {
        role: "可观测性项目负责人",
        domain: "平台可靠性",
        technologies: ["Prometheus", "Grafana", "Loki", "Docker"],
        ownership: "监控规范与排障流程",
        scale: "多环境服务与基础设施",
      },
    ],
    requirements: [
      {
        statement: "能够使用 Java、Go 或 Python 之一交付可靠的服务端代码。",
        evidence_signals: ["线上服务代码", "语言生态实践", "测试与工程习惯"],
      },
      {
        statement: "理解 HTTP、TCP/IP、消息系统和服务稳定性设计。",
        evidence_signals: ["协议排障", "重试与幂等", "消息或服务治理"],
      },
      {
        statement: "有机器人云平台或类似设备云服务的系统设计经验。",
        evidence_signals: ["设备状态", "任务调度", "云端控制链路"],
      },
      {
        statement: "能够与产品、研发和测试团队共同澄清问题并交付结果。",
        evidence_signals: ["跨团队项目", "技术文档", "冲突与取舍"],
      },
    ],
    evidenceSummary: "合成平台经历明确提到服务交付、任务调度和可验证结果。",
  },
  {
    id: "frontend-product",
    label: "前端产品",
    roleTitle: "面向用户的前端产品工程师",
    level: "senior",
    responsibilities: [
      "负责面向用户的 Web 产品交互、性能和可访问性建设。",
      "与产品、设计和后端团队协作，持续验证体验和业务指标。",
    ],
    headline: "Web 产品与体验工程师",
    skills: [
      "TypeScript",
      "React",
      "Node.js",
      "Vite",
      "Playwright",
      "Web Performance",
    ],
    experiences: [
      {
        role: "前端产品工程师",
        domain: "用户增长与工作台",
        technologies: ["TypeScript", "React", "Vite", "Playwright"],
        ownership: "组件系统与关键路径体验",
        scale: "多端用户工作台",
      },
      {
        role: "体验可靠性负责人",
        domain: "Web 可观测性",
        technologies: ["Node.js", "Web Vitals", "Grafana", "Docker"],
        ownership: "性能预算与回归流程",
        scale: "多浏览器和多地区访问",
      },
    ],
    requirements: [
      {
        statement:
          "能够使用 TypeScript、React 或 Node.js 之一交付可靠的 Web 产品。",
        evidence_signals: ["组件与页面代码", "端到端测试", "可访问性实践"],
      },
      {
        statement: "理解浏览器性能、HTTP 和前端可观测性设计。",
        evidence_signals: ["性能预算", "网络排障", "Web 指标"],
      },
      {
        statement: "有面向用户的 Web 产品或复杂工作台交付经验。",
        evidence_signals: ["用户流程", "交互状态", "渐进增强"],
      },
      {
        statement: "能够与产品、设计和后端团队共同澄清问题并交付结果。",
        evidence_signals: ["跨团队项目", "设计评审", "冲突与取舍"],
      },
    ],
    evidenceSummary: "合成产品经历明确提到组件、性能和用户工作台交付。",
  },
  {
    id: "data-platform",
    label: "数据平台",
    roleTitle: "数据平台与分析工程师",
    level: "senior",
    responsibilities: [
      "设计批流一体的数据管道、质量检查和服务接口。",
      "与分析、业务和基础设施团队协作，持续提升数据可用性和稳定性。",
    ],
    headline: "数据平台与分析系统工程师",
    skills: [
      "Python",
      "SQL",
      "Spark",
      "Kafka",
      "Airflow",
      "Kubernetes",
      "Prometheus",
    ],
    experiences: [
      {
        role: "数据平台工程师",
        domain: "批流数据服务",
        technologies: ["Python", "SQL", "Spark", "Kafka"],
        ownership: "数据管道与质量校验",
        scale: "多租户分析数据集",
      },
      {
        role: "数据可靠性负责人",
        domain: "数据质量与可观测性",
        technologies: ["Airflow", "Prometheus", "Grafana", "Docker"],
        ownership: "数据 SLA 与故障复盘",
        scale: "跨区域批流任务",
      },
    ],
    requirements: [
      {
        statement: "能够使用 Python、SQL 或 Scala 之一交付可靠的数据服务。",
        evidence_signals: ["数据管道代码", "查询与建模实践", "测试与工程习惯"],
      },
      {
        statement: "理解数据管道、批流处理和服务稳定性设计。",
        evidence_signals: ["数据质量", "重跑与幂等", "任务或服务治理"],
      },
      {
        statement: "有数据平台或分析系统的系统设计经验。",
        evidence_signals: ["数据建模", "指标口径", "数据服务链路"],
      },
      {
        statement: "能够与分析、业务和基础设施团队共同澄清问题并交付结果。",
        evidence_signals: ["跨团队项目", "口径文档", "冲突与取舍"],
      },
    ],
    evidenceSummary: "合成数据经历明确提到管道交付、质量校验和可验证结果。",
  },
];

const buildScenarioBundle = (
  base: InterviewInputBundle,
  spec: ScenarioSpec,
): InterviewInputBundle => {
  const requirementIds = new Map(
    base.requirements.map((requirement, index) => [
      requirement.requirement_id,
      `requirement-${spec.id}-${index + 1}`,
    ]),
  );
  const requirements = base.requirements.map((requirement, index) => {
    const requirementSpec = spec.requirements[index] ?? spec.requirements[0];
    return {
      ...requirement,
      requirement_id: requirementIds.get(requirement.requirement_id) as string,
      statement: requirementSpec.statement,
      evidence_signals: [...requirementSpec.evidence_signals],
    };
  });
  const jdRequirements = base.jd.requirements.map((requirement, index) => {
    const requirementSpec = spec.requirements[index] ?? spec.requirements[0];
    return {
      ...requirement,
      requirement_id: requirementIds.get(requirement.requirement_id) as string,
      statement: requirementSpec.statement,
      evidence_signals: [...requirementSpec.evidence_signals],
    };
  });
  const resume = {
    ...base.resume,
    resume_id: `resume-${spec.id}`,
    headline: spec.headline,
    skills: [...spec.skills],
    experiences: base.resume.experiences.map((experience, index) => {
      const experienceSpec = spec.experiences[index] ?? spec.experiences[0];
      return {
        ...experience,
        experience_id: `experience-${spec.id}-${index + 1}`,
        role: experienceSpec.role,
        domain: experienceSpec.domain,
        technologies: [...experienceSpec.technologies],
        scope: {
          ...experience.scope,
          ownership: experienceSpec.ownership,
          scale: experienceSpec.scale,
        },
      };
    }),
  };
  const jd = {
    ...base.jd,
    jd_id: `jd-${spec.id}`,
    role_title: spec.roleTitle,
    level: spec.level,
    responsibilities: [...spec.responsibilities],
    requirements: jdRequirements,
  };
  const evidence = base.evidence.map((item, index) => ({
    ...item,
    evidence_id: `evidence-${spec.id}-${index + 1}`,
    summary: spec.evidenceSummary,
    requirement_ids: item.requirement_ids.map(
      (id) => requirementIds.get(id) ?? id,
    ),
  }));
  return validateInterviewInputBundle({ resume, jd, requirements, evidence });
};

export const buildInterviewReliabilityCorpus = (
  base: InterviewInputBundle,
): readonly InterviewReliabilityScenario[] => {
  const validatedBase = validateInterviewInputBundle(base);
  return scenarioSpecs.map((spec) => ({
    id: spec.id,
    label: spec.label,
    bundle: buildScenarioBundle(validatedBase, spec),
  }));
};
