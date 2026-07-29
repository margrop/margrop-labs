import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const JSON_SCHEMA_2020_12 = "https://json-schema.org/draft/2020-12/schema";
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IMMUTABLE_ACTION = /^[^@\s]+@[0-9a-f]{40}(?:\s+#.*)?$/;
const MAX_SCANNED_TEXT_BYTES = 5 * 1024 * 1024;

const secretRules = [
  {
    ruleId: "private-key",
    expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/gu,
  },
  {
    ruleId: "github-token",
    expression:
      /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{50,255})\b/gu,
  },
  {
    ruleId: "provider-api-key",
    expression: /\bsk-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    ruleId: "aws-access-key",
    expression: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu,
  },
  {
    ruleId: "jwt",
    expression:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu,
  },
  {
    ruleId: "bearer-token",
    expression: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}(?=$|[\s"',;)}\]])/giu,
  },
  {
    ruleId: "assigned-secret",
    expression:
      /\b(?:api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret|password)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/-]{20,}={0,2})/giu,
    candidateGroup: 1,
  },
];

const safeCandidateMarkers = [
  "synthetic",
  "example",
  "placeholder",
  "redacted",
  "not-a-real",
  "not_real",
  "test-only",
  "test_only",
  "changeme",
  "your-",
  "your_",
  "process.env.",
  "environment.",
];

const fixtureContracts = [
  [
    "labs/interview-workbench/integrations/interview-workbench-cta.json",
    "schemas/interview-workbench-blog-cta-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/interview-analytics-event.valid.json",
    "schemas/lab-analytics-event-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/interview-analytics-snapshot.valid.json",
    "schemas/lab-analytics-snapshot-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/ai-match-input.valid.json",
    "schemas/interview-ai-match-input-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/ai-plan-input.valid.json",
    "schemas/interview-ai-plan-input-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/ai-conclusion-input.valid.json",
    "schemas/interview-ai-conclusion-input-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/resume.valid.json",
    "schemas/interview-resume-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/text-import.valid.json",
    "schemas/interview-text-import-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/jd.valid.json",
    "schemas/interview-jd-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/requirement.valid.json",
    "schemas/interview-requirement-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/evidence.valid.json",
    "schemas/interview-evidence-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/match.valid.json",
    "schemas/interview-match-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/plan.valid.json",
    "schemas/interview-plan-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/record.valid.json",
    "schemas/interview-record-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/conclusion.valid.json",
    "schemas/interview-conclusion-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/loop.valid.json",
    "schemas/interview-loop-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/export-interviewer.valid.json",
    "schemas/interview-export-v1.schema.json",
  ],
  [
    "labs/interview-workbench/fixtures/export-candidate.valid.json",
    "schemas/interview-export-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/ai-gateway-request.valid.json",
    "schemas/ai-gateway-request-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/ai-gateway-response.valid.json",
    "schemas/ai-gateway-response-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/input.valid.json",
    "schemas/token-forge-input-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/template-small.input.json",
    "schemas/token-forge-input-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/template-medium.input.json",
    "schemas/token-forge-input-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/template-large.input.json",
    "schemas/token-forge-input-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/plan.valid.json",
    "schemas/token-forge-plan-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-agent-package.valid.json",
    "schemas/token-forge-agent-package-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-ai-input.valid.json",
    "schemas/token-forge-ai-input-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-ai-policy.valid.json",
    "schemas/token-forge-ai-policy-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-event.valid.json",
    "schemas/token-forge-event-v1.schema.json",
  ],
  [
    "labs/token-forge/integrations/token-forge-cta.json",
    "schemas/token-forge-blog-cta-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-analytics-snapshot.valid.json",
    "schemas/token-forge-analytics-snapshot-v1.schema.json",
  ],
  [
    "labs/token-forge/fixtures/token-forge-export.valid.json",
    "schemas/token-forge-export-v1.schema.json",
  ],
  [
    "labs/token-forge/benchmarks/corpus.json",
    "schemas/token-forge-benchmark-v1.schema.json",
  ],
  [
    "labs/token-forge/benchmarks/report.json",
    "schemas/token-forge-benchmark-report-v1.schema.json",
  ],
  [
    "labs/incident-detective/fixtures/attempt.valid.json",
    "schemas/incident-detective-attempt-v1.schema.json",
  ],
  [
    "labs/incident-detective/fixtures/case-generation-input.valid.json",
    "schemas/incident-detective-case-generation-input-v1.schema.json",
  ],
  [
    "labs/incident-detective/fixtures/case-proposal.valid.json",
    "schemas/incident-detective-case-proposal-v1.schema.json",
  ],
  [
    "labs/incident-detective/fixtures/case-review.valid.json",
    "schemas/incident-detective-case-review-v1.schema.json",
  ],
  [
    "labs/incident-detective/fixtures/scenario.valid.json",
    "schemas/incident-detective-scenario-v1.schema.json",
  ],
  [
    "labs/incident-detective/cases/mysql-leading-wildcard/attempt.canonical.json",
    "schemas/incident-detective-attempt-v1.schema.json",
  ],
  [
    "labs/incident-detective/cases/mysql-leading-wildcard/scenario.json",
    "schemas/incident-detective-scenario-v1.schema.json",
  ],
  [
    "labs/incident-detective/cases/mysql-leading-wildcard/answer.internal.json",
    "labs/incident-detective/internal/answer-draft-v1.schema.json",
  ],
  [
    "labs/incident-detective/cases/mysql-leading-wildcard/score-rules.internal.json",
    "labs/incident-detective/internal/scoring-rules-v1.schema.json",
  ],
  [
    "labs/smart-rma/fixtures/index.json",
    "schemas/smart-rma-fixture-index-v1.schema.json",
  ],
];

