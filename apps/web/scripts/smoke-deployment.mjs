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

const apiUrl = new URL("/api/token-forge/plan", baseUrl);
const apiResponse = await fetch(apiUrl, {
  method: "POST",
  cache: "no-store",
  redirect: "error",
  headers: {
    "content-type": "application/json",
    origin: baseUrl.origin,
    "user-agent": "margrop-labs-deployment-smoke/1.0",
  },
  body: "{}",
});
assert.equal(apiResponse.status, 400);
assert.equal(apiResponse.headers.get("cache-control"), "no-store");
assert.match(
  apiResponse.headers.get("content-type") ?? "",
  /application\/json/,
);
assert.deepEqual(await apiResponse.json(), {
  schema_version: "1.0",
  status: "error",
  error: {
    code: "invalid_request",
    retryable: false,
  },
  meta: {
    attempt_count: 0,
  },
});

console.log(`Deployment smoke check passed: ${baseUrl.origin}`);
