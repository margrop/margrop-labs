import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import {
  type AllowedFieldMap,
  SanitizationError,
  sanitizeAllowedFields,
} from "@margrop-labs/redaction";

import eventSchema from "../../../../schemas/token-forge-event-v1.schema.json";
import {
  type TokenForgeInput,
  validateTokenForgeInput,
} from "./token-forge-contracts";

export type TokenForgeFormValues = {
  token_budget: string;
  expires_in_days: string;
  available_hours: string;
  tech_stack: string;
  goal: string;
};

export const tokenForgeSyntheticFormValues: Readonly<TokenForgeFormValues> =
  Object.freeze({
    token_budget: "24000",
    expires_in_days: "7",
    available_hours: "12",
    tech_stack: "TypeScript, Astro, Vitest",
    goal: "为一篇技术文章实现一个无需登录、无需 AI、可以本地导出的互动工具",
  });

export type TokenForgeFormErrorCode =
  | "invalid_token_budget"
  | "invalid_expiry"
  | "invalid_hours"
  | "invalid_stack"
  | "invalid_goal"
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
    return validateTokenForgeInput(sanitized);
  } catch {
    throw new TokenForgeFormError("invalid_goal");
  }
};

export const tokenForgeEventNames = [
  "lab_open",
  "run_success",
  "run_failure",
  "export",
  "blog_click",
  "github_click",
] as const;

export type TokenForgeEventName = (typeof tokenForgeEventNames)[number];
export type TokenForgeDeviceCategory =
  "mobile" | "tablet" | "desktop" | "unknown";

export type TokenForgeEvent = {
  schema_version: "1.0";
  event_name: TokenForgeEventName;
  lab_id: "token-forge";
  lab_version: "1.0";
  device_category: TokenForgeDeviceCategory;
};

export class TokenForgeEventError extends Error {
  override name = "TokenForgeEventError";

  constructor() {
    super("Token Forge event did not match the minimal analytics contract.");
  }
}

const eventPolicy = {
  schema_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  event_name: {
    required: true,
    rule: { type: "enum", values: tokenForgeEventNames },
  },
  lab_id: {
    required: true,
    rule: { type: "enum", values: ["token-forge"] },
  },
  lab_version: {
    required: true,
    rule: { type: "enum", values: ["1.0"] },
  },
  device_category: {
    required: true,
    rule: {
      type: "enum",
      values: ["mobile", "tablet", "desktop", "unknown"],
    },
  },
} as const satisfies AllowedFieldMap;

const eventAjv = new Ajv2020({
  allErrors: true,
  strict: true,
});
const validateEventSchema: ValidateFunction<TokenForgeEvent> = eventAjv.compile(
  eventSchema as AnySchema,
);

export const validateTokenForgeEvent = (
  candidate: unknown,
): TokenForgeEvent => {
  let sanitized: unknown;
  try {
    sanitized = sanitizeAllowedFields(candidate, eventPolicy).value;
  } catch {
    throw new TokenForgeEventError();
  }

  if (!validateEventSchema(sanitized)) {
    throw new TokenForgeEventError();
  }
  return sanitized as TokenForgeEvent;
};

export const classifyTokenForgeDevice = (
  width: unknown,
): TokenForgeDeviceCategory => {
  if (typeof width !== "number" || !Number.isFinite(width) || width < 0) {
    return "unknown";
  }
  if (width < 768) {
    return "mobile";
  }
  if (width < 1_024) {
    return "tablet";
  }
  return "desktop";
};

export type TokenForgeEventSink = (event: TokenForgeEvent) => void;

export const emitTokenForgeEvent = (
  eventName: TokenForgeEventName,
  deviceCategory: TokenForgeDeviceCategory,
  sink: TokenForgeEventSink = () => undefined,
): TokenForgeEvent => {
  const event = validateTokenForgeEvent({
    schema_version: "1.0",
    event_name: eventName,
    lab_id: "token-forge",
    lab_version: "1.0",
    device_category: deviceCategory,
  });

  try {
    sink(event);
  } catch {
    // Analytics must never interrupt the local Lab flow.
  }
  return event;
};
