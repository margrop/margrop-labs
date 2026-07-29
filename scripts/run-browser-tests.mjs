import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "..");
const chromiumPackage = JSON.parse(
  await readFile(
    resolve(
      repositoryRoot,
      "node_modules",
      "@sparticuz",
      "chromium",
      "package.json",
    ),
    "utf8",
  ),
);
const browserTemp = resolve(
  repositoryRoot,
  "node_modules",
  ".cache",
  `sparticuz-${chromiumPackage.version}`,
);
const browserCache = resolve(browserTemp, "cache");
await mkdir(browserCache, { recursive: true });
process.env.TMPDIR = browserTemp;
const { default: chromium } = await import("@sparticuz/chromium");
const playwrightCli = resolve(
  repositoryRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const localBrowserCandidates = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

const resolveBrowserExecutable = async () => {
  if (process.env.TOKEN_FORGE_BROWSER_PATH) {
    return process.env.TOKEN_FORGE_BROWSER_PATH;
  }
  if (process.platform === "darwin") {
    const localBrowser = localBrowserCandidates.find((candidate) =>
      existsSync(candidate),
    );
    if (!localBrowser) {
      throw new Error(
        "Chrome or Chromium is required for local browser tests.",
      );
    }
    return localBrowser;
  }

  const getuid = process.getuid;
  process.getuid = () => 1_000;
  try {
    return await chromium.executablePath();
  } finally {
    process.getuid = getuid;
  }
};

const runPlaywright = async (arguments_) => {
  const executablePath = await resolveBrowserExecutable();
  const environment = {
    ...process.env,
    TOKEN_FORGE_BROWSER_PATH: executablePath,
    TOKEN_FORGE_BROWSER_LOCAL: process.platform === "darwin" ? "1" : "0",
    XDG_CACHE_HOME: browserCache,
  };
  const result = spawnSync(process.execPath, [playwrightCli, ...arguments_], {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

await runPlaywright(["test", ...process.argv.slice(2)]);
