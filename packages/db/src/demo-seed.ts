import { Permissions as P } from "@orbit/core/permissions";
import type {
  Account,
  AuditEntry,
  Delivery,
  Guild,
  LedgerEntry,
  Member,
  MusicState,
  Resource,
  RosterSync,
  ServiceHealth,
} from "@orbit/core";
import { displayName as resolveDisplayName } from "@orbit/core/identity";
import {
  DEMO_GUILD_ID,
  DEMO_USER_ID,
  DEMO_GUILD_ICON,
  defaultConfig,
} from "@orbit/core";
import { randomUUID } from "node:crypto";
export type DemoState = {
  communityPosts?: import("@orbit/core/community").CommunityPost[];
  version: number;
  guilds: Guild[];
  /**
   * Demo guild roster. Separate from `accounts` on purpose: a member is not an
   * economy record, and the members screen reads only this.
   */
  members?: Member[];
  rosterSync?: Record<string, RosterSync>;
  templates?: import("./templates").DemoTemplate[];
  templateRuns?: import("./templates").DemoTemplateRun[];
  templateRunSteps?: import("./templates").DemoTemplateRunStep[];
  resources: Resource[];
  audit: AuditEntry[];
  accounts: Account[];
  ledger: LedgerEntry[];
  deliveries: Delivery[];
  music: Record<string, MusicState>;
  operations: Record<string, { payload: string; result: any }>;
  inventory: Record<string, number>;
  /**
   * Leveling state, shaped like the SQL tables so the demo branch and the real
   * one can be read by the same code. `events` is keyed for idempotency
   * exactly as `xp_events` is.
   */
  xp?: {
    totals: Record<
      string,
      {
        guildId: string;
        userId: string;
        total: number;
        messageXp: number;
        voiceXp: number;
        adjustedXp: number;
        lastMessageAt: string | null;
        lastMessageHash: string | null;
        updatedAt: string;
      }
    >;
    events: Record<string, { amount: number; kind: string; at: string }>;
    voiceSessions?: Record<
      string,
      {
        guildId: string;
        userId: string;
        channelId: string;
        startedAt: string;
        lastIntervalAt: string | null;
        intervalsAwarded: number;
        brokenAt: string | null;
      }
    >;
    rewardGrants?: Record<
      string,
      {
        guildId: string;
        userId: string;
        level: number;
        roleId: string;
        grantedAt: string | null;
        error: string | null;
      }
    >;
  };
  /**
   * Tickets, keyed by id. Shaped like the SQL row so the demo branch and the
   * real one are read by the same code.
   */
  tickets?: Record<string, import("./tickets").TicketRow>;
};
/** Demo-only persona illustrations; "Orbit" has no user avatar by design. */
const DEMO_PERSONA_AVATARS: Record<string, string> = {
  Alex: "/demo/alex.svg",
  Sophie: "/demo/sophie.svg",
  Milo: "/demo/milo.svg",
  Jamie: "/demo/jamie-davis.svg",
};
const minutesAgo = (n: number) =>
  new Date(Date.now() - n * 60000).toISOString();
