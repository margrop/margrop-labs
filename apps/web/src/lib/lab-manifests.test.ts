import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  type LabManifest,
  LabManifestError,
  loadLabManifests,
} from "./lab-manifests";

const temporaryDirectories: string[] = [];

const validManifest = (
  id: string,
  overrides: Partial<LabManifest> = {},
): LabManifest => ({
  schema_version: "1.0",
  id,
  title: "示例实验",
  summary: "这是一个用于验证实验清单加载器的完整合成示例。",
  status: "proposed",
  route: `/${id}/`,
  ai_mode: "optional",
  input_privacy: "public",
  sample_mode: true,
  related_articles: ["https://blog.margrop.net/post/example/"],
  ...overrides,
});

const createLabsDirectory = async (
  manifests: Array<{ directory: string; manifest: unknown }>,
): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "margrop-labs-manifests-"));
  temporaryDirectories.push(root);

  await Promise.all(
    manifests.map(async ({ directory, manifest }) => {
      const labDirectory = join(root, directory);
      await mkdir(labDirectory);
      await writeFile(
        join(labDirectory, "lab.json"),
        JSON.stringify(manifest),
        "utf8",
      );
    }),
  );

  return root;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("loadLabManifests", () => {
  it("loads valid manifests in deterministic directory order", async () => {
    const labsDirectory = await createLabsDirectory([
      { directory: "zeta", manifest: validManifest("zeta") },
      {
        directory: "alpha",
        manifest: validManifest("alpha", {
          input_privacy: "local-first",
          related_articles: [],
        }),
      },
    ]);

    const manifests = await loadLabManifests({ labsDirectory });

    expect(manifests.map(({ id }) => id)).toEqual(["alpha", "zeta"]);
    expect(manifests[0]?.input_privacy).toBe("local-first");
  });

  it("rejects a manifest that violates the versioned Schema", async () => {
    const invalidManifest = {
      ...validManifest("unsafe"),
      related_articles: ["https://example.com/not-a-margrop-article/"],
    };
    const labsDirectory = await createLabsDirectory([
      { directory: "unsafe", manifest: invalidManifest },
    ]);

    await expect(loadLabManifests({ labsDirectory })).rejects.toThrow(
      /does not match lab-manifest-v1/,
    );
  });

  it("rejects a manifest whose id differs from its directory", async () => {
    const labsDirectory = await createLabsDirectory([
      { directory: "expected-id", manifest: validManifest("different-id") },
    ]);

    await expect(loadLabManifests({ labsDirectory })).rejects.toThrow(
      /id must match directory "expected-id"/,
    );
  });

  it("rejects duplicate routes", async () => {
    const labsDirectory = await createLabsDirectory([
      {
        directory: "alpha",
        manifest: validManifest("alpha", { route: "/shared/" }),
      },
      {
        directory: "beta",
        manifest: validManifest("beta", { route: "/shared/" }),
      },
    ]);

    await expect(loadLabManifests({ labsDirectory })).rejects.toThrow(
      new LabManifestError('Duplicate Lab route "/shared/".'),
    );
  });
});
