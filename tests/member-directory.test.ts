import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEMO_GUILD_ID, DEMO_USER_ID, defaultConfig } from "@orbit/core";
import {
  memberFilters,
  membersQuerySchema,
  membersQueryString,
  parseMembersQuery,
} from "@orbit/core/members-query";
import {
  getGuild,
  getMemberIdentities,
  getRosterSync,
  listMembers,
  markAbsentDeparted,
  saveRosterSync,
  upsertMembers,
} from "@orbit/db";
import { buildTemplate } from "@orbit/core/templates";
import {
  deleteTemplate,
  getTemplate,
  listTemplates,
  saveTemplate,
} from "@orbit/db";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "orbit-members-test-"));
  vi.stubEnv("DEMO_MODE", "true");
  vi.stubEnv("DEMO_DATA_PATH", join(dir, "state.json"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
});

const otherGuild = "120000000000000002";

describe("member query contract", () => {
  it("round-trips through one schema for the route and the UI", () => {
    const query = parseMembersQuery(
      new URLSearchParams({
        page: "3",
        pageSize: "50",
        query: "alex",
        filter: "bots",
        sort: "joinedAt",
        dir: "desc",
      })
    );
    expect(query).toEqual({
      page: 3,
      pageSize: 50,
      query: "alex",
      filter: "bots",
      sort: "joinedAt",
      dir: "desc",
      // Gained when the directory learned to narrow by role; it defaults to
      // "nothing narrowed", which is what a URL without it means.
      roleId: "",
    });
    expect(parseMembersQuery(new URLSearchParams())).toMatchObject({
      page: 1,
      pageSize: 25,
      filter: "all",
      sort: "displayName",
      dir: "asc",
    });
    expect(membersQueryString(query)).toContain("filter=bots");
  });

  it("rejects values the database cannot honour instead of silently ignoring them", () => {
    expect(() =>
      parseMembersQuery(new URLSearchParams({ filter: "ejected" }))
    ).toThrow();
    expect(() =>
      parseMembersQuery(new URLSearchParams({ pageSize: "500" }))
    ).toThrow();
    expect(() =>
      parseMembersQuery(new URLSearchParams({ page: "0" }))
    ).toThrow();
    expect(memberFilters).toEqual(["all", "humans", "bots", "departed"]);
    expect(() =>
      membersQuerySchema.parse({ page: 1, pageSize: 25, extra: true })
    ).toThrow();
  });
});

describe("member query contract: the role filter", () => {
  it("round-trips a role id through the URL and back", () => {
    const parsed = parseMembersQuery(
      new URLSearchParams(membersQueryString({ roleId: "120000000000000201" }))
    );
    expect(parsed.roleId).toBe("120000000000000201");
  });

  it("leaves the role out of the URL when nothing is narrowed", () => {
    // An empty filter is the default; putting it in every URL would just make
    // them longer and imply a narrowing that is not happening.
    const qs = membersQueryString({ page: 1, roleId: "" });
    expect(qs).not.toContain("roleId");
    expect(parseMembersQuery(new URLSearchParams(qs)).roleId).toBe("");
  });

  it("combines with the other filters rather than replacing them", () => {
    const parsed = parseMembersQuery(
      new URLSearchParams(
        membersQueryString({
          filter: "bots",
          sort: "joinedAt",
          dir: "desc",
          roleId: "120000000000000201",
        })
      )
    );
    expect(parsed).toMatchObject({
      filter: "bots",
      sort: "joinedAt",
      dir: "desc",
      roleId: "120000000000000201",
    });
  });

  it("rejects a role id that is not a snowflake", () => {
    // 17 to 20 digits is Discord's range, so a 19-digit id is valid and must
    // be accepted; only genuinely malformed ids are refused.
    for (const bad of [
      "abc",
      "123",
      "1200000000000002",
      "120000000000000201011",
      "12000000000000020a",
      "-120000000000000201",
    ]) {
      expect(() => membersQuerySchema.parse({ roleId: bad }), bad).toThrow();
    }
    expect(
      membersQuerySchema.parse({ roleId: "120000000000000201" }).roleId
    ).toBe("120000000000000201");
  });
});

