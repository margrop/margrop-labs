import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  TokenForgeBlogCtaError,
  renderTokenForgeBlogCtaFooter,
  renderTokenForgeBlogCtaInline,
  validateTokenForgeBlogCta,
} from "./token-forge-blog-cta";

const integrationUrl = (name: string): URL =>
  new URL(`../../../../labs/token-forge/integrations/${name}`, import.meta.url);

const readIntegration = async (name: string): Promise<string> =>
  readFile(integrationUrl(name), "utf8");

const readContract = async (): Promise<unknown> =>
  JSON.parse(await readIntegration("token-forge-cta.json")) as unknown;

describe("Token Forge blog CTA v1", () => {
  it("accepts the versioned CTA contract and renders committed snippets exactly", async () => {
    const contract = validateTokenForgeBlogCta(await readContract());

    expect(renderTokenForgeBlogCtaInline(contract)).toBe(
      await readIntegration("token-forge-cta-inline.md"),
    );
    expect(renderTokenForgeBlogCtaFooter(contract)).toBe(
      await readIntegration("token-forge-cta-footer.md"),
    );
  });

  it("keeps every link canonical, HTTPS and free of tracking parameters", async () => {
    const contract = validateTokenForgeBlogCta(await readContract());
    const rendered = [
      renderTokenForgeBlogCtaInline(contract),
      renderTokenForgeBlogCtaFooter(contract),
    ].join("\n");
    const urls = [...rendered.matchAll(/\]\((https:\/\/[^)]+)\)/gu)].map(
      ([, value]) => new URL(value ?? ""),
    );

    expect(urls).toHaveLength(4);
    expect(
      urls.every(
        (url) =>
          url.protocol === "https:" &&
          url.search === "" &&
          url.hash === "" &&
          ["lab.margrop.net", "github.com"].includes(url.hostname),
      ),
    ).toBe(true);
    expect(rendered).not.toMatch(/utm_|from=|ref=|source=/iu);
  });

  it("contains no executable markup, placeholders or user-derived fields", async () => {
    const contract = validateTokenForgeBlogCta(await readContract());
    const rendered = [
      renderTokenForgeBlogCtaInline(contract),
      renderTokenForgeBlogCtaFooter(contract),
    ].join("\n");

    expect(rendered).not.toMatch(
      /<script|javascript:|onerror=|onclick=|<lab-id>|repository_url|goal|prompt|response|api[_-]?key/iu,
    );
    expect(new TextEncoder().encode(rendered).byteLength).toBeLessThanOrEqual(
      4_096,
    );
  });

  it("rejects unknown fields, tracking URLs and Markdown injection", async () => {
    const contract = (await readContract()) as Record<string, unknown>;

    expect(() =>
      validateTokenForgeBlogCta({
        ...contract,
        campaign: "must-not-cross",
      }),
    ).toThrow(TokenForgeBlogCtaError);
    expect(() =>
      validateTokenForgeBlogCta({
        ...contract,
        primary_action: {
          label: "打开实验",
          url: "https://lab.margrop.net/token-forge/?utm_source=blog",
        },
      }),
    ).toThrow(TokenForgeBlogCtaError);
    expect(() =>
      validateTokenForgeBlogCta({
        ...contract,
        title: "[click](javascript:alert(1))",
      }),
    ).toThrow(TokenForgeBlogCtaError);
  });

  it("renders without network, storage or console side effects", async () => {
    const contract = validateTokenForgeBlogCta(await readContract());
    const fetchMock = vi.fn();
    const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    try {
      renderTokenForgeBlogCtaInline(contract);
      renderTokenForgeBlogCtaFooter(contract);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      consoleMock.mockRestore();
    }
  });
});
