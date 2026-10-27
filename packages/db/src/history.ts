import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { isDemo } from "@orbit/core/environment";
import { database } from "./client";
import { demoRead } from "./demo";
import {
  compareHistoryRows,
  parseHistorySort,
  type HistorySort,
  type HistorySortField,
} from "./history-sort";
import { serialize } from "./store";
import * as s from "./schema";
export type HistoryKind = "audit" | "ledger" | "deliveries" | "cases";
export type HistoryResult = {
  rows: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
};
/** Drizzle column for a validated sort field, per history kind. */
function sortColumn(kind: HistoryKind, field: HistorySortField) {
  const columns: Record<HistoryKind, Partial<Record<HistorySortField, any>>> = {
    audit: {
      createdAt: s.auditLogs.createdAt,
      actorName: s.auditLogs.actorName,
      action: s.auditLogs.action,
    },
    ledger: {
      createdAt: s.ledger.createdAt,
      amount: s.ledger.amount,
      type: s.ledger.type,
    },
    deliveries: {
      createdAt: s.deliveries.createdAt,
      status: s.deliveries.status,
    },
    cases: { createdAt: s.resources.createdAt, name: s.resources.name },
  };
  return columns[kind][field]!;
}

function idColumn(kind: HistoryKind) {
  return kind === "audit"
    ? s.auditLogs.id
    : kind === "ledger"
      ? s.ledger.id
      : kind === "deliveries"
        ? s.deliveries.id
        : s.resources.id;
}

function orderBy(kind: HistoryKind, order: HistorySort) {
  const column = sortColumn(kind, order.field);
  const primary = order.dir === "asc" ? asc(column) : desc(column);
  // Equal timestamps must not reorder between pages.
  return [primary, desc(idColumn(kind))];
}

export async function queryHistory(
  guildId: string,
  kind: HistoryKind,
  options: {
    page: number;
    pageSize: number;
    query: string;
    filter: string;
    userId?: string;
    /** Server-side ordering; validated against the kind's allow-list below. */
    sort?: HistorySortField;
    dir?: "asc" | "desc";
  }
): Promise<HistoryResult> {
  const { page, pageSize, query, filter, userId, sort, dir } = z
    .object({
      page: z.number().int().min(1).max(100000),
      pageSize: z.number().int().min(1).max(100),
      query: z.string().max(200),
      filter: z.string().max(60),
      userId: z
        .string()
        .regex(/^\d{17,20}$/)
        .optional(),
      sort: z.string().max(30).optional(),
      dir: z.enum(["asc", "desc"]).optional(),
    })
    .parse(options);
  const order = parseHistorySort(kind, { sort, dir });
  if (userId && kind !== "ledger")
    throw new Error("Owner scoping applies to ledger history only.");
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
      .filter(
        (r: any) => r.guildId === guildId && (!userId || r.userId === userId)
      )
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
      .sort(compareHistoryRows(order));
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
        .orderBy(...orderBy("audit", order))
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
      userId ? eq(s.ledger.userId, userId) : undefined,
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
        .orderBy(...orderBy("ledger", order))
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
        .orderBy(...orderBy("deliveries", order))
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
      .orderBy(...orderBy("cases", order))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.resources)
      .where(condition),
  ]);
  return serialize({ rows, total: total[0].n, page, pageSize });
}

/** Caller MUST supply the authenticated/interaction user, never a user-selected account ID. */
export async function getOwnEconomyHistory(
  guildId: string,
  userId: string,
  input: { page?: number; pageSize?: number } = {}
) {
  const q = z
    .object({
      page: z.number().int().min(1).max(10000).default(1),
      pageSize: z.number().int().min(1).max(20).default(5),
    })
    .strict()
    .parse(input);
  const result = await queryHistory(guildId, "ledger", {
    ...q,
    query: "",
    filter: "all",
    userId,
  });
  return {
    ...result,
    rows: result.rows as import("@orbit/core").LedgerEntry[],
  };
}
