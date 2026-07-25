export const redactionKinds = [
  "authorization",
  "cookie",
  "token",
  "email",
  "ip",
  "domain",
  "serial-number",
  "wwn",
] as const;

export type RedactionKind = (typeof redactionKinds)[number];

export type SanitizedJsonValue =
  null | boolean | number | string | SanitizedJsonValue[] | SanitizedJsonObject;

export interface SanitizedJsonObject {
  [key: string]: SanitizedJsonValue;
}

export type SanitizationRule =
  | {
      type: "text";
      maxLength: number;
    }
  | {
      type: "number";
      integer?: boolean;
      minimum?: number;
      maximum?: number;
    }
  | {
      type: "boolean";
    }
  | {
      type: "enum";
      values: readonly string[];
    }
  | {
      type: "array";
      items: SanitizationRule;
      maxItems: number;
    }
  | {
      type: "object";
      fields: AllowedFieldMap;
    };

export type AllowedFieldMap = Readonly<
  Record<
    string,
    {
      rule: SanitizationRule;
      required?: boolean;
    }
  >
>;

export type RedactionCounts = Readonly<Partial<Record<RedactionKind, number>>>;

export type RedactionReport = Readonly<{
  total: number;
  counts: RedactionCounts;
}>;

export type RedactedText = Readonly<{
  text: string;
  report: RedactionReport;
}>;

export type SanitizedObject = Readonly<{
  value: SanitizedJsonObject;
  report: RedactionReport;
}>;

export type SanitizationOptions = Readonly<{
  rejectKinds?: readonly RedactionKind[];
}>;

export class SanitizationError extends Error {
  readonly code: "invalid-input" | "sensitive-input";
  readonly path: string;
  readonly kinds: readonly RedactionKind[];

  constructor(
    code: SanitizationError["code"],
    path: string,
    kinds: readonly RedactionKind[] = [],
  ) {
    super(
      code === "sensitive-input"
        ? `Sensitive input was rejected at ${path}.`
        : `Input did not satisfy the sanitization policy at ${path}.`,
    );
    this.name = "SanitizationError";
    this.code = code;
    this.path = path;
    this.kinds = [...kinds];
  }
}

const placeholders: Readonly<Record<RedactionKind, string>> = {
  authorization: "[REDACTED:AUTHORIZATION]",
  cookie: "[REDACTED:COOKIE]",
  token: "[REDACTED:TOKEN]",
  email: "[REDACTED:EMAIL]",
  ip: "[REDACTED:IP]",
  domain: "[REDACTED:DOMAIN]",
  "serial-number": "[REDACTED:SERIAL_NUMBER]",
  wwn: "[REDACTED:WWN]",
};

const defaultRejectedKinds: readonly RedactionKind[] = [
  "authorization",
  "cookie",
  "token",
];

const publicTopLevelDomains = new Set([
  "ai",
  "app",
  "cloud",
  "cn",
  "co",
  "com",
  "dev",
  "io",
  "me",
  "net",
  "online",
  "org",
  "site",
  "tech",
  "top",
  "xyz",
]);

const fileLikeSuffixes = new Set([
  "astro",
  "conf",
  "config",
  "css",
  "go",
  "html",
  "java",
  "js",
  "json",
  "log",
  "md",
  "mjs",
  "py",
  "sh",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
]);

type MutableCounts = Partial<Record<RedactionKind, number>>;

const increment = (counts: MutableCounts, kind: RedactionKind): void => {
  counts[kind] = (counts[kind] ?? 0) + 1;
};

const isPlaceholder = (value: string): boolean =>
  /^\[REDACTED:[A-Z_]+\]$/.test(value);

const buildReport = (counts: MutableCounts): RedactionReport => {
  const normalized: Partial<Record<RedactionKind, number>> = {};
  let total = 0;

  for (const kind of redactionKinds) {
    const count = counts[kind];
    if (count !== undefined && count > 0) {
      normalized[kind] = count;
      total += count;
    }
  }

  return {
    total,
    counts: normalized,
  };
};

const replaceCapturedValue = (
  input: string,
  pattern: RegExp,
  kind: RedactionKind,
  counts: MutableCounts,
): string =>
  input.replace(
    pattern,
    (
      match: string,
      prefix: string,
      label: string,
      separator: string,
      rawValue: string,
    ) => {
      if (isPlaceholder(rawValue)) {
        return match;
      }

      increment(counts, kind);
      return `${prefix}${label}${separator}${placeholders[kind]}`;
    },
  );