const getLineAndColumn = (text, offset) => {
  const prefix = text.slice(0, offset);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines.at(-1).length + 1,
  };
};

const isSafeCandidate = (candidate) => {
  const normalized = candidate.toLowerCase();
  return safeCandidateMarkers.some((marker) => normalized.includes(marker));
};

export const scanTextForSecrets = (text, path) => {
  const findings = [];

  for (const rule of secretRules) {
    rule.expression.lastIndex = 0;
    let match;
    while ((match = rule.expression.exec(text)) !== null) {
      const candidate = match[rule.candidateGroup ?? 0];
      if (isSafeCandidate(candidate)) {
        continue;
      }
      const location = getLineAndColumn(text, match.index);
      findings.push({
        path,
        ruleId: rule.ruleId,
        line: location.line,
        column: location.column,
      });
    }
  }

  return findings.sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      left.ruleId.localeCompare(right.ruleId),
  );
};

export const scanTrackedFilesForSecrets = async (repositoryRoot) => {
  const trackedOutput = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
  const trackedPaths = trackedOutput.split("\0").filter(Boolean);
  const findings = [];
  let scannedFileCount = 0;

  for (const trackedPath of trackedPaths) {
    const content = await readFile(join(repositoryRoot, trackedPath));
    if (
      content.length > MAX_SCANNED_TEXT_BYTES ||
      content.subarray(0, 8_192).includes(0)
    ) {
      continue;
    }
    scannedFileCount += 1;
    findings.push(...scanTextForSecrets(content.toString("utf8"), trackedPath));
  }

  let historyRange = "HEAD^..HEAD";
  try {
    const baseRef =
      process.env.GITHUB_BASE_REF === undefined ||
      process.env.GITHUB_BASE_REF.length === 0
        ? "origin/main"
        : `origin/${process.env.GITHUB_BASE_REF}`;
    const mergeBase = execFileSync("git", ["merge-base", "HEAD", baseRef], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    const head = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim();
    if (mergeBase !== head) {
      historyRange = `${mergeBase}..HEAD`;
    }
  } catch {
    // A shallow or newly initialized checkout still scans HEAD plus the tree.
  }

  const history = execFileSync(
    "git",
    [
      "log",
      historyRange,
      "--format=commit:%H",
      "--patch",
      "--no-ext-diff",
      "--unified=0",
      "--max-count=100",
      "--",
      ".",
      ":(exclude)package-lock.json",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 50 * 1024 * 1024,
    },
  );
  findings.push(...scanTextForSecrets(history, "git-history"));

  if (findings.length > 0) {
    const locations = findings
      .map(
        (finding) =>
          `${finding.path}:${finding.line}:${finding.column} (${finding.ruleId})`,
      )
      .join("\n");
    throw new Error(
      `Secret scan rejected ${findings.length} finding(s). Values are intentionally omitted:\n${locations}`,
    );
  }

  return { scannedFileCount, scannedHistory: true };
};

const parseJsonFile = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(`Invalid JSON document: ${path}`);
  }
};

