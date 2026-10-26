"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace";
import { historyQueryString } from "@orbit/core/history-query";
import { DataTable, type Column } from "./data-table";
import type { FacetFilter } from "./table-facet";
import { Skeleton } from "./ui/primitives";
export function HistoryTable<T extends { id: string }>({
  kind,
  query = "",
  filter = "all",
  columns,
  emptyTitle,
  emptyDescription,
  searchLabel,
  searchPlaceholder,
  onQueryChange,
  facetLabel,
  facetTitle,
  facetOptions,
  onFilterChange,
  footerNote,
}: {
  kind: "audit" | "ledger" | "deliveries" | "cases";
  query?: string;
  filter?: string;
  columns: Column<T>[];
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * Search and facet chrome belong to the table. A caller that also filters
   * other views with the same term passes the handlers and keeps ownership of
   * the state; a caller that does not gets no search box at all.
   */
  searchLabel?: string;
  searchPlaceholder?: string;
  onQueryChange?: (value: string) => void;
  facetLabel?: string;
  facetTitle?: string;
  facetOptions?: { value: string; label: string }[];
  onFilterChange?: (value: string) => void;
  footerNote?: React.ReactNode;
}) {
  const { api, data } = useWorkspace();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(7);
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
  useEffect(() => setPage(1), [pageSize]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      api(
        `/history?${historyQueryString({
          kind,
          page,
          pageSize,
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
  }, [api, kind, page, pageSize, query, filter, sort, token, retry]);
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
      pageSize={pageSize}
      pagination={{
        page,
        total: result.total,
        onPage: setPage,
        onPageSize: setPageSize,
      }}
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
      label={
        kind === "audit"
          ? "Audit events"
          : kind === "ledger"
            ? "Transaction history"
            : kind === "deliveries"
              ? "Delivery history"
              : "Moderation cases"
      }
      search={
        onQueryChange && searchLabel
          ? {
              value: query,
              onChange: onQueryChange,
              placeholder: searchPlaceholder ?? "Search…",
              label: searchLabel,
            }
          : undefined
      }
      filters={
        onFilterChange && facetOptions?.length
          ? ([
              {
                key: `${kind}-facet`,
                label: facetLabel ?? facetTitle ?? "Filter",
                title: facetTitle ?? "Filter",
                value: filter,
                allValue: "all",
                onChange: onFilterChange,
                options: facetOptions,
                searchable: facetOptions.length > 6,
              },
            ] satisfies FacetFilter[])
          : undefined
      }
      footerNote={footerNote}
      // A filter that matches nothing is not an empty history. The copy names
      // the search rather than claiming the community has no records yet.
      emptyTitle={query || filter !== "all" ? "No records match" : emptyTitle}
      emptyDescription={
        query || filter !== "all"
          ? "Try a shorter search term or a different filter. The search and filters above stay available."
          : emptyDescription
      }
      error={error}
      onRetry={retryRequest}
    />
  );
}
