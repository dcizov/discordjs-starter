import { test, expect } from "@playwright/test";
const guildId = "120000000000000001",
  root = `/dashboard/${guildId}`;
test("automatic deals destination and evidence thresholds persist without sending anything in demo", async ({
  page,
  request,
}) => {
  await page.goto(`${root}/deals`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await expect(
    page.getByText("Demo deal subscriptions", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Set up deal alerts", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Name", { exact: true })
    .fill("E2E · Popular games only");
  await expect(
    dialog.getByText("Automatic posts · familiar games only", { exact: true })
  ).toBeVisible();
  await dialog
    .getByLabel("Destination channel", { exact: true })
    .selectOption({ label: "# game-deals" });
  const channelId = await dialog
    .getByLabel("Destination channel", { exact: true })
    .inputValue();
  await dialog
    .getByLabel("Top ITAD popularity position", { exact: true })
    .fill("200");
  await dialog
    .getByLabel("Minimum Steam reviews", { exact: true })
    .fill("20000");
  await dialog
    .getByLabel("Minimum Steam positive (%)", { exact: true })
    .fill("80");
  await dialog
    .getByLabel("Minimum recent Steam players", { exact: true })
    .fill("100");
  await dialog
    .getByLabel("Maximum new posts per check", { exact: true })
    .fill("2");
  await dialog
    .getByRole("button", { name: "Create deal subscription", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const response = await request.get(`/api/guilds/${guildId}`);
  const data = await response.json();
  const resource = data.resources.find(
    (resource: any) => resource.name === "E2E · Popular games only"
  );
  expect(data.demo).toBe(true);
  expect(resource.data).toMatchObject({
    gameId: "",
    channelId,
    maxPopularityRank: 200,
    minReviews: 20000,
    minScore: 80,
    minPlayers: 100,
    maxPostsPerCheck: 2,
  });
  expect(
    data.deliveries.some((delivery: any) => delivery.sourceId === resource.id)
  ).toBe(false);
  await page
    .getByRole("button", {
      name: "Actions for E2E · Popular games only",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Edit deal subscription" }).click();
  await expect(
    dialog.getByLabel("Minimum Steam reviews", { exact: true })
  ).toHaveValue("20000");
  await expect(
    dialog.getByLabel("Maximum new posts per check", { exact: true })
  ).toHaveValue("2");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", {
      name: "Actions for E2E · Popular games only",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Delete deal subscription" })
    .click();
  await page
    .getByRole("button", { name: "Delete configuration", exact: true })
    .click();
  await expect(
    page.getByText("E2E · Popular games only", { exact: true })
  ).not.toBeVisible();
});
