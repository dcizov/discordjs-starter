import { expect, test } from "@playwright/test";
const root = "/dashboard/120000000000000001";
async function visit(page: import("@playwright/test").Page) {
  await page.goto(`${root}/overview`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}

test("header search and notifications keep independent state and navigate from their dialogs", async ({
  page,
}) => {
  await visit(page);
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "Find your way around" });
  await expect(search).toBeVisible();
  await search
    .getByPlaceholder("Search pages and configuration…")
    .fill("self roles");
  await search.getByRole("option", { name: /Self roles/ }).click();
  await expect(page).toHaveURL(`${root}/roles`);
  await expect(search).not.toBeVisible();
  await page
    .getByRole("button", { name: "Search dashboard", exact: true })
    .click();
  await expect(
    search.getByPlaceholder("Search pages and configuration…")
  ).toHaveValue("");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  const notifications = page.getByRole("dialog", {
    name: "Around your community",
    exact: true,
  });
  await expect(notifications).toBeVisible();
  await notifications.getByRole("button", { name: "View audit log" }).click();
  await expect(page).toHaveURL(`${root}/audit`);
  await expect(notifications).not.toBeVisible();
});

test("overview preferences keep their dialog open and roll back an optimistic failed setting", async ({
  page,
}) => {
  await visit(page);
  await page.route("**/api/guilds/120000000000000001/config", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 503,
          json: { error: "Configuration temporarily unavailable" },
        })
      : route.continue()
  );
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Your overview, your way.",
    exact: true,
  });
  const toggle = dialog.getByRole("switch", {
    name: "A little welcome",
    exact: true,
  });
  const before = await toggle.isChecked();
  await toggle.click();
  await expect(
    page.getByText("Configuration temporarily unavailable", { exact: true })
  ).toBeVisible();
  await expect(toggle).toBeChecked({ checked: before });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Looks like home" }).click();
  await expect(dialog).not.toBeVisible();
});

test("failed profile refresh retains the current identity and image rather than claiming success", async ({
  page,
}) => {
  await visit(page);
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Profile refresh is temporarily unavailable" },
    })
  );
  const account = page.getByRole("button", {
    name: "Account menu for Jamie",
    exact: true,
  });
  await account.click();
  await page
    .getByRole("menuitem", {
      name: "Refresh profile image & name",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Profile refresh is temporarily unavailable", {
      exact: true,
    })
  ).toBeVisible();
  await expect(account).toBeVisible();
  await expect
    .poll(() =>
      account
        .locator("img")
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0
        )
    )
    .toBe(true);
});

test("section tabs expose tab semantics and respond to arrow keys", async ({
  page,
}) => {
  await page.goto(`${root}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const list = page.getByRole("tablist", { name: "Server sections" });
  await expect(list).toBeVisible();
  const channels = list.getByRole("tab", { name: /^channels/i });
  const roles = list.getByRole("tab", { name: /^roles/i });
  await expect(channels).toHaveAttribute("aria-selected", "true");
  await expect(roles).toHaveAttribute("aria-selected", "false");
  // Roving tabindex: only the selected tab is in the Tab order.
  await expect(channels).toHaveAttribute("tabindex", "0");
  await expect(roles).toHaveAttribute("tabindex", "-1");
  await channels.focus();
  await page.keyboard.press("ArrowRight");
  await expect(roles).toHaveAttribute("aria-selected", "true");
  await expect(roles).toBeFocused();
  await page.keyboard.press("End");
  await expect(
    list.getByRole("tab", { name: /^permissions/i })
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(channels).toHaveAttribute("aria-selected", "true");
});
