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

  /*
   * Every column can be brought to the reading position.
   *
   * Scrolled so the header's left edge is just clear of the pinned column,
   * which covers the left of the container. What is asserted is that the
   * *start* of the column is reachable: a column whose start can never be
   * brought out from under the pin is a column you cannot read.
   *
   * The right edge is deliberately not asserted here, and cannot be. A column
   * wider than the space beside the pinned column is not fully visible at any
   * scroll position — scroll to see its right edge and its left goes under
   * the pin. Requiring both would be requiring the impossible, and would fail
   * on any table with a wide column for a reason that has nothing to do with
   * whether the table works.
   */
  for (let index = 1; index < count; index += 1) {
    // Scroll the header clear of the pinned column, which sits on top of the
    // left of the container and would otherwise cover it.
    await headers.nth(index).evaluate((header) => {
      const scroller = header.closest("[data-overflow]") as HTMLElement;
      const pinned = scroller.querySelector("thead th") as HTMLElement | null;
      scroller.scrollLeft =
        (header as HTMLElement).offsetLeft - (pinned?.offsetWidth ?? 0);
    });

    const [box, pinned] = await Promise.all([
      headers.nth(index).boundingBox(),
      headers.first().boundingBox(),
    ]);
    expect(box, `header ${index} has a box`).not.toBeNull();
    expect(pinned, "the pinned column has a box").not.toBeNull();

    const visibleFrom = pinned!.x + pinned!.width;
    // A sub-pixel of rounding is not a clipped column; two pixels is.
    expect(
      box!.x,
      `header ${index} can be scrolled clear of the pinned column`
    ).toBeGreaterThanOrEqual(visibleFrom - 1);
  }

  /*
   * The end of the table is reachable.
   *
   * The other half, and the one that catches content cut off past the last
   * column: scrolled fully right, the last header's right edge has to be
   * inside the container. Scroll a little further than the width so the
   * browser clamps at whatever its true maximum is.
   */
  await wrap.evaluate((el) => {
    (el as HTMLElement).scrollLeft = (el as HTMLElement).scrollWidth;
  });
  const [last, view] = await Promise.all([
    headers.nth(count - 1).boundingBox(),
    wrap.boundingBox(),
  ]);
  expect(last, "the last header has a box").not.toBeNull();
  expect(view, "the scroll container has a box").not.toBeNull();
  expect(
    last!.x + last!.width,
    "the last column ends inside the container when scrolled to the end"
  ).toBeLessThanOrEqual(view!.x + view!.width + 1);

  /*
   * And the pinned column sits flush to the container's left edge: it is
   * visible by construction, so what has to be proved is that it is not
   * floating somewhere in the middle of the row, over the columns it is
   * supposed to sit beside.
   */
  const pinned = await headers.first().boundingBox();
  expect(
    pinned!.x,
    "the pinned column sits at the container's left edge"
  ).toBeLessThanOrEqual(view!.x + 1);
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
  /*
   * Scoped to the toolbar, not to the table. "Every button in the table"
   * also matches the sort buttons in each header and the pager in the footer,
   * which are on the lines they belong to; with those included the assertion
   * could never hold, and would have been a test that only fails.
   */
  const controls = table
    .locator("[data-table-toolbar]")
    .locator('input[type="search"], button');
  const count = await controls.count();
  expect(count).toBeGreaterThan(1);

  const boxes: { top: number; bottom: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const box = await controls.nth(index).boundingBox();
    expect(box, `control ${index} is laid out`).not.toBeNull();
    boxes.push({ top: box!.y, bottom: box!.y + box!.height });
  }

  /*
   * One row: every control overlaps *every other one* vertically.
   *
   * Pairwise, not "each against the union of them all". Two stacked rows both
   * sit inside their own union, so a whole-span comparison passes on two rows
   * just as happily as on one; only pairwise overlap can tell them apart.
   *
   * Overlap rather than equal tops, because equal tops is not what the layout
   * engine promises. Controls of different heights sharing a baseline have
   * tops that differ by a fraction of a pixel, and rounding those to integers
   * turned a single row into two — CI reported `toolbar rows: 447, 447, 446`,
   * which is one row measured three times, not two rows.
   */
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i];
      const b = boxes[j];
      expect(
        a.top < b.bottom && b.top < a.bottom,
        `controls ${i} (${a.top}–${a.bottom}) and ${j} (${b.top}–${b.bottom}) ` +
          `share a line: the toolbar is more than one row`
      ).toBe(true);
    }
  }

  /*
   * And the toolbar is only as tall as one row of them.
   *
   * The overlap check alone would pass on two rows if a control happened to be
   * tall enough to bridge them. One row of `h-8` controls plus the row's own
   * vertical padding is well under this; two rows plus the gap are not.
   */
  const bar = await table.locator("[data-table-toolbar]").boundingBox();
  expect(bar, "the toolbar has a box").not.toBeNull();
  const tallest = Math.max(...boxes.map((b) => b.bottom - b.top));
  expect(bar!.height, "the toolbar is one control tall").toBeLessThan(
    tallest + 24
  );
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
/*
 * Split by what the page actually renders, not by what the navigation calls
 * it. `/roles` and `/news` are card lists behind a `ListToolbar`, so there is
 * no table region on them: the previous version of this loop asked for one by
 * name and failed with "element(s) not found" — a report about the test's
 * assumption rather than about the page.
 *
 * They are still checked, for the thing that is true of any page: it does not
 * scroll sideways. Column reachability is a claim about tables, and only the
 * tables make it.
 */
const tablePages = [
  { path: "/channels", region: "Channels" },
  { path: "/members", region: "Member directory" },
  { path: "/economy", region: "Contributors by balance" },
  { path: "/xp", region: "XP leaderboard" },
  { path: "/audit", region: "Audit events" },
  { path: "/moderation", region: "Automod rules" },
];

/** Record lists that are still cards. Not tables, so not held to the table rule. */
const cardPages = [
  // The page titles, not the straplines under them — `settings.roles.title`
  // is "Self roles"; "A place for everyone." is its description, and asking
  // for it by heading name finds nothing.
  { path: "/roles", heading: "Self roles" },
  { path: "/news", heading: "Keep your corner in the know." },
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

for (const { path, heading } of cardPages) {
  test(`${path} fits a phone viewport at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${root}${path}`);
    await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectNoHorizontalOverflow(page, `${path} at 390px`);
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
