import { test, expect, type Page } from "@playwright/test";
import { chooseOption } from "./support/ui";
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

test("an empty or paused player never presents an active pause control", async ({
  page,
}) => {
  await openMusic(page);
  const progress = page.getByRole("progressbar", { name: "Playback progress" });
  await expect(progress).toBeVisible();
  // The primary transport button describes itself honestly for each state.
  const transport = page.getByRole("button", {
    name: /Pause playback|Resume playback|Nothing is playing/,
  });
  await expect(transport).toBeVisible();
  const label = await transport.getAttribute("aria-label");
  if (label === "Nothing is playing") await expect(transport).toBeDisabled();
});

test("volume moves locally and commits one debounced request per interaction", async ({
  page,
}) => {
  const bodies: any[] = [];
  await page.route(`**${base}/music`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, demo: true } });
  });
  await openMusic(page);
  const slider = page.getByRole("slider", { name: "Playback volume" });
  await expect(slider).toBeEnabled();
  const before = Number(await slider.inputValue());
  await slider.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  // Immediate local feedback, before any request is confirmed.
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeGreaterThanOrEqual(Math.min(100, before + 1));
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({ action: "volume" });
  expect(bodies[0].volume).toBeGreaterThanOrEqual(Math.min(100, before + 1));
  await expect(
    page.getByRole("slider", { name: "Playback volume" })
  ).toHaveValue(String(bodies[0].volume));
});

test("the play form sends the chosen provider and the server default otherwise", async ({
  page,
}) => {
  const bodies: any[] = [];
  await page.route(`**${base}/music`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true, demo: true } });
  });
  await openMusic(page);
  const provider = page.getByLabel("Search with");
  // The default is the server's configured source, not a guess by the dashboard.
  await expect(provider).toHaveValue("");
  await expect(provider.locator("option")).toHaveText([
    "Server default",
    "SoundCloud",
    "YouTube",
    "YouTube Music",
    "Bandcamp",
  ]);
  await chooseOption(page, "Search with", "Bandcamp");
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]).toMatchObject({
    action: "play",
    query: "A clean test recording",
    source: "bandcamp",
  });
  // Back to the default: the option is omitted rather than sent as "".
  await page.getByPlaceholder("Set the mood…").fill("A second request");
  await chooseOption(page, "Search with", "Server default");
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ action: "play" });
  expect(bodies[1]).not.toHaveProperty("source");
});
