import { test, expect, type Page } from "@playwright/test";
const base = "/api/guilds/120000000000000001";
async function openMusic(page: Page) {
  await page.goto("/dashboard/120000000000000001/music");
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  await page.getByPlaceholder("Set the mood…").fill("A clean test recording");
}
const successes = (page: Page) =>
  page.locator('[data-sonner-toast][data-type="success"]');

test("offline bot errors never clear the input or show a successful playback request", async ({
  page,
}) => {
  await page.route(`**${base}/music`, (route) =>
    route.fulfill({
      status: 503,
      json: {
        error:
          "The Discord bot is offline. Start the bot service; no action was queued.",
      },
    })
  );
  await openMusic(page);
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect(
    page.getByText(
      "The Discord bot is offline. Start the bot service; no action was queued.",
      { exact: true }
    )
  ).toBeVisible();
  await expect(page.getByPlaceholder("Set the mood…")).toHaveValue(
    "A clean test recording"
  );
  await expect(successes(page)).toHaveCount(0);
});

test("a queued job's execution error is displayed instead of success", async ({
  page,
}) => {
  // These local transport fixtures exercise the live-job polling protocol while
  // the actual server remains credential-free demo. Nothing reaches Discord.
  await page.route(`**${base}/music`, (route) =>
    route.fulfill({
      status: 202,
      json: { accepted: true, jobId: "fixture-job" },
    })
  );
  let reads = 0;
  await page.route(`**${base}/actions/fixture-job`, (route) =>
    route.fulfill({
      json:
        ++reads === 1
          ? { state: "waiting" }
          : { state: "failed", error: "Join a voice channel first." },
    })
  );
  await openMusic(page);
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect(
    page.getByText("Join a voice channel first.", { exact: true })
  ).toBeVisible();
  await expect(page.getByPlaceholder("Set the mood…")).toHaveValue(
    "A clean test recording"
  );
  await expect(successes(page)).toHaveCount(0);
  expect(reads).toBe(2);
});

test("an accepted request stays pending until the consumer actually completes it", async ({
  page,
}) => {
  await page.route(`**${base}/music`, (route) =>
    route.fulfill({
      status: 202,
      json: { accepted: true, jobId: "fixture-completion" },
    })
  );
  let complete = false,
    reads = 0;
  await page.route(`**${base}/actions/fixture-completion`, (route) => {
    reads++;
    return route.fulfill({
      json: { state: complete ? "completed" : "active" },
    });
  });
  await openMusic(page);
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect.poll(() => reads).toBeGreaterThan(0);
  await expect(successes(page)).toHaveCount(0);
  await expect(page.getByPlaceholder("Set the mood…")).toHaveValue(
    "A clean test recording"
  );
  complete = true;
  await expect(
    page.getByText("Added to the preview queue. No audio is played.", {
      exact: true,
    })
  ).toBeVisible();
  await expect(page.getByPlaceholder("Set the mood…")).toHaveValue("");
});
