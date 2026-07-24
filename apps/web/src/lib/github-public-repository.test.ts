import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  GitHubPublicRepositoryError,
  parsePublicGitHubRepositoryUrl,
  summarizePublicGitHubRepository,
} from "./github-public-repository";

type SyntheticFixture = {
  repository_url: string;
  metadata: {
    private: boolean;
    visibility: string;
    default_branch: string;
  };
  files: Record<string, string>;
  excluded_tree_entries: Array<{
    path: string;
    type: "blob";
    size: number;
  }>;
};

type RequestRecord = {
  url: URL;
  init: RequestInit | undefined;
};

const fixtureUrl = new URL(
  "../../../../labs/token-forge/fixtures/github-public-repository.json",
  import.meta.url,
);

const loadFixture = async (): Promise<SyntheticFixture> =>
  JSON.parse(await readFile(fixtureUrl, "utf8")) as SyntheticFixture;

const jsonResponse = (
  data: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  });

const inputUrl = (input: RequestInfo | URL): URL => {
  if (typeof input === "string") {
    return new URL(input);
  }

  return input instanceof URL ? input : new URL(input.url);
};

const createSyntheticFetch = (
  fixture: SyntheticFixture,
  options: {
    metadataResponses?: Response[];
    treeTruncated?: boolean;
    contentStatus?: Record<string, number>;
  } = {},
): {
  fetchImpl: typeof fetch;
  requests: RequestRecord[];
} => {
  const requests: RequestRecord[] = [];
  const metadataResponses = [...(options.metadataResponses ?? [])];
  const encoder = new TextEncoder();
  const repositoryPath = "/repos/acme/synthetic-repository";
  const contentPrefix = `${repositoryPath}/contents/`;
  const tree = [
    ...Object.entries(fixture.files).map(([path, content]) => ({
      path,
      type: "blob",
      size: encoder.encode(content).byteLength,
    })),
    ...fixture.excluded_tree_entries,
  ];

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = inputUrl(input);
    requests.push({ url, init });

    if (url.pathname === repositoryPath) {
      return metadataResponses.shift() ?? jsonResponse(fixture.metadata);
    }

    if (url.pathname === `${repositoryPath}/git/trees/main`) {
      return jsonResponse({
        tree,
        truncated: options.treeTruncated ?? false,
      });
    }

    if (url.pathname.startsWith(contentPrefix)) {
      const path = url.pathname
        .slice(contentPrefix.length)
        .split("/")
        .map(decodeURIComponent)
        .join("/");
      const status = options.contentStatus?.[path] ?? 200;
      const content = fixture.files[path];

      if (status !== 200 || content === undefined) {
        return jsonResponse({ message: "synthetic failure" }, status);
      }

      const size = encoder.encode(content).byteLength;
      return jsonResponse({
        type: "file",
        encoding: "base64",
        path,
        size,
        content: btoa(content),
      });
    }

    return jsonResponse({ message: "unexpected synthetic request" }, 500);
  };

  return { fetchImpl, requests };
};

