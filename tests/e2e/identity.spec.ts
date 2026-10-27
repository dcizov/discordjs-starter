import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTheme } from "./support/ui";
const root = "/dashboard/120000000000000001/overview";
const guildButton = (page: Page, name = "The Cozy Corner") =>
  page.getByRole("button", {
    name: `Switch server, current: ${name}`,
    exact: true,
  });
// The account menu names the signed-in person the way this server does: their
// nickname here, not the global account name.
const accountButton = (page: Page, name = "Jamie") =>
  page.getByRole("button", { name: `Account menu for ${name}`, exact: true });
async function visit(page: Page) {
  await page.goto(root);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
}
async function decoded(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) =>
          element.complete && element.naturalWidth > 0
      )
    )
    .toBe(true);
  await expect(image).toHaveAttribute("alt", "");
}

test("real local demo images decode in fixed-size accessible identity controls", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (/discord(?:app)?\.com/.test(new URL(request.url()).hostname))
      external.push(request.url());
  });
  await visit(page);
  const guild = guildButton(page),
    account = accountButton(page);
  await decoded(guild.locator("img"));
  await decoded(account.locator("img"));
  await expect(guild.locator("img")).toHaveAttribute("width", "33");
  await expect(account.locator("img")).toHaveAttribute("height", "30");
  expect(
    (await guild.locator('span[aria-hidden="true"]').first().boundingBox())
      ?.width
  ).toBe(33);
  expect(
    (await account.locator('span[aria-hidden="true"]').first().boundingBox())
      ?.height
  ).toBe(30);
  await expect(
    guild.locator('span[aria-hidden="true"]').first()
  ).toHaveAttribute("aria-hidden", "true");
  expect(external).toEqual([]);
  await page.screenshot({
    path: ".artifacts/dashboard-identity-demo.png",
    animations: "disabled",
  });
  await account.click();
  // The menu shows the same identity the roster holds: this guild's name for
  // the person, then the handle, then what the workspace is.
  await expect(page.getByText("@jamie.davis", { exact: false })).toBeVisible();
  await expect(page.getByText(/Demo administrator/)).toBeVisible();
  await page.screenshot({
    path: ".artifacts/dashboard-account-demo.png",
    animations: "disabled",
  });
});

test("guild switching uses each guild's own image or initials, without carrying failed state", async ({
  page,
}) => {
  await visit(page);
  await guildButton(page).click();
  await decoded(
    page
      .getByRole("menuitem")
      .filter({ hasText: "The Cozy Corner" })
      .locator("img")
  );
  const workshop = page
    .getByRole("menuitem")
    .filter({ hasText: "The Workshop" });
  await expect(workshop.locator("img")).toHaveCount(0);
  await workshop.click();
  await expect(guildButton(page, "The Workshop")).toBeVisible();
  await expect(guildButton(page, "The Workshop").locator("img")).toHaveCount(0);
  await expect(
    guildButton(page, "The Workshop")
      .locator('span[aria-hidden="true"]')
      .first()
  ).toHaveText("W");
  await guildButton(page, "The Workshop").click();
  await page
    .getByRole("menuitem")
    .filter({ hasText: "The Cozy Corner" })
    .click();
  await decoded(guildButton(page).locator("img"));
  await decoded(accountButton(page).locator("img"));
});

test("failed network images preserve initials and dimensions and can recover on reload", async ({
  page,
}) => {
  await page.route("**/demo/cozy-corner.svg", (route) => route.abort());
  await page.route("**/demo/jamie-davis.svg", (route) => route.abort());
  await visit(page);
  await expect(guildButton(page).locator("img")).toHaveCount(0);
  await expect(accountButton(page).locator("img")).toHaveCount(0);
  const guildFallback = guildButton(page)
    .locator('span[aria-hidden="true"]')
    .first();
  const userFallback = accountButton(page)
    .locator('span[aria-hidden="true"]')
    .first();
  await expect(guildFallback).toHaveText("CC");
  // Initials come from the name the surface actually shows. This menu names the
  // signed-in person by their nickname in this server ("Jamie"), so a broken
  // picture falls back to one letter rather than initials from a name that is
  // not on screen.
  await expect(userFallback).toHaveText("J");
  expect((await guildFallback.boundingBox())?.width).toBe(33);
  expect((await userFallback.boundingBox())?.height).toBe(30);
  await page.screenshot({
    path: ".artifacts/dashboard-identity-fallbacks.png",
    animations: "disabled",
  });
  await page.unrouteAll();
  await page.reload();
  await decoded(guildButton(page).locator("img"));
  await decoded(accountButton(page).locator("img"));
});

test("changed profile metadata retries a previously failed image and then handles avatar removal", async ({
  page,
}) => {
  await page.route("**/demo/jamie-davis.svg", (route) => route.abort());
  await visit(page);
  await expect(accountButton(page).locator("img")).toHaveCount(0);
  // Actual browser decoding of explicit raster bytes, not a URL-only assertion.
  // This intercept is transport-fixture evidence, NOT live Discord CDN evidence.
  const png = await readFile(resolve("tests/fixtures/identity.png"));
  const avatar = "fedcba9876543210fedcba9876543210";
  const avatarUrl = `https://cdn.discordapp.com/avatars/120000000000000099/${avatar}.webp?size=128`;
  let withAvatar = true;
  await page.route("**/_next/image?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("url") === avatarUrl)
      await route.fulfill({ contentType: "image/png", body: png });
    else await route.continue();
  });
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "120000000000000099",
          name: "Updated global profile",
          avatar: withAvatar ? avatar : null,
          avatarUrl: withAvatar ? avatarUrl : null,
        },
      },
    })
  );
  await accountButton(page).click();
  await page
    .getByRole("menuitem", { name: "Refresh profile image & name" })
    .click();
  await decoded(accountButton(page, "Updated global profile").locator("img"));
  expect(
    await accountButton(page, "Updated global profile")
      .locator("img")
      .evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBe(40);
  withAvatar = false;
  await accountButton(page, "Updated global profile").click();
  await page
    .getByRole("menuitem", { name: "Refresh profile image & name" })
    .click();
  await expect(
    accountButton(page, "Updated global profile").locator("img")
  ).toHaveCount(0);
  await expect(
    accountButton(page, "Updated global profile")
      .locator('span[aria-hidden="true"]')
      .first()
  ).toHaveText("Ug");
});