const role = (
  n: number,
  name: string,
  color: string,
  position: number,
  permissions = "0",
  managed = false
) => ({
  id: `120000000000000${n}`,
  name,
  color,
  position,
  permissions,
  managed,
});
export function createDemo(): DemoState {
  const roles = [
    role(101, "Admin", "#e16b73", 15, "8"),
    role(102, "Moderator", "#60a5a0", 12, "1099511635968"),
    role(
      103,
      "Orbit",
      "#8b5cf6",
      10,
      (
        P.ManageRoles |
        P.ManageChannels |
        P.ManageMessages |
        P.ModerateMembers
      ).toString(),
      true
    ),
    role(104, "Community", "#9c8aee", 2),
    role(105, "PC gaming", "#9d8be2", 3),
    role(106, "Console gaming", "#e7a671", 3),
    role(107, "Game updates", "#8bb9e3", 3),
    role(108, "Deal hunter", "#76b5a7", 3),
    role(109, "Night owl", "#9e91c9", 3),
    role(110, "Early bird", "#e8c36d", 3),
    role(111, "VIP", "#dfaf62", 4),
    role(112, "DJ", "#e99aaf", 5),
  ];
  const channels = [
    {
      id: "120000000000000201",
      name: "general",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000202",
      name: "pick-your-roles",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000203",
      name: "mod-logs",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000204",
      name: "game-deals",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000205",
      name: "gaming-news",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000206",
      name: "minecraft",
      type: "text" as const,
      canSend: true,
    },
    {
      id: "120000000000000207",
      name: "staff-only",
      type: "text" as const,
      canSend: false,
    },
    {
      id: "120000000000000208",
      name: "The listening room",
      type: "voice" as const,
      canSend: true,
    },
  ];
  const config = structuredClone(defaultConfig);
  config.auditChannelId = channels[2].id;
  const guild: Guild = {
    id: DEMO_GUILD_ID,
    name: "The Cozy Corner",
    icon: DEMO_GUILD_ICON,
    installed: true,
    // Discord counts the members it currently has, so this matches the present
    // rows below (the departed sample member is not counted). Real guilds keep
    // Discord's own number, which is why the members screen reports both the
    // synchronized row count and Discord's count separately.
    memberCount: 15,
    config,
    roles: roles.map((item) => ({
      ...item,
      assignedToBot: item.name === "Orbit",
    })),
    channels: channels.map((item) => ({
      ...item,
      supportsCommunityPosts: item.type === "text",
      permissionBits:
        item.name === "staff-only"
          ? "0"
          : item.type === "voice"
            ? (P.ViewChannel | P.Connect | P.Speak).toString()
            : (
                P.ViewChannel |
                P.SendMessages |
                P.EmbedLinks |
                P.SendPolls |
                P.ReadMessageHistory |
                P.AddReactions |
                P.ManageMessages
              ).toString(),
      permissionsSyncedAt: minutesAgo(0),
    })),
    botRolePosition: 10,
    updatedAt: minutesAgo(0),
  };
  const resources: Resource[] = [];
  const add = (
    kind: Resource["kind"],
    name: string,
    data: Record<string, any>,
    enabled = true
  ) => {
    const r = {
      id: randomUUID(),
      guildId: guild.id,
      kind,
      name,
      enabled,
      data,
      createdAt: minutesAgo(14400),
      updatedAt: minutesAgo(15),
    };
    resources.push(r);
    return r;
  };
  add("panel", "Find your people", {
    description:
      "A little about you, a lot of possibilities. Pick the games you love and find your people.",
    channelId: channels[1].id,
    roleIds: [roles[4].id, roles[5].id],
    mode: "buttons",
    selection: "multi",
    maxRoles: 2,
    prerequisiteIds: [],
    exclusiveRoleIds: [],
    emojis: ["🖥️", "🎮"],
  });
  add("panel", "Keep me in the loop", {
    description: "Only the updates you want. Opt in, opt out, make it yours.",
    channelId: channels[1].id,
    roleIds: [roles[6].id, roles[7].id],
    mode: "select",
    selection: "multi",
    maxRoles: 2,
    prerequisiteIds: [],
    exclusiveRoleIds: [],
    emojis: [],
  });
  add("panel", "Early bird or night owl?", {
    description: "When are you in your element?",
    channelId: channels[1].id,
    roleIds: [roles[8].id, roles[9].id],
    mode: "buttons",
    selection: "single",
    maxRoles: 1,
    prerequisiteIds: [],
    exclusiveRoleIds: [roles[8].id, roles[9].id],
    emojis: ["🌙", "☀️"],
  });
  add("panel", "Community interests", {
    description: "What brings you here? Choose your interests.",
    channelId: channels[1].id,
    roleIds: [roles[3].id, roles[4].id, roles[6].id],
    mode: "select",
    selection: "multi",
    maxRoles: 3,
    prerequisiteIds: [],
    exclusiveRoleIds: [],
    emojis: [],
  });
  add("rule", "Keep the conversation flowing", {
    type: "spam",
    threshold: 6,
    windowSeconds: 10,
    action: "warn",
    durationMinutes: 10,
    terms: [],
    exemptRoleIds: [roles[1].id],
    exemptChannelIds: [],
  });
  add("rule", "No mention storms", {
    type: "mentions",
    threshold: 5,
    windowSeconds: 10,
    action: "timeout",
    durationMinutes: 10,
    terms: [],
    exemptRoleIds: [roles[1].id],
    exemptChannelIds: [],
  });
  add("rule", "A little less déjà vu", {
    type: "repeated",
    threshold: 3,
    windowSeconds: 15,
    action: "delete",
    durationMinutes: 10,
    terms: [],
    exemptRoleIds: [],
    exemptChannelIds: [],
  });
  for (const [i, name, type] of [
    [1, "Unwanted repeated messages", "warn"],
    [2, "Excessive mentions", "timeout"],
    [3, "Spam in general", "warn"],
  ] as const)
    add("case", `Case #00${i}`, {
      targetId: `12000000000000030${i}`,
      type,
      reason: name,
      moderatorId: DEMO_USER_ID,
    });
  add("shop", "The golden hour", {
    description:
      "A little extra glow. Unlock the VIP role and stand out in the community.",
    type: "role",
    roleId: roles[10].id,
    price: 5000,
    stock: -1,
    emoji: "✨",
  });
  add("shop", "Pick the next track", {
    description: "One song. Your choice. A ticket for the listening room.",
    type: "item",
    roleId: "",
    price: 750,
    stock: 25,
    emoji: "🎧",
  });
  add("shop", "Community supporter", {
    description: "A badge of appreciation for our most active members.",
    type: "item",
    roleId: "",
    price: 2500,
    stock: -1,
    emoji: "🌱",
  });
  add("deal", "The weekend wishlist", {
    gameId: "",
    channelId: channels[3].id,
    region: "DE",
    currency: "EUR",
    minDiscount: 50,
    maxPrice: 30,
    historicalLow: false,
    stores: [],
    notificationRoleId: roles[7].id,
    intervalMinutes: 60,
  });
  add("deal", "Patient gamer picks", {
    gameId: "",
    channelId: channels[3].id,
    region: "DE",
    currency: "EUR",
    minDiscount: 75,
    maxPrice: 15,
    historicalLow: true,
    stores: [],
    notificationRoleId: "",
    intervalMinutes: 60,
  });
  const steam = add("source", "Steam", {
    adapter: "steam",
    url: "",
    appId: 570,
    channelId: channels[4].id,
    keywords: [],
    tags: ["Gaming", "Updates"],
    intervalMinutes: 30,
    notificationRoleId: "",
    embedColor: "#6b8dbb",
    includeSummary: true,
    health: "healthy",
    lastChecked: minutesAgo(18),
  });
  add("source", "Community feed · Minecraft", {
    adapter: "rss",
    url: "",
    channelId: channels[5].id,
    keywords: [],
    tags: ["Minecraft"],
    intervalMinutes: 30,
    notificationRoleId: "",
    embedColor: "#72a479",
    includeSummary: true,
    health: "setup_required",
    lastError:
      "Add a verified RSS/Atom URL or use a signed incoming webhook. No default feed is assumed.",
  });
  add(
    "source",
    "Community feed · Warcraft",
    {
      adapter: "rss",
      url: "",
      channelId: channels[4].id,
      keywords: [],
      tags: ["Gaming"],
      intervalMinutes: 60,
      notificationRoleId: "",
      embedColor: "#79a3d6",
      includeSummary: true,
      health: "setup_required",
      lastError:
        "No publisher news API is built in. Add a verified RSS/Atom URL or use a signed incoming webhook.",
    },
    false
  );
  add(
    "source",
    "Community feed · Diablo",
    {
      adapter: "rss",
      url: "",
      channelId: channels[4].id,
      keywords: [],
      tags: ["Warcraft"],
      intervalMinutes: 60,
      notificationRoleId: "",
      embedColor: "#d6a468",
      includeSummary: true,
      health: "setup_required",
      lastError:
        "A supported feed URL must be supplied by an administrator. Scraping is disabled.",
    },
    false
  );
  add("route", "Gaming updates → gaming-news", {
    sourceIds: [steam.id],
    channelId: channels[4].id,
    keywords: [],
    tags: [],
    notificationRoleId: "",
    embedColor: "#8b5cf6",
    includeSummary: true,
  });
  const accountNames = [
    "Jamie",
    "Alex",
    "Milo",
    "Sophie",
    "Aria",
    "Noah",
    "Luna",
    "Theo",
  ];
  const accounts: Account[] = accountNames.map((name, i) => ({
    guildId: guild.id,
    userId: i === 0 ? DEMO_USER_ID : `12000000000000040${i}`,
    name,
    // Four personas have a bundled illustration; the rest deliberately do not,
    // so the "no avatar was ever captured" fallback is exercised in the demo.
    avatar: DEMO_PERSONA_AVATARS[name] ?? null,
    balance: [4250, 38750, 34200, 28150, 26400, 22750, 18200, 15450][i],
    lastDaily: null,
  }));
  const ledger: LedgerEntry[] = Array.from({ length: 24 }, (_, i) => ({
    id: randomUUID(),
    guildId: guild.id,
    userId: accounts[i % 8].userId,
    counterpartyId: i % 5 === 0 ? accounts[(i + 1) % 8].userId : null,
    amount: i % 5 === 0 ? -150 : i % 3 === 0 ? 250 : 10,
    type: i % 5 === 0 ? "transfer" : i % 3 === 0 ? "daily" : "activity",
    key: `seed-${i}`,
    note:
      i % 5 === 0
        ? "A little thank-you"
        : i % 3 === 0
          ? "Daily reward"
          : "Community activity",
    createdAt: minutesAgo(i * 43 + 3),
  }));
  const audit: AuditEntry[] = [
    [
      "Alex",
      "updated",
      "Find your people",
      "Updated the self-role panel",
      "12",
    ],
    [
      "Orbit",
      "delivered",
      "Steam",
      "A gaming update was delivered to #gaming-news",
      "26",
    ],
    [
      "Sophie",
      "updated",
      "No mention storms",
      "Changed the mention threshold to 5",
      "48",
    ],
    [
      "Milo",
      "created",
      "The weekend wishlist",
      "Added a game deals subscription",
      "95",
    ],
    [
      "Jamie",
      "updated",
      "Economy settings",
      "Daily reward set to 250 Stardust",
      "180",
    ],
    [
      "Orbit",
      "moderated",
      "Case #003",
      "Warned a member for repeated messages",
      "240",
    ],
    [
      "Alex",
      "updated",
      "Gaming updates",
      "Changed the destination channel",
      "360",
    ],
    [
      "Jamie",
      "created",
      "Keep me in the loop",
      "Created a self-role panel",
      "720",
    ],
  ].map(([actorName, action, target, detail, min]) => ({
    id: randomUUID(),
    guildId: guild.id,
    actorId: DEMO_USER_ID,
    actorName,
    // Simulated personas: local original illustrations, never live Discord metadata.
    actorAvatar: DEMO_PERSONA_AVATARS[String(actorName)] ?? null,
    action,
    target,
    detail,
    createdAt: minutesAgo(Number(min)),
  }));
  const deliveries: Delivery[] = Array.from({ length: 8 }, (_, i) => ({
    id: randomUUID(),
    guildId: guild.id,
    sourceId: steam.id,
    externalId: `seed-${i}`,
    title: [
      "Dota 2: the latest community update",
      "A new season of adventures",
      "This week in PC gaming",
      "Your next favorite game is on sale",
    ][i % 4],
    url: "https://store.steampowered.com/news/app/570",
    channelId: channels[4].id,
    status: "delivered",
    attempts: 1,
    error: null,
    createdAt: minutesAgo(i * 120 + 26),
    deliveredAt: minutesAgo(i * 120 + 26),
  }));
  const music: MusicState = {
    current: {
      id: "demo-current",
      title: "A walk through the clouds",
      author: "Orbit Radio · demo track",
      duration: 214000,
      uri: "",
      requestedBy: "Alex",
    },
    tracks: [
      {
        id: "demo-1",
        title: "Slow mornings",
        author: "Orbit Radio",
        duration: 186000,
        uri: "",
        requestedBy: "Sophie",
      },
      {
        id: "demo-2",
        title: "Somewhere, after the rain",
        author: "Orbit Radio",
        duration: 242000,
        uri: "",
        requestedBy: "Milo",
      },
      {
        id: "demo-3",
        title: "Sunroom sessions",
        author: "Orbit Radio",
        duration: 198000,
        uri: "",
        requestedBy: "Jamie",
      },
    ],
    paused: false,
    volume: 65,
    repeat: "off",
    position: 72000,
    updatedAt: minutesAgo(0),
  };
  /*
    A representative roster, not a decorated one. Between these rows every case
    the members screen and the identity policy have to handle appears once:
    a nickname that differs from the global name, a global name and handle that
    agree (so the second line is suppressed), a member with only a handle, a
    guild-specific avatar that must win over the global one, a member with no
    avatar at all, a bot, a departed member, a very long name and a member whose
    roles are all non-default.
  */
  const member = (
    n: number,
    input: {
      /** Overrides the generated id; used for the signed-in demo person. */
      userId?: string;
      username?: string | null;
      globalName?: string | null;
      nickname?: string | null;
      avatar?: string | null;
      guildAvatar?: string | null;
      bot?: boolean;
      present?: boolean;
      joinedDaysAgo: number;
      roles: string[];
    }
  ): Member => {
    const userId =
      input.userId ?? `1200000000000004${String(n).padStart(2, "0")}`;
    const names = {
      userId,
      username: input.username ?? null,
      globalName: input.globalName ?? null,
      nickname: input.nickname ?? null,
    };
    return {
      guildId: guild.id,
      userId,
      username: names.username,
      globalName: names.globalName,
      nickname: names.nickname,
      displayName: resolveDisplayName(names, "guild"),
      avatar: input.avatar ?? null,
      guildAvatar: input.guildAvatar ?? null,
      bot: input.bot ?? false,
      joinedAt: minutesAgo(input.joinedDaysAgo * 1440),
      roles: input.roles,
      present: input.present ?? true,
      departedAt: input.present === false ? minutesAgo(2880) : null,
      syncedAt: minutesAgo(4),
    };
  };
  const members: Member[] = [
    member(0, {
      // The person signed into the demo is a member of the demo server, so the
      // account menu, the leaderboard and the directory name them the same way.
      userId: DEMO_USER_ID,
      username: "jamie.davis",
      globalName: "Jamie Davis",
      nickname: "Jamie",
      avatar: "/demo/jamie-davis.svg",
      joinedDaysAgo: 420,
      roles: [roles[0].id, roles[1].id, roles[2].id],
    }),
    member(1, {
      username: "alex",
      globalName: "Alex",
      avatar: "/demo/alex.svg",
      joinedDaysAgo: 380,
      roles: [roles[1].id, roles[2].id],
    }),
    member(2, {
      username: "sophie.l",
      globalName: "Sophie Laurent",
      nickname: "Sophie",
      // A guild avatar with no global avatar: the guild one must be used.
      guildAvatar: "/demo/sophie.svg",
      joinedDaysAgo: 365,
      roles: [roles[0].id],
    }),
    member(3, {
      username: "milochen",
      globalName: "Milo Chen",
      nickname: "Milo",
      avatar: "/demo/milo.svg",
      joinedDaysAgo: 300,
      roles: [roles[2].id],
    }),
    member(4, {
      username: "aria",
      globalName: null,
      joinedDaysAgo: 280,
      roles: [roles[2].id],
    }),
    member(5, {
      // The screenshot case: a global name, no nickname, no recorded avatar.
      username: "wtfaq",
      globalName: "wtFAQ",
      joinedDaysAgo: 260,
      roles: [],
    }),
    member(6, {
      username: "noah.kim",
      globalName: "Noah Kim",
      nickname: "Noah",
      joinedDaysAgo: 240,
      roles: [roles[3].id],
    }),
    member(7, {
      username: "luna.park",
      globalName: "Luna Park",
      joinedDaysAgo: 210,
      roles: [roles[3].id, roles[4].id],
    }),
    member(8, {
      username: "theo",
      globalName: "Theo",
      joinedDaysAgo: 180,
      roles: [roles[4].id],
    }),
    member(9, {
      username: "bartholomew.maximilian.featherstonehaugh",
      globalName: "Bartholomew Maximilian Featherstonehaugh",
      nickname: "Bart",
      joinedDaysAgo: 150,
      roles: [roles[5].id],
    }),
    member(10, {
      // Nickname only: the handle is the only secondary identifier.
      username: "quiet.fox",
      globalName: null,
      nickname: "A very quiet fox",
      joinedDaysAgo: 120,
      roles: [],
    }),
    member(11, {
      username: "orbit",
      globalName: "Orbit",
      bot: true,
      joinedDaysAgo: 430,
      roles: [],
    }),
    member(12, {
      username: "casey.former",
      globalName: "Casey Former",
      present: false,
      joinedDaysAgo: 200,
      roles: [],
    }),
    member(13, {
      username: "rae",
      globalName: "Rae",
      joinedDaysAgo: 12,
      roles: [],
    }),
    member(14, {
      username: "tomas",
      globalName: "Tomás Herrera",
      nickname: "Tomi",
      joinedDaysAgo: 9,
      roles: [roles[4].id],
    }),
    member(15, {
      username: "priya",
      globalName: "Priya Raman",
      joinedDaysAgo: 4,
      roles: [],
    }),
    member(16, {
      /*
       * The overflow case, and it is here on purpose.
       *
       * The member list collapses a row's roles to two badges and shows a
       * "+N" button for the rest, and that button is the only place in the
       * app that renders a `<Tooltip>`. Before this member existed, whether
       * the overflow branch rendered at all depended on whoever happened to
       * hold three roles — which is how a missing TooltipProvider reached
       * production. Now the branch is always exercised, and the name is
       * distinctive enough for a browser test to find it without depending on
       * sort order.
       */
      username: "over.load",
      globalName: "Over Load",
      nickname: "Over",
      joinedDaysAgo: 300,
      roles: [
        roles[0].id,
        roles[1].id,
        roles[2].id,
        roles[3].id,
        roles[4].id,
        roles[5].id,
      ],
    }),
  ];
  return {
    version: 1,
    guilds: [
      guild,
      {
        ...structuredClone(guild),
        id: "120000000000000002",
        name: "The Workshop",
        icon: null,
        memberCount: 128,
        config: structuredClone(defaultConfig),
      },
      {
        ...structuredClone(guild),
        id: "120000000000000003",
        name: "Pixel Pioneers",
        icon: null,
        memberCount: 512,
        installed: false,
      },
    ],
    resources,
    audit,
    accounts,
    ledger,
    deliveries,
    members,
    rosterSync: {
      [guild.id]: {
        guildId: guild.id,
        status: "complete",
        startedAt: minutesAgo(5),
        completedAt: minutesAgo(4),
        lastAttemptAt: minutesAgo(4),
        pagesFetched: 1,
        syncedCount: members.filter((m) => m.present).length,
        expectedCount: guild.memberCount,
        lastError: null,
      },
    },
    music: { [guild.id]: music },
    operations: {},
    inventory: {},
  };
}
export function demoHealth(): ServiceHealth[] {
  return [
    {
      name: "Discord API",
      status: "healthy",
      latency: 42,
      detail: "Simulated connection",
      updatedAt: new Date().toISOString(),
    },
    {
      name: "Database",
      status: "healthy",
      latency: 4,
      detail: "Persistent demo store",
      updatedAt: new Date().toISOString(),
    },
    {
      name: "Background workers",
      status: "healthy",
      latency: 12,
      detail: "Simulated · no outbound messages",
      updatedAt: new Date().toISOString(),
    },
    {
      name: "Music backend",
      status: "healthy",
      latency: 28,
      detail: "Preview queue · no audio playback",
      updatedAt: new Date().toISOString(),
    },
  ];
}
