// @vitest-environment jsdom
/*
 * A cell must survive a re-render.
 *
 * Every table in the dashboard renders its cells through `@tanstack/react-table`,
 * which does `createElement(Comp, props)` with `Comp` taken from
 * `columnDef.cell`. When that function's identity changes, React unmounts the
 * cell instead of reconciling it, because the element types differ.
 *
 * The bug was visible as a row menu that closed itself: any re-render — a
 * background data refresh, a toast, a filter keystroke — tore down the open
 * Radix dropdown. It also dropped focus and reset uncontrolled state inside
 * cells. The moderation e2e only passed because it reloaded the page first,
 * which the test's own comment admitted.
 *
 * These tests are the reason the fix belongs in `DataTable` rather than in one
 * page: the mechanism lives in the shared table, and every page builds its
 * `columns` array inline.
 */
import { DataTable, type DataColumn } from "@/components/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; name: string };

/**
 * Render counters, kept outside React.
 *
 * A cell must not set state during render: an earlier draft of this file did,
 * and re-rendering the cell re-entered the setter until the run hung. Counting
 * into a plain object keeps the measurement from disturbing what it measures.
 */
const counts = { cellRender: 0, cellMount: 0, cellUnmount: 0 };

/** The uncontrolled Radix menu a real row's action cell renders. */
function menuFor(name: string) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Actions for ${name}`}>
        Open
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Delete {name}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Reports mount and unmount of a cell's contents, once each, outside render. */
function MenuCell({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    counts.cellMount += 1;
    return () => {
      counts.cellUnmount += 1;
    };
  }, []);
  return <>{children}</>;
}

/** The action cell a page defines: rebuilt inline, keyed by nothing else. */
function actionColumn(): DataColumn<Row> {
  return {
    key: "actions",
    label: "",
    canHide: false,
    render: (r) => {
      counts.cellRender += 1;
      return <MenuCell>{menuFor(r.name)}</MenuCell>;
    },
  };
}

/**
 * A page in miniature: `columns` is rebuilt inline on every render, and `rows`
 * is replaced wholesale on a timer, exactly as the real dashboard's background
 * refresh does it.
 *
 * The refresh is a timer rather than a button because an open Radix menu is
 * modal — it marks the rest of the page `aria-hidden`, so a button outside it
 * cannot be clicked while the menu is open. That is also the honest model: the
 * refresh that broke the menu arrived unprompted, not from a click.
 */
function Harness({ everyMs = 0 }: { everyMs?: number }) {
  const [rows, setRows] = useState<Row[]>([
    { id: "1", name: "First" },
    { id: "2", name: "Second" },
  ]);
  useEffect(() => {
    if (!everyMs) return;
    const timer = setInterval(
      // New array, new objects, same ids: what a refetch delivers.
      () => setRows((current) => current.map((r) => ({ ...r }))),
      everyMs
    );
    return () => clearInterval(timer);
  }, [everyMs]);
  const columns: DataColumn<Row>[] = [
    { key: "name", label: "Name", render: (r) => r.name },
    actionColumn(),
  ];
  return <DataTable rows={rows} columns={columns} />;
}

/**
 * Opens a row menu the way a pointer does; Radix opens on pointerdown.
 *
 * Deliberately synchronous: `findByRole` waits on timers, and these tests run
 * under fake timers, so an async query would wait for a clock that is not
 * moving. Radix opens the menu as a direct result of the event, so one `act`
 * is enough.
 */
async function openMenu(name: string) {
  const trigger = screen.getByRole("button", { name: `Actions for ${name}` });
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    trigger.click();
  });
  return screen.getByRole("menu");
}

/** Lets a harness's background refresh fire `n` times. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  counts.cellRender = 0;
  counts.cellMount = 0;
  counts.cellUnmount = 0;
});
afterEach(cleanup);

describe("table cells keep their identity across re-renders", () => {
  it("does not unmount a cell when the row data is replaced", async () => {
    vi.useFakeTimers();
    render(<Harness everyMs={1000} />);
    await act(async () => {});
    const mountedOnce = counts.cellMount;
    expect(mountedOnce).toBe(2); // one per row

    // Two refetches, each producing brand-new row objects with the same ids.
    await tick(2000);

    // The cells rendered again — the data changed — but nothing was torn down
    // and rebuilt. Before the fix every re-render unmounted both cells, so
    // `cellUnmount` grew by two per refresh and `cellMount` matched it.
    expect(counts.cellRender).toBeGreaterThan(mountedOnce);
    expect(counts.cellUnmount).toBe(0);
    expect(counts.cellMount).toBe(mountedOnce);
    vi.useRealTimers();
  });

  it("keeps an open row menu open while the data refreshes underneath it", async () => {
    vi.useFakeTimers();
    render(<Harness everyMs={1000} />);
    await act(async () => {});

    expect(await openMenu("First")).toBeTruthy();

    // Two background refreshes land while the menu is open: the exact
    // situation that used to unmount the menu out from under the pointer.
    await tick(2000);

    expect(screen.queryByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete First" })).toBeTruthy();
    vi.useRealTimers();
  });

  it("still shows refreshed data from a cell it did not remount", async () => {
    /*
     * The fix must not trade a live cell for a stale one. The stable `cell`
     * function looks its column up by key at call time, so a re-render shows
     * new data without changing the renderer's identity.
     */
    function Seen() {
      const [rows, setRows] = useState<Row[]>([{ id: "1", name: "Before" }]);
      const columns: DataColumn<Row>[] = [
        { key: "name", label: "Name", render: (r) => r.name },
      ];
      return (
        <>
          <button onClick={() => setRows([{ id: "1", name: "After" }])}>
            Rename
          </button>
          <DataTable rows={rows} columns={columns} />
        </>
      );
    }

    const page = render(<Seen />);
    await act(async () => {});
    expect(screen.getByText("Before")).toBeTruthy();

    await act(async () => {
      page.getByRole("button", { name: "Rename" }).click();
    });
    expect(screen.getByText("After")).toBeTruthy();
    expect(screen.queryByText("Before")).toBeNull();
  });

  it("rebuilds a column when the set of columns really changes", async () => {
    /*
     * Stability must not become stickiness: adding a column has to take effect.
     */
    function Growing() {
      const [wide, setWide] = useState(false);
      const columns: DataColumn<Row>[] = [
        { key: "name", label: "Name", render: (r) => r.name },
        ...(wide
          ? [
              {
                key: "extra",
                label: "Extra",
                render: (r: Row) => `extra-${r.name}`,
              },
            ]
          : []),
      ];
      return (
        <>
          <button onClick={() => setWide(true)}>Add column</button>
          <DataTable rows={[{ id: "1", name: "First" }]} columns={columns} />
        </>
      );
    }

    const page = render(<Growing />);
    await act(async () => {});
    expect(screen.queryByText("extra-First")).toBeNull();

    await act(async () => {
      page.getByRole("button", { name: "Add column" }).click();
    });
    expect(screen.getByText("extra-First")).toBeTruthy();
  });
});
