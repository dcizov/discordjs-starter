import { describe, expect, it } from "vitest";
import {
  historyQueryString,
  parseHistoryQuery,
  HISTORY_KINDS,
} from "@orbit/core/history-query";
import {
  compareHistoryRows,
  DEFAULT_HISTORY_SORT,
  HISTORY_SORT_FIELDS,
  parseHistorySort,
} from "@orbit/db/src/history-sort";

/**
 * The dashboard table and the `/history` route share one query contract. These
 * tests keep the two sides honest: what the client builds is what the route
 * accepts, and the sort allow-list stays per dataset.
 */
describe("history query contract", () => {
  it("round-trips what the dashboard sends", () => {
    const search = new URLSearchParams(
      historyQueryString({
        kind: "audit",
        page: 2,
        query: "alice",
        filter: "created",
        sort: "actorName",
        dir: "asc",
      })
    );
    expect(search.get("kind")).toBe("audit");
    expect(parseHistoryQuery(search)).toEqual({
      page: 2,
      pageSize: 7,
      query: "alice",
      filter: "created",
      sort: "actorName",
      dir: "asc",
    });
  });

  it("defaults the optional parts instead of requiring them", () => {
    expect(parseHistoryQuery(new URLSearchParams())).toEqual({
      page: 1,
      pageSize: 7,
      query: "",
      filter: "all",
    });
  });

  it("rejects an unknown parameter rather than ignoring it", () => {
    // A typo in a filter must not look like "the filter did nothing".
    expect(() =>
      parseHistoryQuery(new URLSearchParams("filtr=created"))
    ).toThrow();
  });

  it("rejects out-of-range paging and a bad direction", () => {
    expect(() => parseHistoryQuery(new URLSearchParams("page=0"))).toThrow();
    expect(() =>
      parseHistoryQuery(new URLSearchParams("pageSize=500"))
    ).toThrow();
    expect(() =>
      parseHistoryQuery(new URLSearchParams("dir=sideways"))
    ).toThrow();
  });

  it("names every dataset the route accepts", () => {
    expect([...HISTORY_KINDS]).toEqual([
      "audit",
      "ledger",
      "deliveries",
      "cases",
    ]);
    for (const kind of HISTORY_KINDS)
      expect(HISTORY_SORT_FIELDS[kind].length).toBeGreaterThan(0);
  });
});

describe("history sort allow-list", () => {
  it("defaults to newest first", () => {
    expect(parseHistorySort("audit", {})).toEqual(DEFAULT_HISTORY_SORT);
    expect(parseHistorySort("deliveries", { sort: "status" })).toEqual({
      field: "status",
      dir: "desc",
    });
  });

  it("only allows fields a dataset actually shows", () => {
    expect(parseHistorySort("ledger", { sort: "amount", dir: "asc" })).toEqual({
      field: "amount",
      dir: "asc",
    });
    expect(() => parseHistorySort("audit", { sort: "amount" })).toThrow(
      'Cannot sort audit history by "amount"'
    );
    expect(() => parseHistorySort("cases", { sort: "actorName" })).toThrow();
    expect(() =>
      parseHistorySort("audit", { sort: "createdAt", dir: "up" })
    ).toThrow('Sort direction must be "asc" or "desc".');
  });

  it("orders demo rows the same way the database orders real ones", () => {
    const rows = [
      {
        id: "b",
        createdAt: "2026-10-01T00:00:00.000Z",
        amount: 5,
        name: "zoe",
      },
      {
        id: "a",
        createdAt: "2026-10-02T00:00:00.000Z",
        amount: -1,
        name: "amy",
      },
      {
        id: "c",
        createdAt: "2026-10-03T00:00:00.000Z",
        amount: 10,
        name: "moe",
      },
    ];
    expect(
      rows
        .slice()
        .sort(compareHistoryRows({ field: "amount", dir: "asc" }))
        .map((r) => r.amount)
    ).toEqual([-1, 5, 10]);
    expect(
      rows
        .slice()
        .sort(compareHistoryRows({ field: "name", dir: "desc" }))
        .map((r) => r.name)
    ).toEqual(["zoe", "moe", "amy"]);
    expect(
      rows
        .slice()
        .sort(compareHistoryRows({ field: "createdAt", dir: "desc" }))
        .map((r) => r.id)
    ).toEqual(["c", "a", "b"]);
  });

  it("breaks ties by id so paging cannot repeat a row", () => {
    const rows = [
      { id: "2", createdAt: "2026-10-01T00:00:00.000Z" },
      { id: "1", createdAt: "2026-10-01T00:00:00.000Z" },
    ];
    const sorted = rows.slice().sort(compareHistoryRows(DEFAULT_HISTORY_SORT));
    expect(sorted.map((r) => r.id)).toEqual(["2", "1"]);
  });
});
