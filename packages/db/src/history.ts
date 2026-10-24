import { and, desc, eq, getTableColumns, ilike, or, sql } from "drizzle-orm";
import { isDemo } from "@orbit/core";
import { database } from "./client";
import { demoRead } from "./demo";
import { serialize } from "./store";
import * as s from "./schema";
export type HistoryKind = "audit" | "ledger" | "deliveries" | "cases";
export type HistoryResult = {
  rows: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
};
export async function queryHistory(
  guildId: string,
  kind: HistoryKind,
  options: { page: number; pageSize: number; query: string; filter: string }
): Promise<HistoryResult> {
  const { page, pageSize, query, filter } = options;
  const offset = (page - 1) * pageSize;
  if (isDemo()) {
    const d = await demoRead();
    const source =
      kind === "audit"
        ? d.audit
        : kind === "ledger"
          ? d.ledger
          : kind === "deliveries"
            ? d.deliveries
            : d.resources.filter((r) => r.kind === "case");
    const rows = source
      .filter((r: any) => r.guildId === guildId)
      .filter((r: any) => {
        const name =
          kind === "ledger"
            ? (d.accounts.find(
                (a) => a.guildId === guildId && a.userId === r.userId
              )?.name ?? "")
            : "";
        return (
          (JSON.stringify(r) + name)
            .toLowerCase()
            .includes(query.toLowerCase()) &&
          (filter === "all" ||
            (kind === "audit"
              ? r.action === filter
              : kind === "ledger"
                ? r.type === filter
                : kind === "deliveries"
                  ? r.status ===
                    (filter === "enabled"
                      ? "delivered"
                      : filter === "paused"
                        ? "failed"
                        : filter)
                  : filter === "enabled"
                    ? r.enabled
                    : filter === "paused"
                      ? !r.enabled
                      : r.data.type === filter))
        );
      })
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() ||
          b.id.localeCompare(a.id)
      );
    return {
      rows: rows.slice(offset, offset + pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }
  const db = database().db,
    term = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  if (kind === "audit") {
    const condition = and(
      eq(s.auditLogs.guildId, guildId),
      query
        ? or(
            ilike(s.auditLogs.actorName, term),
            ilike(s.auditLogs.target, term),
            ilike(s.auditLogs.detail, term)
          )
        : undefined,
      filter === "all" ? undefined : eq(s.auditLogs.action, filter)
    );
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(s.auditLogs)
        .where(condition)
        .orderBy(desc(s.auditLogs.createdAt), desc(s.auditLogs.id))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.auditLogs)
        .where(condition),
    ]);
    return serialize({ rows, total: total[0].n, page, pageSize });
  }
  if (kind === "ledger") {
    const join = and(
      eq(s.accounts.guildId, s.ledger.guildId),
      eq(s.accounts.userId, s.ledger.userId)
    );
    const condition = and(
      eq(s.ledger.guildId, guildId),
      query
        ? or(
            ilike(s.ledger.note, term),
            ilike(s.ledger.type, term),
            ilike(s.accounts.name, term),
            ilike(s.ledger.userId, term)
          )
        : undefined,
      filter === "all" ? undefined : eq(s.ledger.type, filter)
    );
    const [rows, total] = await Promise.all([
      db
        .select(getTableColumns(s.ledger))
        .from(s.ledger)
        .leftJoin(s.accounts, join)
        .where(condition)
        .orderBy(desc(s.ledger.createdAt), desc(s.ledger.id))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.ledger)
        .leftJoin(s.accounts, join)
        .where(condition),
    ]);
    return serialize({ rows, total: total[0].n, page, pageSize });
  }
  if (kind === "deliveries") {
    const condition = and(
      eq(s.deliveries.guildId, guildId),
      query
        ? or(ilike(s.deliveries.title, term), ilike(s.deliveries.error, term))
        : undefined,
      filter === "all"
        ? undefined
        : eq(
            s.deliveries.status,
            filter === "enabled"
              ? "delivered"
              : filter === "paused"
                ? "failed"
                : filter
          )
    );
    const [rows, total] = await Promise.all([
      db
        .select()
        .from(s.deliveries)
        .where(condition)
        .orderBy(desc(s.deliveries.createdAt), desc(s.deliveries.id))
        .limit(pageSize)
        .offset(offset),
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(s.deliveries)
        .where(condition),
    ]);
    return serialize({ rows, total: total[0].n, page, pageSize });
  }
  const condition = and(
    eq(s.resources.guildId, guildId),
    eq(s.resources.kind, "case"),
    query
      ? or(
          ilike(s.resources.name, term),
          sql`${s.resources.data}::text ilike ${term}`
        )
      : undefined,
    filter === "all"
      ? undefined
      : filter === "enabled"
        ? eq(s.resources.enabled, true)
        : filter === "paused"
          ? eq(s.resources.enabled, false)
          : sql`${s.resources.data}->>'type' = ${filter}`
  );
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(s.resources)
      .where(condition)
      .orderBy(desc(s.resources.createdAt), desc(s.resources.id))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.resources)
      .where(condition),
  ]);
  return serialize({ rows, total: total[0].n, page, pageSize });
}
