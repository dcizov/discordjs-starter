// @vitest-environment jsdom
/*
 * A tab list must show exactly one panel, and that panel must be the one
 * `aria-controls` points at.
 *
 * For most of this page's life `TabPanel` took `{ id, tab }`, documented `id`
 * as the tab *list* id, and asked callers in a comment to render exactly one
 * panel for the active tab. Both were honoured by two callers and missed by
 * two others. The misses looked like this:
 *
 *   <TabPanel id="board"  tab={tab}>
 *   <TabPanel id="curve"  tab={tab}>
 *   <TabPanel id="rewards" tab={tab}>
 *
 * Each panel passed its own name where the list id was expected, and nothing
 * stopped all three mounting at once. Users saw every section stacked under
 * every other; screen readers saw `aria-controls="leveling-panel-board"`
 * resolving to nothing, because the element that actually rendered was
 * `board-panel-board`. Nothing threw, nothing warned, and the tabs looked
 * broken rather than misconfigured — which is why it survived review.
 *
 * The signature is now `{ listId, value, active }` and the panel returns
 * `null` unless `value === active`, so stacking is not expressible. These
 * tests exist so the guarantee is checked rather than asserted in a comment,
 * and so a future refactor that reintroduces the old shape fails here.
 */
import { TabBar, TabPanel, tabPanelId } from "@/components/ui/tabs";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

const TABS = [
  { id: "board", label: "Leaderboard" },
  { id: "curve", label: "XP curve" },
  { id: "rewards", label: "Role rewards" },
];

/**
 * The shape every caller uses: one bar, one panel per tab, all of them
 * written out. This is the usage that used to silently stack.
 */
function Harness({ initial = "board" }: { initial?: string }) {
  const [tab, setTab] = useState(initial);
  return (
    <div>
      <TabBar
        id="leveling"
        label="Leveling sections"
        tabs={TABS}
        value={tab}
        onChange={setTab}
      />
      {TABS.map((t) => (
        <TabPanel key={t.id} listId="leveling" value={t.id} active={tab}>
          <p>{`${t.id} content`}</p>
        </TabPanel>
      ))}
    </div>
  );
}

afterEach(cleanup);

describe("TabPanel", () => {
  it("renders only the active panel, even when every panel is written out", () => {
    render(<Harness initial="curve" />);

    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain("curve content");
    expect(screen.queryByText("board content")).toBeNull();
    expect(screen.queryByText("rewards content")).toBeNull();
  });

  it("gives the panel the id the tab's aria-controls points at", () => {
    render(<Harness initial="rewards" />);

    const tab = screen.getByRole("tab", { name: "Role rewards" });
    const controls = tab.getAttribute("aria-controls");
    expect(controls).toBe(tabPanelId("leveling", "rewards"));

    // The whole point: that id must resolve to a real element.
    const target = document.getElementById(controls!);
    expect(target).not.toBeNull();
    expect(target.getAttribute("role")).toBe("tabpanel");
    expect(target.textContent).toContain("rewards content");
  });

  it("labels the panel with the tab that controls it", () => {
    render(<Harness initial="board" />);

    // Asserted as a relationship rather than against the id scheme, so the
    // naming convention can change without this test noticing.
    const panel = screen.getByRole("tabpanel");
    const ownerId = panel.getAttribute("aria-labelledby");
    expect(ownerId).toBeTruthy();
    const owner = document.getElementById(ownerId!);
    expect(owner?.getAttribute("role")).toBe("tab");
    expect(owner?.textContent).toContain("Leaderboard");
  });

  it("swaps the panel when the active tab changes", () => {
    render(<Harness initial="board" />);
    expect(screen.getByRole("tabpanel").textContent).toContain("board content");

    fireEvent.click(screen.getByRole("tab", { name: "XP curve" }));

    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(1);
    expect(panels[0].textContent).toContain("curve content");
  });

  it("renders nothing at all when no tab is active", () => {
    // A caller that wires `active` to a value no panel claims. The old
    // component rendered every panel in this situation; this one shows why
    // that is worse than showing nothing.
    render(
      <div>
        <TabBar
          id="leveling"
          label="Leveling sections"
          tabs={TABS}
          value="board"
          onChange={() => {}}
        />
        <TabPanel listId="leveling" value="curve" active="board">
          <p>curve content</p>
        </TabPanel>
      </div>
    );
    expect(screen.queryByRole("tabpanel")).toBeNull();
    expect(screen.queryByText("curve content")).toBeNull();
  });

  it("keeps two independent tab lists on one page from colliding", () => {
    render(
      <div>
        <Harness initial="board" />
        <div>
          <TabBar
            id="leveling-settings"
            label="Leveling settings sections"
            tabs={TABS}
            value="rewards"
            onChange={() => {}}
          />
          {TABS.map((t) => (
            <TabPanel
              key={t.id}
              listId="leveling-settings"
              value={t.id}
              active="rewards"
            >
              <p>{`settings ${t.id} content`}</p>
            </TabPanel>
          ))}
        </div>
      </div>
    );

    // One panel per list, and each one carries a distinct id.
    const panels = screen.getAllByRole("tabpanel");
    expect(panels).toHaveLength(2);

    const ids = panels.map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain(tabPanelId("leveling", "board"));
    expect(ids).toContain(tabPanelId("leveling-settings", "rewards"));
  });
});

describe("TabBar", () => {
  it("marks only the active tab as selected", () => {
    render(<Harness initial="curve" />);
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("XP curve");
  });

  it("points every tab at the id its panel will have", () => {
    render(<Harness initial="board" />);
    for (const t of TABS) {
      const tab = screen.getByRole("tab", { name: t.label });
      expect(tab.getAttribute("aria-controls")).toBe(
        tabPanelId("leveling", t.id)
      );
    }
  });
});
