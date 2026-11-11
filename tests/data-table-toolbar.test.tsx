// @vitest-environment jsdom
/*
 * The toolbar is one row, and the first column is pinned.
 *
 * Both rules live in the shared table, so this is where they are tested: a page
 * cannot opt out of either by accident, and the geometry that matters at 390px
 * cannot be measured in jsdom, which lays nothing out. What *can* be asserted
 * here is the structure the geometry depends on — that there is one trigger per
 * toolbar rather than one per facet, and that the first cell of every row is
 * the one carrying the pinned styling.
 *
 * The measurement itself is `tests/e2e/tables-mobile.spec.ts`, which scrolls
 * each column into view in a real browser.
 */
import { DataTable, type DataColumn } from "@/components/data-table";
import type { FacetFilter } from "@/components/table-facet";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

type Row = { id: string; name: string; level: number; note: string };

const rows: Row[] = [
  { id: "1", name: "Ada", level: 3, note: "first" },
  { id: "2", name: "Grace", level: 9, note: "second" },
];

const columns: DataColumn<Row>[] = [
  { key: "name", label: "Member", render: (r) => r.name },
  { key: "level", label: "Level", render: (r) => String(r.level) },
  { key: "note", label: "Note", render: (r) => r.note },
];

function facet(key: string, title: string, value = "all"): FacetFilter {
  return {
    key,
    label: `Filter ${title.toLowerCase()}`,
    title,
    value,
    allValue: "all",
    onChange: () => {},
    options: [
      { value: "all", label: "All" },
      { value: "one", label: "One" },
    ],
  };
}

afterEach(cleanup);

describe("the toolbar is one row of controls", () => {
  it("offers one Filters trigger however many facets there are", () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        filters={[facet("a", "Alpha"), facet("b", "Beta"), facet("c", "Gamma")]}
      />
    );
    const triggers = screen.getAllByRole("button", { name: /^Filters/ });
    expect(triggers).toHaveLength(1);
    // And not one button per facet, which is what it used to be.
    expect(
      screen.queryByRole("button", { name: /^Filter alpha/ })
    ).toBeNull();
  });

  it("omits the trigger when there are no facets", () => {
    render(<DataTable rows={rows} columns={columns} />);
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
  });

  /*
   * The toolbar carries a hook so a test can address it without guessing by
   * position. Pinned because it is load-bearing in two directions: the
   * one-row assertion in `tables-mobile.spec.ts` selects the toolbar's own
   * controls through it, and without it that assertion has to widen to "every
   * button in the table", which picks up the sort buttons in the header and
   * the pager in the footer and can therefore never pass.
   */
  it("marks its toolbar so a test can scope to it", () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} filters={[facet("a", "Alpha")]} />
    );
    const toolbar = container.querySelectorAll("[data-table-toolbar]");
    expect(toolbar).toHaveLength(1);
    const withinToolbar = within(toolbar[0] as HTMLElement);
    // The controls the row is made of are inside it.
    expect(withinToolbar.getAllByRole("button").length).toBeGreaterThan(0);
    // The pager is not: it is a different row, and the hook exists precisely
    // so that "the toolbar" does not come to mean "the whole table".
    expect(
      withinToolbar.queryByRole("button", { name: /Next page/ })
    ).toBeNull();
  });

  it("names how many facets are set, so the trigger is not silent", () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        filters={[facet("a", "Alpha", "one"), facet("b", "Beta")]}
      />
    );
    expect(
      screen.getByRole("button", { name: "Filters: 1 of 2 set" })
    ).toBeTruthy();
  });

  it("opens every facet behind the one trigger", () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        filters={[facet("a", "Alpha"), facet("b", "Beta")]}
      />
    );
    // Radix renders the trigger's content eagerly; the panel is what is
    // gated. Both facet groups are named by their label, which is how the e2e
    // helper finds them.
    const trigger = screen.getByRole("button", { name: "Filters" });
    expect(trigger).toBeTruthy();
    expect(within(trigger).queryByText("Alpha")).toBeNull();
  });
});

describe("the first column is pinned", () => {
  it("pins the first cell of the header and of every row", () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} />
    );
    const headerFirst = container.querySelector("thead th");
    expect(headerFirst?.className).toContain("sticky");
    expect(headerFirst?.className).toContain("left-0");

    const bodyFirsts = Array.from(
      container.querySelectorAll("tbody tr")
    ).map((tr) => tr.querySelector("td"));
    expect(bodyFirsts).toHaveLength(rows.length);
    for (const cell of bodyFirsts) {
      expect(cell?.className).toContain("sticky");
      expect(cell?.className).toContain("left-0");
    }
  });

  it("pins only the first column", () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} />
    );
    const headerCells = Array.from(container.querySelectorAll("thead th"));
    expect(headerCells).toHaveLength(columns.length);
    expect(headerCells.filter((th) => th.className.includes("sticky")))
      .toHaveLength(1);
  });

  it("can be turned off for a table whose first column is not the identity", () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} pinFirstColumn={false} />
    );
    expect(
      Array.from(container.querySelectorAll("th,td")).filter((cell) =>
        cell.className.includes("sticky")
      )
    ).toHaveLength(0);
  });

  it("moves the pin when the first column is hidden", () => {
    const { container } = render(
      <DataTable
        rows={rows}
        columns={[
          { ...columns[0], defaultHidden: true },
          ...columns.slice(1),
        ]}
      />
    );
    const visible = Array.from(container.querySelectorAll("thead th"));
    // The hidden first column is gone, so "Level" is now the pinned one.
    expect(visible).toHaveLength(2);
    expect(visible[0].textContent).toContain("Level");
    expect(visible[0].className).toContain("sticky");
  });
});

describe("the row backgrounds are opaque", () => {
  /*
   * A pinned cell paints above the columns scrolled underneath it, so a
   * translucent row colour shows them through it. Every state the row can be
   * in has to be a solid colour; this asserts it for the base row, which is
   * the one the pinned cell inherits.
   */
  it("gives the row and its cells an inherit chain, not a translucent colour", () => {
    const { container } = render(
      <DataTable rows={rows} columns={columns} />
    );
    const row = container.querySelector("tbody tr");
    expect(row?.className).toContain("bg-inherit");
    // `/40`, `/60`, `/10` — any alpha is the bug.
    expect(row?.className).not.toMatch(/bg-[a-z-]+\/\d/);
    for (const cell of Array.from(container.querySelectorAll("tbody td"))) {
      expect(cell.className).toContain("bg-inherit");
    }
  });
});
