// @vitest-environment jsdom
/*
 * The Levels page, rendered.
 *
 * `tabs-contract.test.tsx` proves the primitive cannot stack panels. What it
 * cannot prove is that this page wired the primitive up correctly: `listId` is
 * a string, so passing the settings list id to a page panel — or a tab id where
 * a list id belongs, which is exactly the mistake that shipped — type-checks
 * cleanly and fails only in a browser.
 *
 * There is no browser here, so these tests render the real component against
 * real seed data and assert the same things a reader would notice:
 *
 * - one panel per tab list, and `aria-controls` resolving to it;
 * - the leaderboard joining roster names and leaving a roster-less earner as a
 *   bare id;
 * - the settings dialog mounting one panel per tab, and the right one.
 *
 * They are not a substitute for the e2e in `tests/e2e/leveling.spec.ts`, which
 * also covers arrow keys, viewport behaviour and axe. They are the part that
 * can be executed in this environment.
 */
import { LevelingPage } from "@/components/leveling-page";
import { WorkspaceContext, type Workspace } from "@/components/workspace";
import type { DashboardData } from "@orbit/core";
import { levelProgress } from "@orbit/core/leveling";
import { createDemo } from "@orbit/db/src/demo-seed";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

const GUILD_ID = "120000000000000001";

/*
 * jsdom has no ResizeObserver, and Radix uses one to keep a popup positioned
 * against its trigger. The settings dialog renders a Combobox, so without this
 * the dialog tests fail on an environment gap rather than on the app. It is a
 * no-op: nothing here asserts on measured size, and the e2e covers layout.
 */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  NoopResizeObserver as unknown as typeof ResizeObserver;

/**
 * The dashboard projection for the XP board, mirroring `withXpIdentity` in
 * `apps/web/lib/dashboard.ts`: XP rows carry an id and nothing else, and the
 * roster's current names are joined here.
 */
function board(demo: ReturnType<typeof createDemo>) {
  const members = (demo.members ?? []).filter((m) => m.guildId === GUILD_ID);
  const totals = Object.values(demo.xp?.totals ?? {})
    .filter((row) => row.guildId === GUILD_ID && row.total > 0)
    .sort((a, b) => b.total - a.total || a.userId.localeCompare(b.userId));
  return {
    total: totals.length,
    page: 1,
    pageSize: 25,
    rows: totals.map((row, i) => {
      const member = members.find((m) => m.userId === row.userId);
      const progress = levelProgress(row.total);
      return {
        ...row,
        level: progress.level,
        into: progress.into,
        needed: progress.needed,
        rank: i + 1,
        username: member?.username ?? null,
        globalName: member?.globalName ?? null,
        nickname: member?.nickname ?? null,
        avatarUrl: member?.avatar ?? null,
      };
    }),
  };
}

function fixture(): DashboardData {
  const demo = createDemo();
  const guild = demo.guilds[0];
  return {
    guild: {
      id: guild.id,
      name: guild.name,
      icon: guild.icon,
      installed: true,
      memberCount: guild.memberCount,
      config: guild.config,
      roles: guild.roles,
      channels: guild.channels,
      botRolePosition: 1,
    },
    guilds: demo.guilds,
    user: {
      id: demo.accounts[0].userId,
      username: "jamie.davis",
      globalName: "Jamie Davis",
      name: "Jamie",
      secondaryName: "@jamie.davis",
      avatarUrl: null,
    },
    xpBoard: board(demo),
  } as unknown as DashboardData;
}

function mount(children: ReactNode) {
  const workspace = {
    data: fixture(),
    refresh: async () => {},
    api: async () => undefined as never,
    saveConfig: async () => {},
    navigate: () => {},
    setData: () => {},
  } satisfies Workspace;
  return render(
    <WorkspaceContext.Provider value={workspace}>
      {children}
    </WorkspaceContext.Provider>
  );
}

afterEach(cleanup);

