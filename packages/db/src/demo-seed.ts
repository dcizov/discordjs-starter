import { Permissions as P } from "@orbit/core/permissions";
import type {
  Account,
  AuditEntry,
  Delivery,
  Guild,
  LedgerEntry,
  MusicState,
  Resource,
  ServiceHealth,
} from "@orbit/core";
import { DEMO_GUILD_ID, DEMO_USER_ID, defaultConfig } from "@orbit/core";
import { randomUUID } from "node:crypto";
export type DemoState = {
  version: number;
  guilds: Guild[];
  resources: Resource[];
  audit: AuditEntry[];
  accounts: Account[];
  ledger: LedgerEntry[];
  deliveries: Delivery[];
  music: Record<string, MusicState>;
  operations: Record<string, { payload: string; result: any }>;
  inventory: Record<string, number>;
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
      (P.ManageRoles | P.ManageMessages | P.ModerateMembers).toString(),
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
    icon: null,
    installed: true,
    memberCount: 2846,
    config,
    roles: roles.map((item) => ({
      ...item,
      assignedToBot: item.name === "Orbit",
    })),
    channels: channels.map((item) => ({
      ...item,
      permissionBits:
        item.name === "staff-only"
          ? "0"
          : item.type === "voice"
            ? (P.ViewChannel | P.Connect | P.Speak).toString()
            : (
                P.ViewChannel |
                P.SendMessages |
                P.EmbedLinks |
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
  add("source", "Mojang", {
    adapter: "mojang",
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
    "Blizzard",
    {
      adapter: "blizzard",
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
        "Blizzard does not provide a configured universal news API. Add a verified feed or a signed webhook.",
    },
    false
  );
  add(
    "source",
    "Wowhead",
    {
      adapter: "wowhead",
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
  return {
    version: 1,
    guilds: [
      guild,
      {
        ...structuredClone(guild),
        id: "120000000000000002",
        name: "The Workshop",
        memberCount: 128,
        config: structuredClone(defaultConfig),
      },
      {
        ...structuredClone(guild),
        id: "120000000000000003",
        name: "Pixel Pioneers",
        memberCount: 512,
        installed: false,
      },
    ],
    resources,
    audit,
    accounts,
    ledger,
    deliveries,
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
