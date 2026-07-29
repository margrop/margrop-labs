import { expect, test } from "@playwright/test";

test("runs the dual-role three-step sample and preserves a safe export", async ({
  page,
}) => {
  const events: Array<Record<string, unknown>> = [];
  await page.route("**/api/interview-workbench/events", async (route) => {
    events.push(
      (await route.request().postDataJSON()) as Record<string, unknown>,
    );
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/interview-workbench/match", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "1.0",
        status: "error",
        error: { code: "rate_limited", retryable: true },
        meta: { attempt_count: 0 },
      }),
    });
  });

  await page.goto("/interview-workbench/");
  await expect(
    page.getByRole("heading", { name: "岗位匹配：先看证据，再看区间" }),
  ).toBeVisible();

  const candidateRole = page.getByRole("button", {
    name: "面试者",
    exact: true,
  });
  await expect
    .poll(async () => {
      await candidateRole.click();
      return candidateRole.getAttribute("aria-pressed");
    })
    .toBe("true");
  await page.getByRole("button", { name: "AI 匹配复核" }).click();
  await expect(
    page.getByText("AI 不可用，已保留本地结果", { exact: true }),
  ).toBeVisible();

  await page.locator(".interview-stepper").getByRole("button").nth(1).click();
  await expect(
    page.getByRole("heading", { name: "面试者面试计划" }),
  ).toBeVisible();
  await page.locator(".interview-stepper").getByRole("button").nth(2).click();
  await expect(
    page.getByRole("heading", { name: "记录事实，再生成结论草稿" }),
  ).toBeVisible();

  const fact = page.getByRole("textbox", {
    name: "candidate-entry-1事实摘要",
  });
  await fact.fill("面试者补充了一个可由本人确认的真实结果。");
  await expect(page.getByText(/本地记录已验证/)).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("interview-candidate-summary.md");
  await expect.poll(() => events.length).toBeGreaterThanOrEqual(6);
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "lab_open" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "match_complete" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "plan_complete" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "conclusion_complete" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "ai_fallback" }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({ event_name: "export" }),
  );
  expect(JSON.stringify(events)).not.toMatch(
    /candidate|interviewer|resume|\bjd\b|question|record|prompt|response|error/iu,
  );
});

test("keeps the local flow usable when analytics is unavailable", async ({
  page,
}) => {
  await page.route("**/api/interview-workbench/events", async (route) => {
    await route.fulfill({ status: 503 });
  });
  await page.route("**/api/interview-workbench/match", async (route) => {
    await route.fulfill({ status: 503, body: "{}" });
  });

  await page.goto("/interview-workbench/");
  await page.locator(".interview-stepper").getByRole("button").nth(2).click();
  await page.getByRole("button", { name: "AI 结论草稿" }).click();
  await expect(
    page.getByText("AI 不可用，已保留本地结果", { exact: true }),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "interview-interviewer-summary.md",
  );
});

test.use({
  viewport: { width: 320, height: 800 },
});

test("keeps the workbench usable at 320px with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/interview-workbench/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "岗位匹配：先看证据，再看区间" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
});

test("publishes only the indexable synthetic Alpha surface", async ({
  page,
}) => {
  await page.goto("/interview-workbench/");

  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "index, follow",
  );
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://lab.margrop.net/interview-workbench/",
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://lab.margrop.net/social/interview-workbench.png",
  );
  await expect(page.getByText("INTERVIEW WORKBENCH · ALPHA")).toBeVisible();
  await expect(
    page.getByText("当前是完全合成样例；真实文本尚未接入页面。"),
  ).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(
    page.locator('textarea[name*="resume" i], textarea[name*="jd" i]'),
  ).toHaveCount(0);
});
