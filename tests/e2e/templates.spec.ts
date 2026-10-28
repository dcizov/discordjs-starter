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
  /*
   * "Capture this server", not "New template".
   *
   * The builder slice split one button into two, and the product is right to
   * have done so: "New template" now opens the builder, which composes a
   * template from scratch, while "Capture this server" reads this server's
   * roles, channels and configuration out of Discord. This spec is about the
   * capture flow — it fills the capture dialog and asserts the captured result
   * — so it was following the wrong button.
   */
  await page.getByRole("button", { name: "Capture this server" }).click();
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
  /*
   * The copy appears twice on purpose: once in the visible result card, once in
   * an sr-only polite live region, so a state change is announced and not only
   * animated. A bare getByText therefore matched two elements. Assert on the
   * one that is actually shown, not on the announcement.
   */
  await expect(
    page.locator("p:not(.sr-only)", {
      hasText: "Demo preview — nothing was created",
    })
  ).toBeVisible();
  await expect(
    page.getByText(/Demo mode: nothing was created in a Discord server/)
  ).toBeVisible();
});

/*
 * The regression behind every red CI run since 84c9c7f.
 *
 * The templates page polls while a capture or an apply is in flight. Two bugs
 * turned that into roughly 350 requests/second against `/templates/runs/null`
 * and `/actions/null`: the poller asked even when there was no id to build a
 * URL from, and it rescheduled itself with a delay of zero every time a request
 * failed because `idleMs: 0` was consulted after the backoff instead of before
 * it. The rate limiter then starved the Members page, which rendered "Too many
 * requests" and never reached networkidle — so a defect on the templates page
 * presented as a failure of the member directory.
 *
 * This asserts the part the unit tests cannot: that leaving the page actually
 * stops the traffic.
 */
test("leaving the templates section stops all template polling", async ({
  page,
}) => {
  const polls: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/\/templates\/runs\/|\/actions\//.test(url)) polls.push(url);
  });

  await page.goto(`${root}/templates`);
  await hydrated(page);
  // Give any straggler from the initial mount a chance to appear.
  await page.waitForTimeout(2_000);
  const beforeLeaving = polls.length;

  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("link", { name: "Members" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}/members$`));
  await hydrated(page);
  await expect(
    page.getByRole("heading", { name: "The people who make this place." })
  ).toBeVisible();

  // Long enough that a 2s active poll, or a zero-delay loop, would be obvious.
  await page.waitForTimeout(6_000);
  const afterLeaving = polls.slice(beforeLeaving);
  expect(
    afterLeaving,
    `template polling continued after navigating away: ${afterLeaving.length} request(s), first: ${afterLeaving[0] ?? "none"}`
  ).toEqual([]);

  // And nothing asked for an id that does not exist, at any point.
  const nullPolls = polls.filter((u) => /\/(null|undefined)(\?|$)/.test(u));
  expect(nullPolls, `polled a missing id: ${nullPolls[0] ?? ""}`).toEqual([]);
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
