import { expect, test, type Locator, type Page } from "@playwright/test";
import { chooseFacet, chooseOption } from "./support/ui";

/**
 * The shared table experience, exercised through the screens it is for.
 *
 * These tests are about behaviour a reader can see: one range sentence in the
 * footer, sorting that changes the order of a *complete* list, paging that asks
 * the server for the next slice, filters that stay reachable when they match
 * nothing, and real identity in the rows. They are not a visual review — they
 * assert structure, state and copy, not pixels.
 */
const root = "/dashboard/120000000000000001";

async function hydrated(page: Page) {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * One column's text for every visible row, in row order.
 *
 * Read as a single query (`td:nth-child`) rather than cell by cell: a table
 * that is re-rendering a server response can otherwise change row count
 * between two reads and fail on a row that no longer exists.
 */
async function column(rows: Locator, index: number) {
  const values = await rows
    .locator(`td:nth-child(${index + 1})`)
    .allInnerTexts();
  return values.map((value) => value.trim());
}

/** The same, as numbers, with separators and currency glyphs stripped. */
async function numbers(rows: Locator, index: number) {
  return (await column(rows, index)).map((value) =>
    Number(value.replace(/[^\d-]/g, ""))
  );
}

function footer(region: Locator) {
  return region.getByText(/Showing \d+–\d+ of \d+/);
}

test("the economy leaderboard ranks, sorts, pages and searches a complete list", async ({
  page,
}) => {
  await page.goto(`${root}/economy`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Contributors by balance" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  const total = await rows.count();
  expect(total).toBeGreaterThan(1);

  // Exactly one count for this table: the footer range. A second "N records"
  // line above the table is what this rebuild removed.
  await expect(footer(table)).toHaveCount(1);
  await expect(footer(table)).toContainText(`of ${total}`);
  await expect(page.getByText(/^\d+ records?$/)).toHaveCount(0);

  // Identity: the demo personas with an illustration show a real picture, and
  // the current member is marked. At least one row deliberately has no avatar.
  await expect(table.locator("tbody img")).not.toHaveCount(0);
  await expect(table.locator("tbody")).toContainText("no avatar captured");
  await expect(table.getByText("You", { exact: true })).toHaveCount(1);

  // Sorting a client list re-orders every row, not just the visible page.
  const balanceHeader = table.getByRole("columnheader", {
    name: /Stardust balance/,
  });
  await expect(balanceHeader).not.toHaveAttribute("aria-sort", /.+/);
  // Sorting is announced and operable from the keyboard.
  await balanceHeader.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(balanceHeader).toHaveAttribute("aria-sort", "ascending");
  const ascending = await numbers(rows, 2);
  expect([...ascending].sort((a, b) => a - b)).toEqual(ascending);
  await balanceHeader.getByRole("button").click();
  await expect(balanceHeader).toHaveAttribute("aria-sort", "descending");
  const descending = await numbers(rows, 2);
  expect([...descending].sort((a, b) => b - a)).toEqual(descending);

  // Page size is a real control on a complete list, and paging keeps working
  // when the list fits on one page as well.
  await chooseOption(page, "Rows per page", "7");
  await expect(footer(table)).toContainText("1–7");
  await expect(table.getByText(/^Page 1 of 2$/)).toBeVisible();
  const firstPageFirstRow = await rows.first().innerText();
  await table.getByRole("button", { name: "Next page" }).click();
  await expect(table.getByText(/^Page 2 of 2$/)).toBeVisible();
  await expect(footer(table)).toContainText(`${total}–${total} of ${total}`);
  await expect(rows.first()).not.toHaveText(firstPageFirstRow);
  await expect(table.getByRole("button", { name: "Next page" })).toBeDisabled();
  await expect(
    table.getByRole("button", { name: "Go to first page" })
  ).toBeEnabled();
  await table.getByRole("button", { name: "Go to first page" }).click();
  await expect(table.getByText(/^Page 1 of 2$/)).toBeVisible();

  // A search that matches nothing keeps its own input and offers a way back.
  const search = page.getByRole("searchbox", {
    name: "Search the leaderboard",
  });
  await search.fill("zzzz-no-such-member");
  await expect(
    table.getByRole("heading", { name: "No member matches that search" })
  ).toBeVisible();
  await expect(search).toBeVisible();
  await expect(rows).toHaveCount(0);
  await search.fill("");
  await expect(rows).toHaveCount(7);
});

test("the audit log filters by action and pages on the server", async ({
  page,
}) => {
  await page.goto(`${root}/audit`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Audit events" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(footer(table)).toHaveCount(1);
  // Server-owned data: the page controls are always rendered, and the table
  // knows the real total rather than the size of the page it holds.
  await expect(table.getByText(/^Page 1 of \d+$/)).toBeVisible();

  // Historical identity: the actor's recorded picture is rendered by the shared
  // identity cell. (The "nothing was recorded" fallback is asserted
  // deterministically in tests/dashboard-identity.test.ts — this database
  // accumulates rows from other specs, so which actor lands on page 1 varies.)
  await expect(table.locator("tbody img")).not.toHaveCount(0);

  // Keyboard operation of the faceted filter: open with Enter, type to narrow,
  // commit with Enter. The trigger then states the active value.
  const facet = page.getByRole("button", { name: "Filter audit action" });
  await facet.focus();
  await page.keyboard.press("Enter");
  const list = page.locator("[cmdk-list]");
  await expect(list).toBeVisible();
  await page.locator("[cmdk-input]").focus();
  await page.keyboard.type("Moderated");
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Filter audit action: Moderated" })
  ).toBeVisible();
  await expect(rows.first()).toBeVisible();
  const badges = await column(rows, 1);
  expect(badges.length).toBeGreaterThan(0);
  for (const badge of badges) expect(badge).toBe("Moderated");

  // Clearing brings the unfiltered history back in one click.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(
    page.getByRole("button", { name: "Filter audit action" })
  ).toBeVisible();

  // A search with no matches is not an empty audit log; the controls stay.
  const search = page.getByRole("searchbox", { name: "Search the audit log" });
  await search.fill("zzzz-no-such-entry");
  await expect(
    table.getByRole("heading", { name: "No records match" })
  ).toBeVisible();
  await expect(search).toBeVisible();
  await search.fill("");
  await expect(rows.first()).toBeVisible();
});

test("the channel list filters by type and keeps its page position", async ({
  page,
}) => {
  await page.goto(`${root}/channels`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Channels" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  const all = await rows.count();
  expect(all).toBeGreaterThan(1);
  // Everything fits on one page, and the pager says so instead of vanishing.
  await expect(table.getByText(/^Page 1 of 1$/)).toBeVisible();
  await expect(table.getByRole("button", { name: "Next page" })).toBeDisabled();

  await chooseFacet(page, "Filter channel type", "Voice");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("The listening room");
  await expect(footer(table)).toContainText("Showing 1–1 of 1");

  // The facet's accessible name reports the applied value, so the state is not
  // carried by colour alone.
  await expect(
    page.getByRole("button", { name: "Filter channel type: Voice" })
  ).toBeVisible();
  // The toolbar reset clears the active filter and restores the full list.
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(rows).toHaveCount(all);
  await expect(
    page.getByRole("button", { name: "Filter channel type" })
  ).toBeVisible();
});

test("the transaction history exposes type facets and server paging", async ({
  page,
}) => {
  await page.goto(`${root}/economy`);
  await hydrated(page);
  await page.getByRole("tab", { name: "Transaction history" }).click();
  const table = page.getByRole("region", { name: "Transaction history" });
  await expect(table).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const pageSize = await rows.count();
  await expect(table.getByText(/^Page 1 of \d+$/)).toBeVisible();

  // Changing the page size is a server request; the reader lands on page 1 of
  // the new size rather than on "page 1" of the old one.
  await chooseOption(page, "Rows per page", "15");
  await expect(rows).not.toHaveCount(pageSize);

  await chooseFacet(page, "Filter transaction type", "Transfer");
  // The filter is a server request: wait until every rendered row is a transfer
  // instead of sampling the previous response.
  await expect
    .poll(async () => {
      const types = await column(rows, 1);
      return (
        types.length > 0 &&
        types.every((type) => type.toLowerCase().includes("transfer"))
      );
    })
    .toBe(true);
  await expect(footer(table)).toHaveCount(1);
  await expect(rows.first()).toBeVisible();
});