test("the real demo profile refresh is private and performs no Discord operation", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (/discord(?:app)?\.com/.test(new URL(request.url()).hostname))
      external.push(request.url());
  });
  await visit(page);
  await accountButton(page).click();
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/auth/profile") &&
      response.request().method() === "POST"
  );
  await page
    .getByRole("menuitem", { name: "Refresh profile image & name" })
    .click();
  const result = await response;
  expect(result.ok()).toBe(true);
  expect(result.headers()["cache-control"]).toBe("private, no-store");
  const body = await result.json();
  expect(body.user.avatarUrl).toBe("/demo/jamie-davis.svg");
  expect(body.user).not.toHaveProperty("accessToken");
  expect(body.user).not.toHaveProperty("sessionId");
  await expect(
    page.getByText("Demo profile — Discord was not contacted")
  ).toBeVisible();
  expect(external).toEqual([]);
});

test("sidebar has no unexplained News status marker and describes the real moderation count", async ({
  page,
  request,
}) => {
  const snapshot = await (
    await request.get("/api/guilds/120000000000000001")
  ).json();
  await visit(page);
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  const news = nav.getByRole("link", { name: "News & feeds", exact: true });
  await expect(news).toBeVisible();
  await expect(news.locator("span:empty")).toHaveCount(0);
  await expect(
    nav.getByRole("link", { name: "Overview", exact: true })
  ).toHaveAttribute("aria-current", "page");
  const count = snapshot.resources.filter(
    (resource: { kind: string; enabled: boolean }) =>
      resource.kind === "rule" && resource.enabled
  ).length;
  if (count)
    await expect(
      nav.getByLabel(
        `${count} enabled rule configurations; moderation ${snapshot.guild.config.modules.moderation ? "enabled" : "paused"}`
      )
    ).toBeVisible();
  await expect(
    guildButton(page).getByText("Orbit installed", { exact: true })
  ).toBeVisible();
});

test("images and authorized navigation remain useful before/without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(root);
    await decoded(guildButton(page).locator("img"));
    await decoded(accountButton(page).locator("img"));
    await expect(
      page.getByRole("heading", { name: "Server overview" })
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: "News & feeds", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Keep your corner in the know." })
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("image optimizer rejects unapproved hosts, paths, formats and query strings", async ({
  request,
}) => {
  for (const url of [
    "https://example.invalid/avatar.webp?size=128",
    "https://cdn.discordapp.com/attachments/1/avatar.webp?size=128",
    "https://cdn.discordapp.com/avatars/1/avatar.svg?size=128",
    "https://cdn.discordapp.com/avatars/1/avatar.webp?size=4096",
  ]) {
    const response = await request.get(
      `/_next/image?url=${encodeURIComponent(url)}&w=64&q=75`
    );
    expect(response.status()).toBe(400);
    expect(await response.text()).toContain('"url" parameter is not allowed');
  }
});

test("identity controls remain keyboard-accessible on mobile and reject forged profile actions", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page);
  await accountButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("menuitem", { name: "Refresh profile image & name" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(accountButton(page)).toBeFocused();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await decoded(guildButton(page).locator("img"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({ path: ".artifacts/dashboard-identity-mobile.png" });
  const csrf = await request.post("/api/auth/profile", {
    headers: { origin: "https://attacker.example" },
    data: {},
  });
  expect(csrf.status()).toBe(403);
  const forged = await request.post("/api/auth/profile", {
    headers: { origin: "http://localhost:3000" },
    data: { userId: "120000000000000098" },
  });
  expect(forged.status()).toBe(422);
});

test("another account's refresh response requires server reauthorization instead of merging profiles", async ({
  page,
}) => {
  await visit(page);
  await page.route("**/api/auth/profile", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "120000000000000098",
          name: "Another account",
          avatar: null,
          avatarUrl: null,
        },
      },
    })
  );
  await accountButton(page).click();
  const reauthorization = page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname.endsWith("/overview") &&
      request.headers()["rsc"] === "1"
  );
  await page
    .getByRole("menuitem", { name: "Refresh profile image & name" })
    .click();
  await reauthorization;
  // Demo's server identity remains Jamie: the injected different account must never be adopted.
  await expect(accountButton(page)).toBeVisible();
  await expect(accountButton(page, "Another account")).toHaveCount(0);
});

test("navigation and identity controls pass scoped contrast/label checks in both themes", async ({
  page,
}) => {
  await visit(page);
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await setTheme(page, "dark");
    await expect(page.locator("html")).toHaveClass(
      new RegExp(`\\b${theme}\\b`)
    );
    const results = await new AxeBuilder({ page })
      .include('nav[aria-label="Workspace navigation"]')
      .include('button[aria-label^="Switch server"]')
      .include('button[aria-label^="Account menu"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.html),
      }))
    ).toEqual([]);
  }
});
