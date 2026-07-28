import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  compileSchemaDocuments,
  scanTextForSecrets,
  verifyCiPolicy,
  verifyPinnedVersions,
  verifyRuntimeToolVersions,
  verifySchemaContracts,
} from "./repository-security.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..");

describe("repository secret scanning", () => {
  it("detects credential shapes without returning the credential value", () => {
    const providerKey = ["sk", "A".repeat(48)].join("-");
    const privateKeyHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
    const findings = scanTextForSecrets(
      ["const key = " + JSON.stringify(providerKey), privateKeyHeader].join(
        "\n",
      ),
      "synthetic-source.ts",
    );

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      "provider-api-key",
      "private-key",
    ]);
    expect(JSON.stringify(findings)).not.toContain(providerKey);
  });

  it("allows explicit synthetic placeholders and environment references", () => {
    const findings = scanTextForSecrets(
      [
        'provider_api_key: "synthetic-secret-value"',
        'TOKEN_FORGE_AI_API_KEY: "${{ secrets.TOKEN_FORGE_AI_API_KEY }}"',
        "const apiKey = process.env.TOKEN_FORGE_AI_API_KEY;",
        "Authorization: Bearer example-placeholder-not-a-real-token",
      ].join("\n"),
      "fixture.ts",
    );

    expect(findings).toEqual([]);
  });
});

describe("repository schema validation", () => {
  it("rejects duplicate schema identifiers before validating fixtures", () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: "https://example.com/duplicate.schema.json",
      type: "object",
    };

    expect(() =>
      compileSchemaDocuments([
        { path: "first.schema.json", value: schema },
        { path: "second.schema.json", value: schema },
      ]),
    ).toThrow(/duplicate schema \$id/i);
  });

  it("compiles every schema and validates every registered repository fixture", async () => {
    const report = await verifySchemaContracts(repositoryRoot);

    expect(report.schemaCount).toBeGreaterThanOrEqual(20);
    expect(report.fixtureCount).toBeGreaterThanOrEqual(20);
    expect(report.labManifestCount).toBe(3);
  });
});

describe("pinned CI and deployment policy", () => {
  it("requires exact tool versions and dependency versions", async () => {
    const packageJson = JSON.parse(
      await readFile(join(repositoryRoot, "package.json"), "utf8"),
    );
    const nodeVersion = await readFile(join(repositoryRoot, ".nvmrc"), "utf8");

    expect(() =>
      verifyPinnedVersions({ nodeVersion, packageJson }),
    ).not.toThrow();
    expect(() =>
      verifyPinnedVersions({ nodeVersion: "24\n", packageJson }),
    ).toThrow(/exact Node.js version/i);
    expect(() =>
      verifyRuntimeToolVersions({
        actualNodeVersion: packageJson.engines.node,
        actualNpmVersion: packageJson.packageManager.replace("npm@", ""),
        packageJson,
      }),
    ).not.toThrow();
  });

  it("requires immutable actions and manual-only Production deployment", async () => {
    const qualityWorkflow = await readFile(
      join(repositoryRoot, ".github", "workflows", "quality.yml"),
      "utf8",
    );
    const deployWorkflow = await readFile(
      join(repositoryRoot, ".github", "workflows", "deploy.yml"),
      "utf8",
    );

    expect(() =>
      verifyCiPolicy({ deployWorkflow, qualityWorkflow }),
    ).not.toThrow();
    expect(() =>
      verifyCiPolicy({
        deployWorkflow,
        qualityWorkflow: qualityWorkflow.replace(
          /actions\/checkout@[0-9a-f]{40}/u,
          "actions/checkout@v6",
        ),
      }),
    ).toThrow(/immutable commit SHAs/i);
    expect(() =>
      verifyCiPolicy({
        deployWorkflow: deployWorkflow.replaceAll(
          "if: github.event_name == 'workflow_dispatch' && github.event.inputs.target == 'production'",
          "if: github.event_name == 'push'",
        ),
        qualityWorkflow,
      }),
    ).toThrow(/explicit Production workflow dispatch/i);
  });
});
