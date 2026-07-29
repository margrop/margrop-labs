import { expect, test } from "@playwright/test";
import proposalFixtureCandidate from "../labs/incident-detective/fixtures/case-proposal.valid.json";

const proposalFixture = proposalFixtureCandidate as Record<string, unknown>;

const success = (requestId: string, result: unknown): string =>
  JSON.stringify({
    schema_version: "1.0",
    request_id: requestId,
    status: "ok",
    result,
    usage: { input_tokens: 800, output_tokens: 500, total_tokens: 1300 },
    meta: { attempt_count: 1 },
  });

test("completes investigation, AI explanation and human review", async ({
  page,
}) => {
  const explanationRequests: unknown[] = [];
  await page.route("**/api/incident-detective/explanation", async (route) => {
    const request = (await route.request().postDataJSON()) as {
      request_id: string;
      input: {
        scenario_id: string;
        score: {
          total_score: number;
          dimensions: Array<{
            findings: Array<{ rule_id: string; status: string }>;
          }>;
        };
      };
    };
    explanationRequests.push(request);
    const finding = request.input.score.dimensions
      .flatMap(({ findings }) => findings)
      .find(({ status }) => status === "met");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: success(request.request_id, {
        schema_version: "1.0",
        scenario_id: request.input.scenario_id,
        total_score: request.input.score.total_score,
        headline: "取证顺序和安全边界已经形成可审计闭环。",
        strengths: [
          {
            finding_rule_id: finding?.rule_id,
            explanation: "确定性规则确认了这项证据优先行为。",
          },
        ],
        gaps: [],
        safe_next_steps: [
          {
            title: "继续只读验证",
            rationale: "保留证据并在任何生产变更前请求人工审批。",
            evidence_ids: [],
            safety: "read-only",
          },
        ],
        unknowns: ["模型没有收到证据正文，因此不能扩展新的事实。"],
        disclaimer: "AI 解释不改变确定性评分、案例事实或未知项。",
      }),
    });
  });
  await page.route("**/api/incident-detective/case-proposal", async (route) => {
    const request = (await route.request().postDataJSON()) as {
      request_id: string;
    };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: success(request.request_id, proposalFixture),
    });
  });

  await page.goto("/incident-detective/");
  await expect(page.getByText("INCIDENT DETECTIVE · ALPHA")).toBeVisible();

  for (const title of [
    "合成可观测链路拓扑",
    "MySQL 与 Exporter 存活状态",
    "结账搜索延迟趋势",
    "MySQL 连接压力趋势",
    "结账请求的合成 Trace 日志",
    "慢查询形态的只读 EXPLAIN",
  ]) {
    await page
      .locator(".incident-evidence")
      .filter({ has: page.getByRole("heading", { name: title, exact: true }) })
      .getByRole("button", { name: "获取证据" })
      .click();
  }

  await page
    .getByLabel("根因假设")
    .fill(
      "MySQL 保持存活，但搜索查询无法有效使用普通索引，扫描时间增长后连接堆积并造成结账超时。",
    );
  await page.getByLabel(/Checkout API/).check();
  await page.getByLabel(/Orders MySQL/).check();
  for (const title of [
    "结账搜索延迟趋势",
    "MySQL 连接压力趋势",
    "结账请求的合成 Trace 日志",
    "慢查询形态的只读 EXPLAIN",
  ]) {
    await page
      .locator(".incident-evidence-roles > div")
      .filter({ hasText: title })
      .getByLabel("支持")
      .check();
  }
  await page
    .locator(".incident-evidence-roles > div")
    .filter({ hasText: "MySQL 与 Exporter 存活状态" })
    .getByLabel("反证")
    .check();
  await page
    .getByLabel("下一步")
    .fill(
      "先在合成数据上验证查询改写和查询计划，再带回滚方案请求人工批准生产变更。",
    );
  for (const value of [
    "read_only_first",
    "preserve_evidence",
    "least_privilege",
    "request_approval",
  ]) {
    await page
      .locator(`input[name="safety_actions"][value="${value}"]`)
      .check();
  }
  await page.getByRole("button", { name: "验证并评分" }).click();
  await expect(page.locator(".incident-score-number")).toContainText("100");

  await page.getByRole("button", { name: "请求 AI 解释" }).click();
  await expect(
    page.getByText("取证顺序和安全边界已经形成可审计闭环。"),
  ).toBeVisible();
  expect(JSON.stringify(explanationRequests)).not.toContain("hypothesis");
  expect(JSON.stringify(explanationRequests)).not.toContain("next_action");
  expect(JSON.stringify(explanationRequests)).not.toContain("series");

  const workshop = page.getByRole("region", { name: "安全场景变体工坊" });
  await workshop.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      workshop.evaluate(
        (element) => !element.closest("astro-island")?.hasAttribute("ssr"),
      ),
    )
    .toBe(true);
  expect(
    await page
      .locator(".incident-workshop-form :invalid")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          name: node.getAttribute("aria-label") ?? node.textContent,
          message: (node as HTMLInputElement).validationMessage,
        })),
      ),
  ).toEqual([]);
  await page.getByRole("button", { name: "生成待审核 Proposal" }).click();
  await expect(
    page.getByRole("heading", { name: String(proposalFixture.title) }),
  ).toBeVisible();
  for (const label of [
    "已确认全部数据为合成数据",
    "已确认答案与公开场景分离",
    "已确认全部证据访问只读",
    "已确认包含合理反证",
    "已确认预算内存在闭合路径",
    "已确认没有敏感或真实基础设施标识",
    "已确认评分规则独立于 Proposal",
  ]) {
    await page.getByLabel(label).check();
  }
  await page.getByLabel("审核决定").selectOption("approved");
  await page
    .getByLabel("审核备注（必填，每行至少 10 字）")
    .fill("七项边界均已由人工逐项复核，可以进入人工制作阶段。");
  await page.getByRole("button", { name: "验证人工审核" }).click();
  await expect(
    page.getByText("decision=approved · publishable=false"),
  ).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载本地审核包" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe(
    "incident-detective-checkout-cache-stampede-review.json",
  );
});

test.use({ viewport: { width: 320, height: 800 } });

test("keeps the page usable at 320px with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/incident-detective/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: "安全场景变体工坊" }),
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
