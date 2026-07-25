const defaultMarkdownFileName = "margrop-labs-export.md";

const windowsReservedNames = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i;

export const normalizeMarkdownFileName = (candidate: unknown): string => {
  if (typeof candidate !== "string") {
    return defaultMarkdownFileName;
  }

  const pathTail =
    candidate.normalize("NFKC").replace(/\\/g, "/").split("/").at(-1) ?? "";
  const withoutExtension = pathTail.replace(/\.[^.]*$/, "");
  let stem = withoutExtension
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 72)
    .replace(/[-_.]+$/g, "");

  if (windowsReservedNames.test(stem)) {
    stem = `export-${stem}`;
  }

  return stem.length > 0 ? `${stem}.md` : defaultMarkdownFileName;
};