const redactHeaderValues = (input: string, counts: MutableCounts): string => {
  let redacted = input.replace(
    /(^|[\r\n])([ \t]*authorization[ \t]*:[ \t]*)([^\r\n]+)/gi,
    (match: string, lineStart: string, label: string, rawValue: string) => {
      if (isPlaceholder(rawValue.trim())) {
        return match;
      }

      increment(counts, "authorization");
      return `${lineStart}${label}${placeholders.authorization}`;
    },
  );

  redacted = redacted.replace(
    /(^|[\r\n])([ \t]*(?:set-cookie|cookie)[ \t]*:[ \t]*)([^\r\n]+)/gi,
    (match: string, lineStart: string, label: string, rawValue: string) => {
      if (isPlaceholder(rawValue.trim())) {
        return match;
      }

      increment(counts, "cookie");
      return `${lineStart}${label}${placeholders.cookie}`;
    },
  );

  return redacted;
};

const redactLabelledSecrets = (
  input: string,
  counts: MutableCounts,
): string => {
  let redacted = replaceCapturedValue(
    input,
    /(^|[^A-Za-z0-9_-])((?:authorization))(\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    "authorization",
    counts,
  );

  redacted = replaceCapturedValue(
    redacted,
    /(^|[^A-Za-z0-9_-])((?:set[-_]?cookie|cookie))(\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    "cookie",
    counts,
  );

  redacted = replaceCapturedValue(
    redacted,
    /(^|[^A-Za-z0-9_-])((?:api[-_]?key|access[-_]?token|refresh[-_]?token|auth[-_]?token|id[-_]?token|client[-_]?secret|password|token))(\s*[:=]\s*)("[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi,
    "token",
    counts,
  );

  redacted = redacted.replace(
    /\bBearer[ \t]+[A-Za-z0-9._~+/=-]{8,}\b/gi,
    (match: string) => {
      if (isPlaceholder(match)) {
        return match;
      }

      increment(counts, "authorization");
      return placeholders.authorization;
    },
  );

  redacted = redacted.replace(
    /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    () => {
      increment(counts, "token");
      return placeholders.token;
    },
  );

  return redacted;
};

const redactLabelledHardwareIds = (
  input: string,
  counts: MutableCounts,
): string => {
  let redacted = input.replace(
    /(^|[^A-Za-z0-9_-])((?:wwn|world[ \t]+wide[ \t]+name))(\s*[:=]\s*)((?:0x)?[A-Fa-f0-9][A-Fa-f0-9 :.-]{6,}[A-Fa-f0-9])/gi,
    (
      match: string,
      prefix: string,
      label: string,
      separator: string,
      rawValue: string,
    ) => {
      const hexDigits = rawValue.replace(/[^A-Fa-f0-9]/g, "");
      if (isPlaceholder(rawValue) || hexDigits.length < 16) {
        return match;
      }

      increment(counts, "wwn");
      return `${prefix}${label}${separator}${placeholders.wwn}`;
    },
  );

  redacted = redacted.replace(
    /(^|[^A-Za-z0-9_-])((?:serial(?:[ \t_-]+number)?|s\/n|sn))(\s*[:=]\s*)([A-Za-z0-9][A-Za-z0-9._-]{3,})/gi,
    (
      match: string,
      prefix: string,
      label: string,
      separator: string,
      rawValue: string,
    ) => {
      if (isPlaceholder(rawValue)) {
        return match;
      }

      increment(counts, "serial-number");
      return `${prefix}${label}${separator}${placeholders["serial-number"]}`;
    },
  );

  return redacted;
};

const redactEmails = (input: string, counts: MutableCounts): string =>
  input.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi, () => {
    increment(counts, "email");
    return placeholders.email;
  });

const isValidIpv4 = (candidate: string): boolean => {
  const octets = candidate.split(".");
  return (
    octets.length === 4 &&
    octets.every(
      (octet) =>
        /^\d{1,3}$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255,
    )
  );
};

const isValidIpv6 = (candidate: string): boolean => {
  if (
    candidate.length < 2 ||
    !candidate.includes(":") ||
    !/^[A-Fa-f0-9:]+$/.test(candidate) ||
    candidate.includes(":::") ||
    (candidate.match(/::/g)?.length ?? 0) > 1
  ) {
    return false;
  }

  const hasCompression = candidate.includes("::");
  const segments = candidate.split(":");
  const populatedSegments = segments.filter((segment) => segment.length > 0);

  if (
    populatedSegments.some(
      (segment) => segment.length > 4 || !/^[A-Fa-f0-9]+$/.test(segment),
    )
  ) {
    return false;
  }

  return hasCompression
    ? populatedSegments.length < 8
    : populatedSegments.length === 8;
};

const redactIpAddresses = (input: string, counts: MutableCounts): string => {
  let redacted = input.replace(
    /(^|[^0-9])((?:\d{1,3}\.){3}\d{1,3})(?=$|[^0-9])/g,
    (match: string, prefix: string, candidate: string) => {
      if (!isValidIpv4(candidate)) {
        return match;
      }

      increment(counts, "ip");
      return `${prefix}${placeholders.ip}`;
    },
  );

  redacted = redacted.replace(
    /(^|[^A-Fa-f0-9:])([A-Fa-f0-9:]*:[A-Fa-f0-9:]+)(?=$|[^A-Fa-f0-9:])/g,
    (match: string, prefix: string, candidate: string) => {
      if (!isValidIpv6(candidate)) {
        return match;
      }

      increment(counts, "ip");
      return `${prefix}${placeholders.ip}`;
    },
  );

  return redacted;
};

const domainLabels = (candidate: string): string[] | undefined => {
  const normalized = candidate.toLowerCase().replace(/\.$/, "");
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes("..")
  ) {
    return undefined;
  }

  const labels = normalized.split(".");
  if (
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/.test(label),
    )
  ) {
    return undefined;
  }

  return labels;
};

