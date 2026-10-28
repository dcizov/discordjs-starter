import { test, expect, type Page, type Request } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Visual evidence capture, not an assertion suite.
 *
 * The point is to review what the dashboard actually looks like with fixed,
 * repeatable conditions: same viewport, light theme, demo data, tour dismissed,
 * network settled. Passing assertions here say nothing about visual quality —
 * a human (or a reviewer reading the uploaded artifacts) has to look at the
 * images, so this spec never claims approval on its own.
 *
 * Runs only when `VISUAL_EVIDENCE=1`, because it writes files and takes much
 * longer than a normal spec:
 *
 *   VISUAL_EVIDENCE=1 npx playwright test tests/e2e/screenshots.spec.ts
 *
 * Output: `visual-evidence/*.png`, deliberately **outside** `test-results/`:
 * Playwright wipes its own output directory at the start of every run, so files
 * written there are gone before the upload step of the following run. The CI
 * `verify` job uploads this directory as `dashboard-screenshots`.
 */
const enabled = process.env.VISUAL_EVIDENCE === "1";
const guild = "120000000000000001";
const root = `/dashboard/${guild}`;
const outputDir = resolve("visual-evidence");

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

/**
 * Follow the requests a page makes, so a networkidle timeout can explain
 * itself.
 *
 * "networkidle timed out" is one of the least useful failures a browser test can
 * produce: it says the page never went quiet without saying what kept it busy.
 * It is also how a polling defect on one page surfaces as a failure of a
 * different page — a run poller hammering the rate limiter starved the member
 * directory, and the only symptom here was that this page never went idle.
 *
 * `page.on("request")` and `page.on("requestfinished")` are attached per call so
 * the counters describe the page being opened rather than the whole run.
 */
function trackRequests(page: Page) {
  const inflight = new Map<string, number>();
  const counts = new Map<string, number>();
  const onRequest = (request: Request) => {
    const url = request.url();
    inflight.set(url, (inflight.get(url) ?? 0) + 1);
    counts.set(url, (counts.get(url) ?? 0) + 1);
  };
  const onSettled = (request: Request) => {
    const url = request.url();
    const left = (inflight.get(url) ?? 0) - 1;
    if (left > 0) inflight.set(url, left);
    else inflight.delete(url);
  };
  page.on("request", onRequest);
  page.on("requestfinished", onSettled);
  page.on("requestfailed", onSettled);
  return {
    counts,
    inflight,
    detach() {
      page.off("request", onRequest);
      page.off("requestfinished", onSettled);
      page.off("requestfailed", onSettled);
    },
    /** A readable diagnosis, used when waiting for stillness fails. */
    describe(limit = 15) {
      const byCount = [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([url, n]) => `  ${String(n).padStart(6)}x  ${url}`)
        .join("\n");
      const pending = [...inflight.keys()]
        .slice(0, limit)
        .map((url) => `  PENDING  ${url}`)
        .join("\n");
      return [
        `Most-requested URLs for this page (${counts.size} distinct, ${[...counts.values()].reduce((a, b) => a + b, 0)} total):`,
        byCount || "  (none)",
        pending ? `Still in flight:\n${pending}` : "Still in flight: (none)",
      ].join("\n");
    },
  };
}

async function open(page: Page, url: string) {
  const traffic = trackRequests(page);
  try {
    await page.goto(url);
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
      timeout: 20000,
    });
    // Animations make two runs differ for no reason; let them finish first.
    try {
      await page.waitForLoadState("networkidle", { timeout: 15000 });
    } catch (cause) {
      // Carry the diagnosis into the GitHub annotation instead of leaving a
      // bare timeout: which URL was asked for most, and what never settled.
      throw new Error(
        `Network never went idle on ${url}.\n${traffic.describe()}`,
        { cause }
      );
    }
    await page.addStyleTag({
      content:
        "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}",
    });
  } finally {
    traffic.detach();
  }
}

/**
 * Documentation pages have no dashboard hydration marker; they are static. Wait
 * for the network instead, and apply the same motion suppression.
 */
async function openDocs(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.addStyleTag({
    content:
      "*,*::before,*::after{animation-duration:0s!important;transition-duration:0s!important}",
  });
}

async function capture(page: Page, name: string) {
  await page.screenshot({
    path: resolve(outputDir, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}

test.describe("visual evidence", () => {
  test.skip(!enabled, "Set VISUAL_EVIDENCE=1 to capture review screenshots");

  test.beforeAll(() => {
    mkdirSync(outputDir, { recursive: true });
  });

  test.use({ viewport: desktop });

  test("desktop sections", async ({ page }) => {
    const sections = [
      ["", "overview"],
      [`${root}/news`, "news"],
      [`${root}/music`, "music"],
      [`${root}/audit`, "audit"],
      [`${root}/settings`, "settings-config-form"],
      [`${root}/economy`, "economy"],
      [`${root}/xp`, "levels"],
      [`${root}/channels`, "channels"],
      [`${root}/templates`, "templates"],
      [`${root}/members`, "members"],
    ] as const;
    for (const [url, name] of sections) {
      await open(page, url || "/");
      await capture(page, `desktop-${name}`);
    }
  });

  test("confirmation dialog", async ({ page }) => {
    await open(page, `${root}/music`);
    const stop = page.getByRole("button", { name: "Stop playback" });
    // Demo music state decides whether something is "playing"; when it is not,
    // the button is disabled and the dialog cannot be shown.
    if (await stop.isEnabled()) {
      await stop.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, "desktop-confirm-dialog");
    } else {
      test.info().annotations.push({
        type: "note",
        description:
          "No demo track is playing, so the stop confirmation cannot be opened.",
      });
    }
  });

  test("member detail and column menu", async ({ page }) => {
    await open(page, `${root}/members`);
    await capture(page, "desktop-members");
    await page.getByRole("button", { name: "Columns", exact: true }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await capture(page, "desktop-members-columns");
    await page.keyboard.press("Escape");
    const firstAction = page
      .getByRole("button", { name: /^Actions for / })
      .first();
    if (await firstAction.count()) {
      await firstAction.click();
      await page.getByRole("menuitem", { name: "View member details" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, "desktop-member-detail");
    }
  });

  test("empty and no-match states", async ({ page }) => {
    await open(page, `${root}/audit`);
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await search.fill("zzz-no-such-audit-entry");
      await page.waitForLoadState("networkidle");
      await capture(page, "desktop-audit-no-match");
    }
  });

  test("documentation index and guide, light and dark", async ({ page }) => {
    await openDocs(page, "/docs");
    await capture(page, "desktop-docs-index");
    await openDocs(page, "/docs/workflows");
    await capture(page, "desktop-docs-workflows");
    await page.evaluate(() => window.localStorage.setItem("theme", "dark"));
    await openDocs(page, "/docs/workflows");
    await capture(page, "desktop-docs-workflows-dark");
    await page.evaluate(() => window.localStorage.setItem("theme", "light"));
    await page.setViewportSize(mobile);
    await openDocs(page, "/docs/workflows");
    await capture(page, "mobile-docs-guide");
    await page.getByRole("button", { name: "Browse documentation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await capture(page, "mobile-docs-navigation");
  });

  test("mobile navigation and overview", async ({ page }) => {
    await page.setViewportSize(mobile);
    await open(page, "/");
    await capture(page, "mobile-overview");
    await open(page, `${root}/members`);
    await capture(page, "mobile-members");
    const nav = page.getByRole("button", { name: "Open navigation" });
    if (await nav.count()) {
      await nav.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await capture(page, "mobile-navigation");
    }
  });
});
