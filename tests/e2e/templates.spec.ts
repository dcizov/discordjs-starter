import { expect, test, type Page } from "@playwright/test";

/**
 * The template flow in demo mode.
 *
 * Demo mode never creates Discord resources, so the assertions here are about the
 * shape of the flow — create → preview → confirm → recorded result — and about the
 * honesty of the ending: the demo says nothing was created instead of inventing
 * created channels. Live application is only ever exercised on a disposable
 * server, which these tests do not have.
 */
const root = "/dashboard/120000000000000001";

async function hydrated(page: Page) {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });
}

test("a template is captured, previewed and recorded as a demo apply", async ({
  page,
}) => {
  await page.goto(`${root}/templates`);
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "A blueprint, not a copy." })
  ).toBeVisible();
  // The page states what a template is *not*: Discord's own template format.
  await expect(page.getByText(/Discord’s server templates/)).toBeVisible();
  await expect(page.getByText("Never in a template")).toBeVisible();

  const name = `E2E blueprint ${Date.now()}`;
  await page.getByRole("button", { name: "New template" }).click();
  const dialog = page.getByRole("dialog", { name: "Capture a template" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Template name", { exact: true }).fill(name);
  await dialog
    .getByLabel("Description", { exact: true })
    .fill("Captured by a browser test");
  await dialog.getByRole("button", { name: "Capture template" }).click();
  await expect(dialog).not.toBeVisible();

  // The new template is listed with its source server and its counts.
  const item = page.getByRole("button", { name: new RegExp(name) });
  await expect(item).toBeVisible();
  await item.click();

  await page.getByRole("button", { name: "Preview changes" }).click();
  await expect(page.getByText(/\d+ to create/)).toBeVisible();
  await expect(page.getByText(/Plan fingerprint/)).toBeVisible();

  await page.getByRole("button", { name: "Apply this plan" }).click();
  await expect(
    page.getByText("Demo preview — nothing was created")
  ).toBeVisible();
  await expect(
    page.getByText(/Demo mode: nothing was created in a Discord server/)
  ).toBeVisible();
});

test("the template flow refuses to apply without a preview", async ({
  page,
}) => {
  await page.goto(`${root}/templates`);
  await hydrated(page);
  // Nothing is selectable for apply until a template exists and is previewed.
  const apply = page.getByRole("button", { name: "Apply this plan" });
  await expect(apply).toHaveCount(0);
  // Whether or not another spec already captured a template here, the panel is
  // explicit that a plan must be previewed first.
  await expect(
    page.getByText(
      /Choose a template to preview what it would do here|Nothing is created until you confirm/
    )
  ).toBeVisible({ timeout: 10_000 });
});
