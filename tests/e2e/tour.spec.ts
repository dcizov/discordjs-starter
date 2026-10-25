import { test, expect } from "@playwright/test";

// This spec deliberately starts without the seeded "already seen" state.
test.use({ storageState: { cookies: [], origins: [] } });

const root = "/dashboard/120000000000000001";

test("the introduction appears once, navigates, and can be replayed", async ({
  page,
}) => {
  await page.goto(`${root}/overview`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Step 1 of 6/)).toBeVisible();
  await expect(
    dialog.getByText(/changes nothing in your server/)
  ).toBeVisible();

  await dialog.getByRole("button", { name: "Next" }).click();
  await expect(dialog.getByText(/Step 2 of 6/)).toBeVisible();
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByText(/Step 1 of 6/)).toBeVisible();
  await dialog.getByRole("button", { name: "Skip" }).click();
  await expect(dialog).toHaveCount(0);

  // Dismissal is remembered per person, including after a reload.
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // ...and it stays dismissed when switching servers' sections.
  await page.goto(`${root}/music`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Replay lives in the help dialog.
  await page.getByRole("button", { name: /A little help\?/ }).click();
  await page.getByRole("button", { name: "Replay the introduction" }).click();
  await expect(page.getByRole("dialog").getByText(/Step 1 of 6/)).toBeVisible();
});
