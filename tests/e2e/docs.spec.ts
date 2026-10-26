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

test("the index can be filtered down to a page", async ({ page }) => {
  await page.goto("/docs");
  const search = page.getByLabel("Find a page");
  const article = page.locator("article.docs-prose");
  const music = article.getByRole("link", { name: "Music and voice" });
  await expect(music).toBeVisible();
  await search.fill("music");
  await expect(music).toBeVisible();
  await expect(
    article.getByRole("link", { name: "Deployment", exact: true })
  ).toHaveCount(0);
  await search.fill("zzzz-no-such-page");
  await expect(article.getByText(/No page matches/)).toBeVisible();
  await search.fill("");
  await expect(
    article.getByRole("link", { name: "Deployment", exact: true })
  ).toBeVisible();
});

test("a guide marks the current page, offers previous/next and keeps code labelled", async ({
  page,
}) => {
  await page.goto("/docs/workflows");
  const nav = page.locator('nav[aria-label="Documentation"]:visible').first();
  await expect(
    nav.getByRole("link", { name: /Development workflows/ })
  ).toHaveAttribute("aria-current", "page");
  await expect(
    nav.getByRole("link", {
      name: /^Development workflow \(developer guide\)$/,
    })
  ).not.toHaveAttribute("aria-current", "page");
  // A labelled code frame: the language is in the server HTML, not painted by a
  // highlighter after load.
  const frame = page.locator('figure.docs-code[data-language="sh"]').first();
  await expect(frame.locator("figcaption")).toContainText("sh");
  await expect(frame.locator("pre code")).toContainText("npm ci");
  const pages = page.getByRole("navigation", { name: "Documentation pages" });
  await expect(pages.getByRole("link", { name: /Previous/ })).toBeVisible();
  await expect(pages.getByRole("link", { name: /Next/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /More in Building on Orbit/ })
  ).toBeVisible();
});

test("section anchors, copy controls and the skip link are keyboard reachable", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/docs/workflows");
  // First tab stop is the skip link; activating it moves to the content.
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#docs-content$/);

  const copy = page
    .locator('figure.docs-code[data-language="sh"]')
    .first()
    .getByRole("button", { name: "Copy this code block" });
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(copy).toHaveText("Copied");
  await expect(page.getByText("Code copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "npm ci"
  );
  await expect(copy).toHaveText("Copy", { timeout: 4000 });

  // A section's `#` link is a real link; clicking it also copies the deep link.
  const anchor = page.locator("h2 a[data-docs-anchor]").first();
  const id = (await anchor.getAttribute("href"))!;
  await anchor.scrollIntoViewIfNeeded();
  await anchor.click();
  await expect(page).toHaveURL(new RegExp(`${id}$`));
  await expect(page.getByText("Section link copied")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    id
  );
});

test("the mobile navigation is a dialog that closes on the chosen page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/workflows");
  await page.getByRole("button", { name: "Browse documentation" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByRole("navigation", { name: "Documentation" })
  ).toBeVisible();
  await sheet.getByRole("link", { name: /Dev container/ }).click();
  await expect(sheet).not.toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: /Dev Container/ })
  ).toBeVisible();
  // Opening the sheet again and pressing Escape returns focus to the trigger.
  const trigger = page.getByRole("button", { name: "Browse documentation" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("long commands and wide tables scroll inside their frames on a phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const slug of ["workflows", "development", "permissions"]) {
    await page.goto(`/docs/${slug}`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(
      overflow,
      `${slug} must not scroll the page sideways`
    ).toBeLessThanOrEqual(1);
  }
  await page.goto("/docs/workflows");
  const frame = page.locator(".docs-table, figure.docs-code").first();
  await expect(frame).toBeVisible();
});
