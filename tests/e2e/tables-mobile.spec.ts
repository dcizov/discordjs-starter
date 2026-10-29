import { expect, test } from "@playwright/test";
import { chooseFacet } from "./support/ui";

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
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

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
  await expect(
    page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
    )
  ).resolves.toBeLessThanOrEqual(1);
});

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
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
});
