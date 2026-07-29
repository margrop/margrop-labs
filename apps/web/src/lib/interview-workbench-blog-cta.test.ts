import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  InterviewWorkbenchBlogCtaError,
  renderInterviewWorkbenchBlogCtaFooter,
  renderInterviewWorkbenchBlogCtaInline,
  validateInterviewWorkbenchBlogCta,
} from "./interview-workbench-blog-cta";

const integrationUrl = (name: string): URL =>
  new URL(
    `../../../../labs/interview-workbench/integrations/${name}`,
    import.meta.url,
  );

const readIntegration = async (name: string): Promise<string> =>
  readFile(integrationUrl(name), "utf8");

const readContract = async (): Promise<unknown> =>
  JSON.parse(await readIntegration("interview-workbench-cta.json")) as unknown;

describe("Interview Workbench blog CTA v1", () => {
  it("renders the committed inline and footer snippets exactly", async () => {
    const contract = validateInterviewWorkbenchBlogCta(await readContract());

    expect(renderInterviewWorkbenchBlogCtaInline(contract)).toBe(
      await readIntegration("interview-workbench-cta-inline.md"),
    );
    expect(renderInterviewWorkbenchBlogCtaFooter(contract)).toBe(
      await readIntegration("interview-workbench-cta-footer.md"),
    );
  });

  it("keeps links canonical, HTTPS and tracking-free", async () => {
    const contract = validateInterviewWorkbenchBlogCta(await readContract());
    const rendered = [
      renderInterviewWorkbenchBlogCtaInline(contract),
      renderInterviewWorkbenchBlogCtaFooter(contract),
    ].join("\n");
    const urls = [...rendered.matchAll(/\]\((https:\/\/[^)]+)\)/gu)].map(
      ([, value]) => new URL(value ?? ""),
    );

    expect(urls).toHaveLength(4);
    expect(
      urls.every(
        (url) =>
          url.protocol === "https:" && url.search === "" && url.hash === "",
      ),
    ).toBe(true);
    expect(rendered).not.toMatch(/utm_|from=|ref=|source=/iu);
  });

  it("contains no executable markup or sensitive content fields", async () => {
    const contract = validateInterviewWorkbenchBlogCta(await readContract());
    const rendered = [
      renderInterviewWorkbenchBlogCtaInline(contract),
      renderInterviewWorkbenchBlogCtaFooter(contract),
    ].join("\n");

    expect(rendered).not.toMatch(
      /<script|javascript:|onclick=|resume|\bjd\b|record|prompt|response/iu,
    );
    expect(new TextEncoder().encode(rendered).byteLength).toBeLessThanOrEqual(
      4_096,
    );
  });

  it("rejects unknown fields, non-canonical URLs and Markdown injection", async () => {
    const contract = (await readContract()) as Record<string, unknown>;

    expect(() =>
      validateInterviewWorkbenchBlogCta({
        ...contract,
        campaign: "must-not-cross",
      }),
    ).toThrow(InterviewWorkbenchBlogCtaError);
    expect(() =>
      validateInterviewWorkbenchBlogCta({
        ...contract,
        primary_action: {
          label: "打开实验",
          url: "https://example.com/interview-workbench/",
        },
      }),
    ).toThrow(InterviewWorkbenchBlogCtaError);
    expect(() =>
      validateInterviewWorkbenchBlogCta({
        ...contract,
        title: "[click](javascript:alert(1))",
      }),
    ).toThrow(InterviewWorkbenchBlogCtaError);
  });

  it("renders without network, storage or console side effects", async () => {
    const contract = validateInterviewWorkbenchBlogCta(await readContract());
    const fetchMock = vi.fn();
    const consoleMock = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetchMock);

    try {
      renderInterviewWorkbenchBlogCtaInline(contract);
      renderInterviewWorkbenchBlogCtaFooter(contract);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(consoleMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      consoleMock.mockRestore();
    }
  });
});