export const compileSchemaDocuments = (schemaDocuments) => {
  const schemaIds = new Map();
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);

  for (const document of schemaDocuments) {
    const schema = document.value;
    if (
      schema === null ||
      typeof schema !== "object" ||
      Array.isArray(schema) ||
      schema.$schema !== JSON_SCHEMA_2020_12 ||
      typeof schema.$id !== "string" ||
      schema.$id.length === 0
    ) {
      throw new Error(
        `Schema must declare draft 2020-12 and a non-empty $id: ${document.path}`,
      );
    }
    if (schemaIds.has(schema.$id)) {
      throw new Error(
        `Duplicate schema $id ${schema.$id}: ${schemaIds.get(schema.$id)} and ${document.path}`,
      );
    }
    schemaIds.set(schema.$id, document.path);
    ajv.addSchema(schema, schema.$id);
  }

  for (const [schemaId, path] of schemaIds) {
    if (ajv.getSchema(schemaId) === undefined) {
      throw new Error(`Schema did not compile: ${path}`);
    }
  }

  return { ajv, schemaIds };
};

const listJsonSchemas = async (repositoryRoot) => {
  const publicSchemaDirectory = join(repositoryRoot, "schemas");
  const publicSchemaNames = (await readdir(publicSchemaDirectory))
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
  const internalSchemaDirectory = join(
    repositoryRoot,
    "labs",
    "incident-detective",
    "internal",
  );
  const internalSchemaNames = (await readdir(internalSchemaDirectory))
    .filter((name) => name.endsWith(".schema.json"))
    .sort();
  const paths = [
    ...publicSchemaNames.map((name) => join(publicSchemaDirectory, name)),
    ...internalSchemaNames.map((name) => join(internalSchemaDirectory, name)),
  ];

  return Promise.all(
    paths.map(async (path) => ({
      path: relative(repositoryRoot, path),
      value: await parseJsonFile(path),
    })),
  );
};

const validateFixture = async ({
  ajv,
  repositoryRoot,
  schemaDocument,
  fixturePath,
}) => {
  const validator = ajv.getSchema(schemaDocument.value.$id);
  if (validator === undefined) {
    throw new Error(`Missing compiled schema: ${schemaDocument.path}`);
  }
  const fixture = await parseJsonFile(join(repositoryRoot, fixturePath));
  if (!validator(fixture)) {
    throw new Error(
      `Fixture failed ${schemaDocument.path}: ${fixturePath}; ${ajv.errorsText(validator.errors)}`,
    );
  }
};

export const verifySchemaContracts = async (repositoryRoot) => {
  const schemaDocuments = await listJsonSchemas(repositoryRoot);
  const { ajv } = compileSchemaDocuments(schemaDocuments);
  const schemasByPath = new Map(
    schemaDocuments.map((document) => [document.path, document]),
  );

  for (const [fixturePath, schemaPath] of fixtureContracts) {
    const schemaDocument = schemasByPath.get(schemaPath);
    if (schemaDocument === undefined) {
      throw new Error(
        `Fixture registry references missing schema: ${schemaPath}`,
      );
    }
    await validateFixture({
      ajv,
      repositoryRoot,
      schemaDocument,
      fixturePath,
    });
  }

  const labDirectory = join(repositoryRoot, "labs");
  const labNames = (await readdir(labDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const manifestSchema = schemasByPath.get(
    "schemas/lab-manifest-v1.schema.json",
  );
  if (manifestSchema === undefined) {
    throw new Error("Lab manifest schema is missing.");
  }
  for (const labName of labNames) {
    await validateFixture({
      ajv,
      repositoryRoot,
      schemaDocument: manifestSchema,
      fixturePath: `labs/${labName}/lab.json`,
    });
  }

  return {
    schemaCount: schemaDocuments.length,
    fixtureCount: fixtureContracts.length,
    labManifestCount: labNames.length,
  };
};

const exactDependencyVersions = (packageJson) => {
  const findings = [];
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, version] of Object.entries(packageJson[field] ?? {})) {
      if (!EXACT_VERSION.test(version)) {
        findings.push(`${field}.${name}=${version}`);
      }
    }
  }
  return findings;
};

