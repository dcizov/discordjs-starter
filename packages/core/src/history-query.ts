import { z } from "zod";

/**
 * The query contract for `GET /api/guilds/:id/history`.
 *
 * One schema is used by the route handler (to parse) and by the dashboard (to
 * build the query string), so a renamed parameter cannot drift into a silently
 * ignored filter. This is the kind of duplication oRPC would remove wholesale;
 * see `docs/ORPC-DECISION.md` for why Orbit keeps a hand-written contract for
 * now and keeps the two sides in one place instead.
 */
export const HISTORY_KINDS = [
  "audit",
  "ledger",
  "deliveries",
  "cases",
] as const;
export type HistoryKindName = (typeof HISTORY_KINDS)[number];

export const historyQuerySchema = z
  .object({
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(50).default(7),
    query: z.string().max(100).default(""),
    filter: z.string().max(30).default("all"),
    // Validated per dataset by `parseHistorySort` in @orbit/db.
    sort: z.string().max(30).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
  })
  .strict();

export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** Build the request query string for a history table. */
export function historyQueryString(input: {
  kind: HistoryKindName;
  page: number;
  pageSize?: number;
  query?: string;
  filter?: string;
  sort?: string;
  dir?: "asc" | "desc";
}): string {
  const params = new URLSearchParams();
  params.set("kind", input.kind);
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize ?? 7));
  params.set("query", input.query ?? "");
  params.set("filter", input.filter ?? "all");
  if (input.sort) params.set("sort", input.sort);
  if (input.dir) params.set("dir", input.dir);
  return params.toString();
}

const HISTORY_QUERY_PARAMS = new Set([
  "kind",
  "page",
  "pageSize",
  "query",
  "filter",
  "sort",
  "dir",
]);

/** Parse the query string of a history request. Throws on unknown parameters. */
export function parseHistoryQuery(search: URLSearchParams): HistoryQuery {
  // An unrecognised parameter is an error, not something to drop: a misspelled
  // filter must not look like "the filter matched everything".
  for (const key of search.keys())
    if (!HISTORY_QUERY_PARAMS.has(key))
      throw new Error(`Unknown history parameter "${key}".`);
  return historyQuerySchema.parse({
    page: Number(search.get("page") ?? 1),
    pageSize: Number(search.get("pageSize") ?? 7),
    query: search.get("query") ?? "",
    filter: search.get("filter") ?? "all",
    ...(search.get("sort") ? { sort: search.get("sort")! } : {}),
    ...(search.get("dir") ? { dir: search.get("dir") as "asc" | "desc" } : {}),
  });
}
