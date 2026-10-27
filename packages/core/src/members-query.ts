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
    /**
     * Show only members holding this role.
     *
     * Empty means "no role filter". It is a separate parameter rather than an
     * extension of `filter` because a role narrows the set *in addition to*
     * humans/bots/departed, and because it arrives from a link that names a
     * role and should not have to know what the other controls are set to.
     */
    roleId: z
      .string()
      .regex(/^(\d{17,20})?$/)
      .default(""),
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
    roleId: params.get("roleId") ?? "",
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
    roleId: input.roleId ?? "",
  });
  const params = new URLSearchParams({
    page: String(parsed.page),
    pageSize: String(parsed.pageSize),
    query: parsed.query,
    filter: parsed.filter,
    sort: parsed.sort,
    dir: parsed.dir,
  });
  // Only when it narrows: an empty role filter is the default and would just
  // make every URL longer.
  if (parsed.roleId) params.set("roleId", parsed.roleId);
  return params.toString();
}
