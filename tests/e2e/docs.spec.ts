import { test, expect } from "@playwright/test";

// The docs are prerendered from the repository Markdown: they must be readable
// without signing in, without JavaScript-only navigation and on a phone.
test.use({ storageState: { cookies: [], origins: [] } });

test("documentation index lists grouped user and developer guides", async ({
  page,
}) => {
  await page.goto("/docs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Orbit documentation" })
  ).toBeVisible();
  const nav = page.locator('nav[aria-label="Documentation"]:visible').first();
  await expect(nav.getByRole("link", { name: /Start here/ })).toBeVisible();
  await expect(
    nav.getByRole("link", { name: /Music and voice/ })
  ).toBeVisible();
  // Every navigation entry points at a stable in-app URL.
  const hrefs = await nav
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(10);
  expect(hrefs.every((href) => href?.startsWith("/docs/"))).toBe(true);
});

test("a guide renders headings, anchors and a table of contents", async ({
  page,
}) => {
  await page.goto("/docs/music");
  await expect(
    page.getByRole("heading", { level: 1, name: /Lavalink v4/ })
  ).toBeVisible();
  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc).toBeVisible();
  const first = toc.getByRole("link").first();
  const target = await first.getAttribute("href");
  expect(target?.startsWith("#")).toBe(true);
  await first.click();
  await expect(page.locator(target!)).toBeVisible();
  // Repository links are rewritten to in-app pages, not broken relative paths.
  await expect(page.locator('main a[href^="/docs/"]').first()).toBeVisible();
});

test("documentation stays usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/permissions");
  const browse = page.getByText("Browse documentation", { exact: true });
  await expect(browse).toBeVisible();
  await browse.click();
  await expect(
    page
      .locator('nav[aria-label="Documentation"]:visible')
      .first()
      .getByRole("link", { name: /Music and voice/ })
  ).toBeVisible();
  // Long tables must not break the layout into horizontal page scroll.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
