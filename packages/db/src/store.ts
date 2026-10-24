import type {
  AuditEntry,
  DashboardData,
  Delivery,
  Account,
  Guild,
  GuildConfig,
  MusicState,
  Resource,
  ResourceKind,
  ServiceHealth,
} from "@orbit/core";
import {
  assertAssignableRole,
  assertFeedUrl,
  configSchema,
  isDemo,
  resourceSchemas,
  safeText,
} from "@orbit/core";
import { diagnosticText } from "@orbit/core/diagnostics";
import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import { demoHealth } from "./demo-seed";
import * as s from "./schema";
export const serialize = <T>(v: unknown): T => JSON.parse(JSON.stringify(v));
export const emptyMusic = (): MusicState => ({
  current: null,
  tracks: [],
  paused: false,
  volume: 65,
  repeat: "off",
  position: 0,
  updatedAt: new Date().toISOString(),
});
export async function getGuild(id: string): Promise<Guild | null> {
  if (isDemo())
    return (await demoRead()).guilds.find((g) => g.id === id) ?? null;
  const [g] = await database()
    .db.select()
    .from(s.guilds)
    .where(eq(s.guilds.id, id));
  return g ? serialize<Guild>(g) : null;
}
export async function getAccount(
  guildId: string,
  userId: string
): Promise<Account | null> {
  if (isDemo())
    return (
      (await demoRead()).accounts.find(
        (a) => a.guildId === guildId && a.userId === userId
      ) ?? null
    );
  const [row] = await database()
    .db.select()
    .from(s.accounts)
    .where(and(eq(s.accounts.guildId, guildId), eq(s.accounts.userId, userId)));
  return row ? serialize<Account>(row) : null;
}
export async function listInstalledGuilds() {
  if (isDemo()) return (await demoRead()).guilds;
  return serialize<Guild[]>(await database().db.select().from(s.guilds));
}
export async function listResources(
  guildId: string,
  kind?: ResourceKind
): Promise<Resource[]> {
  if (isDemo())
    return (await demoRead()).resources.filter(
      (r) => r.guildId === guildId && (!kind || r.kind === kind)
    );
  return serialize<Resource[]>(
    await database()
      .db.select()
      .from(s.resources)
      .where(
        kind
          ? and(eq(s.resources.guildId, guildId), eq(s.resources.kind, kind))
          : eq(s.resources.guildId, guildId)
      )
      .orderBy(desc(s.resources.createdAt))
  );
}
export async function getResource(guildId: string, id: string) {
  return (await listResources(guildId)).find((r) => r.id === id) ?? null;
}
export type Actor = { id: string; name: string };
function newAudit(
  guildId: string,
  actor: Actor,
  action: string,
  target: string,
  detail: string
): AuditEntry {
  return {
    id: randomUUID(),
    guildId,
    actorId: actor.id,
    actorName: actor.name,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  };
}
export async function audit(
  guildId: string,
  actor: Actor,
  action: string,
  target: string,
  detail: string
) {
  const entry = newAudit(
    guildId,
    actor,
    action,
    safeText(target, 80),
    diagnosticText(detail)
  );
  if (isDemo())
    await demoTransaction((d) => {
      d.audit.unshift(entry);
    });
  else
    await database()
      .db.insert(s.auditLogs)
      .values({ ...entry, createdAt: new Date(entry.createdAt) });
}
function validateReferences(
  guild: Guild,
  kind: ResourceKind,
  data: Record<string, any>
) {
  if (
    data.channelId &&
    !guild.channels.some((c) => c.id === data.channelId && c.type === "text")
  )
    throw new Error("Choose a text channel belonging to this server.");
  if (data.notificationRoleId) {
    const role = guild.roles.find((r) => r.id === data.notificationRoleId);
    if (!role || role.managed || role.id === guild.id)
      throw new Error(
        "Choose a valid notification role, not @everyone or an integration."
      );
  }
  if (kind === "panel") {
    for (const id of [...data.roleIds, ...(data.exclusiveRoleIds ?? [])])
      assertAssignableRole(
        guild.roles.find((r) => r.id === id),
        guild.botRolePosition,
        guild.id
      );
    if (
      data.prerequisiteIds?.some(
        (id: string) => !guild.roles.some((r) => r.id === id)
      )
    )
      throw new Error("A prerequisite role no longer exists.");
    if (data.selection === "single" && data.maxRoles !== 1)
      throw new Error("Single-select panels must have a limit of 1.");
    if (data.mode === "reaction" && data.emojis.length !== data.roleIds.length)
      throw new Error("Provide one unique emoji for each reaction role.");
    if (
      data.mode === "reaction" &&
      new Set(data.emojis).size !== data.emojis.length
    )
      throw new Error("Reaction emojis must be unique.");
    if (data.mode === "buttons" && data.roleIds.length > 20)
      throw new Error("Button panels support at most 20 roles.");
  }
  if (kind === "shop" && data.type === "role")
    assertAssignableRole(
      guild.roles.find((r) => r.id === data.roleId),
      guild.botRolePosition,
      guild.id
    );
  if (kind === "source" && data.url) assertFeedUrl(data.url);
}
export async function saveResource(
  guildId: string,
  kind: ResourceKind,
  input: unknown,
  actor: Actor,
  id?: string
) {
  if (kind === "case")
    throw new Error(
      "Moderation cases are append-only and are created by the bot."
    );
  const parsed = resourceSchemas[kind].parse(input);
  const guild = await getGuild(guildId);
  if (!guild || !guild.installed)
    throw new Error("The bot is not installed in this server.");
  validateReferences(guild, kind, parsed.data);
  if (kind === "route") {
    const sources = await listResources(guildId, "source");
    if (
      (parsed.data as any).sourceIds.some(
        (sid: string) => !sources.some((r) => r.id === sid)
      )
    )
      throw new Error("Routing sources must belong to this server.");
  }
  if (kind === "source") {
    const data = parsed.data as any;
    const prior = id ? await getResource(guildId, id) : null;
    const unchanged =
      prior?.data.adapter === data.adapter &&
      prior?.data.url === data.url &&
      prior?.data.appId === data.appId;
    // Configuration alone is not evidence that an external service is healthy.
    data.health = unchanged
      ? (prior?.data.health ?? "setup_required")
      : "setup_required";
    if (data.adapter === "webhook" && !isDemo()) {
      const credential = id
        ? (
            await database()
              .db.select({ sourceId: s.webhookSecrets.sourceId })
              .from(s.webhookSecrets)
              .where(
                and(
                  eq(s.webhookSecrets.guildId, guildId),
                  eq(s.webhookSecrets.sourceId, id)
                )
              )
          )[0]
        : null;
      data.health = credential ? "healthy" : "setup_required";
    }
  }
  const now = new Date();
  const entry = newAudit(
    guildId,
    actor,
    id ? "updated" : "created",
    parsed.name,
    `${id ? "Updated" : "Created"} ${kind} configuration`
  );
  if (isDemo())
    return demoTransaction((d) => {
      const existing = id
        ? d.resources.find(
            (r) => r.id === id && r.guildId === guildId && r.kind === kind
          )
        : null;
      if (id && !existing) throw new Error("Resource not found");
      const resource: Resource = {
        id: id ?? randomUUID(),
        guildId,
        kind,
        ...parsed,
        data: parsed.data,
        createdAt: existing?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (existing) d.resources[d.resources.indexOf(existing)] = resource;
      else d.resources.unshift(resource);
      d.audit.unshift(entry);
      return resource;
    });
  return database().db.transaction(async (tx) => {
    let rows;
    if (id)
      rows = await tx
        .update(s.resources)
        .set({ ...parsed, updatedAt: now })
        .where(
          and(
            eq(s.resources.guildId, guildId),
            eq(s.resources.id, id),
            eq(s.resources.kind, kind)
          )
        )
        .returning();
    else
      rows = await tx
        .insert(s.resources)
        .values({ guildId, kind, ...parsed })
        .returning();
    if (!rows.length) throw new Error("Resource not found");
    await tx.insert(s.auditLogs).values({ ...entry, createdAt: now });
    return serialize<Resource>(rows[0]);
  });
}
export async function deleteResource(
  guildId: string,
  kind: ResourceKind,
  id: string,
  actor: Actor
) {
  if (kind === "case") throw new Error("Moderation cases cannot be deleted.");
  const entry = newAudit(
    guildId,
    actor,
    "deleted",
    kind,
    `Deleted ${kind} ${id}`
  );
  if (isDemo())
    return demoTransaction((d) => {
      const i = d.resources.findIndex(
        (r) => r.guildId === guildId && r.id === id && r.kind === kind
      );
      if (i < 0) throw new Error("Resource not found");
      entry.target = d.resources[i].name;
      d.resources.splice(i, 1);
      d.audit.unshift(entry);
    });
  await database().db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(s.resources)
      .where(
        and(
          eq(s.resources.id, id),
          eq(s.resources.guildId, guildId),
          eq(s.resources.kind, kind)
        )
      )
      .returning();
    if (!removed) throw new Error("Resource not found");
    await tx
      .insert(s.auditLogs)
      .values({ ...entry, target: removed.name, createdAt: new Date() });
  });
}
export async function saveConfig(
  guildId: string,
  input: unknown,
  actor: Actor
): Promise<GuildConfig> {
  const config = configSchema.parse(input);
  const guild = await getGuild(guildId);
  if (!guild) throw new Error("Server not found");
  if (
    config.auditChannelId &&
    !guild.channels.some(
      (c) => c.id === config.auditChannelId && c.type === "text"
    )
  )
    throw new Error("Invalid audit channel");
  if (
    config.music.djRoleId &&
    !guild.roles.some((r) => r.id === config.music.djRoleId)
  )
    throw new Error("Invalid DJ role");
  if (
    config.notificationRoleId &&
    !guild.roles.some(
      (r) =>
        r.id === config.notificationRoleId && r.id !== guild.id && !r.managed
    )
  )
    throw new Error("Invalid notification role");
  if (
    config.moderation.exemptRoleIds.some(
      (id) => !guild.roles.some((r) => r.id === id)
    )
  )
    throw new Error("Invalid exemption role");
  const entry = newAudit(
    guildId,
    actor,
    "updated",
    "Server settings",
    "Saved server configuration"
  );
  if (isDemo())
    await demoTransaction((d) => {
      const g = d.guilds.find((g) => g.id === guildId);
      if (!g) throw new Error("Server not found");
      g.config = config;
      g.updatedAt = new Date().toISOString();
      d.audit.unshift(entry);
    });
  else
    await database().db.transaction(async (tx) => {
      await tx
        .update(s.guilds)
        .set({ config, updatedAt: new Date() })
        .where(eq(s.guilds.id, guildId));
      await tx.insert(s.auditLogs).values({ ...entry, createdAt: new Date() });
    });
  return config;
}
export async function getDashboardData(
  guildId: string
): Promise<Omit<DashboardData, "user" | "guilds">> {
  const guild = await getGuild(guildId);
  if (!guild) throw new Error("Server not found");
  if (isDemo()) {
    const d = await demoRead();
    return {
      guild,
      resources: d.resources.filter((r) => r.guildId === guildId),
      audit: d.audit.filter((r) => r.guildId === guildId).slice(0, 200),
      ledger: d.ledger.filter((r) => r.guildId === guildId).slice(0, 200),
      accounts: d.accounts
        .filter((r) => r.guildId === guildId)
        .sort((a, b) => b.balance - a.balance),
      deliveries: d.deliveries
        .filter((r) => r.guildId === guildId)
        .slice(0, 200),
      music: d.music[guildId] ?? emptyMusic(),
      health: demoHealth(),
      stats: {
        accountCount: d.accounts.filter((a) => a.guildId === guildId).length,
        circulation: d.accounts
          .filter((a) => a.guildId === guildId)
          .reduce((n, a) => n + a.balance, 0),
      },
      demo: true,
    };
  }
  const db = database().db;
  const [
    resources,
    audit,
    ledger,
    accounts,
    deliveries,
    music,
    health,
    totals,
  ] = await Promise.all([
    listResources(guildId),
    db
      .select()
      .from(s.auditLogs)
      .where(eq(s.auditLogs.guildId, guildId))
      .orderBy(desc(s.auditLogs.createdAt))
      .limit(200),
    db
      .select()
      .from(s.ledger)
      .where(eq(s.ledger.guildId, guildId))
      .orderBy(desc(s.ledger.createdAt))
      .limit(200),
    db
      .select()
      .from(s.accounts)
      .where(eq(s.accounts.guildId, guildId))
      .orderBy(desc(s.accounts.balance))
      .limit(100),
    db
      .select()
      .from(s.deliveries)
      .where(eq(s.deliveries.guildId, guildId))
      .orderBy(desc(s.deliveries.createdAt))
      .limit(200),
    db.select().from(s.musicStates).where(eq(s.musicStates.guildId, guildId)),
    db.select().from(s.health),
    db
      .select({
        accountCount: sql<number>`count(*)::int`,
        circulation: sql<number>`coalesce(sum(${s.accounts.balance}),0)::bigint`,
      })
      .from(s.accounts)
      .where(eq(s.accounts.guildId, guildId)),
  ]);
  return serialize({
    guild,
    resources,
    audit,
    ledger,
    accounts,
    deliveries,
    music: music[0]?.data ?? emptyMusic(),
    health: [
      "Discord API",
      "Database",
      "Background workers",
      "Music backend",
    ].map((name) => {
      if (name === "Database")
        return {
          name,
          status: "healthy",
          latency: 0,
          detail: "PostgreSQL connected",
          updatedAt: new Date().toISOString(),
        };
      const h = health.find((h) => h.name === name);
      return h && Date.now() - new Date(h.updatedAt).getTime() < 120000
        ? h
        : {
            name,
            status: "offline",
            latency: 0,
            detail: "No recent heartbeat",
            updatedAt: h?.updatedAt ?? new Date(0).toISOString(),
          };
    }),
    stats: {
      accountCount: Number(totals[0]?.accountCount ?? 0),
      circulation: Number(totals[0]?.circulation ?? 0),
    },
    demo: false,
  });
}
export async function putMusicState(guildId: string, data: MusicState) {
  if (isDemo())
    await demoTransaction((d) => {
      d.music[guildId] = data;
    });
  else
    await database()
      .db.insert(s.musicStates)
      .values({ guildId, data })
      .onConflictDoUpdate({ target: s.musicStates.guildId, set: { data } });
}
export async function recordCase(
  guildId: string,
  input: unknown,
  actor: Actor
) {
  const p = resourceSchemas.case.parse(input);
  const now = new Date();
  if (isDemo())
    return demoTransaction((d) => {
      const r: Resource = {
        id: randomUUID(),
        guildId,
        kind: "case",
        ...p,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      d.resources.unshift(r);
      d.audit.unshift(
        newAudit(guildId, actor, "moderated", p.name, p.data.reason)
      );
      return r;
    });
  return database().db.transaction(async (tx) => {
    const [r] = await tx
      .insert(s.resources)
      .values({ guildId, kind: "case", ...p })
      .returning();
    await tx.insert(s.auditLogs).values({
      ...newAudit(guildId, actor, "moderated", p.name, p.data.reason),
      createdAt: now,
    });
    return serialize<Resource>(r);
  });
}
export async function reserveDelivery(
  input: Omit<
    Delivery,
    "id" | "status" | "attempts" | "error" | "createdAt" | "deliveredAt"
  >
) {
  if (isDemo())
    return demoTransaction((d) => {
      if (
        d.deliveries.some(
          (v) =>
            v.guildId === input.guildId &&
            v.sourceId === input.sourceId &&
            v.externalId === input.externalId &&
            v.channelId === input.channelId
        )
      )
        return null;
      const row: Delivery = {
        ...input,
        id: randomUUID(),
        status: "pending",
        attempts: 0,
        error: null,
        createdAt: new Date().toISOString(),
        deliveredAt: null,
      };
      d.deliveries.unshift(row);
      return row;
    });
  const [row] = await database()
    .db.insert(s.deliveries)
    .values(input)
    .onConflictDoNothing()
    .returning();
  return row ? serialize<Delivery>(row) : null;
}
export async function setHealth(
  name: string,
  status: ServiceHealth["status"],
  latency: number,
  detail: string
) {
  if (isDemo()) return;
  await database()
    .db.insert(s.health)
    .values({ name, status, latency, detail, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: s.health.name,
      set: { status, latency, detail, updatedAt: new Date() },
    });
}
