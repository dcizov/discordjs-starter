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
export async function chooseOption(
  page: Page | Locator,
  name: string,
  option: string,
  options: { exact?: boolean } = {}
) {
  const trigger = page.getByLabel(name, { exact: options.exact ?? true });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const listbox = page.getByRole("listbox");
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
  const search = page.getByPlaceholder("Search…");
  await search.fill(option);
  await page.getByRole("option", { name: option }).first().click();
  await expect(page.getByRole("listbox")).toBeHidden();
}