describe("member directory", () => {
  it("pages and searches the synchronized roster", async () => {
    const first = await listMembers(DEMO_GUILD_ID, { page: 1, pageSize: 5 });
    expect(first.rows).toHaveLength(5);
    expect(first.total).toBeGreaterThan(5);
    const second = await listMembers(DEMO_GUILD_ID, {
      page: 2,
      pageSize: 5,
    });
    expect(second.rows.map((m) => m.userId)).not.toEqual(
      first.rows.map((m) => m.userId)
    );
    const searched = await listMembers(DEMO_GUILD_ID, { query: "sophie" });
    expect(searched.rows).toHaveLength(1);
    expect(searched.rows[0].displayName).toBe("Sophie");
    // The handle and the nickname are searchable too, not just the label.
    expect(
      (await listMembers(DEMO_GUILD_ID, { query: "sophie.l" })).total
    ).toBe(1);
  });

  it("narrows to the members holding one role", async () => {
    // The role → members direction of the connected views: the roles view links
    // here with ?roleId=… and the directory must land already narrowed.
    const guild = (await getGuild(DEMO_GUILD_ID))!;
    const [first, second] = guild.roles;

    const withFirst = await listMembers(DEMO_GUILD_ID, { roleId: first.id });
    const withSecond = await listMembers(DEMO_GUILD_ID, { roleId: second.id });

    expect(withFirst.total).toBeGreaterThan(0);
    expect(withSecond.total).toBeGreaterThan(0);
    // Every returned row really holds the role; this is the assertion that
    // would catch a filter that narrows on the wrong field.
    expect(withFirst.rows.every((m) => m.roles.includes(first.id))).toBe(true);
    expect(withSecond.rows.every((m) => m.roles.includes(second.id))).toBe(
      true
    );
    // Two different roles, two different sets — otherwise the filter is a no-op.
    expect(withFirst.rows.map((m) => m.userId)).not.toEqual(
      withSecond.rows.map((m) => m.userId)
    );
  });

  it("keeps the role filter inside its own guild", async () => {
    // Guild isolation: a role id from one server must not select members here.
    const other = (await getGuild(otherGuild))!;
    const foreignRole = other.roles[0]?.id;
    const all = await listMembers(DEMO_GUILD_ID, {});
    const narrowed = await listMembers(DEMO_GUILD_ID, {
      roleId: foreignRole,
    });
    expect(narrowed.total).toBeLessThan(all.total);
  });

  it("returns everyone when no role is named", async () => {
    const all = await listMembers(DEMO_GUILD_ID, {});
    const emptyRole = await listMembers(DEMO_GUILD_ID, { roleId: "" });
    expect(emptyRole.total).toBe(all.total);
  });

  it("keeps bots, people and departed members apart", async () => {
    const all = await listMembers(DEMO_GUILD_ID, { pageSize: 100 });
    const bots = await listMembers(DEMO_GUILD_ID, {
      pageSize: 100,
      filter: "bots",
    });
    const humans = await listMembers(DEMO_GUILD_ID, {
      pageSize: 100,
      filter: "humans",
    });
    const departed = await listMembers(DEMO_GUILD_ID, {
      pageSize: 100,
      filter: "departed",
    });
    expect(bots.rows.every((m) => m.bot)).toBe(true);
    expect(humans.rows.every((m) => !m.bot && m.present)).toBe(true);
    expect(departed.rows.every((m) => !m.present)).toBe(true);
    expect(bots.rows.length + humans.rows.length).toBeLessThan(
      all.rows.length + 1
    );
  });

  it("reports Discord's count and the stored row count separately, and never calls an account count a roster", async () => {
    const page = await listMembers(DEMO_GUILD_ID, {});
    /*
     * Corrected 15 -> 16 on both counts, and the two now agree.
     *
     * "Over Load" was added deliberately, to hold more roles than the member
     * list can display. It is a present roster row, so the stored count moved;
     * Discord's tally did not, because the demo's `memberCount` was a literal
     * that had drifted from the roster it describes. It is derived from the
     * present rows now, so the two cannot disagree again.
     *
     * That does not make this assertion redundant. What it pins is that the
     * page exposes two separately named numbers rather than one ambiguous
     * "members" figure, and that the roster count is never the economy's
     * account count. The case where Discord's tally genuinely differs from the
     * rows we hold belongs to the database path, not the demo.
     */
    expect(page.counts.guildMemberCount).toBe(16);
    expect(page.counts.syncedMembers).toBe(16);
    expect(page.counts.economyAccounts).toBeLessThanOrEqual(
      page.counts.syncedMembers
    );
    expect(page.sync.status).toBe("complete");
    expect(page.counts.departed).toBeGreaterThan(0);
    expect(page.counts.bots).toBeGreaterThan(0);
    // The counts object names each number; none of them is "members" alone.
    expect(Object.keys(page.counts).sort()).toEqual([
      "bots",
      "departed",
      "economyAccounts",
      "guildMemberCount",
      "syncedMembers",
    ]);
  });

  it("does not turn an interrupted sweep into departures", async () => {
    const roster = await listMembers(DEMO_GUILD_ID, { pageSize: 100 });
    const before = roster.rows.filter((m) => m.present).length;
    await saveRosterSync(DEMO_GUILD_ID, {
      status: "running",
      startedAt: new Date(),
    });
    const during = await getRosterSync(DEMO_GUILD_ID);
    expect(during.status).toBe("running");
    const after = await listMembers(DEMO_GUILD_ID, { pageSize: 100 });
    expect(after.rows.filter((m) => m.present).length).toBe(before);
    // Restore the demo's own state for later assertions.
    await saveRosterSync(DEMO_GUILD_ID, {
      status: "complete",
      completedAt: new Date(),
    });
  });

  it("marks departures only when a completed sweep says so", async () => {
    const roster = await listMembers(DEMO_GUILD_ID, { pageSize: 100 });
    const target = roster.rows.find((m) => m.present)!;
    await markAbsentDeparted(
      DEMO_GUILD_ID,
      roster.rows.filter((m) => m.userId !== target.userId).map((m) => m.userId)
    );
    const after = await listMembers(DEMO_GUILD_ID, {
      query: target.displayName,
    });
    expect(after.rows[0].present).toBe(false);
    // A later sighting clears the departure again.
    await upsertMembers(DEMO_GUILD_ID, [
      {
        userId: target.userId,
        username: target.username,
        globalName: target.globalName,
        nickname: target.nickname,
        avatar: target.avatar,
        guildAvatar: target.guildAvatar,
        bot: target.bot,
        joinedAt: target.joinedAt,
        roles: target.roles,
      },
    ]);
    const back = await listMembers(DEMO_GUILD_ID, {
      query: target.displayName,
    });
    expect(back.rows[0].present).toBe(true);
    expect(back.rows[0].departedAt).toBeNull();
    // Put every row back so later assertions see the seeded roster again.
    await upsertMembers(
      DEMO_GUILD_ID,
      roster.rows.map((m) => ({
        userId: m.userId,
        username: m.username,
        globalName: m.globalName,
        nickname: m.nickname,
        avatar: m.avatar,
        guildAvatar: m.guildAvatar,
        bot: m.bot,
        joinedAt: m.joinedAt,
        roles: m.roles,
        present: m.present,
      }))
    );
  });

  it("gives current surfaces the roster identity without a per-member lookup", async () => {
    const roster = await listMembers(DEMO_GUILD_ID, { pageSize: 100 });
    const identities = await getMemberIdentities(
      DEMO_GUILD_ID,
      roster.rows.map((m) => m.userId)
    );
    expect(identities).toHaveLength(roster.rows.length);
    const sophie = identities.find((i) => i.username === "sophie.l");
    expect(sophie?.guildAvatar).toContain("/demo/");
    // Departed members keep their last known identity; presence is not claimed.
    const gone = identities.find((i) => i.username === "casey.former");
    expect(gone).toBeDefined();
    expect(gone?.present).toBe(false);
    expect(await getMemberIdentities(DEMO_GUILD_ID, [])).toEqual([]);
  });

  it("scopes identity to the guild it was read from", async () => {
    const roster = await listMembers(DEMO_GUILD_ID, { pageSize: 5 });
    expect(
      await getMemberIdentities(
        otherGuild,
        roster.rows.map((m) => m.userId)
      )
    ).toEqual([]);
  });
});