export const verifyPinnedVersions = ({ nodeVersion, packageJson }) => {
  const normalizedNodeVersion = nodeVersion.trim();
  const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/.exec(
    packageJson.packageManager ?? "",
  );
  const dependencyFindings = exactDependencyVersions(packageJson);

  if (!EXACT_VERSION.test(normalizedNodeVersion)) {
    throw new Error(".nvmrc must pin an exact Node.js version.");
  }
  if (packageJson.engines?.node !== normalizedNodeVersion) {
    throw new Error("package.json engines.node must match .nvmrc exactly.");
  }
  if (packageManagerMatch === null) {
    throw new Error(
      "package.json packageManager must pin an exact npm version.",
    );
  }
  if (packageJson.engines?.npm !== packageManagerMatch[1]) {
    throw new Error(
      "package.json engines.npm must match packageManager exactly.",
    );
  }
  if (dependencyFindings.length > 0) {
    throw new Error(
      `Package dependency versions must be exact: ${dependencyFindings.join(", ")}`,
    );
  }
};

export const verifyRuntimeToolVersions = ({
  actualNodeVersion,
  actualNpmVersion,
  packageJson,
}) => {
  const expectedNpmVersion = /^npm@(.+)$/.exec(
    packageJson.packageManager ?? "",
  )?.[1];
  if (actualNodeVersion !== packageJson.engines?.node) {
    throw new Error(
      `Node.js ${actualNodeVersion} does not match pinned ${packageJson.engines?.node}.`,
    );
  }
  if (actualNpmVersion !== expectedNpmVersion) {
    throw new Error(
      `npm ${actualNpmVersion} does not match pinned ${expectedNpmVersion}.`,
    );
  }
};

const verifyWorkspacePackageVersions = async ({
  nodeVersion,
  packageJson,
  repositoryRoot,
}) => {
  const normalizedNodeVersion = nodeVersion.trim();
  for (const workspacePattern of packageJson.workspaces ?? []) {
    if (!workspacePattern.endsWith("/*")) {
      throw new Error(
        `Only one-level workspace patterns are supported by the security check: ${workspacePattern}`,
      );
    }
    const workspaceRoot = join(repositoryRoot, workspacePattern.slice(0, -2));
    const entries = await readdir(workspaceRoot, { withFileTypes: true });
    for (const entry of entries.filter((candidate) =>
      candidate.isDirectory(),
    )) {
      const workspacePath = join(workspaceRoot, entry.name, "package.json");
      let workspacePackage;
      try {
        workspacePackage = await parseJsonFile(workspacePath);
      } catch {
        continue;
      }
      if (workspacePackage.engines?.node !== normalizedNodeVersion) {
        throw new Error(
          `${relative(repositoryRoot, workspacePath)} must pin Node.js ${normalizedNodeVersion}.`,
        );
      }
      const dependencyFindings = exactDependencyVersions(workspacePackage);
      if (dependencyFindings.length > 0) {
        throw new Error(
          `${relative(repositoryRoot, workspacePath)} must use exact dependency versions: ${dependencyFindings.join(", ")}`,
        );
      }
    }
  }
};

const actionReferences = (workflow) =>
  workflow
    .split("\n")
    .map((line) => /^\s*uses:\s*(.+?)\s*$/.exec(line)?.[1])
    .filter(Boolean)
    .filter((reference) => !reference.startsWith("./"));

