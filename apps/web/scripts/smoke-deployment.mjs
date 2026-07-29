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
    /<link\s+rel="canonical"\s+href="https:\/\/lab\.margrop\.net\/"\s*\/?>/,
  );
  assert.match(
    homepage,
    /<meta\s+property="og:image"\s+content="https:\/\/lab\.margrop\.net\/social\/margrop-labs\.png"\s*\/?>/,
  );
  assert.match(
    homepage,
    /<meta\s+name="viewport"\s+content="width=device-width,\s*initial-scale=1"\s*\/?>/,
  );
});

const tokenForgeUrl = new URL("/token-forge/", baseUrl);
await fetchTextWithRetry(tokenForgeUrl, (tokenForge) => {
  assert.match(
    tokenForge,
    /<link\s+rel="canonical"\s+href="https:\/\/lab\.margrop\.net\/token-forge\/"\s*\/?>/,
  );
  assert.match(
    tokenForge,
    /<meta\s+property="og:image"\s+content="https:\/\/lab\.margrop\.net\/social\/token-forge\.png"\s*\/?>/,
  );
  assert.match(tokenForge, /"@type":"WebApplication"/);
});

const interviewWorkbenchUrl = new URL("/interview-workbench/", baseUrl);
await fetchTextWithRetry(interviewWorkbenchUrl, (interviewWorkbench) => {
  assert.match(
    interviewWorkbench,
    /<link\s+rel="canonical"\s+href="https:\/\/lab\.margrop\.net\/interview-workbench\/"\s*\/?>/,
  );
  assert.match(
    interviewWorkbench,
    /<meta\s+name="robots"\s+content="index, follow"\s*\/?>/,
  );
  assert.match(
    interviewWorkbench,
    /<meta\s+property="og:image"\s+content="https:\/\/lab\.margrop\.net\/social\/interview-workbench\.png"\s*\/?>/,
  );
  assert.match(interviewWorkbench, /"@type":"WebApplication"/);
});

const robotsUrl = new URL("/robots.txt", baseUrl);
await fetchTextWithRetry(robotsUrl, (robots) => {
  assert.match(robots, /User-agent:\s*\*/);
  assert.match(
    robots,
    /Sitemap:\s*https:\/\/lab\.margrop\.net\/sitemap-index\.xml/,
  );
});

const sitemapIndexUrl = new URL("/sitemap-index.xml", baseUrl);
await fetchTextWithRetry(sitemapIndexUrl, (sitemapIndex) => {
  assert.match(
    sitemapIndex,
    /<loc>https:\/\/lab\.margrop\.net\/sitemap-0\.xml<\/loc>/,
  );
});

const sitemapUrl = new URL("/sitemap-0.xml", baseUrl);
await fetchTextWithRetry(sitemapUrl, (sitemap) => {
  assert.match(
    sitemap,
    /<loc>https:\/\/lab\.margrop\.net\/token-forge\/<\/loc>/,
  );
  assert.match(
    sitemap,
    /<loc>https:\/\/lab\.margrop\.net\/interview-workbench\/<\/loc>/,
  );
  assert.doesNotMatch(sitemap, /\/404|\/api\//);
});

const apiUrl = new URL("/api/token-forge/plan", baseUrl);
let apiError;

for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const apiResponse = await fetch(apiUrl, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        "cache-control": "no-cache",
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
    apiError = undefined;
    break;
  } catch (error) {
    apiError = error;
  }

  if (attempt < attempts) {
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}

if (apiError !== undefined) {
  throw apiError;
}

for (const analyticsPath of [
  "/api/token-forge/events",
  "/api/interview-workbench/events",
]) {
  const analyticsUrl = new URL(analyticsPath, baseUrl);
  const analyticsResponse = await fetch(analyticsUrl, {
    method: "POST",
    cache: "no-store",
    redirect: "error",
    headers: {
      "cache-control": "no-cache",
      "content-type": "application/json",
      origin: baseUrl.origin,
      "user-agent": "margrop-labs-deployment-smoke/1.0",
    },
    body: "{}",
  });
  assert.equal(analyticsResponse.status, 400);
  assert.equal(analyticsResponse.headers.get("cache-control"), "no-store");
  assert.equal(await analyticsResponse.text(), "");
}

console.log(`Deployment smoke check passed: ${baseUrl.origin}`);
