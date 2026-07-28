import { spawnSync } from "node:child_process";
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
const runPlaywright = async (arguments_) => {
  const getuid = process.getuid;
  process.getuid = () => 1_000;
  let executablePath;
  try {
    executablePath = await chromium.executablePath();
  } finally {
    process.getuid = getuid;
  }
  const environment = {
    ...process.env,
    TOKEN_FORGE_BROWSER_PATH: executablePath,
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
