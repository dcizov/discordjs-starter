import { randomUUID } from "node:crypto";
import { isDemo, configSchema } from "@orbit/core";
import {
  communityInputSchema,
  communityQuerySchema,
  communityModule,
  communityIdSchema,
  isCommunityChannel,
  CommunityConflict,
  assertCommunityVersion,
  assertCommunityEditable,
  assertCommunityPublishable,
  validateCommunitySchedule,
  COMMUNITY_POST_LIMIT,
  COMMUNITY_GRACE_MS,
  COMMUNITY_RETENTION_MS,
  COMMUNITY_SEND_LEASE_MS,
  type CommunityPost,
  type CommunityKind,
  type CommunityPage,
  type CommunityResult,
} from "@orbit/core/community";
import type { Guild } from "@orbit/core";
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import * as s from "./schema";

type Tx = Parameters<
  Parameters<ReturnType<typeof database>["db"]["transaction"]>[0]
>[0];
const serialize = <T>(value: unknown): T => JSON.parse(JSON.stringify(value));
const table = s.communityPosts;
function assertGuild(guild: Guild | undefined, kind?: CommunityKind) {
  if (!guild?.installed) throw new Error("Install Orbit in this server first.");
  if (kind && guild.config.modules[communityModule(kind)] !== true)
    throw new Error(
      "This module is paused. Enable it explicitly in Settings before creating or publishing posts."
    );
}
async function lockGuild(tx: Tx, guildId: string, kind?: CommunityKind) {
  const [row] = await tx
    .select()
    .from(s.guilds)
    .where(eq(s.guilds.id, guildId))
    .for("update");
  const guild = row
    ? serialize<Guild>({ ...row, config: configSchema.parse(row.config) })
    : undefined;
  assertGuild(guild, kind);
  return guild!;
}
const predicate = (guildId: string, id: string) =>
  and(eq(table.guildId, guildId), eq(table.id, id));
