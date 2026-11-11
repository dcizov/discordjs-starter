import { expect, type Locator, type Page } from "@playwright/test";
import { describeOffenders, scanOverflowOffenders } from "./overflow-scan";

/**
 * Choose an option from a shadcn/Radix `Select` or `Combobox`.
 *
 * These are buttons plus a listbox, not native `<select>` elements, so
 * `selectOption()` does not apply. The helper drives them the way a keyboard
 * user does — open the trigger by its accessible name, then pick the option —
 * which also proves the control is actually operable and announces its name.
 *
 * `name` is the control's accessible name (its `Field` label or `aria-label`).
 * `option` is the visible option text.
 */
/** Radix portals its popups to <body>, so popup lookups always start at the page. */
function root(page: Page | Locator): Page {
  return "page" in page && typeof page.page === "function"
    ? page.page()
    : (page as Page);
}

export async function chooseOption(
  page: Page | Locator,
  name: string,
  option: string,
  options: { exact?: boolean } = {}
) {
  const trigger = page.getByLabel(name, { exact: options.exact ?? true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  // Radix portals the listbox to <body>, so it is not a descendant of a dialog
  // passed in as the scope. Only one select can be open, so the page-level
  // lookup is unambiguous.
  const view = root(page);
  const listbox = view.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await listbox
    .getByRole("option", { name: option, exact: options.exact ?? true })
    .click();
  await expect(listbox).toBeHidden();
}

/**
 * Set a faceted filter.
 *
 * Two shapes exist, and the helper works with either rather than making the
 * caller know which page it is on:
 *
 * - `DataTable` collapses every facet into one "Filters" trigger, with a group
 *   per facet. This is the shape that keeps the toolbar to a single row.
 * - The card lists (news sources, role panels) keep one standalone trigger per
 *   facet, named for the facet itself.
 *
 * Both are found by the facet's own name, so a page can move between the two
 * without the test changing.
 */
export async function chooseFacet(
  page: Page | Locator,
  name: string,
  option: string
) {
  const view = root(page);
  // The option text carries the value and, when the caller knows one, a count:
  // "Needs setup 2". Matching the prefix avoids depending on that suffix.
  const item = (scope: Locator) =>
    scope.locator("[cmdk-item]").filter({ hasText: new RegExp(`^${option}`) });

  const combined = view.getByRole("button", { name: /^Filters/ });
  if ((await combined.count()) > 0) {
    await expect(combined).toBeVisible();
    await combined.click();
    const group = view.getByRole("group", { name });
    await expect(group).toBeVisible();
    const option_ = item(group);
    await expect(option_).toHaveCount(1);
    await option_.click();
    // The menu deliberately stays open after a pick — setting two filters in
    // one visit is the common case — so close it and assert on the count the
    // trigger reports, which is the only summary left once the panel is shut.
    await view.keyboard.press("Escape");
    await expect(combined).toHaveAccessibleName(/^Filters: [1-9]/);
    return;
  }

  const trigger = view.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const list = view.locator("[cmdk-list]");
  await expect(list).toBeVisible();
  const optionItem = item(list);
  await expect(optionItem).toHaveCount(1);
  await optionItem.click();
  await expect(list).toBeHidden();
  await expect(trigger).toContainText(option);
}

/** Same, for a searchable combobox: type to narrow, then pick. */
export async function chooseComboboxOption(
  page: Page | Locator,
  name: string,
  option: string
) {
  const trigger = page.getByRole("combobox", { name });
  await expect(trigger).toBeVisible();
  await trigger.click();
  // The search field is cmdk's own input; its placeholder differs per page
  // ("Search…", "Search channels…"), so it is found structurally.
  const view = root(page);
  // The popover is portalled too, so the field and list are found from the page.
  const search = view.locator("[cmdk-input]");
  await expect(search).toBeVisible();
  await search.fill(option);
  await view
    .locator("[cmdk-list]")
    .getByRole("option", { name: option })
    .first()
    .click();
  await expect(view.locator("[cmdk-list]")).toBeHidden();
}

/**
 * Set the dashboard appearance through its menu.
 *
 * The theme control is a menu (Light / Dark / System) rather than a toggle, so
 * the system preference is reachable from the UI. Tests drive the real menu.
 */
export async function setTheme(page: Page, theme: "light" | "dark" | "system") {
  const label = theme[0].toUpperCase() + theme.slice(1);
  const trigger = page.getByRole("button", { name: "Color theme" });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByRole("menuitemradio", { name: label }).click();
  if (theme === "system") return;
  await expect(page.locator("html")).toHaveClass(
    theme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b).*/
  );
}

/**
 * Assert the document does not scroll sideways, naming what overflows.
 *
 * Replaces the bare `scrollWidth <= innerWidth` comparison. That form answered
 * "no" and stopped there, so every failure came back as a manual bisect in a
 * real browser; this one names the element and the distance, which is usually
 * enough to fix it without reproducing it.
 */
export async function expectNoHorizontalOverflow(
  page: Page,
  label: string
): Promise<void> {
  const vw = await page.evaluate(() => window.innerWidth);
  // Serialised into the page, so the scan must close over nothing.
  const bad = await page.evaluate(scanOverflowOffenders, vw);
  // Sub-pixel layout is not overflow. The tolerance is spelled out rather
  // than imported: this function is serialised into the page, where a
  // module binding would not exist.
  const scrolls = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
  );
  if (bad.length === 0 && !scrolls) return;
  const detail =
    bad.length > 0
      ? `\n${describeOffenders(bad, vw)}`
      : "\n  (no element's right edge is over the line, but the document still scrolls)";
  expect(
    bad.length + (scrolls ? 1 : 0),
    `${label}: the ${vw}px viewport scrolls sideways.${detail}`
  ).toBe(0);
}
