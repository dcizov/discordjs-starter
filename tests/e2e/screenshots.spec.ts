import { test, expect, type Page } from "@playwright/test";
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
 * Output: `test-results/screenshots/*.png` (uploaded as a CI artifact on every
 * run of the `visual-evidence` job).
 */
const enabled = process.env.VISUAL_EVIDENCE === "1";
const guild = "120000000000000001";
const root = `/dashboard/${guild}`;
const outputDir = resolve("test-results/screenshots");

const desktop = { width: 1440, height: 900 };
const mobile = { width: 390, height: 844 };

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20000,
  });
  // Animations make two runs differ for no reason; let them finish first.
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
      [`${root}/channels`, "channels"],
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

  test("empty and no-match states", async ({ page }) => {
    await open(page, `${root}/audit`);
    const search = page.getByPlaceholder(/search/i).first();
    if (await search.count()) {
      await search.fill("zzz-no-such-audit-entry");
      await page.waitForLoadState("networkidle");
      await capture(page, "desktop-audit-no-match");
    }
  });

  test("mobile navigation and overview", async ({ page }) => {
    await page.setViewportSize(mobile);
    await open(page, "/");
    await capture(page, "mobile-overview");
    const nav = page.getByRole("button", { name: "Open navigation" });
    if (await nav.count()) {
      await nav.click();
      await expect(
        page.getByRole("button", { name: "Close navigation" })
      ).toBeVisible();
      await capture(page, "mobile-navigation");
    }
  });
});
