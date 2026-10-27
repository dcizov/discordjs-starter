import { test, expect, type Page } from "@playwright/test";

/**
 * App-owned hydration coverage, in a browser context with no extensions.
 *
 * Playwright launches a fresh Chromium profile: no Dark Reader, no other
 * extension. Anything reported here is therefore the application's own
 * server/client disagreement, and every message is collected unfiltered — the
 * only test is whether a message is a hydration error.
 *
 * A pass does **not** mean "tested with Dark Reader": an extension that rewrites
 * the live DOM cannot be reproduced by this harness. See
 * `docs/DASHBOARD-UX.md#hydration-warnings-in-the-browser-console` for the
 * diagnosis and the `darkreader-lock` mitigation.
 */
const hydrationError =
  /hydrat|server rendered|minified react error #(418|425)|react\.dev\/errors\/(418|425)/i;
const guild = "/dashboard/120000000000000001";

test.use({ storageState: { cookies: [], origins: [] } });

/** Collect every console error and page error; never drop one before asserting. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return {
    expectNoHydrationErrors() {
      expect(
        consoleErrors.filter((message) => hydrationError.test(message))
      ).toEqual([]);
      expect(pageErrors).toEqual([]);
    },
    consoleErrors,
  };
}

test("the login page hydrates its Lucide mark without an app-owned mismatch", async ({
  page,
}) => {
  const watcher = watch(page);
  let serverHtml = "";
  await page.route("**/login", async (route) => {
    const response = await route.fetch();
    serverHtml = await response.text();
    await route.fulfill({ response, body: serverHtml });
  });
  await page.goto("/login");
  const mark = page.locator('main a[href="/"] svg').first();
  await expect(mark).toBeVisible();
  // The icon markup exists in the server HTML and is unchanged by hydration, so
  // an extension's `--darkreader-inline-*` rewrite cannot be an app mismatch.
  const serverMark = serverHtml.match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? "";
  expect(serverMark).not.toBe("");
  expect(await mark.evaluate((element) => element.outerHTML)).toBe(serverMark);
  expect(serverMark).not.toMatch(/darkreader/i);
  watcher.expectNoHydrationErrors();
});

test("the dashboard overview hydrates icons, identity images and the activity chart", async ({
  page,
}) => {
  const watcher = watch(page);
  await page.goto(`${guild}/overview`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  const images = page.locator(
    '[aria-label="Switch server, current: The Cozy Corner"] img, [aria-label="Account menu for Jamie"] img'
  );
  await expect(images).toHaveCount(2);
  for (const image of await images.all()) {
    await expect
      .poll(() =>
        image.evaluate(
          (element: HTMLImageElement) =>
            element.complete && element.naturalWidth > 0
        )
      )
      .toBe(true);
    // No extension marker on the image the app rendered.
    expect(
      await image.getAttribute("data-darkreader-inline-bgimage")
    ).toBeNull();
  }
  const chart = page.locator("[data-activity-reference]");
  await expect(chart.locator("svg[data-activity-labels]")).toHaveCount(1);
  await expect(chart.locator("[data-activity-day]")).toHaveCount(7);
  // No icon or SVG in the app carries an extension's marker.
  expect(await page.locator("svg[data-darkreader-inline-fill]").count()).toBe(
    0
  );
  watcher.expectNoHydrationErrors();
});

for (const [label, theme, scheme] of [
  ["light", "light", "light"],
  ["dark", "dark", "dark"],
  ["system", "system", "dark"],
] as const) {
  test(`the ${label} theme hydrates the same way and declares its colour scheme`, async ({
    page,
  }) => {
    const watcher = watch(page);
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript((value) => {
      window.localStorage.setItem("theme", value);
    }, theme);
    await page.goto(`${guild}/overview`);
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
      timeout: 15000,
    });
    const html = page.locator("html");
    if (scheme === "dark") await expect(html).toHaveClass(/dark/);
    else await expect(html).not.toHaveClass(/dark/);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme
      )
    ).toBe(scheme);
    await expect(page.locator("[data-activity-reference]")).toBeVisible();
    watcher.expectNoHydrationErrors();
  });
}

test("the documentation pages hydrate their client navigation and filter cleanly", async ({
  page,
}) => {
  const watcher = watch(page);
  await page.goto("/docs");
  await expect(
    page.getByRole("heading", { level: 1, name: "Orbit documentation" })
  ).toBeVisible();
  const search = page.getByLabel("Find a page");
  await search.fill("music");
  await expect(page.getByText(/Showing \d+ of \d+ pages/)).toBeVisible();
  await search.fill("");
  await page
    .locator('nav[aria-label="Documentation"]')
    .first()
    .getByRole("link", { name: /Development workflows/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Development workflows" })
  ).toBeVisible();
  await page
    .locator('nav[aria-label="Documentation"]')
    .first()
    .getByRole("link", { name: /Dev container/ })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: /Dev Container/ })
  ).toBeVisible();
  expect(await page.locator("head meta[name='darkreader-lock']").count()).toBe(
    1
  );
  watcher.expectNoHydrationErrors();
});
