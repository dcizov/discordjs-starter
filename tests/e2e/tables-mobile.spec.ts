import { expect, test, type Locator, type Page } from "@playwright/test";
import { chooseFacet, expectNoHorizontalOverflow } from "./support/ui";

/**
 * The table surface at phone width.
 *
 * A table is the screen most likely to be squeezed into an unreadable grid on a
 * narrow viewport: the controls wrap, the columns do not fit, and the page ends
 * up scrolling sideways. This asserts the composition survives at 390px — the
 * toolbar stays usable, the sortable header and the facet still work, and the
 * table scrolls inside its own surface instead of widening the page.
 *
 * It is a structural check, not a visual review.
 */
const root = "/dashboard/120000000000000001";

/**
 * Every column is reachable, and none is clipped.
 *
 * `scrollWidth > clientWidth` is not this test. That only says the table is
 * wider than its surface, which is the *premise*, not the thing to prove: a
 * table whose last three columns can never be brought into view passes it
 * comfortably.
 *
 * So each header is scrolled to and then measured. The container is the
 * viewport, the pinned first column is the part of it that is covered, and a
 * header counts as reachable only when its whole box sits inside what is left.
 */
async function assertEveryColumnReachable(page: Page, region: Locator) {
  const wrap = region.locator("[data-overflow]");
  await expect(wrap).toBeVisible();
  const headers = region.locator("thead th");
  const count = await headers.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    // Scroll the header clear of the pinned column, which sits on top of the
    // left of the container and would otherwise cover it.
    await headers.nth(index).evaluate((header) => {
      const scroller = header.closest("[data-overflow]") as HTMLElement;
      const pinned = scroller.querySelector("thead th") as HTMLElement | null;
      scroller.scrollLeft =
        (header as HTMLElement).offsetLeft - (pinned?.offsetWidth ?? 0);
    });

    const [box, view, pinned] = await Promise.all([
      headers.nth(index).boundingBox(),
      wrap.boundingBox(),
      headers.first().boundingBox(),
    ]);
    expect(box, `header ${index} has a box`).not.toBeNull();
    expect(view, "the scroll container has a box").not.toBeNull();
    expect(pinned, "the pinned column has a box").not.toBeNull();

    const left = box!;
    const visibleFrom = pinned!.x + pinned!.width;
    // A sub-pixel of rounding is not a clipped column; two pixels is.
    expect(
      left.x,
      `header ${index} starts clear of the pinned column`
    ).toBeGreaterThanOrEqual(visibleFrom - 1);
    expect(
      left.x + left.width,
      `header ${index} ends inside the container`
    ).toBeLessThanOrEqual(view!.x + view!.width + 1);
  }
}

/** The page itself must never be the thing that scrolls sideways. */

test("the channel table stays usable and does not overflow a phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });

  const table = page.getByRole("region", { name: "Channels" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  const all = await rows.count();
  expect(all).toBeGreaterThan(1);

  // Nothing gets squeezed off the page: the document itself never scrolls
  // sideways, and the table container does the scrolling instead.
  await expectNoHorizontalOverflow(page, "channel table at 390px");

  await assertEveryColumnReachable(page, table);

  // The toolbar's controls are reachable and operable at this width.
  await chooseFacet(page, "Filter channel type", "Voice");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("The listening room");
  await expect(page.getByText("Page 1 of 1")).toBeVisible();

  // Sorting is a keyboard-operable button, not a decorative arrow.
  const nameHeader = table.getByRole("columnheader", { name: "Channel" });
  await nameHeader.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(nameHeader).toHaveAttribute("aria-sort", "ascending");
  await expectNoHorizontalOverflow(page, "pinned first column at 390px");
});

/*
 * The toolbar is one row.
 *
 * It used to be one row per facet at this width, which pushed the table down a
 * screen that is already short. Measured as a single line: every control in it
 * shares the same top edge.
 */
test("the table toolbar is a single row at phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });

  const table = page.getByRole("region", { name: "Channels" });
  const controls = table.locator('input[type="search"], button');
  const count = await controls.count();
  expect(count).toBeGreaterThan(1);

  const tops: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox();
    expect(box, `control ${index} is laid out`).not.toBeNull();
    tops.push(Math.round(box!.y));
  }
  // One row: no control sits below another.
  expect(new Set(tops).size, `toolbar rows: ${tops.join(", ")}`).toBe(1);
});

/*
 * The pinned column stays put.
 *
 * Scrolling the container to its far end is the only thing that proves it: a
 * first column that scrolled away with the rest would leave the row numbers
 * and the names behind the moment you went looking for a later column.
 */
test("the first column stays pinned when the table is scrolled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });

  const table = page.getByRole("region", { name: "Channels" });
  const wrap = table.locator("[data-overflow]");
  const first = table.locator("thead th").first();
  await expect(first).toBeVisible();

  const before = await first.boundingBox();
  await wrap.evaluate((el) => {
    (el as HTMLElement).scrollLeft = (el as HTMLElement).scrollWidth;
  });
  const after = await first.boundingBox();

  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  // The container really did scroll, or the test proves nothing.
  const scrolled = await wrap.evaluate((el) => (el as HTMLElement).scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
  expect(
    Math.abs(after!.x - before!.x),
    "the pinned column did not move"
  ).toBeLessThanOrEqual(1);
});

/*
 * Every table on the dashboard, at phone width.
 *
 * One page passing says nothing about the rest: the columns differ, the first
 * column differs, and the amount of content in each cell differs.
 */
const tablePages = [
  { path: "/channels", region: "Channels" },
  { path: "/members", region: "Member directory" },
  { path: "/economy", region: "Contributors by balance" },
  { path: "/xp", region: "XP leaderboard" },
  { path: "/audit", region: "Audit events" },
  { path: "/roles", region: "Role panels" },
  { path: "/moderation", region: "Automod rules" },
  { path: "/news", region: "News sources" },
];

for (const { path, region } of tablePages) {
  test(`every column of ${region} is reachable at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${root}${path}`);
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
      timeout: 20_000,
    });

    const table = page.getByRole("region", { name: region });
    await expect(table).toBeVisible();

    // Throws with the offending element and its label, so a failure names the
    // page instead of reporting a bare "expected 0 to be <= 1".
    await expectNoHorizontalOverflow(page, `${region} at 390px`);
    await assertEveryColumnReachable(page, table);
  });
}

/*
 * The "+N" role count at phone width.
 *
 * The popover is portalled and positioned by Radix, so it is the one piece of
 * the role cell that could escape the table's own scroll container and land
 * off-screen on a narrow viewport. Opening it at 390px is the check that it
 * stays reachable — and that Escape still dismisses it, so a reader who opens
 * it by accident is not stuck behind a panel they cannot see the edges of.
 */
test("the +N role count still opens and closes at phone width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${root}/members`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });

  const table = page.getByRole("region", { name: "Member directory" });
  const row = table.locator("tbody tr", { hasText: "over.load" });
  await expect(row).toHaveCount(1);

  const button = row.getByRole("button", { name: /more roles/ });
  await expect(button).toBeVisible();
  await button.click();

  const panel = page.getByRole("dialog", { name: "4 more roles" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Orbit", { exact: true })).toBeVisible();

  // Neither the panel nor the control widened the page.
  await expectNoHorizontalOverflow(page, "+N roles popover at 390px");

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});
