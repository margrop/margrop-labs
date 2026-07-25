import assert from "node:assert/strict";

const [targetUrl] = process.argv.slice(2);

assert(
  targetUrl,
  "Usage: npm run smoke --workspace @margrop-labs/web -- <url>",
);

const baseUrl = new URL(targetUrl);
const attempts = 12;
const retryDelayMs = 5_000;

async function fetchTextWithRetry(url, validate) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        headers: {
          "cache-control": "no-cache",
          "user-agent": "margrop-labs-deployment-smoke/1.0",
        },
        redirect: "follow",
      });

      if (response.ok) {
        const text = await response.text();
        validate(text);
        return text;
      }

      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw lastError;
}

await fetchTextWithRetry(baseUrl, (homepage) => {
  assert.match(homepage, /<title>[^<]*Margrop Labs[^<]*<\/title>/);
  assert.match(homepage, /Token 任务炼金炉/);
  assert.match(
    homepage,
    /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*\/?>/,
  );
});

const robotsUrl = new URL("/robots.txt", baseUrl);
await fetchTextWithRetry(robotsUrl, (robots) => {
  assert.match(robots, /User-agent:\s*\*/);
});

console.log(`Deployment smoke check passed: ${baseUrl.origin}`);