describe("template store authorization", () => {
  const document = () =>
    buildTemplate({
      name: "Starter",
      description: "Captured for a test",
      include: { structure: true, config: true },
      structure: {
        roles: [
          {
            id: "120000000000000010",
            name: "Member",
            color: "#3366ff",
            position: 2,
            permissions: "0",
            managed: false,
          },
        ],
        channels: [
          {
            id: "120000000000000100",
            name: "general",
            type: "text",
            parentId: null,
            overwrites: [],
          },
        ],
      },
      config: structuredClone(defaultConfig),
    });

  it("only lists and resolves templates through a guild the user manages", async () => {
    const saved = await saveTemplate({
      sourceGuildId: DEMO_GUILD_ID,
      name: "Starter",
      description: "Captured for a test",
      createdBy: DEMO_USER_ID,
      document: document(),
    });
    expect(await listTemplates([DEMO_GUILD_ID])).toHaveLength(1);
    // A template id grants nothing on its own: another guild's list is empty and
    // the id does not resolve.
    expect(await listTemplates([otherGuild])).toEqual([]);
    expect(await getTemplate(saved.id, [otherGuild])).toBeNull();
    expect(await getTemplate(saved.id, [])).toBeNull();
    const mine = await getTemplate(saved.id, [DEMO_GUILD_ID]);
    expect(mine?.data.structure?.roles[0].key).toBe("role:member");
  });

  it("refuses to delete a template from a guild that did not capture it", async () => {
    const saved = await saveTemplate({
      sourceGuildId: DEMO_GUILD_ID,
      name: "Starter",
      description: "",
      createdBy: DEMO_USER_ID,
      document: document(),
    });
    await expect(deleteTemplate(saved.id, otherGuild)).rejects.toThrow();
    expect(await getTemplate(saved.id, [DEMO_GUILD_ID])).not.toBeNull();
  });
});