const isValidDomain = (candidate: string): boolean => {
  const labels = domainLabels(candidate);
  return labels !== undefined && labels.length >= 2;
};

const isValidLabelledHost = (candidate: string): boolean =>
  domainLabels(candidate) !== undefined;

const isLikelyDomain = (candidate: string): boolean => {
  const labels = domainLabels(candidate);
  if (labels === undefined || labels.length < 2) {
    return false;
  }

  const suffix = labels.at(-1);
  if (suffix === undefined || fileLikeSuffixes.has(suffix)) {
    return false;
  }

  return (
    suffix.length === 2 ||
    publicTopLevelDomains.has(suffix) ||
    labels.length >= 3
  );
};

const redactDomains = (input: string, counts: MutableCounts): string => {
  let redacted = input.replace(
    /\b(https?:\/\/)([A-Za-z0-9.-]+)(:\d{1,5})?/gi,
    (
      match: string,
      scheme: string,
      candidate: string,
      port: string | undefined,
    ) => {
      if (!isValidDomain(candidate)) {
        return match;
      }

      increment(counts, "domain");
      return `${scheme}${placeholders.domain}${port ?? ""}`;
    },
  );

  redacted = redacted.replace(
    /(^|[^A-Za-z0-9_-])((?:domain|hostname|host|server))(\s*[:=]\s*)([A-Za-z0-9.-]+)/gi,
    (
      match: string,
      prefix: string,
      label: string,
      separator: string,
      candidate: string,
    ) => {
      if (!isValidLabelledHost(candidate)) {
        return match;
      }

      increment(counts, "domain");
      return `${prefix}${label}${separator}${placeholders.domain}`;
    },
  );

  redacted = redacted.replace(
    /(^|[^A-Za-z0-9_@/-])((?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24})(?=$|[^A-Za-z0-9_-])/gi,
    (match: string, prefix: string, candidate: string) => {
      if (!isLikelyDomain(candidate)) {
        return match;
      }

      increment(counts, "domain");
      return `${prefix}${placeholders.domain}`;
    },
  );

  return redacted;
};

const redactTextIntoCounts = (input: string, counts: MutableCounts): string => {
  let redacted = redactHeaderValues(input, counts);
  redacted = redactLabelledSecrets(redacted, counts);
  redacted = redactLabelledHardwareIds(redacted, counts);
  redacted = redactEmails(redacted, counts);
  redacted = redactIpAddresses(redacted, counts);
  redacted = redactDomains(redacted, counts);
  return redacted;
};

