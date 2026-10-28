import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Accessibility of the reworked controls, in a real browser.
 *
 * Two kinds of check, both on the running demo app:
 *
 * 1. **Names and semantics** on the primitives that were migrated (Radix
 *    `Select`, combobox, switch, table headers, menus) — an unlabelled icon
 *    button or a switch with no accessible name fails here.
 * 2. **axe-core** on each page family, at WCAG 2.1/2.2 AA, in light and dark.
 *
 * It is not a substitute for a human review, and it does not test screen-reader
 * output; it does catch the regressions this pass could introduce.
 */
const guild = "/dashboard/120000000000000001";

const axe = async (page: Page, selector: string) => {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.allSettled(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getComputedTiming().iterations !== Infinity
        )
        .map((animation) => animation.finished)
    );
  });
  const results = await new AxeBuilder({ page })
    .include(selector)
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => ({
        html: node.html,
        failureSummary: node.failureSummary,
      })),
    }))
  ).toEqual([]);
};

test.beforeEach(async ({ page }) => {
  await page.goto(`${guild}/overview`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20000,
  });
});

test("every interactive control on the dashboard has an accessible name", async ({
  page,
}) => {
  const unnamed = await page.evaluate(() => {
    const controlSelector =
      'button, [role="button"], [role="switch"], [role="combobox"], [role="tab"], a[href], input, select, textarea';
    const nameOf = (element: Element) => {
      const aria = element.getAttribute("aria-label")?.trim();
      if (aria) return aria;
      const labelledBy = element.getAttribute("aria-labelledby");
      if (labelledBy) {
        const text = labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" ")
          .trim();
        if (text) return text;
      }
      const id = element.getAttribute("id");
      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (label?.textContent?.trim()) return label.textContent.trim();
      }
      const wrapping = element.closest("label");
      if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
      if (element instanceof HTMLInputElement) {
        if (element.type === "hidden") return "hidden";
        if (element.getAttribute("title"))
          return element.getAttribute("title")!;
      }
      const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text) return text;
      return "";
    };
    return Array.from(document.querySelectorAll(controlSelector))
      .filter((element) => {
        const style = getComputedStyle(element);
        const hidden =
          style.display === "none" ||
          style.visibility === "hidden" ||
          element.getAttribute("aria-hidden") === "true";
        return !hidden && !nameOf(element);
      })
      .map((element) => element.outerHTML.slice(0, 160));
  });
  expect(unnamed).toEqual([]);
});

test("the migrated selects are operable by keyboard and announce their value", async ({
  page,
}) => {
  await page.goto(`${guild}/commands`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20000,
  });
  const trigger = page.getByLabel("Filter command module", { exact: true });
  await expect(trigger).toHaveAttribute("role", "combobox");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  // Arrow keys move focus through the options and Enter chooses, so the whole
  // flow works without a pointer. Radix keeps focus on the option element
  // itself (rather than tracking an aria-activedescendant on the trigger), so
  // the assertion reads the focused option.
  await page.keyboard.press("ArrowDown");
  const focused = page.locator('[role="option"]:focus');
  await expect(focused).toBeVisible();
  const label = (await focused.innerText()).trim();
  expect(label.length).toBeGreaterThan(0);
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(trigger).toContainText(label);
  await expect(trigger).toBeFocused();
});

test("the channel combobox filters its options and restores focus", async ({
  page,
}) => {
  await page.goto(`${guild}/settings`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20000,
  });
  const trigger = page.getByRole("combobox", {
    name: "Moderation audit channel",
  });
  await trigger.click();
  const search = page.getByPlaceholder("Search channels…");
  await expect(search).toBeFocused();
  await search.fill("staff");
  // cmdk keeps non-matching items mounted but hidden, so the count that matters
  // is the visible one.
  const options = page.locator("[cmdk-list] [cmdk-item]:visible");
  await expect(options).toHaveCount(1);
  await expect(options.first()).toContainText("staff");
  await options.first().click();
  await expect(trigger).toContainText("staff");
  await expect(trigger).toBeFocused();
});

test("table headers expose sort state and the columns menu is keyboard operable", async ({
  page,
}) => {
  await page.goto(`${guild}/channels`);
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20000,
  });
  const table = page.getByRole("region", { name: "Channels" }).locator("table");
  await expect(table).toBeVisible();
  const channelHeader = table.getByRole("columnheader", { name: /Channel/ });
  // The first column is the channel name — the column being sorted.
  const names = () => table.locator("tbody tr td:first-child").allInnerTexts();
  await expect(channelHeader).not.toHaveAttribute("aria-sort", /.+/);
  await channelHeader.getByRole("button").click();
  await expect(channelHeader).toHaveAttribute("aria-sort", "ascending");
  const ascending = await names();
  await channelHeader.getByRole("button").click();
  await expect(channelHeader).toHaveAttribute("aria-sort", "descending");
  // Descending is the same list, reversed — an order change of the whole list,
  // not just an arrow. Comparing the two orders exactly avoids depending on any
  // particular collation.
  expect(await names()).toEqual([...ascending].reverse());

  await page.getByRole("button", { name: "Columns", exact: true }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const checkbox = menu.getByRole("menuitemcheckbox").first();
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await checkbox.click();
  await expect(menu.getByRole("menuitemcheckbox").first()).toHaveAttribute(
    "aria-checked",
    "false"
  );
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
});

for (const [label, theme] of [
  ["light", "light"],
  ["dark", "dark"],
] as const) {
  test(`the reworked pages pass axe at WCAG AA in the ${label} theme`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.addInitScript((value) => {
      window.localStorage.setItem("theme", value);
    }, theme);
    const pages: [string, string][] = [
      ["/login", "main"],
      [`${guild}/overview`, "main"],
      [`${guild}/channels`, "main"],
      [`${guild}/audit`, "main"],
      [`${guild}/settings`, "main"],
      [`${guild}/music`, "main"],
      [`${guild}/xp`, "main"],
      ["/docs", "main"],
      ["/docs/workflows", "main"],
    ];
    for (const [url, selector] of pages) {
      await page.goto(url);
      if (url.startsWith(guild)) {
        await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
          timeout: 20000,
        });
      }
      await axe(page, selector);
    }
  });
}
