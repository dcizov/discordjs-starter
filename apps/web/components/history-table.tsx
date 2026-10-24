"use client";
import { useEffect, useState } from "react";
import { useWorkspace } from "./workspace";
import { DataTable, type Column } from "./data-table";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/primitives";
import { AlertCircle, RefreshCw } from "lucide-react";
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
        `/history?${new URLSearchParams({ kind, page: String(page), pageSize: "7", query, filter })}`
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
  }, [api, kind, page, query, filter, token, retry]);
  if (error)
    return (
      <div
        role="alert"
        className="flex flex-col items-center gap-3 p-10 text-center"
      >
        <AlertCircle size={22} className="text-amber-500" />
        <p className="text-xs text-muted-foreground">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRetry((v) => v + 1)}
        >
          <RefreshCw size={12} />
          Try again
        </Button>
      </div>
    );
  if (!result)
    return (
      <div className="space-y-4 p-5" aria-label="Loading records">
        {[1, 2, 3, 4, 5].map((n) => (
          <Skeleton key={n} className="h-10 w-full" />
        ))}
      </div>
    );
  return (
    <div
      aria-busy={loading}
      className={
        loading ? "opacity-60 transition-opacity" : "transition-opacity"
      }
    >
      <DataTable
        rows={result.rows}
        columns={columns}
        pagination={{ page, total: result.total, onPage: setPage }}
        emptyTitle={emptyTitle}
        emptyDescription={emptyDescription}
      />
    </div>
  );
}
