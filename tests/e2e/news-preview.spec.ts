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
  // The meta line is posted date first, then the producing feed; match the line
  // exactly so the disclosure's copy of the feed name cannot satisfy it.
  await expect(
    card.getByText(/^Posted \d{1,2} \w{3} \d{4} · Community Announcements$/)
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

  // Diagnostics live in collapsed disclosures, not in the article body: one on
  // the feature card (configured subscription vs provider feed) and one for the
  // dialog (delivery behaviour, polled counts, provider notices).
  const details = card.locator("details").first();
  await expect(details).not.toHaveAttribute("open", "");
  await expect(card.getByText("Preview details")).toBeVisible();
  expect(text).not.toContain("No provider-supplied image");

  // Expanding the card disclosure names the configured subscription separately
  // from the provider feed.
  await details.locator("summary").click();
  await expect(
    details.getByText(
      /Configured source: CS2 updates · feed: Community Announcements/
    )
  ).toBeVisible();
  const dialogDetails = dialog.locator("details").last();
  await expect(dialogDetails).not.toHaveAttribute("open", "");
  await dialogDetails.locator("summary").click();
  await expect(
    dialogDetails.getByText(/Same normalization and embed limits/)
  ).toBeVisible();

  // The remaining polled items form a dated "more updates" list under the
  // feature card, and every row keeps its own link.
  await expect(
    dialog.getByRole("heading", { name: /^More updates from / })
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

/*
 * Feed artwork actually loads.
 *
 * `img-src` was `'self' data:` plus the Discord CDN, which is right for
 * avatars and wrong for a dashboard that previews third-party feeds: `CoverArt`
 * points a plain `<img>` straight at the provider's URL, so every Steam, ITAD
 * and RSS image was refused by the browser and each card fell back to "This
 * image did not load".
 *
 * It survived three releases because nothing rendered one: the recorded Steam
 * fixture below has `image: null` on every item, and no unit test can see a
 * CSP — the browser is the only thing that enforces it.
 *
 * The artwork is served by intercepting the provider host, so the suite needs
 * no Steam access, and the request is *counted*. That count is the real
 * assertion: CSP is enforced by the renderer before the network layer, so a
 * blocked image issues no request at all and never reaches the route. A test
 * that only checked `naturalWidth` would pass on a page that never fetched.
 */
const ARTWORK_HOST = "https://clan.fastly.steamstatic.com";
const ARTWORK_URL = `${ARTWORK_HOST}/images/4192955715210614400/csp-preview.jpg`;
/** A real 16x16 PNG, so "it loaded" means the bytes decoded. */
const ARTWORK_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJElEQVR42mPQiDoBRx8+fIUjXOIMg1ADMYqQxQejhtF4GBQaAJvZD5+ZnKo2AAAAAElFTkSuQmCC";

test("provider artwork is not blocked by the Content-Security-Policy", async ({
  page,
  request,
}) => {
  const withArtwork = JSON.parse(payload);
  withArtwork.items[0].image = ARTWORK_URL;
  withArtwork.items[0].imageKind = "provider";

  let imageRequests = 0;
  await page.route(`${ARTWORK_HOST}/**`, (route) => {
    imageRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(ARTWORK_PNG, "base64"),
    });
  });
  await page.route("**/api/guilds/**/resources/source/*/test", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(withArtwork),
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

  const image = dialog.locator("article").first().locator("img").first();
  await expect(image).toBeVisible();
  await image.scrollIntoViewIfNeeded();

  // The request left the browser at all.
  await expect.poll(() => imageRequests).toBeGreaterThan(0);
  // And it decoded, which is what "loaded" means.
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBe(16);

  /*
   * Never the failure placeholder, which is what shipped. `CoverArt` swaps the
   * `<img>` for that placeholder on `onError`, so an image the CSP refuses
   * leaves no `<img>` behind at all — an assertion on `naturalWidth` alone
   * would be satisfied by a page that never rendered one.
   */
  await expect(image).toHaveAttribute("src", ARTWORK_URL);
  await expect(
    dialog.locator('[title="This image did not load."]')
  ).toHaveCount(0);
});
