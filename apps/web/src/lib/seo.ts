export const SITE_NAME = "Margrop Labs";
export const DEFAULT_SOCIAL_IMAGE_PATH = "/social/margrop-labs.png";
export const DEFAULT_SOCIAL_IMAGE_ALT =
  "Margrop Labs：把技术文章变成可以亲手验证的实验";

export type OpenGraphType = "website";

export interface SeoMetadataOptions {
  site: URL | undefined;
  pathname: string;
  title: string;
  description: string;
  socialTitle?: string;
  socialDescription?: string;
  socialImagePath?: string;
  socialImageAlt?: string;
  openGraphType?: OpenGraphType;
  indexable?: boolean;
}

export interface SeoMetadata {
  canonical: string;
  description: string;
  indexable: boolean;
  openGraphType: OpenGraphType;
  robots: "index, follow" | "noindex, nofollow";
  siteName: typeof SITE_NAME;
  socialDescription: string;
  socialImage: string;
  socialImageAlt: string;
  socialTitle: string;
  title: string;
}

function requireSite(site: URL | undefined): URL {
  if (!site) {
    throw new Error("Astro site is required to build canonical SEO metadata.");
  }

  return site;
}

function buildCanonical(site: URL, pathname: string): URL {
  const canonical = new URL(pathname, site);
  canonical.search = "";
  canonical.hash = "";
  return canonical;
}

function buildSocialImage(site: URL, socialImagePath: string): URL {
  const socialImage = new URL(socialImagePath, site);

  if (socialImage.origin !== site.origin) {
    throw new Error("Social images must use the canonical site origin.");
  }

  return socialImage;
}

export function buildSeoMetadata(options: SeoMetadataOptions): SeoMetadata {
  const site = requireSite(options.site);
  const indexable = options.indexable ?? true;

  return {
    canonical: buildCanonical(site, options.pathname).toString(),
    description: options.description,
    indexable,
    openGraphType: options.openGraphType ?? "website",
    robots: indexable ? "index, follow" : "noindex, nofollow",
    siteName: SITE_NAME,
    socialDescription: options.socialDescription ?? options.description,
    socialImage: buildSocialImage(
      site,
      options.socialImagePath ?? DEFAULT_SOCIAL_IMAGE_PATH,
    ).toString(),
    socialImageAlt: options.socialImageAlt ?? DEFAULT_SOCIAL_IMAGE_ALT,
    socialTitle: options.socialTitle ?? options.title,
    title: options.title,
  };
}
