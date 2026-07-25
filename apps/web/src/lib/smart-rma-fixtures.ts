import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { redactTextWithReport } from "@margrop-labs/redaction";
import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";

import fixtureIndexSchema from "../../../../schemas/smart-rma-fixture-index-v1.schema.json";

export type SmartRmaFixtureProtocol = "ata" | "nvme" | "unknown";
export type SmartRmaExpectedState =
  "healthy" | "warning" | "critical" | "unknown";
export type SmartRmaFixtureCoverage =
  | SmartRmaExpectedState
  | "missing-fields"
  | "vendor-extension"
  | "smart-unavailable"
  | "conflicting-signals";
export type SmartRmaMissingField =
  | "model"
  | "serial_number"
  | "firmware_version"
  | "overall_health"
  | "temperature"
  | "power_on_hours";
export type SmartRmaExpectedSignal =
  | "smart-overall-passed"
  | "smart-overall-failed"
  | "ata-reallocated-sectors"
  | "ata-pending-sectors"
  | "ata-uncorrectable-sectors"
  | "ata-error-log"
  | "nvme-critical-warning"
  | "nvme-spare-below-threshold"
  | "nvme-percentage-used"
  | "nvme-media-errors"
  | "vendor-extension"
  | "smart-unavailable"
  | "incomplete-identification";

export type SmartRmaFixtureMetadata = {
  id: string;
  file: string;
  protocol: SmartRmaFixtureProtocol;
  smartctl_version: string;
  expected_state: SmartRmaExpectedState;
  coverage: SmartRmaFixtureCoverage[];
  missing_fields: SmartRmaMissingField[];
  expected_signals: SmartRmaExpectedSignal[];
};

export type SmartRmaFixtureIndex = {
  schema_version: "1.0";
  lab_id: "smart-rma";
  synthetic_only: true;
  fixtures: SmartRmaFixtureMetadata[];
};

export type SmartRmaFixture = SmartRmaFixtureMetadata & {
  raw: string;
};

export type SmartRmaFixtureCorpus = Omit<SmartRmaFixtureIndex, "fixtures"> & {
  fixtures: SmartRmaFixture[];
};

export type LoadSmartRmaFixtureCorpusOptions = {
  fixtureDirectory?: string;
  indexPath?: string;
  schema?: unknown;
};

export class SmartRmaFixtureError extends Error {
  override name = "SmartRmaFixtureError";
}

export const defaultSmartRmaFixtureDirectory = fileURLToPath(
  new URL("../../../../labs/smart-rma/fixtures/", import.meta.url),
);

const maximumFixtureBytes = 64 * 1024;
const forbiddenSensitiveKinds = [
  "authorization",
  "cookie",
  "token",
  "email",
  "ip",
  "domain",
] as const;
const requiredProtocols: readonly SmartRmaFixtureProtocol[] = [
  "ata",
  "nvme",
  "unknown",
];
const requiredStates: readonly SmartRmaExpectedState[] = [
  "healthy",
  "warning",
  "critical",
  "unknown",
];
const requiredCoverage: readonly SmartRmaFixtureCoverage[] = [
  "missing-fields",
  "vendor-extension",
  "smart-unavailable",
  "conflicting-signals",
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

const createIndexValidator = (
  schema: unknown,
): ValidateFunction<SmartRmaFixtureIndex> => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });

  return ajv.compile<SmartRmaFixtureIndex>(schema as AnySchema);
};

const parseIndex = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new SmartRmaFixtureError(
      "SMART fixture index contains invalid JSON.",
    );
  }
};

const assertUnique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) {
    throw new SmartRmaFixtureError(`SMART fixture ${label} must be unique.`);
  }
};

const assertCorpusCoverage = (
  fixtures: readonly SmartRmaFixtureMetadata[],
): void => {
  const protocols = new Set(fixtures.map(({ protocol }) => protocol));
  const states = new Set(fixtures.map(({ expected_state }) => expected_state));
  const coverage = new Set(fixtures.flatMap((fixture) => fixture.coverage));

  if (requiredProtocols.some((protocol) => !protocols.has(protocol))) {
    throw new SmartRmaFixtureError(
      "SMART fixture corpus must cover ATA, NVMe and an unknown protocol.",
    );
  }
  if (requiredStates.some((state) => !states.has(state))) {
    throw new SmartRmaFixtureError(
      "SMART fixture corpus must cover healthy, warning, critical and unknown states.",
    );
  }
  if (requiredCoverage.some((item) => !coverage.has(item))) {
    throw new SmartRmaFixtureError(
      "SMART fixture corpus is missing a required edge-case class.",
    );
  }
};

const assertSyntheticHardwareIdentifiers = (raw: string): void => {
  const serialLines = raw.matchAll(/^Serial Number:\s*(\S+)\s*$/gimu);
  for (const match of serialLines) {
    const serial = match[1];
    if (!serial || !/^SYNTHETIC-[A-Z0-9-]+$/u.test(serial)) {
      throw new SmartRmaFixtureError(
        "SMART fixtures only allow visibly synthetic serial numbers.",
      );
    }
  }

  const wwnLines = raw.matchAll(
    /^(?:LU WWN Device Id|WWN):\s*(\S(?:.*\S)?)\s*$/gimu,
  );
  for (const match of wwnLines) {
    const normalizedWwn = (match[1] ?? "")
      .replace(/^0x/iu, "")
      .replace(/[\s:.-]/gu, "");
    if (!/^0+$/u.test(normalizedWwn)) {
      throw new SmartRmaFixtureError(
        "SMART fixtures only allow an all-zero synthetic WWN placeholder.",
      );
    }
  }
};