export const verifyCiPolicy = ({ deployWorkflow, qualityWorkflow }) => {
  const actions = [
    ...actionReferences(qualityWorkflow),
    ...actionReferences(deployWorkflow),
  ];
  const mutableActions = actions.filter(
    (reference) => !IMMUTABLE_ACTION.test(reference),
  );
  if (mutableActions.length > 0) {
    throw new Error(
      `GitHub Actions must use immutable commit SHAs: ${mutableActions.join(", ")}`,
    );
  }
  for (const [name, workflow] of [
    ["Quality", qualityWorkflow],
    ["Deploy", deployWorkflow],
  ]) {
    if (
      !/fetch-depth:\s+0/u.test(workflow) ||
      !/persist-credentials:\s+false/u.test(workflow)
    ) {
      throw new Error(
        `${name} checkout must fetch PR history without persisting credentials.`,
      );
    }
  }
  if (
    !/\bon:\s*\n\s+pull_request:/u.test(qualityWorkflow) ||
    !/permissions:\s*\n\s+contents:\s+read/u.test(qualityWorkflow) ||
    !/run:\s+npm run validate/u.test(qualityWorkflow) ||
    /\bdeploy(?::|\s)/iu.test(qualityWorkflow)
  ) {
    throw new Error(
      "Quality workflow must gate pull requests with read-only npm run validate and no deployment.",
    );
  }

  const productionCondition =
    "if: github.event_name == 'workflow_dispatch' && github.event.inputs.target == 'production'";
  const productionSteps = [
    "Deploy production",
    "Smoke test production",
    "Record production URL",
  ];
  for (const stepName of productionSteps) {
    const stepStart = deployWorkflow.indexOf(`- name: ${stepName}`);
    if (stepStart === -1) {
      throw new Error(`Missing Production step: ${stepName}`);
    }
    const nextStep = deployWorkflow.indexOf("\n      - name:", stepStart + 1);
    const stepBlock = deployWorkflow.slice(
      stepStart,
      nextStep === -1 ? undefined : nextStep,
    );
    if (!stepBlock.includes(productionCondition)) {
      throw new Error(
        `${stepName} must require an explicit Production workflow dispatch.`,
      );
    }
  }
  if (
    !deployWorkflow.includes(
      "github.event_name == 'push' || (github.event_name == 'workflow_dispatch' && github.event.inputs.target == 'preview')",
    )
  ) {
    throw new Error("Push deployments must target Preview only.");
  }
};

export const verifyRepositorySecurity = async (repositoryRoot) => {
  const [packageJson, nodeVersion, qualityWorkflow, deployWorkflow] =
    await Promise.all([
      parseJsonFile(join(repositoryRoot, "package.json")),
      readFile(join(repositoryRoot, ".nvmrc"), "utf8"),
      readFile(
        join(repositoryRoot, ".github", "workflows", "quality.yml"),
        "utf8",
      ),
      readFile(
        join(repositoryRoot, ".github", "workflows", "deploy.yml"),
        "utf8",
      ),
    ]);

  verifyPinnedVersions({ nodeVersion, packageJson });
  verifyRuntimeToolVersions({
    actualNodeVersion: process.versions.node,
    actualNpmVersion: execFileSync("npm", ["--version"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(),
    packageJson,
  });
  await verifyWorkspacePackageVersions({
    nodeVersion,
    packageJson,
    repositoryRoot,
  });
  verifyCiPolicy({ deployWorkflow, qualityWorkflow });
  const schemaReport = await verifySchemaContracts(repositoryRoot);
  const secretReport = await scanTrackedFilesForSecrets(repositoryRoot);
  return { ...schemaReport, ...secretReport };
};

const currentPath = fileURLToPath(import.meta.url);
const invokedPath =
  process.argv[1] === undefined ? undefined : resolve(process.argv[1]);

if (invokedPath === currentPath) {
  const repositoryRoot = resolve(dirname(currentPath), "..", "..");
  try {
    const report = await verifyRepositorySecurity(repositoryRoot);
    process.stdout.write(
      [
        `Security checks passed for ${report.scannedFileCount} repository text files.`,
        `Compiled ${report.schemaCount} schemas and validated ${report.fixtureCount} registered fixtures.`,
        `Validated ${report.labManifestCount} Lab manifests and immutable CI policy.`,
      ].join("\n") + "\n",
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Repository security checks failed."}\n`,
    );
    process.exitCode = 1;
  }
}
