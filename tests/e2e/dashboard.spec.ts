import { test, expect, type Page } from "@playwright/test";
import { chooseOption, setTheme } from "./support/ui";
const guild = "120000000000000001";
const root = `/dashboard/${guild}`;
async function visit(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
}
test("overview is polished, responsive, and clearly labels simulation", async ({
  page,
}) => {
  await visit(page, "/");
  await expect(
    page.getByRole("heading", { name: "Server overview" })
  ).toBeVisible();
  await expect(
    page.getByText("Your changes are saved, not sent.")
  ).toBeVisible();
  // The demo's member total is the roster it can actually show, not a
  // decorative number: compare the card with the members API.
  const roster = await page.request.get(
    `/api/guilds/${guild}/members?pageSize=1`
  );
  expect(roster.ok()).toBe(true);
  const counts = (await roster.json()).counts as {
    guildMemberCount: number;
    syncedMembers: number;
  };
  expect(counts.guildMemberCount).toBe(counts.syncedMembers);
  await expect(
    page
      .getByText(
        new Intl.NumberFormat("en-US").format(counts.guildMemberCount),
        {
          exact: true,
        }
      )
      .first()
  ).toBeVisible();
  await expect(page.getByText("Sample activity")).toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("switch", { name: "A little welcome" }).click();
  await page.getByRole("button", { name: "Looks like home" }).click();
  await expect(page.getByText("A little less managing.")).not.toBeVisible();
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByText("A little less managing.")).not.toBeVisible();
  await page.getByRole("button", { name: "Customize", exact: true }).click();
  await page.getByRole("switch", { name: "A little welcome" }).click();
  await page.getByRole("button", { name: "Looks like home" }).click();
  await setTheme(page, "dark");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await setTheme(page, "light");
});
test("role panels have working create, preview, publish, edit, and delete flows", async ({
  page,
}) => {
  await visit(page, `${root}/roles`);
  await page
    .getByRole("button", { name: "Create role panel", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Name", { exact: true })
    .fill("E2E · Find your people");
  await dialog.getByLabel("PC gaming", { exact: true }).check();
  await dialog
    .getByRole("button", { name: "Create role panel", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "E2E · Find your people" })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for E2E · Find your people" })
    .click();
  await page.getByRole("menuitem", { name: "Preview panel" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /PC gaming/ })
    .click();
  await expect(page.getByText("1 role selected. Looking good!")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Actions for E2E · Find your people" })
    .click();
  await page.getByRole("menuitem", { name: "Simulate publication" }).click();
  await expect(
    page.getByText("Panel publication simulated — nothing sent to Discord.")
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for E2E · Find your people" })
    .click();
  await page.getByRole("menuitem", { name: "Edit role panel" }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("E2E · Updated panel");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(
    page.getByRole("heading", { name: "E2E · Updated panel" })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for E2E · Updated panel" })
    .click();
  await page.getByRole("menuitem", { name: "Delete role panel" }).click();
  await page
    .getByRole("button", { name: "Delete configuration", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "E2E · Updated panel" })
  ).not.toBeVisible();
});
test("moderation rules validate, persist, filter, and delete", async ({
  page,
}) => {
  // A name of its own. Playwright retries a failed test in a database that the
  // first attempt already wrote to, and a fixed name then produces two rows
  // that only make the retry fail with an ambiguous-locator error.
  const name = `E2E · Kind conversations ${Date.now().toString(36)}`;
  await visit(page, `${root}/moderation`);
  await page
    .getByRole("button", { name: "Create automod rule", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill(name);
  await chooseOption(d, "What should Orbit watch for?", "Blocked terms");
  await d
    .getByLabel("Blocked terms", { exact: true })
    .fill("blocked phrase\nsecond phrase");
  await d
    .getByRole("button", { name: "Create automod rule", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  await page.getByPlaceholder("Search automod rules…").fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: `Toggle ${name}` }).click();
  await expect(
    page.getByRole("switch", { name: `Toggle ${name}` })
  ).not.toBeChecked();
  // The switch persists through a refresh, and the row menu is opened on a
  // table that is not still re-rendering the response.
  await visit(page, `${root}/moderation`);
  await page.getByPlaceholder("Search automod rules…").fill(name);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("switch", { name: `Toggle ${name}` })
  ).not.toBeChecked();
  await page.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete automod rule" }).click();
  await page
    .getByRole("button", { name: "Delete configuration", exact: true })
    .click();
  await expect(page.getByText(name, { exact: true })).not.toBeVisible();
});
test("news sources can be tested, routed, and safely simulated", async ({
  page,
}) => {
  await visit(page, `${root}/news`);
  await page.getByRole("button", { name: "Add news source" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Name", { exact: true }).fill("E2E · Community dispatch");
  await chooseOption(d, "Source adapter", "Signed incoming webhook");
  await d.getByLabel("Source tags").fill("Community, Updates");
  await d
    .getByRole("button", { name: "Create news source", exact: true })
    .click();
  await expect(d).not.toBeVisible();
  // News sources are cards, each with its own action menu; the moderation rules
  // on the other tab are the table. Assert the card arrived before using it.
  await expect(
    page.getByRole("heading", { name: "E2E · Community dispatch", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Actions for E2E · Community dispatch" })
    .click();
  await page
    .getByRole("menuitem", { name: "Test source", exact: true })
    .click();
  await expect(
    page.getByText("Your source is ready for a test flight")
  ).toBeVisible();
  await page.getByRole("button", { name: "Looks good" }).click();
  await page
    .getByRole("button", { name: "Actions for E2E · Community dispatch" })
    .click();
  await page.getByRole("menuitem", { name: "Send test message" }).click();
  await expect(
    page.getByText("Test delivery simulated — nothing sent to Discord.")
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Delivery history", exact: true })
    .click();
  await expect(
    page.getByText("Test message from E2E · Community dispatch").first()
  ).toBeVisible();
  await page.getByRole("tab", { name: "Sources", exact: true }).click();
  await page
    .getByRole("button", { name: "Actions for E2E · Community dispatch" })
    .click();
  await page.getByRole("menuitem", { name: "Webhook credentials" }).click();
  await expect(page.getByText("demo-only-not-a-live-webhook")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Actions for E2E · Community dispatch" })
    .click();
  await page.getByRole("menuitem", { name: "Delete news source" }).click();
  await page
    .getByRole("button", { name: "Delete configuration", exact: true })
    .click();
});
test("economy daily rewards and transfers update persistent balances", async ({
  page,
  request,
}) => {
  const before = await (await request.get(`/api/guilds/${guild}`)).json();
  const me = before.accounts.find((a: any) => a.userId === before.user.id);
  await visit(page, `${root}/economy`);
  if (!me.lastDaily) {
    await page.getByRole("button", { name: /Claim 250 daily/ }).click();
    await expect(
      page.getByRole("button", { name: "All set for today. See you tomorrow!" })
    ).toBeDisabled();
  }
  await page
    .getByRole("button", { name: "Send a little appreciation" })
    .click();
  await page
    .getByRole("dialog")
    .getByLabel("Amount", { exact: true })
    .fill("30");
  await page.getByRole("button", { name: "Send 30 ✦" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const after = await (await request.get(`/api/guilds/${guild}`)).json();
  const final = after.accounts.find((a: any) => a.userId === after.user.id);
  expect(final.balance).toBe(me.balance + (me.lastDaily ? 0 : 250) - 30);
  await page
    .getByRole("tab", { name: "Transaction history", exact: true })
    .click();
  await page
    .getByPlaceholder("Search transactions…")
    .fill("A little thank-you");
  await expect(
    page.getByText("A little thank-you", { exact: true }).first()
  ).toBeVisible();
});
test("queue controls work without claiming real demo playback", async ({
  page,
}) => {
  await visit(page, `${root}/music`);
  await expect(
    page.getByText(/no audio is played or sent to Discord/)
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause playback", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resume playback", exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume playback", exact: true })
    .click();
  await page
    .getByPlaceholder("Set the mood…")
    .fill("E2E · An afternoon in orbit");
  await page
    .getByRole("button", { name: "Add to the queue", exact: true })
    .click();
  await expect(
    page.getByText("E2E · An afternoon in orbit", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Remove E2E · An afternoon in orbit" })
    .click();
  await expect(
    page.getByText("E2E · An afternoon in orbit", { exact: true })
  ).not.toBeVisible();
});
test("server settings persist and leave an audit trail", async ({ page }) => {
  await visit(page, `${root}/settings`);
  const old = await page.getByLabel("Timezone", { exact: true }).inputValue();
  const next = old === "UTC" ? "Europe/Berlin" : "UTC";
  await page.getByLabel("Timezone", { exact: true }).selectOption(next);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .first()
    .click();
  await expect(page.getByText("Unsaved changes")).not.toBeVisible();
  await page.reload();
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByLabel("Timezone", { exact: true })).toHaveValue(next);
  await page.getByLabel("Timezone", { exact: true }).selectOption(old);
  await page
    .getByRole("button", { name: "Save changes", exact: true })
    .first()
    .click();
  await page.getByRole("link", { name: "Audit log", exact: true }).click();
  await page
    .getByPlaceholder("Search people, changes, and settings…")
    .fill("Server settings");
  await expect(
    page.getByText("Server settings", { exact: true }).last()
  ).toBeVisible();
});
test("authorization, CSRF, and protected role checks cannot be bypassed", async ({
  request,
}) => {
  const foreign = await request.get("/api/guilds/990000000000000999");
  expect(foreign.status()).toBe(403);
  const snapshot = await (await request.get(`/api/guilds/${guild}`)).json();
  const badOrigin = await request.patch(`/api/guilds/${guild}/config`, {
    data: snapshot.guild.config,
    headers: { origin: "https://attacker.example" },
  });
  expect(badOrigin.status()).toBe(403);
  const privileged = snapshot.guild.roles.find(
    (r: any) => r.permissions === "8"
  );
  const unsafe = await request.post(`/api/guilds/${guild}/resources/panel`, {
    headers: { origin: "http://localhost:3000" },
    data: {
      name: "Unsafe role",
      enabled: true,
      data: {
        description: "",
        channelId: snapshot.guild.channels[0].id,
        roleIds: [privileged.id],
        mode: "buttons",
        selection: "single",
        maxRoles: 1,
        prerequisiteIds: [],
        exclusiveRoleIds: [],
        emojis: [],
      },
    },
  });
  expect(unsafe.ok()).toBe(false);
  expect((await unsafe.json()).error).toMatch(/elevated|above/);
  const webhook = await request.post(
    "/api/webhooks/00000000-0000-4000-8000-000000000000",
    { data: {} }
  );
  expect(webhook.status()).toBe(409);
});
test("server switcher distinguishes communities that need an invite", async ({
  page,
}) => {
  await visit(page, root + "/overview");
  await page.getByRole("button").filter({ hasText: "The Cozy Corner" }).click();
  await page
    .getByRole("menuitem")
    .filter({ hasText: "Pixel Pioneers" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Let’s connect Pixel Pioneers." })
  ).toBeVisible();
  await expect(
    page.getByText("All systems operational", { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("Status not reported", { exact: true })
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Invite Orbit to your server" })
    .click();
  await expect(
    page.getByText(
      "Invites are disabled in demo mode. Choose The Cozy Corner to explore."
    )
  ).toBeVisible();
});
test("mobile navigation and layouts have no page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, root + "/overview");
  await expect(
    page.getByRole("heading", { name: "Server overview" })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "News & feeds", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Keep your corner in the know." })
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});

test("unavailable server permissions render a recoverable page without exposing workspace data", async ({
  page,
}) => {
  await page.goto("/dashboard/990000000000000999/music");
  await expect(
    page.getByRole("heading", { name: "Server access denied", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      "Nothing was changed. Your server settings remain protected."
    )
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true })
  ).toBeVisible();
  await expect(page.locator('[data-hydrated="true"]')).toHaveCount(0);
});
