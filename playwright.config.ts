import { defineConfig, devices } from "@playwright/test";
import chromium from "@sparticuz/chromium";

const executablePath = process.env.TOKEN_FORGE_BROWSER_PATH;

if (!executablePath) {
  throw new Error(
    "TOKEN_FORGE_BROWSER_PATH must be provided by scripts/run-browser-tests.mjs.",
  );
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "artifacts/playwright",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: "http://127.0.0.1:4321",
    launchOptions: {
      args: chromium.args.filter((argument) => argument !== "--single-process"),
      executablePath,
    },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  webServer: {
    command:
      "npm run preview --workspace @margrop-labs/web -- --host 127.0.0.1 --port 4321",
    url: "http://127.0.0.1:4321/token-forge/",
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ASTRO_TELEMETRY_DISABLED: "1",
    },
  },
});