export const redactTextWithReport = (input: string): RedactedText => {
  const counts: MutableCounts = {};
  return {
    text: redactTextIntoCounts(input, counts),
    report: buildReport(counts),
  };
};

export const redactText = (input: string): string =>
  redactTextWithReport(input).text;

const isRecord = (candidate: unknown): candidate is Record<string, unknown> =>
  typeof candidate === "object" &&
  candidate !== null &&
  !Array.isArray(candidate);

type SanitizationContext = {
  counts: MutableCounts;
  rejectedKinds: ReadonlySet<RedactionKind>;
};

const assertNoRejectedKinds = (
  report: RedactionReport,
  context: SanitizationContext,
  path: string,
): void => {
  const rejected = redactionKinds.filter(
    (kind) => context.rejectedKinds.has(kind) && (report.counts[kind] ?? 0) > 0,
  );

  if (rejected.length > 0) {
    throw new SanitizationError("sensitive-input", path, rejected);
  }
};

const sanitizeRule = (
  candidate: unknown,
  rule: SanitizationRule,
  path: string,
  context: SanitizationContext,
): SanitizedJsonValue => {
  switch (rule.type) {
    case "text": {
      if (typeof candidate !== "string" || candidate.length > rule.maxLength) {
        throw new SanitizationError("invalid-input", path);
      }

      const result = redactTextWithReport(candidate);
      assertNoRejectedKinds(result.report, context, path);
      for (const kind of redactionKinds) {
        const count = result.report.counts[kind];
        if (count !== undefined) {
          context.counts[kind] = (context.counts[kind] ?? 0) + count;
        }
      }
      return result.text;
    }

    case "number":
      if (
        typeof candidate !== "number" ||
        !Number.isFinite(candidate) ||
        (rule.integer === true && !Number.isInteger(candidate)) ||
        (rule.minimum !== undefined && candidate < rule.minimum) ||
        (rule.maximum !== undefined && candidate > rule.maximum)
      ) {
        throw new SanitizationError("invalid-input", path);
      }
      return candidate;

    case "boolean":
      if (typeof candidate !== "boolean") {
        throw new SanitizationError("invalid-input", path);
      }
      return candidate;

    case "enum":
      if (typeof candidate !== "string" || !rule.values.includes(candidate)) {
        throw new SanitizationError("invalid-input", path);
      }
      return candidate;

    case "array":
      if (!Array.isArray(candidate) || candidate.length > rule.maxItems) {
        throw new SanitizationError("invalid-input", path);
      }
      return candidate.map((item, index) =>
        sanitizeRule(item, rule.items, `${path}[${index}]`, context),
      );

    case "object":
      if (!isRecord(candidate)) {
        throw new SanitizationError("invalid-input", path);
      }
      return sanitizeObject(candidate, rule.fields, path, context);
  }
};

const sanitizeObject = (
  candidate: Record<string, unknown>,
  fields: AllowedFieldMap,
  path: string,
  context: SanitizationContext,
): SanitizedJsonObject => {
  const result: SanitizedJsonObject = {};

  for (const [field, definition] of Object.entries(fields)) {
    if (
      field === "__proto__" ||
      field === "prototype" ||
      field === "constructor"
    ) {
      throw new SanitizationError("invalid-input", path);
    }

    const value = candidate[field];
    if (value === undefined) {
      if (definition.required === true) {
        throw new SanitizationError("invalid-input", `${path}.${field}`);
      }
      continue;
    }

    result[field] = sanitizeRule(
      value,
      definition.rule,
      `${path}.${field}`,
      context,
    );
  }

  return result;
};

export const sanitizeAllowedFields = (
  candidate: unknown,
  fields: AllowedFieldMap,
  options: SanitizationOptions = {},
): SanitizedObject => {
  if (!isRecord(candidate)) {
    throw new SanitizationError("invalid-input", "input");
  }

  const context: SanitizationContext = {
    counts: {},
    rejectedKinds: new Set(options.rejectKinds ?? defaultRejectedKinds),
  };

  return {
    value: sanitizeObject(candidate, fields, "input", context),
    report: buildReport(context.counts),
  };
};
