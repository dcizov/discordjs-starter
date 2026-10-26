import { expect, type Locator, type Page } from "@playwright/test";

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
