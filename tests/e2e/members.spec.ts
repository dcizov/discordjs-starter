import { expect, test, type Page } from "@playwright/test";
import { chooseFacet } from "./support/ui";

/**
 * The member directory, end to end.
 *
 * These assertions are about what a reader can check: that the page is reachable
 * from the navigation, that it pages the roster the bot synchronized rather than
 * some derived list, that its sync state is stated, and that the row menu and its
 * detail dialog are operable with a keyboard. Pixels are not asserted here.
 */
const root = "/dashboard/120000000000000001";

async function hydrated(page: Page) {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });
}

test("the member directory is reachable from the navigation and states its sync", async ({
  page,
}) => {
  await page.goto(`${root}/overview`);
  await hydrated(page);
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}/members$`));
  await hydrated(page);

  await expect(
    page.getByRole("heading", { name: "The people who make this place." })
  ).toBeVisible();
  const table = page.getByRole("region", { name: "Member directory" });
  await expect(table).toBeVisible();

  // The banner separates Discord's number from the stored row count, and this
  // demo holds a complete copy, so it says so.
  const banner = page.getByTestId("roster-sync-banner");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("synchronized");
  await expect(banner).toContainText("Discord reports");
  await expect(banner).toContainText(
    "Every member Discord reports is synchronized."
  );

  // It is a roster, not an economy list: it is longer than one page of accounts
  // and at least one row is a bot.
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(5);
  await expect(table.getByText("Bot", { exact: true }).first()).toBeVisible();
  // A current surface never narrates a missing avatar.
  await expect(table.locator("tbody")).not.toContainText("no avatar");
});

test("members are searched and filtered through the server", async ({
  page,
}) => {
  await page.goto(`${root}/members`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Member directory" });
  const rows = table.locator("tbody tr");
  // The footer states one accurate range over the server's own total. Every
  // row the roster holds is reachable here, including the member who left.
  await expect(table.getByText(/Showing 1–16 of 16/)).toBeVisible();

  const search = page.getByRole("searchbox", {
    name: "Search the member directory",
  });
  await search.fill("sophie");
  await expect(rows).toHaveCount(1);
  await expect(table.locator("tbody")).toContainText("Sophie");
  // The handle is the secondary line for a nickname like this one.
  await expect(table.locator("tbody")).toContainText("sophie.l");
  await expect(table.getByText(/Showing 1–1 of 1/)).toBeVisible();

  await search.fill("");
  await expect(rows).toHaveCount(16);
  // The facet filters the same roster by kind, and a bot is labelled as one.
  await chooseFacet(page, "Filter members", "Bots");
  await expect(rows).toHaveCount(1);
  await expect(table.locator("tbody")).toContainText("Bot");
  await expect(table.getByText(/Showing 1–1 of 1/)).toBeVisible();
});

test("a member's detail dialog opens from its row menu and closes on Escape", async ({
  page,
}) => {
  await page.goto(`${root}/members`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Member directory" });
  await table.getByRole("button", { name: "Actions for Sophie" }).click();
  await page.getByRole("menuitem", { name: "View member details" }).click();
  const dialog = page.getByRole("dialog", { name: "Member details" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Discord ID");
  await expect(dialog).toContainText("Roles");
  // No invented moderation controls on a member record.
  await expect(
    dialog.getByRole("button", { name: /ban|kick|timeout/i })
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("every column menu entry has a name", async ({ page }) => {
  await page.goto(`${root}/members`);
  await hydrated(page);
  await page.getByRole("button", { name: "Columns", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const labels = await menu
    .getByRole("menuitemcheckbox")
    .evaluateAll((items) =>
      items.map((item) => (item.textContent ?? "").trim())
    );
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) expect(label).not.toBe("");
  // The trailing action column is not a data column and must not be offered.
  expect(labels.join(" ")).not.toMatch(/open|actions/i);
});
