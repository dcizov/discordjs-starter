"use client";
import { useEffect, useState } from "react";
import type { DashboardData } from "@orbit/core";
import { communityDate } from "@orbit/core/community";
import { useWorkspace } from "./workspace";
import { Card } from "./ui/primitives";
import { DataTable } from "./data-table";
export function OwnHistory() {
  const { data, api } = useWorkspace();
  const [history, setHistory] = useState<
    NonNullable<DashboardData["walletHistory"]>
  >(data.walletHistory ?? { rows: [], total: 0, page: 1, pageSize: 5 });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (data.walletHistory && history.page === 1)
      setHistory(data.walletHistory);
  }, [data.walletHistory, history.page]);
  async function load(page: number) {
    setBusy(true);
    setError("");
    try {
      setHistory(await api(`/my-transactions?page=${page}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read history");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-5" data-testid="own-history">
      <h2 className="text-xs font-semibold">Your transaction history</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Only your ledger in this server. Server managers retain their separate
        server-ledger access. Reading history never claims a reward.
      </p>
      {data.demo && (
        <p className="mt-2 text-xs text-blue-600 dark:text-blue-300">
          Sample economy history — no real currency.
        </p>
      )}
      {/*
       * The API owns the slice (page/pageSize), so this table runs in server
       * mode: it reports page changes and never sorts or filters the five rows
       * it happens to hold. The page size the server returned is passed through
       * so the page count is the server's count, not a guessed default.
       */}
      <div className="mt-4 overflow-hidden rounded-lg border">
        <DataTable
          label="Your transactions"
          rows={history.rows}
          pageSize={history.pageSize}
          loading={busy}
          error={error}
          onRetry={() => void load(history.page)}
          footerNote={`Times shown in ${data.guild.config.timezone}`}
          pagination={{
            page: history.page,
            total: history.total,
            onPage: (page) => void load(page),
          }}
          columns={[
            {
              key: "type",
              label: "Activity",
              render: (row) => (
                <span className="block min-w-0">
                  <span className="block font-medium capitalize">
                    {row.type}
                  </span>
                  <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">
                    {row.note}
                  </span>
                  <time
                    dateTime={row.createdAt}
                    className="mt-0.5 block text-[10px] text-muted-foreground"
                  >
                    {communityDate(row.createdAt, data.guild.config.timezone)}
                  </time>
                </span>
              ),
            },
            {
              key: "change",
              label: "Change",
              align: "right",
              header: (
                <span className="block text-right">
                  Change ({data.guild.config.economy.symbol})
                </span>
              ),
              render: (row) => (
                <span
                  className={
                    row.amount > 0
                      ? "tabular-nums text-emerald-700 dark:text-emerald-400"
                      : "tabular-nums text-muted-foreground"
                  }
                >
                  {row.amount > 0 ? "+" : ""}
                  {row.amount}
                </span>
              ),
            },
          ]}
          emptyTitle="No transactions yet"
          emptyDescription="Earning, spending and transfers in this server will appear here."
        />
      </div>
    </Card>
  );
}
