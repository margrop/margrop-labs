import type { TokenForgeFormValues } from "./token-forge-page";

export type TokenForgeFirstUseSampleId =
  "quick-local" | "standard-public" | "deep-local";

export type TokenForgeFirstUseSample = {
  id: TokenForgeFirstUseSampleId;
  label: string;
  title: string;
  description: string;
  outcome: string;
  repository_mode: "none" | "public-read-only";
  default_mode: "template";
  recommended: boolean;
  form: Readonly<TokenForgeFormValues>;
};

export const tokenForgeFirstUseSamples = [
  {
    id: "quick-local",
    label: "6K · 快速加固",
    title: "先用一个小任务看懂完整闭环",
    description:
      "完全本地，不读取仓库；适合首次体验输入、计划、质量和三种导出。",
    outcome: "1 个 S 任务 · 约 3 小时",
    repository_mode: "none",
    default_mode: "template",
    recommended: true,
    form: {
      token_budget: "6000",
      expires_in_days: "2",
      available_hours: "3",
      tech_stack: "TypeScript, Vitest",
      goal: "为一个已有本地工具补充输入合同、失败状态和自动化测试",
      repository_url: "",
    },
  },
  {
    id: "standard-public",
    label: "24K · 公开仓库切片",
    title: "读取受限公开证据，再生成模板",
    description:
      "只读 Margrop Labs 公开仓库；GitHub 失败时仍保留完整本地模板和导出。",
    outcome: "1 个 M 任务 · 约 8 小时",
    repository_mode: "public-read-only",
    default_mode: "template",
    recommended: false,
    form: {
      token_budget: "24000",
      expires_in_days: "7",
      available_hours: "12",
      tech_stack: "TypeScript, Astro, Preact, Vitest",
      goal: "为公开技术博客实现一个无需登录、无需 AI、可以本地导出的互动工具",
      repository_url: "https://github.com/margrop/margrop-labs",
    },
  },
  {
    id: "deep-local",
    label: "40K · 离线 MVP",
    title: "体验依赖安全的多阶段执行包",
    description: "完全本地，把较大目标拆成合同、核心和合成验收三个依赖阶段。",
    outcome: "3 个 S/M 任务 · 约 15 小时",
    repository_mode: "none",
    default_mode: "template",
    recommended: false,
    form: {
      token_budget: "40000",
      expires_in_days: "14",
      available_hours: "24",
      tech_stack: "Go, Gin, GORM, Docker",
      goal: "为一个公开 API 服务实现无登录、无外部写入且可重复验收的离线诊断 MVP",
      repository_url: "",
    },
  },
] as const satisfies readonly TokenForgeFirstUseSample[];

export const tokenForgeFirstUseSteps = [
  {
    id: "choose",
    order: 1,
    title: "选择样例或填写目标",
    description: "首次体验推荐 6K 完全本地样例，也可以修改任意公开输入。",
  },
  {
    id: "generate",
    order: 2,
    title: "生成并检查计划",
    description: "样例默认只运行确定性模板；AI 增强始终由你显式选择。",
  },
  {
    id: "export",
    order: 3,
    title: "复制或下载",
    description: "从完整计划、Issue 草稿和 Coding Agent 执行包中选择一种导出。",
  },
] as const;

export const getTokenForgeFirstUseSampleForm = (
  id: TokenForgeFirstUseSampleId,
): TokenForgeFormValues => {
  const sample = tokenForgeFirstUseSamples.find(
    (candidate) => candidate.id === id,
  );

  if (!sample) {
    throw new Error("Unknown Token Forge first-use sample.");
  }

  return { ...sample.form };
};
