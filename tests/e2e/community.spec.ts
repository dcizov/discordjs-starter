import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
const gid = "120000000000000001",
  base = `/api/guilds/${gid}`,
  root = `/dashboard/${gid}`,
  origin = "http://localhost:3000";
test.use({ timezoneId: "America/Los_Angeles" });
let original: any;
let configChanged = false;
const kinds = new Set<"poll" | "announcement">();
const names: string[] = [];
async function visit(page: Page, section: string) {
  await page.goto(`${root}/${section}`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
async function config(request: APIRequestContext, value: any) {
  const response = await request.patch(`${base}/config`, {
    headers: { origin },
    data: value,
  });
  expect(response.ok()).toBe(true);
  configChanged = true;
}
async function draft(
  request: APIRequestContext,
  kind: "poll" | "announcement",
  title: string
) {
  names.push(title);
  kinds.add(kind);
  const response = await request.post(`${base}/community`, {
    headers: { origin, "Idempotency-Key": randomUUID() },
    data: {
      kind,
      title,
      channelId: "120000000000000201",
      body: kind === "announcement" ? "A safe community notice." : "",
      poll:
        kind === "poll"
          ? {
              question: "Which game should we play?",
              answers: ["Co-op", "Board games"],
              durationHours: 24,
              allowMultiselect: false,
            }
          : null,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
test.beforeEach(async ({ request }) => {
  names.length = 0;
  kinds.clear();
  configChanged = false;
  const response = await request.get(base);
  expect(response.ok()).toBe(true);
  original = (await response.json()).guild.config;
});
test.afterEach(async ({ request }) => {
  // Only query/delete records this test actually created; do not spend the
  // shared per-user quota on unrelated cleanup reads or no-op config writes.
  for (const kind of kinds) {
    const response = await request.get(
      `${base}/community?kind=${kind}&pageSize=20`
    );
    if (!response.ok()) continue;
    for (let post of (await response.json()).items.filter((p: any) =>
      names.includes(p.title)
    )) {
      if (post.state === "scheduled") {
        const cancelled = await request.post(
          `${base}/community/${post.id}/actions`,
          {
            headers: { origin },
            data: { action: "cancel", version: post.version },
          }
        );
        if (cancelled.ok()) post = (await cancelled.json()).post;
      }
      await request.delete(`${base}/community/${post.id}`, {
        headers: { origin },
        data: { version: post.version },
      });
    }
  }
  if (configChanged) await config(request, original);
});
test("poll draft validation, explicit opt-in, immutable simulation and paused cleanup work with keyboard focus", async ({
  page,
  request,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, polls: false },
  });
  await visit(page, "polls");
  const create = page.getByRole("button", { name: "New poll", exact: true });
  await expect(create).toBeDisabled();
  await page.getByRole("button", { name: "Enable polls", exact: true }).click();
  await expect(create).toBeEnabled();
  await create.focus();
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Draft name", { exact: true })).toBeFocused();
  const title = "E2E · Native game-night poll";
  names.push(title);
  kinds.add("poll");
  await dialog.getByLabel("Draft name", { exact: true }).fill(title);
  await dialog
    .getByLabel("Poll question", { exact: true })
    .fill("Which game should we play?");
  await dialog.getByLabel("Answers", { exact: true }).fill("Co-op\nco-op");
  await dialog
    .getByRole("button", { name: "Save unsent draft", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("different");
  await dialog
    .getByLabel("Answers", { exact: true })
    .fill("Co-op\nBoard games");
  await dialog
    .getByRole("button", { name: "Save unsent draft", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  const article = page.getByRole("article", { name: title, exact: true });
  await expect(article).toContainText("Simulation · draft");
  await article
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Demo simulation — no Discord I/O");
  await dialog
    .getByRole("button", { name: "Simulate publish", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(article).toContainText("Simulation · published");
  await expect(
    article.getByRole("button", { name: "Edit draft", exact: true })
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Pause module", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable polls", exact: true })
  ).toBeVisible();
  await article
    .getByRole("button", { name: "Refresh results", exact: true })
    .click();
  await expect(
    article.getByRole("cell", { name: "Unknown", exact: true })
  ).toHaveCount(2);
  await article.getByRole("button", { name: "End poll", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "End voting", exact: true })
    .click();
  await expect(article).toContainText("Simulation · closed");
  await page.screenshot({
    path: ".artifacts/native-polls-demo.png",
    fullPage: true,
  });
});
test("announcements preview UTC/server time, reject stale cancellation and remain cancellable while paused", async ({
  page,
  request,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, announcements: true },
  });
  const title = "E2E · Scheduled community notice",
    post = await draft(request, "announcement", title);
  await visit(page, "announcements");
  const article = page.getByRole("article", { name: title, exact: true });
  await article.getByRole("button", { name: "Schedule", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const utc = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);
  await dialog.getByLabel("Send at (UTC)", { exact: true }).fill(utc);
  await expect(dialog.getByText(/Server time:/)).toContainText(
    original.timezone
  );
  await dialog
    .getByRole("button", { name: "Save schedule", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(article).toContainText("Simulation · scheduled");
  await expect(article).toContainText("not delivered by demo workers");
  expect(
    (
      await request.post(`${base}/community/${post.id}/actions`, {
        headers: { origin },
        data: { action: "cancel", version: post.version },
      })
    ).status()
  ).toBe(409);
  await page.getByRole("button", { name: "Pause module", exact: true }).click();
  await article
    .getByRole("button", { name: "Cancel schedule", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(article).toContainText("Simulation · cancelled");
  await page.screenshot({
    path: ".artifacts/announcements-demo.png",
    fullPage: true,
  });
});
test("stored posts and own-ledger content render without JavaScript; hydration matches across browser zones", async ({
  browser,
  request,
  page,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, polls: true },
  });
  const title = "E2E · Server-rendered poll";
  await draft(request, "poll", title);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const server = await browser.newContext({
    javaScriptEnabled: false,
    timezoneId: "Asia/Tokyo",
  });
  const noJS = await server.newPage();
  await noJS.goto(`http://localhost:3000${root}/polls`);
  await expect(
    noJS.getByRole("article", { name: title, exact: true })
  ).toContainText("Which game should we play?");
  const ssr = await noJS
    .getByRole("article", { name: title, exact: true })
    .innerText();
  await server.close();
  await visit(page, "polls");
  expect(
    await page.getByRole("article", { name: title, exact: true }).innerText()
  ).toBe(ssr);
  const ledger = await browser.newContext({
    javaScriptEnabled: false,
    timezoneId: "Pacific/Kiritimati",
  });
  const ledgerPage = await ledger.newPage();
  await ledgerPage.goto(`http://localhost:3000${root}/economy`);
  await expect(
    ledgerPage.getByRole("heading", {
      name: "Your transaction history",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    ledgerPage.getByTestId("own-history").getByRole("table")
  ).toBeVisible();
  await ledger.close();
  expect(
    errors.filter((e) =>
      /hydration|didn't match|did not match|uncaught/i.test(e)
    )
  ).toEqual([]);
});
test("mobile editor remains keyboard accessible, restores focus and has no page overflow", async ({
  page,
  request,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, announcements: true },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, "announcements");
  const create = page.getByRole("button", {
    name: "New announcement",
    exact: true,
  });
  await create.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Draft name", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByLabel("Destination channel", { exact: true })
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(create).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
test("real origin, tenant and body-size guards protect new endpoints; own history ignores account selectors", async ({
  request,
}) => {
  expect(
    (
      await request.post(`${base}/news-preview`, {
        headers: { origin: "https://attacker.invalid" },
        data: { sourceId: randomUUID(), title: "No delivery" },
      })
    ).status()
  ).toBe(403);
  expect(
    (
      await request.get("/api/guilds/990000000000000999/community?kind=poll")
    ).status()
  ).toBe(403);
  expect(
    (
      await request.post(`${base}/community`, {
        headers: { origin, "Idempotency-Key": randomUUID() },
        data: { body: "x".repeat(70000) },
      })
    ).status()
  ).toBe(413);
  const response = await request.get(
    `${base}/my-transactions?userId=990000000000000999`
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const history = await response.json();
  expect(
    history.rows.every(
      (row: any) => row.userId === "120000000000000099" && row.guildId === gid
    )
  ).toBe(true);
});
test("news routing preview explains matching without fetching or sending", async ({
  page,
}) => {
  await visit(page, "news");
  await page
    .locator("summary")
    .filter({ hasText: "Preview news routing" })
    .click();
  await page
    .getByLabel("Sample headline", { exact: true })
    .fill("Patch release for game night");
  await page.getByLabel("Sample tags", { exact: true }).fill("games,patch");
  await page
    .getByRole("button", { name: "Preview routing only", exact: true })
    .click();
  await expect(
    page.getByText(
      /Fetch performed: no. Send performed: no. Delivery verified: no./
    )
  ).toBeVisible();
  await page
    .getByLabel("Sample headline", { exact: true })
    .fill("Changed preview input");
  await expect(
    page.getByText(
      /Fetch performed: no. Send performed: no. Delivery verified: no./
    )
  ).not.toBeVisible();
});

test("new publishing, routing and private-history controls pass scoped WCAG AA checks", async ({
  page,
  request,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, polls: true, announcements: true },
  });
  await draft(request, "poll", "E2E · Accessible poll snapshot");
  await visit(page, "polls");
  async function check(selector: string) {
    await page.locator(selector).waitFor({ state: "visible" });
    // Audit settled colors/fonts, not an intermediate page/dialog fade. No fixed
    // sleep, motion suppression, relaxed contrast rule or infinite-animation wait.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.allSettled(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === "running" &&
              animation.effect?.getComputedTiming().iterations !== Infinity
          )
          .map((animation) => animation.finished)
      );
    });
    const results = await new AxeBuilder({ page })
      .include(selector)
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          failureSummary: n.failureSummary,
        })),
      }))
    ).toEqual([]);
  }
  await check("[data-community-workspace]");
  await page.getByRole("button", { name: "New poll", exact: true }).click();
  await check('[role="dialog"]');
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Toggle color theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  await check("[data-community-workspace]");
  await visit(page, "news");
  await page
    .locator("summary")
    .filter({ hasText: "Preview news routing" })
    .click();
  await check('[data-testid="news-preview"]');
  await visit(page, "economy");
  await check('[data-testid="own-history"]');
});

