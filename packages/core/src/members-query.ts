import { z } from "zod";

/**
 * The query contract for `GET /api/guilds/:id/members`.
 *
 * One schema is used by the route (to parse) and by the dashboard (to build the
 * query string), so a renamed parameter cannot drift into a silently ignored
 * filter — the same pattern as `history-query.ts`.
 */
export const MEMBER_SORTS = ["displayName", "joinedAt", "username"] as const;
export type MemberSortField = (typeof MEMBER_SORTS)[number];

export const memberFilters = ["all", "humans", "bots", "departed"] as const;
export type MemberFilter = (typeof memberFilters)[number];

export const membersQuerySchema = z
  .object({
    page: z.number().int().min(1).max(100000).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
    query: z.string().max(100).default(""),
    filter: z.enum(memberFilters).default("all"),
    sort: z.enum(MEMBER_SORTS).default("displayName"),
    dir: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();

export type MembersQuery = z.infer<typeof membersQuerySchema>;

/** Parse the URL parameters the dashboard sends. Unknown values are rejected. */
export function parseMembersQuery(params: URLSearchParams): MembersQuery {
  const number = (key: string, fallback: number) => {
    const raw = params.get(key);
    if (raw === null || raw === "") return fallback;
    return Number(raw);
  };
  return membersQuerySchema.parse({
    page: number("page", 1),
    pageSize: number("pageSize", 25),
    query: params.get("query") ?? "",
    filter: params.get("filter") ?? "all",
    sort: params.get("sort") ?? "displayName",
    dir: params.get("dir") ?? "asc",
  });
}

export function membersQueryString(input: Partial<MembersQuery>): string {
  const parsed = membersQuerySchema.parse({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 25,
    query: input.query ?? "",
    filter: input.filter ?? "all",
    sort: input.sort ?? "displayName",
    dir: input.dir ?? "asc",
  });
  const params = new URLSearchParams({
    page: String(parsed.page),
    pageSize: String(parsed.pageSize),
    query: parsed.query,
    filter: parsed.filter,
    sort: parsed.sort,
    dir: parsed.dir,
  });
  return params.toString();
}
