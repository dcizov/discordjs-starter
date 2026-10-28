"use client";
import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * In-page tabs shared by the dashboard sections.
 *
 * The pages that used to hand-roll this bar differed in padding, hover state,
 * capitalisation and — more importantly — in accessibility: plain buttons with a
 * colour change, no roles and no keyboard support. This keeps the same visual
 * language and adds the semantics the pattern requires:
 *
 * - `role="tablist"`, `role="tab"` with roving `tabIndex`, `aria-selected`;
 * - Left/Right/Home/End move selection *and* focus (manual activation);
 * - each tab names its own panel through `aria-controls`, and the caller renders
 *   exactly one `TabPanel` for the active tab (see `tabPanelId`).
 *
 * The caller owns the panel content because sections compose different clients.
 * Ids are explicit (`id="economy"`) instead of generated: deterministic markup is
 * easier to assert in tests and stable across server/client render.
 */
export type TabItem = {
  id: string;
  label: string;
  /** Optional count or short state shown after the label. */
  badge?: React.ReactNode;
};

export function tabPanelId(listId: string, tabId: string) {
  return `${listId}-panel-${tabId}`;
}

function tabId(listId: string, tabId: string) {
  return `${listId}-tab-${tabId}`;
}

export function TabBar({
  id,
  tabs,
  value,
  onChange,
  label,
  className,
  controls = true,
}: {
  /** Stable page-level id, e.g. "economy". */
  id: string;
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list, e.g. "Economy sections". */
  label: string;
  className?: string;
  /**
   * Whether the caller renders `TabPanel` elements. Pass `false` for a section
   * that swaps large conditional trees and cannot easily wrap them: the tab
   * semantics still work, and `aria-controls` is omitted rather than pointing at
   * an element that does not exist.
   */
  controls?: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const select = (next: TabItem | undefined) => {
    if (!next) return;
    onChange(next.id);
    // Manual activation: focus follows the newly selected tab.
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)
      ?.focus();
  };

  const move = (offset: number | "first" | "last") => {
    const index = tabs.findIndex((tab) => tab.id === value);
    const next =
      offset === "first"
        ? 0
        : offset === "last"
          ? tabs.length - 1
          : (index + offset + tabs.length) % tabs.length;
    select(tabs[next]);
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn("mb-5 flex gap-6 overflow-x-auto border-b", className)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          move(1);
        } else if (event.key === "ArrowLeft") {
          event.preventDefault();
          move(-1);
        } else if (event.key === "Home") {
          event.preventDefault();
          move("first");
        } else if (event.key === "End") {
          event.preventDefault();
          move("last");
        }
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabId(id, tab.id)}
            data-tab={tab.id}
            aria-selected={selected}
            {...(controls ? { "aria-controls": tabPanelId(id, tab.id) } : {})}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative -mb-px whitespace-nowrap border-b-2 px-0.5 pb-3 pt-1 text-[12px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              selected
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
            {tab.badge ? (
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Panel for one tab. Renders nothing unless that tab is the active one.
 *
 * The previous signature was `TabPanel({ id, tab })`, with `id` documented as
 * the *list* id and a comment asking the caller to render exactly one panel.
 * Both were easy to get wrong and nothing enforced either: a caller read the
 * argument names as "this panel's id", passed a tab id where the list id was
 * expected, and rendered every panel unconditionally. Every section then
 * stacked on top of every other, and `aria-controls` pointed at an element
 * that was never rendered (`leveling-panel-board` versus `board-panel-board`).
 *
 * A comment asking politely is not a contract. This one is: panels cannot
 * stack, because every tab except the active one returns `null`, and the ids
 * cannot disagree, because both derive from the same `listId`.
 *
 * `active` is required rather than defaulted so a caller must say which tab is
 * selected — the mistake this replaces was a caller that never said.
 */
export function TabPanel({
  listId,
  value,
  active,
  className,
  children,
}: {
  /** The `TabBar`'s id, e.g. "leveling". Both panel ids derive from it. */
  listId: string;
  /** The tab this panel belongs to, e.g. "board". */
  value: string;
  /** The currently selected tab id. */
  active: string;
  className?: string;
  children: React.ReactNode;
}) {
  if (value !== active) return null;
  return (
    <div
      role="tabpanel"
      id={tabPanelId(listId, value)}
      aria-labelledby={tabId(listId, value)}
      // Focusable so keyboard users can reach the panel content after the bar.
      tabIndex={0}
      className={cn("focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