const assertSyntheticFixture = (
  metadata: SmartRmaFixtureMetadata,
  raw: string,
): void => {
  const size = Buffer.byteLength(raw, "utf8");
  if (size === 0 || size > maximumFixtureBytes) {
    throw new SmartRmaFixtureError(
      "SMART fixture text must be between 1 byte and 64 KiB.",
    );
  }
  if (
    raw.includes("\r") ||
    raw.includes("\0") ||
    raw.includes("\uFFFD") ||
    !raw.endsWith("\n")
  ) {
    throw new SmartRmaFixtureError(
      "SMART fixtures must be valid LF-terminated plain text.",
    );
  }

  const versionMatch = /^smartctl\s+([0-9]+\.[0-9]+)\b/u.exec(raw);
  if (!versionMatch || versionMatch[1] !== metadata.smartctl_version) {
    throw new SmartRmaFixtureError(
      "SMART fixture banner must match its indexed smartctl version.",
    );
  }
  if (!/\bSYNTHETIC\b/iu.test(raw)) {
    throw new SmartRmaFixtureError(
      "SMART fixture text must be visibly marked as synthetic.",
    );
  }
  if (
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(raw) ||
    /^(?:Host Name|Hostname):/imu.test(raw)
  ) {
    throw new SmartRmaFixtureError(
      "SMART fixtures reject private keys and host identifiers.",
    );
  }

  const report = redactTextWithReport(raw).report;
  if (forbiddenSensitiveKinds.some((kind) => (report.counts[kind] ?? 0) > 0)) {
    throw new SmartRmaFixtureError(
      "SMART fixtures reject Secret, personal and network identifiers.",
    );
  }

  assertSyntheticHardwareIdentifiers(raw);

  if (
    metadata.protocol !== "unknown" &&
    !/^(?:Device Model|Model Number):\s+MARGROP LABS SYNTHETIC\b/imu.test(raw)
  ) {
    throw new SmartRmaFixtureError(
      "Identified SMART fixtures require a visibly synthetic model.",
    );
  }
  if (!metadata.coverage.includes(metadata.expected_state)) {
    throw new SmartRmaFixtureError(
      "SMART fixture coverage must include its expected state.",
    );
  }
};

export const loadSmartRmaFixtureCorpus = async ({
  fixtureDirectory = defaultSmartRmaFixtureDirectory,
  indexPath = join(fixtureDirectory, "index.json"),
  schema = fixtureIndexSchema,
}: LoadSmartRmaFixtureCorpusOptions = {}): Promise<SmartRmaFixtureCorpus> => {
  let rawIndex: string;
  try {
    rawIndex = await readFile(indexPath, "utf8");
  } catch {
    throw new SmartRmaFixtureError(
      "SMART fixture index is missing or unreadable.",
    );
  }

  const candidate = parseIndex(rawIndex);
  const validate = createIndexValidator(schema);
  if (!validate(candidate)) {
    throw new SmartRmaFixtureError(
      `SMART fixture index does not match smart-rma-fixture-index-v1: ${formatValidationErrors(validate.errors)}`,
    );
  }

  const index = candidate as SmartRmaFixtureIndex;
  assertUnique(
    index.fixtures.map(({ id }) => id),
    "ids",
  );
  assertUnique(
    index.fixtures.map(({ file }) => file),
    "file references",
  );
  assertCorpusCoverage(index.fixtures);

  const directoryEntries = await readdir(fixtureDirectory, {
    withFileTypes: true,
  });
  const actualTextFiles = directoryEntries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".txt"))
    .map(({ name }) => name)
    .sort();
  const indexedTextFiles = index.fixtures.map(({ file }) => file).sort();
  if (
    actualTextFiles.length !== indexedTextFiles.length ||
    actualTextFiles.some((file, index) => file !== indexedTextFiles[index])
  ) {
    throw new SmartRmaFixtureError(
      "Every SMART text fixture must be indexed exactly once.",
    );
  }

  const fixtureRoot = resolve(fixtureDirectory);
  const fixtures = await Promise.all(
    index.fixtures.map(async (metadata): Promise<SmartRmaFixture> => {
      const fixturePath = resolve(fixtureRoot, metadata.file);
      if (
        fixturePath !== join(fixtureRoot, metadata.file) ||
        basename(fixturePath) !== metadata.file
      ) {
        throw new SmartRmaFixtureError(
          "SMART fixture paths must remain inside the fixture directory.",
        );
      }

      let raw: string;
      try {
        raw = await readFile(fixturePath, "utf8");
      } catch {
        throw new SmartRmaFixtureError(
          "An indexed SMART fixture is missing or unreadable.",
        );
      }
      assertSyntheticFixture(metadata, raw);

      return {
        ...metadata,
        raw,
      };
    }),
  );

  return {
    schema_version: index.schema_version,
    lab_id: index.lab_id,
    synthetic_only: index.synthetic_only,
    fixtures,
  };
};