describe("Levels page", () => {
  it("mounts exactly one panel for the section tab list", () => {
    mount(<LevelingPage />);
    const list = screen.getByRole("tablist", { name: "Leveling sections" });
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);

    // The mounted panel is the one the selected tab advertises.
    const selected = within(list)
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(selected).toBeTruthy();
    expect(panels[0].id).toBe(selected.getAttribute("aria-controls"));
  });

  it("keeps one panel when the section tab changes", () => {
    mount(<LevelingPage />);
    const list = screen.getByRole("tablist", { name: "Leveling sections" });

    fireEvent.click(within(list).getByRole("tab", { name: "How levels work" }));
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
    expect(screen.getByText("How a level is earned")).toBeTruthy();

    fireEvent.click(within(list).getByRole("tab", { name: "Role rewards" }));
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    // The curve content is gone, not merely stacked underneath.
    expect(screen.queryByText("How a level is earned")).toBeNull();
  });

  it("names leaderboard members from the roster and leaves a stranger as an id", () => {
    mount(<LevelingPage />);
    const region = screen.getByRole("region", { name: "XP leaderboard" });
    const rows = within(region).getAllByRole("row");
    // Header row plus one per seeded earner.
    expect(rows.length).toBeGreaterThan(1);

    const text = region.textContent ?? "";
    // People the roster knows are named.
    expect(text).toContain("Jamie");
    expect(text).toContain("Alex");
    // An earner with no roster row is shown as a bare id rather than an
    // invented name — the board must not claim a name it cannot support.
    expect(text).toContain("120000000000000499");
  });

  it("marks the signed-in person on the board", () => {
    mount(<LevelingPage />);
    const region = screen.getByRole("region", { name: "XP leaderboard" });
    expect(within(region).getByText("You")).toBeTruthy();
  });

  /*
   * Radix's own focus handling must be enough.
   *
   * The dialog used to carry a page-specific `onOpenAutoFocus` handler that
   * pinned `scrollTop` to 0 and focused the first field manually. It was added
   * on the theory that the browser would scroll somewhere unhelpful. The real
   * cause of the scroll-to-bottom was the five stacked panels inside a nested
   * scroller — both now gone — and with one panel and one scroll container
   * Radix focuses the first tabbable descendant (the tab bar, at the top) and
   * the dialog simply opens at the top.
   *
   * The handler is deleted. This test is what says that was safe: no page
   * code touches focus or scroll, and the dialog still opens with its title
   * and first field inside the content box and the content unscrolled.
   *
   * What it cannot check is geometry — jsdom reports every rectangle as 0, so
   * "inside the content box" here means DOM containment, and `toBeInViewport`
   * in `tests/e2e/leveling.spec.ts` is what actually proves the pixels.
   */
  it("opens at the top on its own, with no page-level focus choreography", () => {
    mount(<LevelingPage />);
    // No per-page focus override: the source must not mention one.
    const source = readFileSync(
      resolve(process.cwd(), "apps/web/components/leveling-page.tsx"),
      "utf8"
    );
    expect(source).not.toContain("onOpenAutoFocus");

    fireEvent.click(screen.getByRole("button", { name: "Leveling settings" }));

    const content = screen.getByRole("dialog");
    // The content box is unscrolled.
    expect(content.scrollTop).toBe(0);

    // Title, tab bar and the first field are all inside it.
    const title = within(content).getByText(
      "Make levels feel like your server"
    );
    expect(content.contains(title)).toBe(true);
    const tabBar = within(content).getByRole("tablist", {
      name: "Leveling settings sections",
    });
    expect(content.contains(tabBar)).toBe(true);
    const firstField = within(content).getByLabelText("Minimum per message");
    expect(content.contains(firstField)).toBe(true);

    // And they are in that order, so the header is above the fields rather
    // than scrolled away beneath them.
    const order = content.compareDocumentPosition(firstField);
    expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("opens settings on the Messages tab with a single panel", () => {
    mount(<LevelingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Leveling settings" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("Make levels feel like your server")
    ).toBeTruthy();

    const list = within(dialog).getByRole("tablist", {
      name: "Leveling settings sections",
    });
    const selected = within(list)
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(selected.textContent).toBe("Messages");

    // One panel, and it belongs to this list, not to the page's.
    const panels = screen.getAllByRole("tabpanel");
    const settingsPanels = panels.filter((panel) =>
      panel.id.startsWith("leveling-settings-panel-")
    );
    expect(settingsPanels).toHaveLength(1);
    expect(settingsPanels[0].id).toBe(selected.getAttribute("aria-controls"));
  });

  it("shows only the active settings tab's fields", () => {
    mount(<LevelingPage />);
    fireEvent.click(screen.getByRole("button", { name: "Leveling settings" }));
    const dialog = screen.getByRole("dialog");
    const list = within(dialog).getByRole("tablist", {
      name: "Leveling settings sections",
    });

    const cases: [string, string, string][] = [
      // tab, a field it owns, a field belonging to another tab
      ["Messages", "Minimum per message", "Minimum per interval"],
      ["Voice", "Minimum per interval", "Minimum per message"],
      ["Exclusions", "Excluded channels", "Minimum per message"],
      ["Rewards", "Keep every reward earned", "Minimum per message"],
      ["Announcement", "Announcement channel", "Minimum per message"],
    ];

    for (const [tab, present, absent] of cases) {
      fireEvent.click(within(list).getByRole("tab", { name: tab }));
      const panels = screen
        .getAllByRole("tabpanel")
        .filter((panel) => panel.id.startsWith("leveling-settings-panel-"));
      expect(panels, `"${tab}" should mount one settings panel`).toHaveLength(
        1
      );
      expect(
        within(dialog).queryByLabelText(present),
        `"${tab}" should show "${present}"`
      ).toBeTruthy();
      expect(
        within(dialog).queryByLabelText(absent),
        `"${tab}" should not show "${absent}"`
      ).toBeNull();
    }
  });
});
