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

/*
 * Real pictures, not initials.
 *
 * The gap this closes: the assertion above only checked the *absence* of the
 * string "no avatar", so a directory where every single row fell back to
 * initials passed it. That is exactly what shipped — on a real 61-member
 * server every row, the bot included, drew initials while the XP leaderboard
 * beside it drew faces, because the members route returned the raw avatar
 * hashes and never derived a URL from them.
 *
 * So this asserts presence, and it waits for the bytes rather than for the
 * element: an <img> that 404s is still an <img> until it loads.
 */
test("the member directory renders real avatars, not initials for everyone", async ({
  page,
}) => {
  await page.goto(`${root}/members`);
  await hydrated(page);

  const table = page.getByRole("region", { name: "Member directory" });
  const rows = table.locator("tbody tr");
  await expect(rows.first()).toBeVisible();

  // Members the seed gives a recorded picture to. Four of seventeen have one;
  // the rest are honestly null and must still show initials.
  const avatars = table.locator("tbody tr img");
  await expect(avatars.first()).toBeVisible();
  const count = await avatars.count();
  expect(count, "no row rendered an avatar image").toBeGreaterThan(0);

  // Every rendered avatar actually loaded. `naturalWidth` is 0 until the
  // bytes arrive, so this fails on a 404 or a blocked image rather than
  // passing on the element existing.
  await expect
    .poll(async () => {
      const widths = await avatars.evaluateAll((nodes) =>
        (nodes as HTMLImageElement[]).map((n) => n.complete && n.naturalWidth)
      );
      return widths.every((w) => w);
    })
    .toBe(true);

  // And at least one named person has their picture rather than a fallback.
  for (const name of ["Jamie", "Alex", "Milo"]) {
    const row = rows.filter({ hasText: name }).first();
    await expect(row.locator("img")).toHaveCount(1);
  }
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
  await expect(table.getByText(/Showing 1–17 of 17/)).toBeVisible();

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
  await expect(rows).toHaveCount(17);
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

/*
 * The overflow branch, asserted on purpose rather than left to whoever happens
 * to hold three roles.
 *
 * The member list shows two role badges and a "+N" button for the rest, and
 * that button is the only `<Tooltip>` in the app. It is also the only branch
 * that renders conditionally on data, which is exactly the kind of branch a
 * browser test has to reach deliberately: it shipped once with no
 * `TooltipProvider` mounted anywhere, and the page crashed for precisely the
 * members with the most roles.
 *
 * The demo seed carries "Over Load" with six roles so this branch is always
 * exercised, not incidentally covered.
 */
/*
 * The "+N" role count opens what it is hiding.
 *
 * It used to be a tooltip: it carried the hidden roles' names, so a screen
 * reader could reach them, but clicking it did nothing. A control drawn as a
 * button that behaves like a label is worse than one that says nothing — it
 * advertises an interaction it does not have.
 *
 * The demo seed carries "Over Load" with six roles so this branch is always
 * exercised, not incidentally covered.
 */
test("the +N role count opens the roles it is hiding, and Escape closes it", async ({
  page,
}) => {
  await page.goto(`${root}/members`);
  await hydrated(page);
  const table = page.getByRole("region", { name: "Member directory" });
  /*
   * Matched on the handle, not the display name.
   *
   * The seed member is `over.load` with the global name "Over Load" and the
   * nickname "Over". Where a nickname exists the row shows the nickname with
   * the handle beneath it, so the global name is never rendered and a filter on
   * "Over Load" finds no row — which is what a browser run reported.
   */
  const row = table.locator("tbody tr", { hasText: "over.load" });
  await expect(row).toHaveCount(1);

  // Two badges are drawn, the rest are collapsed into one control.
  const button = row.getByRole("button", { name: /more roles/ });
  await expect(button).toBeVisible();
  await expect(button).toHaveText("+4");
  // The names travel with the control, so a screen reader reaches them
  // without opening anything.
  const label = await button.getAttribute("aria-label");
  expect(label).toContain("4 more roles");
  expect(label).toContain("Orbit");

  // Nothing is open before the click.
  const panel = page.getByRole("dialog", { name: "4 more roles" });
  await expect(panel).toHaveCount(0);

  await button.click();
  await expect(panel).toBeVisible();

  // Six held, two drawn as badges, four listed here. Sorted by hierarchy, the
  // two highest are the ones already drawn.
  const text = (await panel.textContent()) ?? "";
  for (const name of ["Orbit", "Console gaming", "PC gaming", "Community"])
    expect(text).toContain(name);
  // The two already drawn must not be repeated inside the panel.
  expect(text).not.toContain("Admin");
  expect(text).not.toContain("Moderator");

  // Each one is a real badge, not a line of text: the name is always visible
  // and the colour dot carries the same swatch as the drawn badges.
  await expect(panel.getByText("Orbit", { exact: true })).toBeVisible();

  // Escape dismisses it, which is what makes the control safe inside a table.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
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