test("confirmation copy stays action-specific without publishing from a review", async ({
  page,
  request,
}) => {
  await config(request, {
    ...original,
    modules: { ...original.modules, announcements: true },
  });
  const title = "E2E · Confirmation copy characterization";
  await draft(request, "announcement", title);
  await visit(page, "announcements");
  const article = page.getByRole("article", { name: title, exact: true });
  for (const check of [
    {
      trigger: "Review & publish",
      heading: "Simulate publication",
      submit: "Simulate publish",
      explanation: "All mentions are suppressed.",
    },
    {
      trigger: "Schedule",
      heading: "Schedule once in UTC",
      submit: "Save schedule",
      explanation: "Delivery is not guaranteed.",
    },
    {
      trigger: "Cancel draft",
      heading: "Cancel this unsent post?",
      submit: "Confirm cancellation",
      explanation: "The stored revision will change",
    },
    {
      trigger: "Delete stored record",
      heading: "Delete the stored record?",
      submit: "Delete record",
      explanation: "Audit metadata is retained.",
    },
  ]) {
    await article
      .getByRole("button", { name: check.trigger, exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: check.heading, exact: true })
    ).toBeVisible();
    await expect(
      dialog.getByText(check.explanation, { exact: false })
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: check.submit, exact: true })
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Keep unchanged", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(article).toContainText("Simulation · draft");
  }
});
