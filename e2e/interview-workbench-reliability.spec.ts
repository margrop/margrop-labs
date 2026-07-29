import { expect, test } from "@playwright/test";

test("degrades all three AI actions to the deterministic loop on provider failure", async ({
  page,
}) => {
  await page.route("**/api/interview-workbench/*", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: "1.0",
        status: "error",
        error: { code: "provider_unavailable", retryable: true },
        meta: { attempt_count: 1 },
      }),
    });
  });

  await page.goto("/interview-workbench/");
  await page.getByRole("button", { name: "AI 匹配复核" }).click();
  await expect(
    page.getByText("AI 不可用，已保留本地结果", { exact: true }),
  ).toBeVisible();

  await page.locator(".interview-stepper").getByRole("button").nth(1).click();
  await page.getByRole("button", { name: "AI 计划建议" }).click();
  await expect(
    page.getByText("AI 不可用，已保留本地结果", { exact: true }),
  ).toBeVisible();

  await page.locator(".interview-stepper").getByRole("button").nth(2).click();
  await page.getByRole("button", { name: "AI 结论草稿" }).click();
  await expect(
    page.getByText("AI 不可用，已保留本地结果", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "当前页面仍保留完整匹配、面试计划、记录、结论草稿和安全摘要。",
      { exact: true },
    ),
  ).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Markdown" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "interview-interviewer-summary.md",
  );
});
