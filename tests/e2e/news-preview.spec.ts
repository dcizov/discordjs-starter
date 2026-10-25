import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test, expect } from "@playwright/test";

const guildId = "120000000000000001";
const root = `/dashboard/${guildId}`;

/**
 * The demo workspace ships a Steam source; take its name from the API rather
 * than assuming seed copy, so renaming the seed cannot silently skip this test.
 */
async function steamSourceName(request: any) {
  const data = await (await request.get(`/api/guilds/${guildId}`)).json();
  const source = data.resources.find(
    (resource: any) =>
      resource.kind === "source" && resource.data?.adapter === "steam"
  );
  expect(
    source,
    "the demo workspace should contain a Steam news source"
  ).toBeTruthy();
  return source.name as string;
}

function sourceCard(page: any, name: string) {
  return page
    .locator("div.rounded-xl")
    .filter({ has: page.getByRole("heading", { name, exact: true }) })
    .last();
}

/**
 * Browser regression for the reported defect.
 *
 * The test-flight response is the recorded payload in
 * `tests/fixtures/steam/preview-payload.json`: it is generated from the real
 * 2026-10-25 Steam response by `scripts/build-steam-preview.ts`, and
 * `tests/steam-news.test.ts` fails if it drifts from what the route produces.
 * Intercepting here means the browser renders genuine provider content without
 * this suite needing Steam access; the server-side normalization itself is
 * covered by `tests/steam-route.test.ts`.
 */
const payload = readFileSync(
  resolve("tests/fixtures/steam/preview-payload.json"),
  "utf8"
);

test("the Steam preview renders real announcement content without raw markup", async ({
  page,
  request,
}) => {
  await page.route("**/api/guilds/**/resources/source/*/test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: payload,
    })
  );
  await page.goto(`${root}/news`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();

  const name = await steamSourceName(request);
  await sourceCard(page, name)
    .getByRole("button", { name: "Test source", exact: true })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(/Found 4 recent items|The source is reachable/)
  ).toBeVisible();

  const card = dialog.locator("article").first();
  await expect(card).toBeVisible();

  // The heading survives as literal text; no escape characters and no list
  // markers anywhere in the card's rendered text.
  const text = await card.innerText();
  expect(text).toContain("[ MAP SCRIPTING ]");
  expect(text).not.toContain("[/*]");
  expect(text).not.toContain("[*]");
  expect(text).not.toContain("[p]");
  expect(text).not.toContain("\\[");
  expect(text).not.toContain("[\\");

  // Attribution names the feed and the real link destination.
  await expect(
    card.getByText("App announcement", { exact: true })
  ).toBeVisible();
  await expect(
    card.getByText("Community Announcements", { exact: false })
  ).toBeVisible();
  await expect(
    card.getByRole("link", { name: "Read the announcement" })
  ).toBeVisible();

  // Bullets are compact: each occupies exactly one line, with no blank line
  // between them (the reported bug put a marker and a gap on every entry).
  const excerpt = await card.locator("p.whitespace-pre-line").innerText();
  const lines = excerpt.split("\n");
  expect(lines[0]).toBe("[ MAP SCRIPTING ]");
  expect(lines).toContain("• Added Instance.Precache");
  expect(lines).toContain("◦ Returns a CSPrecache object");
  for (let i = 1; i < lines.length; i++)
    expect(lines[i], `line ${i} must not be blank`).not.toBe("");
  expect(lines.length).toBeLessThanOrEqual(7);

  // Missing-image and metadata diagnostics live in a collapsed disclosure, not
  // in the article body.
  const details = card.locator("details");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(card.getByText("Preview details")).toBeVisible();
  expect(text).not.toContain("No provider-supplied image");

  // Expanding the disclosure names the configured subscription separately from
  // the provider feed.
  await details.locator("summary").click();
  await expect(
    details.getByText(
      /Configured source: CS2 updates · feed: Community Announcements/
    )
  ).toBeVisible();
});

test("a provider outage is reported as a retryable failure, not a bad request", async ({
  page,
  request,
}) => {
  await page.route("**/api/guilds/**/resources/source/*/test", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Integration returned HTTP 503; retry after 120s",
        retryAfterSeconds: 120,
      }),
    })
  );
  await page.goto(`${root}/news`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible();
  const name = await steamSourceName(request);
  await sourceCard(page, name)
    .getByRole("button", { name: "Test source", exact: true })
    .click();
  // The failure message is visible; no fabricated cards are rendered.
  await expect(page.getByText(/Integration returned HTTP 503/)).toBeVisible();
  await expect(page.getByRole("dialog").locator("article")).toHaveCount(0);
});
