"use client";
import { useEffect, useState } from "react";
import type { DashboardData } from "@orbit/core";
import { communityDate } from "@orbit/core/community";
import { useWorkspace } from "./workspace";
import { Card } from "./ui/primitives";
import { Button } from "./ui/button";
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
      <table className="mt-4 w-full text-left text-xs">
        <caption className="sr-only">
          Your transactions, shown in {data.guild.config.timezone}
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pb-2">
              Activity
            </th>
            <th scope="col" className="pb-2 text-right">
              Change
            </th>
          </tr>
        </thead>
        <tbody>
          {history.rows.map((row) => (
            <tr key={row.id} className="border-t border-border">
              <th scope="row" className="py-3 pr-2 font-normal">
                <span className="font-medium">{row.type}</span>
                <span className="mt-1 block break-words text-[11px] text-muted-foreground">
                  {row.note}
                </span>
                <time
                  dateTime={row.createdAt}
                  className="mt-1 block text-[10px] text-muted-foreground"
                >
                  {communityDate(row.createdAt, data.guild.config.timezone)}
                </time>
              </th>
              <td className="whitespace-nowrap text-right align-top pt-3 tabular-nums">
                {row.amount > 0 ? "+" : ""}
                {row.amount} {data.guild.config.economy.symbol}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!history.rows.length && (
        <p className="py-4 text-xs text-muted-foreground">
          No transactions on this page.
        </p>
      )}
      {error && (
        <p role="alert" className="my-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px]" role="status">
          Page {history.page}/
          {Math.max(1, Math.ceil(history.total / history.pageSize))}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || history.page === 1}
            onClick={() => void load(history.page - 1)}
          >
            Earlier page
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || history.page * history.pageSize >= history.total}
            onClick={() => void load(history.page + 1)}
          >
            Older entries
          </Button>
        </div>
      </div>
    </Card>
  );
}
