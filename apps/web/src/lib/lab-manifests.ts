import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import Ajv2020, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { AnySchema } from "ajv";
import addFormats from "ajv-formats";

const findRepositoryRoot = (startDirectory: string): string => {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    if (
      existsSync(
        join(currentDirectory, "schemas", "lab-manifest-v1.schema.json"),
      ) &&
      existsSync(join(currentDirectory, "labs"))
    ) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      throw new Error(
        "Unable to locate the repository root containing labs/ and schemas/.",
      );
    }

    currentDirectory = parentDirectory;
  }
};

const repositoryRoot = findRepositoryRoot(
  process.env.INIT_CWD ?? process.cwd(),
);

export const defaultLabsDirectory = join(repositoryRoot, "labs");
export const defaultSchemaPath = join(
  repositoryRoot,
  "schemas",
  "lab-manifest-v1.schema.json",
);

export type LabStatus = "proposed" | "building" | "alpha" | "beta" | "stable";
export type LabAiMode = "none" | "optional" | "required";
export type LabInputPrivacy = "public" | "local-first" | "sensitive";

export type LabManifest = {
  schema_version: "1.0";
  id: string;
  title: string;
  summary: string;
  status: LabStatus;
  route: string;
  ai_mode: LabAiMode;
  input_privacy: LabInputPrivacy;
  sample_mode: true;
  related_articles: string[];
};

export type LoadLabManifestsOptions = {
  labsDirectory?: string;
  schemaPath?: string;
};

export class LabManifestError extends Error {
  override name = "LabManifestError";
}

const displayPath = (path: string): string => {
  const repositoryPath = relative(repositoryRoot, path);

  return repositoryPath.startsWith("..") ? basename(path) : repositoryPath;
};

const parseJson = (raw: string, path: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new LabManifestError(`${displayPath(path)} contains invalid JSON.`);
  }
};

const formatValidationErrors = (
  errors: ErrorObject[] | null | undefined,
): string =>
  (errors ?? [])
    .map((error) => {
      const location = error.instancePath || "/";
      return `${location} ${error.message ?? "is invalid"}`;
    })
    .join("; ");

const createValidator = (schema: unknown): ValidateFunction<LabManifest> => {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
  });
  addFormats(ajv);

  return ajv.compile<LabManifest>(schema as AnySchema);
};

function assertManifest(
  candidate: unknown,
  path: string,
  validate: ValidateFunction<LabManifest>,
): asserts candidate is LabManifest {
  if (!validate(candidate)) {
    throw new LabManifestError(
      `${displayPath(path)} does not match lab-manifest-v1: ${formatValidationErrors(validate.errors)}`,
    );
  }
}

const compareDirectoryNames = (
  left: { name: string },
  right: { name: string },
): number => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);

export const loadLabManifests = async ({
  labsDirectory = defaultLabsDirectory,
  schemaPath = defaultSchemaPath,
}: LoadLabManifestsOptions = {}): Promise<LabManifest[]> => {
  const schema = parseJson(await readFile(schemaPath, "utf8"), schemaPath);
  const validate = createValidator(schema);
  const directories = (await readdir(labsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort(compareDirectoryNames);

  if (directories.length === 0) {
    throw new LabManifestError(
      `${displayPath(labsDirectory)} does not contain any Lab directories.`,
    );
  }

  const manifests: LabManifest[] = [];
  const ids = new Set<string>();
  const routes = new Set<string>();

  for (const directory of directories) {
    const manifestPath = join(labsDirectory, directory.name, "lab.json");
    let rawManifest: string;

    try {
      rawManifest = await readFile(manifestPath, "utf8");
    } catch {
      throw new LabManifestError(`${displayPath(manifestPath)} is required.`);
    }

    const manifest = parseJson(rawManifest, manifestPath);
    assertManifest(manifest, manifestPath, validate);

    if (manifest.id !== directory.name) {
      throw new LabManifestError(
        `${displayPath(manifestPath)} id must match directory "${directory.name}".`,
      );
    }

    if (ids.has(manifest.id)) {
      throw new LabManifestError(`Duplicate Lab id "${manifest.id}".`);
    }

    if (routes.has(manifest.route)) {
      throw new LabManifestError(`Duplicate Lab route "${manifest.route}".`);
    }

    ids.add(manifest.id);
    routes.add(manifest.route);
    manifests.push(manifest);
  }

  return manifests;
};
