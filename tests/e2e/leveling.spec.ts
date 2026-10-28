import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Levels & XP, in a real browser.
 *
 * This page shipped with no browser coverage at all, which is how it reached a
 * user with every tab stacked on top of every other. The primitive was
 * `TabPanel({ id, tab })` with `id` documented as the tab *list* id; the page
 * passed each panel's own name instead and rendered all three unconditionally.
 * Nothing threw. The only symptom was a page that looked wrong.
 *
 * These tests are written against the symptom a reader would notice, not
 * against the implementation:
 *
 * - exactly one panel exists per tab list, and the tab's `aria-controls`
 *   resolves to it — the two facts that were broken;
 * - the arrow keys move between tabs the same way they do elsewhere;
 * - the settings dialog opens with its title and first field on screen, which
 *   it did not while a nested scroll box and five stacked panels pushed the
 *   header out of view;
 * - a saved value survives closing and reopening the dialog.
 *
 * Assertions are on roles, names and DOM relationships so the internal id
 * scheme can change without these tests noticing.
 */
const root = "/dashboard/120000000000000001";

async function hydrated(page: Page) {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * The full `aria-controls` contract for one tab list, checked from the DOM.
 *
 * Every clause here was false on the broken page: all the panels mounted at
 * once, `aria-controls` pointed at an id that was never rendered, and the
 * panel that did render carried a different id from the one the tab
 * advertised. Nothing threw, which is why the page shipped like that.
 *
 * Read from the DOM rather than from knowledge of the id scheme, so the scheme
 * can change without these tests noticing.
 */
async function assertTabContract(
  page: Page,
  listName: string,
  expectedTabCount: number
) {
  const list = page.getByRole("tablist", { name: listName });
  await expect(list).toBeVisible();

  // What each tab claims to control, and which one is selected.
  const tabs = await list.getByRole("tab").evaluateAll((nodes) =>
    nodes.map((node) => ({
      name: (node.textContent ?? "").trim(),
      controls: node.getAttribute("aria-controls"),
      selected: node.getAttribute("aria-selected") === "true",
    }))
  );
  expect(
    tabs,
    `"${listName}" should have ${expectedTabCount} tabs`
  ).toHaveLength(expectedTabCount);
  for (const tab of tabs) {
    expect(
      tab.controls,
      `tab "${tab.name}" advertises no aria-controls`
    ).toBeTruthy();
  }
  expect(tabs.filter((tab) => tab.selected)).toHaveLength(1);

  // Every panel actually in the document, from any list.
  const mounted = await page
    .locator('[role="tabpanel"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id));

  // Exactly one of THIS list's advertised ids is mounted...
  const advertised = tabs.map((tab) => tab.controls!);
  const mountedHere = mounted.filter((id) => advertised.includes(id));
  expect(
    mountedHere,
    `expected exactly one mounted panel for "${listName}"`
  ).toHaveLength(1);

  // ...and it is the selected tab's, which is the whole point of aria-controls.
  const selected = tabs.find((tab) => tab.selected)!;
  expect(mountedHere[0]).toBe(selected.controls);

  // Unselected tabs must point at nothing at all.
  for (const tab of tabs.filter((tab) => !tab.selected)) {
    expect(
      mounted,
      `panel for unselected tab "${tab.name}" should not be mounted`
    ).not.toContain(tab.controls);
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${root}/xp`);
  await hydrated(page);
});

test("the levels page is reachable from the navigation", async ({ page }) => {
  await page.goto(`${root}/overview`);
  await hydrated(page);
  const nav = page.getByRole("navigation", { name: "Workspace navigation" });
  await nav.getByRole("link", { name: "Levels & XP" }).click();
  await expect(page).toHaveURL(new RegExp(`${root}/xp$`));
  await hydrated(page);
  await expect(
    page.getByRole("tablist", { name: "Leveling sections" })
  ).toBeVisible();
});

test("each section tab shows exactly one panel and owns it", async ({
  page,
}) => {
  const list = page.getByRole("tablist", { name: "Leveling sections" });

  // Leaderboard is the default.
  await expect(list.getByRole("tab", { name: "Leaderboard" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await assertTabContract(page, "Leveling sections", 3);

  // Switching tabs swaps the panel; it must never add one.
  await list.getByRole("tab", { name: "How levels work" }).click();
  await assertTabContract(page, "Leveling sections", 3);
  await expect(
    page.getByRole("heading", { name: "How a level is earned" })
  ).toBeVisible();
  // The leaderboard's own content is gone, not merely hidden underneath.
  await expect(
    page.getByRole("region", { name: "XP leaderboard" })
  ).toHaveCount(0);

  await list.getByRole("tab", { name: "Role rewards" }).click();
  await assertTabContract(page, "Leveling sections", 3);
  await expect(
    page.getByRole("region", { name: "XP leaderboard" })
  ).toHaveCount(0);
});

test("section tabs move with the arrow keys, Home and End", async ({
  page,
}) => {
  const list = page.getByRole("tablist", { name: "Leveling sections" });
  const leaderboard = list.getByRole("tab", { name: "Leaderboard" });
  const curve = list.getByRole("tab", { name: "How levels work" });
  const rewards = list.getByRole("tab", { name: "Role rewards" });

  // Roving tabindex: only the selected tab is in the Tab order.
  await expect(leaderboard).toHaveAttribute("tabindex", "0");
  await expect(curve).toHaveAttribute("tabindex", "-1");
  await expect(rewards).toHaveAttribute("tabindex", "-1");

  await leaderboard.focus();
  await page.keyboard.press("ArrowRight");
  await expect(curve).toHaveAttribute("aria-selected", "true");
  await expect(curve).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(rewards).toHaveAttribute("aria-selected", "true");
  await expect(rewards).toBeFocused();

  // Wraps.
  await page.keyboard.press("ArrowRight");
  await expect(leaderboard).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowLeft");
  await expect(rewards).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Home");
  await expect(leaderboard).toHaveAttribute("aria-selected", "true");
  await expect(leaderboard).toBeFocused();

  await page.keyboard.press("End");
  await expect(rewards).toHaveAttribute("aria-selected", "true");
  await expect(rewards).toBeFocused();

  // Only ever one panel, after every one of those keystrokes.
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);
});

test("the XP curve states both costs and lists real levels", async ({
  page,
}) => {
  await page
    .getByRole("tablist", { name: "Leveling sections" })
    .getByRole("tab", { name: "How levels work" })
    .click();

  await expect(
    page.getByRole("heading", { name: "How a level is earned" })
  ).toBeVisible();
  // The per-level cost and the cumulative cost are different numbers; mixing
  // them up is the documented mistake, so both are named in the page.
  await expect(page.getByText("5n² + 50n + 100")).toBeVisible();

  const table = page.locator("table").filter({ hasText: "Reaching level" });
  await expect(table).toBeVisible();
  for (const header of [
    "Reaching level",
    "This level costs",
    "Total XP to get here",
  ]) {
    await expect(
      table.getByRole("columnheader", { name: header })
    ).toBeVisible();
  }
  // Levels 1, 2, 3, 5, 10, 25, 50, 100.
  const firstColumn = table.locator("tbody tr td:first-child");
  await expect(firstColumn).toHaveCount(8);
  await expect(firstColumn.first()).toHaveText("Level 1");
  await expect(firstColumn.last()).toHaveText("Level 100");
});

test("the leaderboard joins roster identity rather than inventing it", async ({
  page,
}) => {
  const board = page.getByRole("region", { name: "XP leaderboard" });
  await expect(board).toBeVisible();

  const table = board.locator("table");
  for (const header of ["#", "Member", "Level", "Total XP"]) {
    await expect(
      table.getByRole("columnheader", { name: header })
    ).toBeVisible();
  }

  // Seeded XP for nine members, richest first.
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(9);

  const memberColumn = table.locator("tbody tr td:nth-child(2)");
  const names = (await memberColumn.allInnerTexts()).map((s) => s.trim());

  // The signed-in person is on the board and is marked, not renamed.
  const first = names[0];
  expect(first).toContain("Jamie");
  expect(first).toContain("You");

  // People the roster knows are named.
  const joined = names.join(" | ");
  for (const expected of ["Jamie", "Alex", "Milo", "Sophie", "Luna"]) {
    expect(joined, `expected "${expected}" on the board`).toContain(expected);
  }

  // A member who earned XP but has no roster row is shown as an id. Inventing
  // a name for them would be a lie the board cannot support.
  expect(joined).toContain("120000000000000499");

  // Rank order follows total XP, and the winner is called out.
  const totals = (
    await table.locator("tbody tr td:nth-child(5)").allInnerTexts()
  ).map((s) => Number(s.replace(/[^0-9-]/g, "")));
  expect(totals).toEqual([...totals].sort((a, b) => b - a));
  expect(totals[0]).toBeGreaterThan(totals[8]);
});

test("settings opens on its first tab with the title and first field in view", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Leveling settings" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // The header must be on screen. It was not, while five panels mounted at
  // once inside a nested scroll box and the browser scrolled to the bottom.
  await expect(
    dialog.getByRole("heading", { name: "Make levels feel like your server" })
  ).toBeInViewport();

  const list = dialog.getByRole("tablist", {
    name: "Leveling settings sections",
  });
  await expect(list).toBeInViewport();
  await expect(list.getByRole("tab", { name: "Messages" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  // One panel only, and it is the Messages one.
  await expect(dialog.locator('[role="tabpanel"]')).toHaveCount(1);
  const firstField = dialog.getByLabel("Minimum per message");
  await expect(firstField).toBeVisible();
  await expect(firstField).toBeInViewport();

  // The dialog must not contain a second scroll container nested inside its
  // own — that is what let the header scroll away in the first place.
  const nestedScrollers = await dialog.evaluate((node) => {
    const scrollable = (el: Element) => {
      const style = getComputedStyle(el);
      return (
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        el.scrollHeight > el.clientHeight + 1
      );
    };
    return Array.from(node.querySelectorAll("*")).filter(scrollable).length;
  });
  expect(
    nestedScrollers,
    "the settings dialog should have at most one scrollable region"
  ).toBeLessThanOrEqual(1);
});

test("every settings tab shows its own fields and only its own", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Leveling settings" }).click();
  const dialog = page.getByRole("dialog");
  const list = dialog.getByRole("tablist", {
    name: "Leveling settings sections",
  });

  const expected: [string, string[], string[]][] = [
    // tab, fields it must show, fields belonging to other tabs
    [
      "Messages",
      ["Minimum per message", "Maximum per message", "Seconds between awards"],
      ["Minimum per interval", "Excluded channels", "Announcement channel"],
    ],
    [
      "Voice",
      [
        "Minimum per interval",
        "Maximum per interval",
        "Interval (seconds)",
        "Session cap (minutes)",
        "People required in the channel",
      ],
      ["Minimum per message", "Excluded channels", "Announcement channel"],
    ],
    [
      "Exclusions",
      ["Excluded channels", "Excluded roles"],
      ["Minimum per message", "Minimum per interval", "Announcement channel"],
    ],
    [
      "Rewards",
      ["Keep every reward earned"],
      ["Minimum per message", "Excluded channels", "Announcement channel"],
    ],
    [
      "Announcement",
      ["Announce level ups", "Announcement channel", "Message"],
      ["Minimum per message", "Excluded channels", "Minimum per interval"],
    ],
  ];

  for (const [tab, present, absent] of expected) {
    await list.getByRole("tab", { name: tab }).click();
    await expect(list.getByRole("tab", { name: tab })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    // The point of the fix: still one panel, now a different one.
    await expect(dialog.locator('[role="tabpanel"]')).toHaveCount(1);
    for (const field of present) {
      await expect(
        dialog.getByLabel(field, { exact: false }).first(),
        `"${tab}" should show "${field}"`
      ).toBeVisible();
    }
    for (const field of absent) {
      await expect(
        dialog.getByLabel(field, { exact: false }),
        `"${tab}" should not show "${field}"`
      ).toHaveCount(0);
    }
  }
});

test("a saved setting survives closing and reopening the dialog", async ({
  page,
}) => {
  const field = "Minimum per message";

  await page.getByRole("button", { name: "Leveling settings" }).click();
  let dialog = page.getByRole("dialog");
  let input = dialog.getByLabel(field);
  await expect(input).toBeVisible();

  const original = await input.inputValue();
  const changed = String(Number(original) + 7);

  try {
    await input.fill(changed);
    await dialog.getByRole("button", { name: "Save settings" }).click();
    // Saving closes the dialog.
    await expect(dialog).toHaveCount(0);

    // Reopen: the value round-tripped through the store.
    await page.getByRole("button", { name: "Leveling settings" }).click();
    dialog = page.getByRole("dialog");
    input = dialog.getByLabel(field);
    await expect(input).toHaveValue(changed);
  } finally {
    // Put the seeded value back so this test does not leak state into the
    // rest of the suite, which shares one demo file.
    await input.fill(original);
    await dialog.getByRole("button", { name: "Save settings" }).click();
    await expect(dialog).toHaveCount(0);
  }
});

test("the levels page and its settings dialog pass axe at WCAG AA", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const analyse = async () => {
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
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(
      results.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => ({
          html: n.html,
          failureSummary: n.failureSummary,
        })),
      }))
    ).toEqual([]);
  };

  await analyse();

  await page.getByRole("button", { name: "Leveling settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await analyse();
});

test("the levels page stays usable at a phone width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await hydrated(page);

  const list = page.getByRole("tablist", { name: "Leveling sections" });
  await expect(list).toBeVisible();

  // The bar scrolls inside itself rather than widening the page.
  const overflows = await page.evaluate(
    () =>
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 1
  );
  expect(overflows, "the page should not scroll sideways at 390px").toBe(false);

  // Tabs still switch, and still only ever show one panel.
  await list.getByRole("tab", { name: "How levels work" }).click();
  await expect(
    page.getByRole("heading", { name: "How a level is earned" })
  ).toBeVisible();
  await expect(page.locator('[role="tabpanel"]')).toHaveCount(1);

  // The settings dialog fits the viewport at this width too.
  await page.getByRole("button", { name: "Leveling settings" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(390);

  await expect(
    dialog.getByRole("heading", { name: "Make levels feel like your server" })
  ).toBeInViewport();
  await expect(
    dialog.getByRole("tablist", { name: "Leveling settings sections" })
  ).toBeInViewport();
  await expect(dialog.locator('[role="tabpanel"]')).toHaveCount(1);
});