function updateValues(post: CommunityPost) {
  return {
    actorId: post.actorId,
    title: post.title,
    channelId: post.channelId,
    body: post.body,
    poll: post.poll,
    state: post.state,
    version: post.version,
    scheduledFor: post.scheduledFor ? new Date(post.scheduledFor) : null,
    attemptedAt: post.attemptedAt ? new Date(post.attemptedAt) : null,
    messageId: post.messageId,
    lastError: post.lastError,
    result: post.result,
    updatedAt: new Date(post.updatedAt),
  };
}
async function auditTx(
  tx: Tx,
  post: CommunityPost,
  actorId: string,
  verb: string
) {
  await tx.insert(s.auditLogs).values({
    guildId: post.guildId,
    actorId,
    actorName: actorId,
    action: verb,
    target: `${post.kind}: ${post.id}`,
    detail: `Community post ${post.id}; state ${post.state}; revision ${post.version}.`,
  });
}
/** Serializes only short database changes. No Discord requests may run inside this callback. */
async function change(
  guildId: string,
  id: string,
  version: number | null,
  actorId: string,
  verb: string,
  requireEnabled: boolean,
  mutate: (post: CommunityPost, guild: Guild) => void
) {
  communityIdSchema.parse(id);
  const now = new Date().toISOString();
  if (isDemo())
    return demoTransaction((state) => {
      const post = (state.communityPosts ?? []).find(
        (p) => p.guildId === guildId && p.id === id
      );
      if (!post) throw new Error("Community post not found in this server.");
      const guild = state.guilds.find((g) => g.id === guildId);
      assertGuild(guild, requireEnabled ? post.kind : undefined);
      if (version !== null) assertCommunityVersion(post, version);
      if (
        verb === "publication claimed" &&
        state.audit.filter(
          (a) =>
            a.guildId === guildId &&
            a.action === verb &&
            Date.parse(a.createdAt) >= Date.now() - 3600_000
        ).length >= 10
      )
        throw new Error(
          "Publication limit reached: at most 10 posts per server per hour. Try later."
        );
      mutate(post, guild!);
      post.version++;
      post.updatedAt = now;
      state.audit.unshift({
        id: randomUUID(),
        guildId,
        actorId,
        actorName: actorId,
        action: verb,
        target: `${post.kind}: ${post.id}`,
        detail: `${post.state}; revision ${post.version}`,
        createdAt: now,
      });
      return serialize<CommunityPost>(post);
    });
  return database().db.transaction(async (tx) => {
    const guild = await lockGuild(tx, guildId);
    const [row] = await tx
      .select()
      .from(table)
      .where(predicate(guildId, id))
      .for("update");
    if (!row) throw new Error("Community post not found in this server.");
    const post = serialize<CommunityPost>(row);
    if (requireEnabled) assertGuild(guild, post.kind);
    if (version !== null) assertCommunityVersion(post, version);
    if (verb === "publication claimed") {
      const [count] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(s.auditLogs)
        .where(
          and(
            eq(s.auditLogs.guildId, guildId),
            eq(s.auditLogs.action, verb),
            sql`${s.auditLogs.createdAt}>=${new Date(Date.now() - 3600_000)}`
          )
        );
      if (count.value >= 10)
        throw new Error(
          "Publication limit reached: at most 10 posts per server per hour. Try later."
        );
    }
    mutate(post, guild!);
    post.version++;
    post.updatedAt = now;
    await tx
      .update(table)
      .set(updateValues(post))
      .where(predicate(guildId, id));
    await auditTx(tx, post, actorId, verb);
    return post;
  });
}
export async function getCommunityPost(
  guildId: string,
  id: string
): Promise<CommunityPost | null> {
  if (!communityIdSchema.safeParse(id).success) return null;
  if (isDemo())
    return (
      (await demoRead()).communityPosts?.find(
        (p) => p.guildId === guildId && p.id === id
      ) ?? null
    );
  const [row] = await database()
    .db.select()
    .from(table)
    .where(predicate(guildId, id));
  return row ? serialize<CommunityPost>(row) : null;
}
export async function listCommunityPosts(
  guildId: string,
  input: unknown
): Promise<CommunityPage> {
  const q = communityQuerySchema.parse(input);
  const asOf = new Date().toISOString();
  if (isDemo()) {
    const all = ((await demoRead()).communityPosts ?? [])
      .filter(
        (p) =>
          p.guildId === guildId &&
          p.kind === q.kind &&
          (q.state === "all" || p.state === q.state)
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
      );
    return {
      asOf,
      kind: q.kind,
      items: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: all.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  const where = and(
    eq(table.guildId, guildId),
    eq(table.kind, q.kind),
    q.state !== "all" ? eq(table.state, q.state) : undefined
  );
  const [rows, [count]] = await Promise.all([
    database()
      .db.select()
      .from(table)
      .where(where)
      .orderBy(desc(table.createdAt), desc(table.id))
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize),
    database()
      .db.select({ value: sql<number>`count(*)::int` })
      .from(table)
      .where(where),
  ]);
  return {
    asOf,
    kind: q.kind,
    items: serialize<CommunityPost[]>(rows),
    total: count.value,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function createCommunityPost(
  guildId: string,
  actorId: string,
  input: unknown,
  requestKey: string
) {
  const data = communityInputSchema.parse(input);
  if (
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(
      requestKey
    )
  )
    throw new Error("Provide a UUID idempotency key.");
  const now = new Date().toISOString();
  const post: CommunityPost = {
    ...data,
    id: randomUUID(),
    guildId,
    state: "draft",
    version: 1,
    actorId,
    requestKey,
    scheduledFor: null,
    attemptedAt: null,
    messageId: null,
    lastError: null,
    result: null,
    createdAt: now,
    updatedAt: now,
  };
  function existing(prior: CommunityPost) {
    if (
      prior.actorId !== actorId ||
      JSON.stringify({
        kind: prior.kind,
        title: prior.title,
        channelId: prior.channelId,
        body: prior.body,
        poll: prior.poll,
      }) !== JSON.stringify(data)
    )
      throw new CommunityConflict(
        "This idempotency key was already used for different content."
      );
    return prior;
  }
  if (isDemo())
    return demoTransaction((state) => {
      const guild = state.guilds.find((g) => g.id === guildId);
      assertGuild(guild, data.kind);
      if (
        !guild!.channels.some(
          (c) => c.id === data.channelId && isCommunityChannel(c, true)
        )
      )
        throw new Error(
          "Choose a supported server text channel. Sync guild metadata if it is missing."
        );
      state.communityPosts ??= [];
      const prior = state.communityPosts.find(
        (p) => p.guildId === guildId && p.requestKey === requestKey
      );
      if (prior) return existing(prior);
      if (
        state.communityPosts.filter((p) => p.guildId === guildId).length >=
        COMMUNITY_POST_LIMIT
      )
        throw new Error(
          "This server has reached its 200-post storage limit. Delete old records first."
        );
      state.communityPosts.push(post);
      state.audit.unshift({
        id: randomUUID(),
        guildId,
        actorId,
        actorName: actorId,
        action: "created",
        target: `${post.kind}: ${post.id}`,
        detail: "Unsent community draft; no Discord delivery.",
        createdAt: now,
      });
      return post;
    });
  return database().db.transaction(async (tx) => {
    const guild = await lockGuild(tx, guildId, data.kind);
    if (
      !guild.channels.some(
        (c) => c.id === data.channelId && isCommunityChannel(c)
      )
    )
      throw new Error(
        "Choose a supported server text channel. Sync guild metadata if it is missing."
      );
    const [prior] = await tx
      .select()
      .from(table)
      .where(and(eq(table.guildId, guildId), eq(table.requestKey, requestKey)));
    if (prior) return existing(serialize<CommunityPost>(prior));
    const [count] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.guildId, guildId));
    if (count.value >= COMMUNITY_POST_LIMIT)
      throw new Error(
        "This server has reached its 200-post storage limit. Delete old records first."
      );
    await tx
      .insert(table)
      .values({ ...post, ...updateValues(post), createdAt: new Date(now) });
    await auditTx(tx, post, actorId, "created");
    return post;
  });
}
export async function editCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  input: unknown
) {
  const data = communityInputSchema.parse(input);
  // Reference check is performed again at publication against fresh Discord channel metadata.
  return change(guildId, id, version, actorId, "updated", true, (p, guild) => {
    assertCommunityEditable(p);
    if (
      !guild.channels.some(
        (c) => c.id === data.channelId && isCommunityChannel(c, isDemo())
      )
    )
      throw new Error("Choose a supported text channel in this server.");
    if (p.kind !== data.kind) throw new Error("Post kind cannot change.");
    Object.assign(p, data, {
      actorId,
      state: "draft",
      scheduledFor: null,
      lastError: null,
    });
  });
}
export function scheduleCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  value: string,
  now?: number
) {
  return change(guildId, id, version, actorId, "scheduled", true, (p) => {
    assertCommunityEditable(p);
    if (p.kind !== "announcement")
      throw new Error("Only announcements can be scheduled.");
    const due = validateCommunitySchedule(value, now ?? Date.now());
    p.actorId = actorId;
    p.state = "scheduled";
    p.scheduledFor = due;
    p.lastError = null;
  });
}
export function cancelCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string
) {
  return change(guildId, id, version, actorId, "cancelled", false, (p) => {
    if (!["draft", "scheduled", "failed", "missed"].includes(p.state))
      throw new CommunityConflict(
        "An in-flight or already published post cannot be cancelled. No recall is promised."
      );
    p.state = "cancelled";
    p.scheduledFor = null;
  });
}
export function claimCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  scheduled: boolean,
  now?: number,
  deadline?: number
) {
  return change(
    guildId,
    id,
    version,
    actorId,
    "publication claimed",
    true,
    (p) => {
      const current = now ?? Date.now();
      if (deadline !== undefined && current > deadline)
        throw new CommunityConflict(
          "This publication request expired. Submit a fresh explicit request."
        );
      assertCommunityPublishable(p, scheduled, current);
      if (scheduled && p.actorId !== actorId)
        throw new CommunityConflict("The approving manager changed.");
      p.state = "sending";
      p.attemptedAt = new Date(current).toISOString();
      p.lastError = null;
    }
  );
}
export function finishCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  outcome: {
    state: "published" | "failed" | "unconfirmed";
    messageId?: string;
    error?: string;
    result?: CommunityResult | null;
  }
) {
  return change(
    guildId,
    id,
    version,
    actorId,
    "publication settled",
    false,
    (p) => {
      if (!["sending", "unconfirmed"].includes(p.state))
        throw new CommunityConflict("Publication is no longer in flight.");
      p.state = outcome.state;
      p.messageId = outcome.messageId ?? null;
      p.lastError = outcome.error ?? null;
      p.result = outcome.result ?? null;
    }
  );
}
export function rejectCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  error: string
) {
  return change(
    guildId,
    id,
    version,
    actorId,
    "publication rejected",
    false,
    (p) => {
      if (!["draft", "failed", "scheduled"].includes(p.state))
        throw new CommunityConflict("Publication state changed.");
      p.state = "failed";
      p.lastError = error;
    }
  );
}
export function recordCommunityResult(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  result: CommunityResult,
  closed: boolean
) {
  return change(
    guildId,
    id,
    version,
    actorId,
    "poll result checked",
    false,
    (p) => {
      if (p.kind !== "poll" || !["published", "closed"].includes(p.state))
        throw new CommunityConflict("This is not a published poll.");
      p.result = result;
      p.lastError = null;
      if (closed) p.state = "closed";
    }
  );
}
export async function deleteCommunityPost(
  guildId: string,
  id: string,
  version: number,
  actorId: string
) {
  communityIdSchema.parse(id);
  // Never delete a claim while the external call might still be in flight.
  if (isDemo())
    return demoTransaction((state) => {
      const p = state.communityPosts?.find(
        (p) => p.guildId === guildId && p.id === id
      );
      if (!p) throw new Error("Post not found.");
      assertGuild(state.guilds.find((g) => g.id === guildId));
      assertCommunityVersion(p, version);
      if (["sending", "scheduled"].includes(p.state))
        throw new CommunityConflict(
          "Cancel the schedule or wait for publication to settle before deleting the record."
        );
      state.communityPosts = state.communityPosts!.filter((row) => row !== p);
      state.audit.unshift({
        id: randomUUID(),
        guildId,
        actorId,
        actorName: actorId,
        action: "deleted",
        target: `${p.kind}: ${p.id}`,
        detail: "Stored record deleted; Discord message was not deleted.",
        createdAt: new Date().toISOString(),
      });
    });
  return database().db.transaction(async (tx) => {
    await lockGuild(tx, guildId);
    const [row] = await tx
      .select()
      .from(table)
      .where(predicate(guildId, id))
      .for("update");
    if (!row) throw new Error("Post not found.");
    const p = serialize<CommunityPost>(row);
    assertCommunityVersion(p, version);
    if (["sending", "scheduled"].includes(p.state))
      throw new CommunityConflict(
        "Cancel the schedule or wait for publication to settle before deleting the record."
      );
    await tx.delete(table).where(predicate(guildId, id));
    await auditTx(
      tx,
      p,
      actorId,
      "stored record deleted (Discord message retained)"
    );
  });
}
/** Bounded reconciliation, including paused guilds. No per-guild timers and no catch-up flood. */
export async function maintainCommunityPosts(
  now = Date.now()
): Promise<CommunityPost[]> {
  if (isDemo()) return [];
  const db = database().db;
  // SKIP LOCKED keeps multiple workers bounded without holding a transaction over network I/O.
  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(table)
      .where(
        sql`(${table.state}='scheduled' and ${table.scheduledFor}<${new Date(now - COMMUNITY_GRACE_MS)}) or (${table.state}='sending' and ${table.attemptedAt}<${new Date(now - COMMUNITY_SEND_LEASE_MS)}) or (${table.state} not in ('scheduled','sending') and ${table.updatedAt}<${new Date(now - COMMUNITY_RETENTION_MS)})`
      )
      .orderBy(asc(table.updatedAt))
      .limit(100)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      if (row.state === "sending")
        await tx
          .update(table)
          .set({
            state: "unconfirmed",
            lastError:
              "The sender stopped before recording Discord's response. Inspect the channel; automatic resend is blocked.",
            updatedAt: new Date(now),
          })
          .where(predicate(row.guildId, row.id));
      else if (row.state === "scheduled")
        await tx
          .update(table)
          .set({
            state: "missed",
            lastError:
              "The 15-minute send window expired. This announcement was not replayed.",
            version: sql`${table.version}+1`,
            updatedAt: new Date(now),
          })
          .where(predicate(row.guildId, row.id));
      else await tx.delete(table).where(predicate(row.guildId, row.id));
    }
  });
  const rows = await db
    .select({ post: table })
    .from(table)
    .innerJoin(s.guilds, eq(table.guildId, s.guilds.id))
    .where(
      and(
        eq(table.state, "scheduled"),
        gte(table.scheduledFor, new Date(now - COMMUNITY_GRACE_MS)),
        lte(table.scheduledFor, new Date(now)),
        sql`${s.guilds.installed}=true and ${s.guilds.config}->'modules'->>'announcements'='true'`
      )
    )
    .orderBy(asc(table.scheduledFor))
    .limit(50);
  return serialize<CommunityPost[]>(rows.map((r) => r.post));
}
