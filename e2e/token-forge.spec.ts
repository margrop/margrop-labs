import { expect, test, type Page } from "@playwright/test";

const sampleCard = (page: Page, tier: string) =>
  page.locator(".token-forge-sample").filter({ hasText: tier });

const waitForWorkbenchHydration = async (
  page: Page,
  goal = "为真实浏览器关键路径实现一个无需登录并可以本地验收的合成工具",
): Promise<void> => {
  const field = page.getByRole("textbox", { name: "想完成的目标" });
  await expect
    .poll(async () => {
      await field.fill(goal);
      return page
        .getByLabel("想完成的目标当前值", { exact: true })
        .textContent();
    })
    .toBe(`${goal.length}/500`);
};

test("runs the 6K local sample, focuses the result and downloads an export", async ({
  page,
}) => {
  await page.goto("/token-forge/");
  await waitForWorkbenchHydration(page);
  const card = sampleCard(page, "6K");
  await card.getByRole("button", { name: "用此样例生成模板" }).click();

  const resultHeading = page.getByRole("heading", {
    name: "可执行的模板任务",
  });
  await expect(resultHeading).toBeVisible();
  await expect(resultHeading).toBeFocused();
  await expect(page.locator(".token-forge-task")).toHaveCount(1);
  await expect(
    page.getByRole("navigation", { name: "计划结果快速导航" }),
  ).toBeVisible();
  await expect(page.locator(".token-forge-export-grid > section")).toHaveCount(
    3,
  );

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 计划 Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("token-forge-plan.md");
});

test("keeps a complete template when the public repository is rate limited", async ({
  page,
}) => {
  await page.route("https://api.github.com/**", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({ message: "synthetic rate limit" }),
    });
  });
  await page.goto("/token-forge/");
  await waitForWorkbenchHydration(page);
  const card = sampleCard(page, "24K");
  await card.getByRole("button", { name: "用此样例生成模板" }).click();

  await expect(
    page.getByRole("heading", { name: "可执行的模板任务" }),
  ).toBeVisible();
  await expect(page.getByText(/仓库摘要已降级，模板计划可用/u)).toBeVisible();
  await expect(page.locator(".token-forge-export-grid > section")).toHaveCount(
    3,
  );
});

test("downgrades a rate-limited AI request without losing exports", async ({
  page,
}) => {
  await page.route("**/api/token-forge/plan", async (route) => {
    await route.fulfill({
      status: 429,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "1.0",
        status: "error",
        error: {
          code: "rate_limited",
          retryable: true,
          retry_after_seconds: 60,
        },
        meta: {
          attempt_count: 0,
        },
      }),
    });
  });
  await page.goto("/token-forge/");
  await waitForWorkbenchHydration(page);
  await page.getByRole("button", { name: "AI 增强生成" }).click();

  await expect(
    page.getByRole("heading", { name: "可执行的模板任务" }),
  ).toBeVisible();
  await expect(page.getByText(/AI 已安全降级，模板计划可用/u)).toBeVisible();
  await expect(page.locator(".token-forge-export-grid > section")).toHaveCount(
    3,
  );
});

test.use({
  viewport: {
    width: 320,
    height: 800,
  },
  reducedMotion: "reduce",
});

test("supports the mobile keyboard path without horizontal overflow", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/token-forge/", { waitUntil: "networkidle" });
  const mobileGoal = "为移动端键盘路径实现一个无需登录并可以本地验收的合成工具";
  await waitForWorkbenchHydration(page, mobileGoal);
  const button = sampleCard(page, "6K").getByRole("button", {
    name: "用此样例生成模板",
  });
  await button.focus();
  await expect(button).toBeFocused();
  await button.press("Enter");

  const resultHeading = page.getByRole("heading", {
    name: "可执行的模板任务",
  });
  await expect(resultHeading).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "计划结果快速导航" }),
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