describe("public GitHub repository adapter", () => {
  it("returns a deterministic bounded summary without fetching risky paths", async () => {
    const fixture = await loadFixture();
    const { fetchImpl, requests } = createSyntheticFetch(fixture);
    const summary = await summarizePublicGitHubRepository(
      fixture.repository_url,
      { fetchImpl },
    );

    expect(summary.repository).toEqual({
      owner: "acme",
      name: "synthetic-repository",
      default_branch: "main",
    });
    expect(summary.tech_signals).toEqual(["TypeScript", "Node.js"]);
    expect(summary.files.map((file) => file.path)).toEqual([
      "README.md",
      "package.json",
      "docs/guide.md",
      "src/index.ts",
      "src/worker.ts",
    ]);
    expect(summary.files.every((file) => file.untrusted_text.length > 0)).toBe(
      true,
    );
    expect(summary.coverage).toMatchObject({
      tree_entries_seen: 12,
      eligible_text_files: 6,
      sampled_files: 5,
      tree_truncated: false,
      skipped_secret_paths: 2,
      skipped_binary_or_generated: 3,
      skipped_too_large: 1,
      skipped_secret_content: 1,
      skipped_fetch_errors: 0,
      skipped_by_sampling_limit: 0,
    });

    const fetchedContentPaths = requests
      .filter((request) => request.url.pathname.includes("/contents/"))
      .map((request) =>
        decodeURIComponent(request.url.pathname.split("/contents/")[1] ?? ""),
      );
    expect(fetchedContentPaths).toEqual([
      "README.md",
      "package.json",
      "docs/guide.md",
      "docs/leak.md",
      "src/index.ts",
      "src/worker.ts",
    ]);
    expect(requests).toHaveLength(8);

    for (const request of requests) {
      const headers = new Headers(request.init?.headers);
      expect(request.url.origin).toBe("https://api.github.com");
      expect(headers.get("x-github-api-version")).toBe("2026-03-10");
      expect(headers.has("authorization")).toBe(false);
      expect(request.init?.credentials).toBe("omit");
      expect(request.init?.redirect).toBe("error");
    }
  });

  it("allows callers to lower, but not raise, sampling limits", async () => {
    const fixture = await loadFixture();
    const { fetchImpl, requests } = createSyntheticFetch(fixture);
    const summary = await summarizePublicGitHubRepository(
      fixture.repository_url,
      {
        fetchImpl,
        limits: {
          maxFiles: 2,
          maxFileBytes: Number.MAX_SAFE_INTEGER,
        },
      },
    );

    expect(summary.files.map((file) => file.path)).toEqual([
      "README.md",
      "package.json",
    ]);
    expect(summary.coverage.skipped_by_sampling_limit).toBe(4);
    expect(summary.limits.maxFiles).toBe(2);
    expect(summary.limits.maxFileBytes).toBe(32 * 1024);
    expect(requests).toHaveLength(4);
  });

  it.each([
    "http://github.com/acme/synthetic-repository",
    "https://api.github.com/acme/synthetic-repository",
    "https://github.com/acme/synthetic-repository/tree/main",
    "https://github.com/acme/synthetic-repository?tab=readme",
  ])("rejects a non-canonical repository URL before fetching: %s", (url) => {
    expect(() => parsePublicGitHubRepositoryUrl(url)).toThrow(
      GitHubPublicRepositoryError,
    );

    try {
      parsePublicGitHubRepositoryUrl(url);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_repository_url" });
      expect((error as Error).message).not.toContain(url);
    }
  });

  it("fails closed when metadata says the repository is private", async () => {
    const fixture = await loadFixture();
    const { fetchImpl, requests } = createSyntheticFetch({
      ...fixture,
      metadata: {
        ...fixture.metadata,
        private: true,
        visibility: "private",
      },
    });

    await expect(
      summarizePublicGitHubRepository(fixture.repository_url, { fetchImpl }),
    ).rejects.toMatchObject({ code: "repository_not_public" });
    expect(requests).toHaveLength(1);
  });

  it("does not retry or continue after a rate-limit response", async () => {
    const fixture = await loadFixture();
    const { fetchImpl, requests } = createSyntheticFetch(fixture, {
      metadataResponses: [jsonResponse({ message: "rate limited" }, 429)],
    });

    await expect(
      summarizePublicGitHubRepository(fixture.repository_url, { fetchImpl }),
    ).rejects.toMatchObject({ code: "rate_limited" });
    expect(requests).toHaveLength(1);
  });

  it("retries one transient server failure and then continues", async () => {
    const fixture = await loadFixture();
    const { fetchImpl, requests } = createSyntheticFetch(fixture, {
      metadataResponses: [
        jsonResponse({ message: "temporary failure" }, 503),
        jsonResponse(fixture.metadata),
      ],
    });

    await expect(
      summarizePublicGitHubRepository(fixture.repository_url, { fetchImpl }),
    ).resolves.toMatchObject({
      source: "github-public",
      repository: { name: "synthetic-repository" },
    });
    expect(
      requests.filter(
        (request) =>
          request.url.pathname === "/repos/acme/synthetic-repository",
      ),
    ).toHaveLength(2);
  });

  it("fails with a safe timeout code when GitHub does not respond", async () => {
    const fixture = await loadFixture();
    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      });

    await expect(
      summarizePublicGitHubRepository(fixture.repository_url, {
        fetchImpl,
        limits: { timeoutMs: 5 },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects an oversized response before parsing it", async () => {
    const fixture = await loadFixture();
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({}, 200, {
        "content-length": String(64 * 1024 + 1),
      });

    await expect(
      summarizePublicGitHubRepository(fixture.repository_url, { fetchImpl }),
    ).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("reports truncated trees and recoverable file failures as unknowns", async () => {
    const fixture = await loadFixture();
    const { fetchImpl } = createSyntheticFetch(fixture, {
      treeTruncated: true,
      contentStatus: { "docs/guide.md": 404 },
    });
    const summary = await summarizePublicGitHubRepository(
      fixture.repository_url,
      { fetchImpl },
    );

    expect(summary.coverage.tree_truncated).toBe(true);
    expect(summary.coverage.skipped_fetch_errors).toBe(1);
    expect(summary.unknowns).toContain(
      "目录树响应不完整，摘要只覆盖受限样本。",
    );
    expect(summary.unknowns).toContain(
      "部分候选文件读取失败，摘要可能缺少上下文。",
    );
  });
});
