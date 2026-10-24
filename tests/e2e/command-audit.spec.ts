import { test, expect, type Page } from "@playwright/test";
const guild = "120000000000000001";
const root = `/dashboard/${guild}`;
async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 15000,
  });
}
async function auditFixture(page: Page) {
  const detail = `  Source lookup failed\n\tjava.example.Loader.<init>(Loader.java:42)\n${"A preserved cause, not a shortened summary. ".repeat(40)}\n  final line  `;
  const entry = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    guildId: guild,
    actorId: "120000000000000099",
    actorName: "Test operator",
    action: "failed",
    target: "music",
    detail,
    createdAt: "2026-10-24T12:00:00.000Z",
  };
  await page.route(`**/api/guilds/${guild}/history?**`, async (route) => {
    await route.fulfill({ json: { rows: [entry], total: 1 } });
  });
  return { entry, detail };
}
test("commands are discoverable, derived from registration, searchable, and filterable", async ({
  page,
}) => {
  await visit(page, `${root}/overview`);
  await page.getByRole("link", { name: "Commands", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "One command away." })
  ).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(35);
  await expect(
    page.getByText("Showing 35 of 35 command invocations", { exact: false })
  ).toBeVisible();
  await expect(
    page.getByText(
      "This does not verify which commands are currently registered in Discord.",
      { exact: false }
    )
  ).toBeVisible();
  const search = page.getByPlaceholder(
    "Search commands, arguments, or permissions…"
  );
  await search.fill("/timeout");
  await expect(page.getByRole("article")).toHaveCount(1);
  const timeout = page.getByRole("article", { name: "/timeout", exact: true });
  await timeout.locator("summary").click();
  await expect(timeout.getByText("Range: 1–40320")).toBeVisible();
  await expect(
    timeout.getByText("Moderate Members", { exact: true })
  ).toBeVisible();
  await search.fill("");
  await page.getByLabel("Filter command module").selectOption("music");
  await expect(page.getByRole("article")).toHaveCount(9);
  await expect(
    page.getByRole("article", { name: "/play", exact: true })
  ).toBeVisible();
  await search.fill("nonexistent-command-unique");
  await expect(
    page.getByText("No commands match", { exact: true })
  ).toBeVisible();
  await search.fill("");
  const catalog = await page.request.get(`/api/guilds/${guild}/commands`);
  expect(catalog.status()).toBe(200);
  expect(await catalog.json()).toMatchObject({
    source: "registration-definitions",
    registrationVerified: false,
    rootCount: 26,
    invocationCount: 35,
  });
  expect(
    (await page.request.get("/api/guilds/990000000000000999/commands")).status()
  ).toBe(403);
});
test("command reference is usable on mobile without page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await visit(page, `${root}/commands`);
  await page
    .getByPlaceholder("Search commands, arguments, or permissions…")
    .fill("/deals watch");
  const card = page.getByRole("article", { name: "/deals watch", exact: true });
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await expect(
    card.getByText("Additional runtime permission: Manage Server.")
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});
test("command reference handles a failed load and retries instead of showing an empty catalog", async ({
  page,
}) => {
  let first = true;
  await page.route(`**/api/guilds/${guild}/commands`, async (route) => {
    if (first) {
      first = false;
      await route.fulfill({
        status: 503,
        json: { error: "Temporarily unavailable" },
      });
    } else await route.continue();
  });
  await visit(page, `${root}/commands`);
  await expect(
    page.getByText("The command reference couldn’t load.", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(35);
});
test("audit detail copies the exact stored multiline error and full event JSON", async ({
  page,
}) => {
  const { entry, detail } = await auditFixture(page);
  await page.addInitScript(() => {
    (window as any).__copied = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).__copied.push(text);
        },
      },
    });
  });
  await visit(page, `${root}/audit`);
  await page.getByRole("button", { name: "View audit event" }).click();
  const dialog = page.getByRole("dialog");
  expect(await dialog.locator("dd").nth(4).textContent()).toBe(detail);
  await dialog.getByRole("button", { name: "Copy error", exact: true }).click();
  await expect(
    page.getByText("Details copied exactly as recorded", { exact: true })
  ).toBeVisible();
  expect(await page.evaluate(() => (window as any).__copied[0])).toBe(detail);
  await dialog
    .getByRole("button", { name: "Copy full event", exact: true })
    .click();
  expect(
    JSON.parse(await page.evaluate(() => (window as any).__copied[1]))
  ).toEqual(entry);
});
test("audit copy reports clipboard failure honestly and leaves the complete error selectable", async ({
  page,
}) => {
  const { detail } = await auditFixture(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("Permission denied");
        },
      },
    });
    document.execCommand = () => false;
  });
  await visit(page, `${root}/audit`);
  await page.getByRole("button", { name: "View audit event" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Copy error", exact: true }).click();
  await expect(
    page.getByText("Copy failed. Select the text and copy it manually.", {
      exact: true,
    })
  ).toBeVisible();
  expect(await dialog.locator("dd").nth(4).textContent()).toBe(detail);
  await expect(
    dialog.getByRole("button", { name: "Copy error", exact: true })
  ).toHaveText("Copy error");
});

test("the added command link does not make lower navigation unreachable on short desktop screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await visit(page, `${root}/commands`);
  await page
    .getByRole("link", { name: "Server settings", exact: true })
    .click();
  await expect(page).toHaveURL(`${root}/settings`);
  await expect(
    page.getByRole("heading", {
      name: "Make this space your own.",
      exact: true,
    })
  ).toBeVisible();
});
