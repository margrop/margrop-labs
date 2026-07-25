import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type SmartRmaFixtureCorpus,
  type SmartRmaFixtureIndex,
  SmartRmaFixtureError,
  loadSmartRmaFixtureCorpus,
} from "./smart-rma-fixtures";

const temporaryDirectories: string[] = [];

const fixtureMetadata = (
  corpus: SmartRmaFixtureCorpus,
): SmartRmaFixtureIndex => ({
  schema_version: corpus.schema_version,
  lab_id: corpus.lab_id,
  synthetic_only: corpus.synthetic_only,
  fixtures: corpus.fixtures.map(
    ({
      id,
      file,
      protocol,
      smartctl_version,
      expected_state,
      coverage,
      missing_fields,
      expected_signals,
    }) => ({
      id,
      file,
      protocol,
      smartctl_version,
      expected_state,
      coverage,
      missing_fields,
      expected_signals,
    }),
  ),
});

const createTemporaryCorpus = async (
  corpus: SmartRmaFixtureCorpus,
  options: {
    index?: unknown;
    transformRaw?: (file: string, raw: string) => string;
    extraTextFile?: { file: string; raw: string };
  } = {},
): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), "smart-rma-fixtures-"));
  temporaryDirectories.push(directory);

  await writeFile(
    join(directory, "index.json"),
    JSON.stringify(options.index ?? fixtureMetadata(corpus)),
    "utf8",
  );
  await Promise.all(
    corpus.fixtures.map(({ file, raw }) =>
      writeFile(
        join(directory, file),
        options.transformRaw?.(file, raw) ?? raw,
        "utf8",
      ),
    ),
  );
  if (options.extraTextFile) {
    await writeFile(
      join(directory, options.extraTextFile.file),
      options.extraTextFile.raw,
      "utf8",
    );
  }

  return directory;
};

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("SMART / RMA synthetic fixture corpus v1", () => {
  it("loads the complete corpus in deterministic index order", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();

    expect(corpus.schema_version).toBe("1.0");
    expect(corpus.synthetic_only).toBe(true);
    expect(corpus.fixtures.map(({ id }) => id)).toEqual([
      "ata-healthy-7-4",
      "ata-warning-7-4",
      "ata-vendor-extension-7-3",
      "nvme-healthy-7-4",
      "nvme-critical-7-4",
      "sat-smart-unavailable-7-4",
      "ata-incomplete-6-5",
    ]);
    expect(corpus.fixtures.every(({ raw }) => raw.includes("SYNTHETIC"))).toBe(
      true,
    );
  });

  it("covers protocols, health outcomes and parser edge cases", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const protocols = new Set(corpus.fixtures.map(({ protocol }) => protocol));
    const states = new Set(
      corpus.fixtures.map(({ expected_state }) => expected_state),
    );
    const coverage = new Set(
      corpus.fixtures.flatMap((fixture) => fixture.coverage),
    );
    const requiredEdgeCases = [
      "missing-fields",
      "vendor-extension",
      "smart-unavailable",
      "conflicting-signals",
    ] as const;

    expect(protocols).toEqual(new Set(["ata", "nvme", "unknown"]));
    expect(states).toEqual(
      new Set(["healthy", "warning", "critical", "unknown"]),
    );
    expect(requiredEdgeCases.every((item) => coverage.has(item))).toBe(true);

    const conflicting = corpus.fixtures.find(
      ({ id }) => id === "ata-warning-7-4",
    );
    expect(conflicting?.expected_state).toBe("warning");
    expect(conflicting?.raw).toContain(
      "SMART overall-health self-assessment test result: PASSED",
    );
  });

  it("rejects an index that violates the versioned Schema", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const invalidIndex = {
      ...fixtureMetadata(corpus),
      source_url: "must-not-be-accepted",
    };
    const directory = await createTemporaryCorpus(corpus, {
      index: invalidIndex,
    });

    await expect(
      loadSmartRmaFixtureCorpus({ fixtureDirectory: directory }),
    ).rejects.toThrow(/does not match smart-rma-fixture-index-v1/);
  });

  it("rejects duplicate ids and unindexed text files", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const duplicateIndex = fixtureMetadata(corpus);
    duplicateIndex.fixtures[1]!.id = duplicateIndex.fixtures[0]!.id;
    const duplicateDirectory = await createTemporaryCorpus(corpus, {
      index: duplicateIndex,
    });

    await expect(
      loadSmartRmaFixtureCorpus({ fixtureDirectory: duplicateDirectory }),
    ).rejects.toThrow(/ids must be unique/);

    const extraDirectory = await createTemporaryCorpus(corpus, {
      extraTextFile: {
        file: "unindexed.txt",
        raw: corpus.fixtures[0]!.raw,
      },
    });
    await expect(
      loadSmartRmaFixtureCorpus({ fixtureDirectory: extraDirectory }),
    ).rejects.toThrow(/must be indexed exactly once/);
  });

  it("rejects real-looking hardware identifiers without echoing them", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const unsafeSerial = "REALDRIVE-ABC123456789";
    const directory = await createTemporaryCorpus(corpus, {
      transformRaw: (file, raw) =>
        file === "ata-healthy-7-4.txt"
          ? raw.replace("SYNTHETIC-ATA-HEALTHY-0001", unsafeSerial)
          : raw,
    });

    let receivedError: unknown;
    try {
      await loadSmartRmaFixtureCorpus({ fixtureDirectory: directory });
    } catch (error) {
      receivedError = error;
    }

    expect(receivedError).toBeInstanceOf(SmartRmaFixtureError);
    expect(String(receivedError)).not.toContain(unsafeSerial);
  });

  it("rejects network, secret and malformed text boundaries", async () => {
    const corpus = await loadSmartRmaFixtureCorpus();
    const unsafeValue = "operator@real.invalid";
    const networkDirectory = await createTemporaryCorpus(corpus, {
      transformRaw: (file, raw) =>
        file === "nvme-healthy-7-4.txt"
          ? raw.replace(
              "MARGROP LABS SYNTHETIC NVME 1TB",
              `MARGROP LABS SYNTHETIC NVME 1TB ${unsafeValue}`,
            )
          : raw,
    });

    let networkError: unknown;
    try {
      await loadSmartRmaFixtureCorpus({
        fixtureDirectory: networkDirectory,
      });
    } catch (error) {
      networkError = error;
    }
    expect(networkError).toBeInstanceOf(SmartRmaFixtureError);
    expect(String(networkError)).not.toContain(unsafeValue);

    const malformedDirectory = await createTemporaryCorpus(corpus, {
      transformRaw: (file, raw) =>
        file === "nvme-healthy-7-4.txt" ? raw.replace(/\n/gu, "\r\n") : raw,
    });
    await expect(
      loadSmartRmaFixtureCorpus({ fixtureDirectory: malformedDirectory }),
    ).rejects.toThrow(/LF-terminated plain text/);
  });

  it("loads offline without network, storage or console side effects", async () => {
    const fetchSpy = vi.fn();
    const storageWriteSpy = vi.fn();
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("localStorage", {
      setItem: storageWriteSpy,
    });

    await loadSmartRmaFixtureCorpus();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageWriteSpy).not.toHaveBeenCalled();
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
