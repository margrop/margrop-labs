import { describe, expect, it } from "vitest";

import { DEFAULT_SOCIAL_IMAGE_PATH, SITE_NAME, buildSeoMetadata } from "./seo";

const site = new URL("https://lab.margrop.net");

describe("canonical SEO metadata", () => {
  it("builds absolute canonical and social URLs on the production origin", () => {
    expect(
      buildSeoMetadata({
        site,
        pathname: "/token-forge/?from=ignored#result",
        title: "Token Forge",
        description: "A bounded task planner.",
        socialImagePath: "/social/token-forge.png",
        socialImageAlt: "Token Forge preview",
      }),
    ).toEqual({
      canonical: "https://lab.margrop.net/token-forge/",
      description: "A bounded task planner.",
      indexable: true,
      openGraphType: "website",
      robots: "index, follow",
      siteName: SITE_NAME,
      socialDescription: "A bounded task planner.",
      socialImage: "https://lab.margrop.net/social/token-forge.png",
      socialImageAlt: "Token Forge preview",
      socialTitle: "Token Forge",
      title: "Token Forge",
    });
  });

  it("uses the site-wide image and keeps non-indexable pages out of search", () => {
    const metadata = buildSeoMetadata({
      site,
      pathname: "/404/",
      title: "Not found",
      description: "Missing page.",
      indexable: false,
    });

    expect(metadata.socialImage).toBe(
      new URL(DEFAULT_SOCIAL_IMAGE_PATH, site).toString(),
    );
    expect(metadata.robots).toBe("noindex, nofollow");
    expect(metadata.indexable).toBe(false);
  });

  it("fails closed without a canonical site or with an external image", () => {
    expect(() =>
      buildSeoMetadata({
        site: undefined,
        pathname: "/",
        title: "Missing site",
        description: "Missing site.",
      }),
    ).toThrow("Astro site is required");

    expect(() =>
      buildSeoMetadata({
        site,
        pathname: "/",
        title: "External image",
        description: "External image.",
        socialImagePath: "https://tracker.example/card.png",
      }),
    ).toThrow("canonical site origin");
  });
});
