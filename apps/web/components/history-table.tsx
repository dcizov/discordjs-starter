"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace";
import { historyQueryString } from "@orbit/core/history-query";
import { DataTable, type Column } from "./data-table";
import { Skeleton } from "./ui/primitives";
export function HistoryTable<T extends { id: string }>({
  kind,
  query = "",
  filter = "all",
  columns,
  emptyTitle,
  emptyDescription,
}: {
  kind: "audit" | "ledger" | "deliveries" | "cases";
  query?: string;
  filter?: string;
  columns: Column<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const { api, data } = useWorkspace();
  const [page, setPage] = useState(1);
  // Sorting is a server contract: changing it restarts at page 1 so the reader
  // never sees page 4 of a different ordering.
  const [sort, setSort] = useState<{ field: string; dir: "asc" | "desc" }>({
    field: "createdAt",
    dir: "desc",
  });
  const [result, setResult] = useState<{ rows: T[]; total: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const token =
    kind === "audit"
      ? data.audit[0]?.id
      : kind === "ledger"
        ? data.ledger[0]?.id
        : kind === "deliveries"
          ? data.deliveries[0]?.id
          : data.resources.find((r) => r.kind === "case")?.id;
  useEffect(() => setPage(1), [query, filter, kind]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api(
        `/history?${historyQueryString({
          kind,
          page,
          query,
          filter,
          sort: sort.field,
          dir: sort.dir,
        })}`
      )
        .then((r) => {
          if (active) {
            setResult(r);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, kind, page, query, filter, sort, token, retry]);
  const retryRequest = () => setRetry((v) => v + 1);
  if (!result)
    return (
      <div className="space-y-4 p-5" aria-label="Loading records">
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
    );
  return (
    <DataTable
      rows={result.rows}
      columns={columns}
      loading={loading}
      pagination={{ page, total: result.total, onPage: setPage }}
      sort={{
        field: sort.field,
        dir: sort.dir,
        // Reset the page with the ordering change, in one render, so a listener
        // on page 4 does not fetch "page 4 of the new sort" first.
        onChange: (field) => {
          setPage(1);
          setSort((current) =>
            current.field === field
              ? { field, dir: current.dir === "asc" ? "desc" : "asc" }
              : { field, dir: "desc" }
          );
        },
      }}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      error={error}
      onRetry={retryRequest}
    />
  );
}
