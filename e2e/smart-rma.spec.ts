import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

test("classifies the synthetic warning case, degrades AI, and exports safe reports", async ({
  page,
}) => {
  await page.route("**/api/smart-rma/explain", async (route) => {
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

  await page.goto("/smart-rma/");
  await expect(
    page.getByRole("heading", { name: "规则结论：正常" }),
  ).toBeVisible();

  const sampleSelect = page.getByRole("combobox", { name: "完全合成样例" });
  const loadSample = page.getByRole("button", { name: "载入合成样例" });
  const smartctlText = page.getByLabel("smartctl 文本");
  await expect
    .poll(async () => {
      await sampleSelect.selectOption("ata-warning-7-4");
      await loadSample.click();
      return smartctlText.inputValue();
    })
    .toContain("ATA Error Count: 2");
  await page.getByRole("button", { name: "本地解析并脱敏" }).click();

  await expect(
    page.getByRole("heading", { name: "规则结论：注意" }),
  ).toBeVisible();
  await expect(
    page.getByText("冲突：smartctl 报告 PASSED，但确定性规则发现注意级证据。"),
  ).toBeVisible();
  await expect(
    page.locator(".smart-rma-assessment").getByText("ATA 待处理扇区非零"),
  ).toBeVisible();

  await page.getByRole("button", { name: "请求 AI 通俗解释" }).click();
  await expect(page.getByText("AI 暂不可用")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "规则结论：注意" }),
  ).toBeVisible();

  const chineseDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载中文摘要" }).click();
  const chineseDownload = await chineseDownloadPromise;
  expect(chineseDownload.suggestedFilename()).toBe(
    "smart-health-summary.zh-CN.md",
  );
  const chinesePath = await chineseDownload.path();
  if (!chinesePath) throw new Error("Chinese report path required");
  const chineseReport = await readFile(chinesePath, "utf8");
  expect(chineseReport).toContain("规则结论：注意");
  expect(chineseReport).not.toContain("SYNTHETIC-");

  const englishDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载英文 RMA Markdown" }).click();
  const englishDownload = await englishDownloadPromise;
  expect(englishDownload.suggestedFilename()).toBe("smart-rma-evidence.en.md");
  const englishPath = await englishDownload.path();
  if (!englishPath) throw new Error("English report path required");
  const englishReport = await readFile(englishPath, "utf8");
  expect(englishReport).toContain("Observed SMART Evidence");
  expect(englishReport).toContain("does not determine warranty eligibility");
  expect(englishReport).not.toContain("SYNTHETIC-");
});

test.use({ viewport: { width: 320, height: 800 } });

test("keeps the deterministic workflow usable at 320px with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/smart-rma/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "规则结论：正常" }),
  ).toBeVisible();
  await expect(page.getByLabel("smartctl 文本")).toBeVisible();
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
