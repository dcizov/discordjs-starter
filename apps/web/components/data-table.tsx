"use client";
import { Check, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { EmptyState } from "./ui/primitives";

/**
 * Column of the shared dashboard table.
 *
 * `sortKey` is the *server* field name. A column without one stays unsortable,
 * so the UI can never request an order the API refuses.
 */
export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  className?: string;
  sortKey?: string;
  /** Listed in the columns menu but not shown until the reader enables it. */
  defaultHidden?: boolean;
};

export type TableSort = {
  field: string;
  dir: "asc" | "desc";
  onChange: (field: string) => void;
};

/**
 * The shared table foundation: server-paginated rows, optional server-side
 * sorting, column visibility, and honest loading/empty states.
 *
 * Deliberately *not* a data-grid: rows are fetched a page at a time from the
 * API, selection and bulk actions are absent because none of Orbit's datasets
 * has a safe multi-row action, and no column is sorted in the browser (sorting
 * one page of results would misrepresent the rest of the table).
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  emptyTitle = "Nothing here just yet",
  emptyDescription = "New activity will appear here as your community gets going.",
  pageSize = 7,
  pagination,
  sort,
  loading = false,
}: {
  rows: T[];
  columns: Column<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  pagination?: { page: number; total: number; onPage: (page: number) => void };
  sort?: TableSort;
  loading?: boolean;
}) {
  const [page, setPage] = useState(1);
  const [hidden, setHidden] = useState<string[]>(() =>
    columns.filter((c) => c.defaultHidden).map((c) => c.key)
  );
  const totalItems = pagination?.total ?? rows.length;
  const total = Math.max(1, Math.ceil(totalItems / pageSize));
  const controlled = !!pagination;
  const visible = columns.filter((c) => !hidden.includes(c.key));

  useEffect(() => {
    if (!controlled) setPage(1);
  }, [rows.length, controlled]);
  // A stale filter must not strand the reader on a page that no longer exists.
  useEffect(() => {
    if (pagination && pagination.page > total) pagination.onPage(total);
  }, [pagination, total]);

  const p = Math.min(pagination?.page ?? page, total);
  const go = (n: number) => (pagination ? pagination.onPage(n) : setPage(n));

  const toolbar = (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
      <p className="text-[10px] text-muted-foreground">
        {totalItems === 0
          ? "No rows match the current filters"
          : `${totalItems} row${totalItems === 1 ? "" : "s"}${
              sort
                ? ` · sorted by ${columns.find((c) => c.sortKey === sort.field)?.label ?? sort.field} (${sort.dir === "asc" ? "ascending" : "descending"})`
                : ""
            }`}
      </p>
      {columns.length > 2 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-[10px]">
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-[10px]">
              Show columns
            </DropdownMenuLabel>
            {columns.map((column) => {
              const isHidden = hidden.includes(column.key);
              return (
                <DropdownMenuItem
                  key={column.key}
                  // The last visible column stays visible: an empty header row
                  // is indistinguishable from a loading failure.
                  disabled={!isHidden && visible.length === 1}
                  onSelect={(event) => {
                    event.preventDefault();
                    setHidden((current) =>
                      current.includes(column.key)
                        ? current.filter((key) => key !== column.key)
                        : [...current, column.key]
                    );
                  }}
                >
                  <Check
                    aria-hidden
                    className={isHidden ? "size-3 opacity-0" : "size-3"}
                  />
                  {column.label}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );

  if (!rows.length)
    return (
      <>
        {toolbar}
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </>
    );

  return (
    <>
      {toolbar}
      <div
        aria-busy={loading}
        className={
          loading ? "opacity-60 transition-opacity" : "transition-opacity"
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b bg-muted/25">
                {visible.map((c) => {
                  const active = sort && c.sortKey && sort.field === c.sortKey;
                  return (
                    <th
                      key={c.key}
                      aria-sort={
                        active
                          ? sort!.dir === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={`whitespace-nowrap px-5 py-3 text-[10px] font-medium text-muted-foreground ${c.className ?? ""}`}
                    >
                      {sort && c.sortKey ? (
                        <button
                          type="button"
                          onClick={() => sort.onChange(c.sortKey!)}
                          className="inline-flex items-center gap-1 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                        >
                          {c.label}
                          <ChevronsUpDown
                            aria-hidden
                            className={
                              active
                                ? "size-3 text-foreground"
                                : "size-3 opacity-50"
                            }
                          />
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {(pagination
                ? rows
                : rows.slice((p - 1) * pageSize, p * pageSize)
              ).map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border/70 transition last:border-0 hover:bg-muted/25"
                >
                  {visible.map((c) => (
                    <td
                      key={c.key}
                      className={`px-5 py-4 text-[11px] ${c.className ?? ""}`}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t px-5 py-3">
          <p className="text-[10px] text-muted-foreground">
            Showing{" "}
            <span className="font-medium text-foreground">
              {(p - 1) * pageSize + 1}–{Math.min(p * pageSize, totalItems)}
            </span>{" "}
            of {totalItems} matching rows
          </p>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={p === 1}
              onClick={() => go(p - 1)}
              aria-label="Previous page"
            >
              <ChevronLeft size={13} />
            </Button>
            <span className="px-2 text-[10px] text-muted-foreground">
              {p} of {total}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              disabled={p >= total}
              onClick={() => go(p + 1)}
              aria-label="Next page"
            >
              <ChevronRight size={13} />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
