import type { HistoryKind } from "./history";

/**
 * Server-side sorting for history tables.
 *
 * Sorting happens in the database, never on a page of rows: a "sorted by amount"
 * view that only reorders the seven rows already fetched would be a lie about the
 * rest of the table. Only the fields a screen actually shows are allowed, and
 * each kind has its own list, so a request cannot sort by a column that would
 * leak information a screen never displays.
 */
export type HistorySortField =
  "createdAt" | "actorName" | "action" | "amount" | "type" | "status" | "name";

export type HistorySort = {
  field: HistorySortField;
  dir: "asc" | "desc";
};

export const DEFAULT_HISTORY_SORT: HistorySort = {
  field: "createdAt",
  dir: "desc",
};

export const HISTORY_SORT_FIELDS: Record<
  HistoryKind,
  readonly HistorySortField[]
> = {
  audit: ["createdAt", "actorName", "action"],
  ledger: ["createdAt", "amount", "type"],
  deliveries: ["createdAt", "status"],
  cases: ["createdAt", "name"],
};

/**
 * Validate a requested sort against the kind's allow-list.
 *
 * Unknown or unsupported values are rejected rather than silently ignored, so a
 * client cannot believe it is looking at ascending amounts while receiving the
 * default order.
 */
export function parseHistorySort(
  kind: HistoryKind,
  input: { sort?: string | null; dir?: string | null } = {}
): HistorySort {
  const field = (input.sort ?? DEFAULT_HISTORY_SORT.field) as HistorySortField;
  const dir =
    input.dir === "asc" ? "asc" : input.dir === "desc" ? "desc" : null;
  const allowed = HISTORY_SORT_FIELDS[kind];
  if (!allowed.includes(field))
    throw new Error(
      `Cannot sort ${kind} history by "${field}". Allowed: ${allowed.join(", ")}.`
    );
  if (input.dir && !dir)
    throw new Error(`Sort direction must be "asc" or "desc".`);
  return { field, dir: dir ?? DEFAULT_HISTORY_SORT.dir };
}

const stringFields: HistorySortField[] = [
  "actorName",
  "action",
  "type",
  "status",
  "name",
];

/** Comparator for the demo store, which has no database to sort in. */
export function compareHistoryRows(
  sort: HistorySort
): (a: Record<string, any>, b: Record<string, any>) => number {
  const sign = sort.dir === "asc" ? 1 : -1;
  return (a, b) => {
    if (sort.field === "createdAt") {
      const diff =
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (diff) return diff * sign;
    } else if (sort.field === "amount") {
      const diff = Number(a.amount ?? 0) - Number(b.amount ?? 0);
      if (diff) return diff * sign;
    } else if (stringFields.includes(sort.field)) {
      const diff = String(a[sort.field] ?? "").localeCompare(
        String(b[sort.field] ?? "")
      );
      if (diff) return diff * sign;
    }
    // Stable tiebreak so paging cannot repeat or skip a row with equal keys.
    return String(b.id).localeCompare(String(a.id));
  };
}
