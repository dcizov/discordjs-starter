"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/primitives";
export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  className?: string;
};
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  emptyTitle = "Nothing here just yet",
  emptyDescription = "New activity will appear here as your community gets going.",
  pageSize = 7,
  pagination,
}: {
  rows: T[];
  columns: Column<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  pagination?: { page: number; total: number; onPage: (page: number) => void };
}) {
  const [page, setPage] = useState(1);
  const totalItems = pagination?.total ?? rows.length;
  const total = Math.max(1, Math.ceil(totalItems / pageSize));
  const controlled = !!pagination;
  useEffect(() => {
    if (!controlled) setPage(1);
  }, [rows.length, controlled]);
  const p = Math.min(pagination?.page ?? page, total);
  const go = (n: number) => (pagination ? pagination.onPage(n) : setPage(n));
  if (!rows.length)
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b bg-muted/25">
              {columns.map((c) => (
                <th
                  className={`whitespace-nowrap px-5 py-3 text-[10px] font-medium text-muted-foreground ${c.className ?? ""}`}
                  key={c.key}
                >
                  {c.label}
                </th>
              ))}
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
                {columns.map((c) => (
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
          of {totalItems}
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
    </>
  );
}
