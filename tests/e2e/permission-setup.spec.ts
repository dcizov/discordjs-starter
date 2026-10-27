import { chooseComboboxOption, chooseFacet, chooseOption } from "./support/ui";
import { test, expect } from "@playwright/test";
const root = "/dashboard/120000000000000001";
test("read-only permission setup evaluates the selected channel, preserves protection and makes no grant requests", async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/guilds/") &&
      !["GET", "HEAD"].includes(request.method())
    )
      mutations.push(`${request.method()} ${request.url()}`);
  });
  await page.goto(`${root}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByRole("tab", { name: /^permissions$/i }).click();
  const setup = page.getByTestId("permission-setup");
  await expect(setup.getByText("Sample data", { exact: true })).toBeVisible();
  await expect(setup.getByText(/no live Discord audit/)).toBeVisible();
  await expect(
    setup.getByText(/GuildVoiceStates is NOT a privileged toggle/)
  ).toBeVisible();
  await chooseComboboxOption(
    setup,
    "Permission check channel",
    "Voice: The listening room"
  );
  const voice = setup.getByRole("row").filter({ hasText: "Music voice join" });
  await expect(voice.getByText("Bits present", { exact: true })).toBeVisible();
  await expect(
    voice.getByText(/MoveMembers is NOT a normal requirement/)
  ).toBeVisible();
  await chooseComboboxOption(setup, "Permission check channel", "#staff-only");
  const posting = setup
    .getByRole("row")
    .filter({ hasText: "Baseline channel posting" });
  await expect(
    posting.getByText("Missing bits", { exact: true })
  ).toBeVisible();
  await expect(
    posting.getByText("View Channel — missing", { exact: true })
  ).toBeVisible();
  await setup.locator("summary").click();
  await expect(setup.getByText("Admin", { exact: true })).toBeVisible();
  await expect(setup.getByText(/Administrator does not bypass/)).toBeVisible();
  expect(mutations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
test("module setup filters are useful and publisher starters remain explicitly setup-required", async ({
  page,
}) => {
  await page.goto(`${root}/overview`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await chooseOption(page, "Filter module setup", "Needs setup");
  await expect(page.locator('[data-module-card="news"]')).toBeVisible();
  await expect(page.locator('[data-module-card="economy"]')).toHaveCount(0);
  await page
    .locator('[data-module-card="news"]')
    .getByRole("button")
    .last()
    .click();
  await expect(page.locator('[data-module-setup="news"]')).toBeVisible();
  // The news source list is a table now: its status control is the faceted
  // filter in the table toolbar, not a page-level select.
  await chooseFacet(page, "Filter by status", "Needs setup");
  await expect(
    page.getByRole("heading", {
      name: "Community feed · Minecraft",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Steam", exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Community feed · Warcraft",
      exact: true,
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Community feed · Diablo", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(/No default publisher feed or scraping is assumed/).first()
  ).toBeVisible();
});
