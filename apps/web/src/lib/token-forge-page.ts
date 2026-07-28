import {
  type AllowedFieldMap,
  SanitizationError,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import {
  type TokenForgeInput,
  validateTokenForgeInput,
} from "./token-forge-contracts";
import {
  GitHubPublicRepositoryError,
  parsePublicGitHubRepositoryUrl,
} from "./github-public-repository";

export type TokenForgeFormValues = {
  token_budget: string;
  expires_in_days: string;
  available_hours: string;
  tech_stack: string;
  goal: string;
  repository_url: string;
};

export const tokenForgeSyntheticFormValues: Readonly<TokenForgeFormValues> =
  Object.freeze({
    token_budget: "24000",
    expires_in_days: "7",
    available_hours: "12",
    tech_stack: "TypeScript, Astro, Vitest",
    goal: "为一篇技术文章实现一个无需登录、无需 AI、可以本地导出的互动工具",
    repository_url: "",
  });

export type TokenForgeFormErrorCode =
  | "invalid_token_budget"
  | "invalid_expiry"
  | "invalid_hours"
  | "invalid_stack"
  | "invalid_goal"
  | "invalid_repository_url"
  | "sensitive_input";

export const tokenForgeFormErrorMessages: Record<
  TokenForgeFormErrorCode,
  string
> = {
  invalid_token_budget: "可用 Token 必须是 2,000–60,000 之间的整数。",
  invalid_expiry: "到期时间必须是 1–30 天之间的整数。",
  invalid_hours: "可投入时间必须是 1–80 小时，并以 0.5 小时为步长。",
  invalid_stack: "请提供 1–8 个技术栈，用逗号或换行分隔。",
  invalid_goal: "目标需要包含 10–500 个字符。",
  invalid_repository_url:
    "仓库地址必须是规范的公开 GitHub HTTPS 地址，例如 https://github.com/owner/repository。",
  sensitive_input: "检测到 Token、Cookie 或 Authorization，请移除后重试。",
};

export class TokenForgeFormError extends Error {
  override name = "TokenForgeFormError";

  constructor(readonly code: TokenForgeFormErrorCode) {
    super(tokenForgeFormErrorMessages[code]);
  }
}

const parseNumber = (value: string, code: TokenForgeFormErrorCode): number => {
  if (value.trim().length === 0) {
    throw new TokenForgeFormError(code);
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TokenForgeFormError(code);
  }
  return parsed;
};

const parseTechStack = (value: string): string[] => {
  const stack = [
    ...new Set(
      value
        .split(/[,，;\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];

  if (stack.length < 1 || stack.length > 8) {
    throw new TokenForgeFormError("invalid_stack");
  }
  return stack;
};

const pageInputPolicy = {
  schema_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  token_budget: {
    required: true,
    rule: {
      type: "number",
      integer: true,
      minimum: 2_000,
      maximum: 60_000,
    },
  },
  expires_in_days: {
    required: true,
    rule: {
      type: "number",
      integer: true,
      minimum: 1,
      maximum: 30,
    },
  },
  available_hours: {
    required: true,
    rule: { type: "number", minimum: 1, maximum: 80 },
  },
  tech_stack: {
    required: true,
    rule: {
      type: "array",
      maxItems: 8,
      items: { type: "text", maxLength: 80 },
    },
  },
  goal: {
    required: true,
    rule: { type: "text", maxLength: 500 },
  },
} as const satisfies AllowedFieldMap;

export const buildTokenForgeInputFromForm = (
  candidate: TokenForgeFormValues,
): TokenForgeInput => {
  const tokenBudget = parseNumber(
    candidate.token_budget,
    "invalid_token_budget",
  );
  if (
    !Number.isInteger(tokenBudget) ||
    tokenBudget < 2_000 ||
    tokenBudget > 60_000
  ) {
    throw new TokenForgeFormError("invalid_token_budget");
  }

  const expiresInDays = parseNumber(
    candidate.expires_in_days,
    "invalid_expiry",
  );
  if (
    !Number.isInteger(expiresInDays) ||
    expiresInDays < 1 ||
    expiresInDays > 30
  ) {
    throw new TokenForgeFormError("invalid_expiry");
  }

  const availableHours = parseNumber(
    candidate.available_hours,
    "invalid_hours",
  );
  if (
    availableHours < 1 ||
    availableHours > 80 ||
    !Number.isInteger(availableHours * 2)
  ) {
    throw new TokenForgeFormError("invalid_hours");
  }

  const techStack = parseTechStack(candidate.tech_stack);
  const goal = candidate.goal.trim();
  if (goal.length < 10 || goal.length > 500) {
    throw new TokenForgeFormError("invalid_goal");
  }

  const repositoryUrl = candidate.repository_url.trim();
  let normalizedRepositoryUrl: string | undefined;
  if (repositoryUrl.length > 0) {
    if (repositoryUrl.length > 200) {
      throw new TokenForgeFormError("invalid_repository_url");
    }

    try {
      const { owner, name } = parsePublicGitHubRepositoryUrl(repositoryUrl);
      normalizedRepositoryUrl = `https://github.com/${owner}/${name}`;
    } catch (error) {
      if (error instanceof GitHubPublicRepositoryError) {
        throw new TokenForgeFormError("invalid_repository_url");
      }
      throw error;
    }
  }

  let sanitized: unknown;
  try {
    sanitized = sanitizeAllowedFields(
      {
        schema_version: "1.0",
        token_budget: tokenBudget,
        expires_in_days: expiresInDays,
        available_hours: availableHours,
        tech_stack: techStack,
        goal,
      },
      pageInputPolicy,
    ).value;
  } catch (error) {
    if (
      error instanceof SanitizationError &&
      error.code === "sensitive-input"
    ) {
      throw new TokenForgeFormError("sensitive_input");
    }
    throw new TokenForgeFormError("invalid_goal");
  }

  try {
    return validateTokenForgeInput({
      ...(sanitized as Record<string, unknown>),
      ...(normalizedRepositoryUrl === undefined
        ? {}
        : { repository_url: normalizedRepositoryUrl }),
    });
  } catch {
    throw new TokenForgeFormError("invalid_goal");
  }
};

export {
  TokenForgeEventError,
  classifyTokenForgeDevice,
  emitTokenForgeEvent,
  sendTokenForgeEvent,
  tokenForgeAnalyticsEndpointPath,
  tokenForgeEventNames,
  validateTokenForgeEvent,
} from "./token-forge-analytics";
export type {
  TokenForgeDeviceCategory,
  TokenForgeEvent,
  TokenForgeEventFetch,
  TokenForgeEventName,
  TokenForgeEventSink,
} from "./token-forge-analytics";
