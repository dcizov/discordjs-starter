import { previewNewsRouting } from "@orbit/db/src/news-preview";
import { getOwnEconomyHistory } from "@orbit/db";
import { assertMusicQueueAdmission } from "@orbit/core/music-policy";
import {
  communityActionSchema,
  CommunityConflict,
} from "@orbit/core/community";
import {
  createCommunityPost,
  getCommunityPost,
  listCommunityPosts,
  editCommunityPost,
  deleteCommunityPost,
  scheduleCommunityPost,
  cancelCommunityPost,
} from "@orbit/db";
import { simulateCommunityAction } from "@orbit/db/src/community-demo";
import { eq, and, sql } from "drizzle-orm";
import { authorize, HttpError } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import { assertOrigin, body, rateLimit } from "@/lib/security";
import type { ResourceKind } from "@orbit/core";
import { encrypt, resourceSchemas, snowflake } from "@orbit/core";
import { inviteUrl, isDemo, required } from "@orbit/core/environment";
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
import { diagnosticText } from "@orbit/core/diagnostics";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { pollSourceDetailed, searchGames } from "@orbit/core/feeds";
import { UpstreamError } from "@orbit/core/integration-http";
import { HISTORY_KINDS, parseHistoryQuery } from "@orbit/core/history-query";
import { newsCard } from "@orbit/core/news-presentation";
import { createQueue, enqueueAction } from "@orbit/core/queue";
import {
  audit,
  database,
  deleteResource,
  economyTransaction,
  getDashboardData,
  getGuild,
  queryHistory,
  getResource,
  putMusicState,
  reserveDelivery,
  saveConfig,
  saveResource,
  schema,
} from "@orbit/db";
import { demoTransaction } from "@orbit/db/src/demo";
import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: Request, context: Context) {
  try {
    const { path } = await context.params;
    if (path[0] === "healthz")
      return NextResponse.json({
        status: "ok",
        mode: isDemo() ? "demo" : "live",
      });
    if (path[0] !== "guilds" || !path[1])
      throw new HttpError(404, "Endpoint not found");
    const guildId = snowflake.parse(path[1]),
      mutating = req.method !== "GET";
    if (mutating) assertOrigin(req);
    const auth = await authorize(guildId, mutating);
    await rateLimit(`${auth.user.id}:${guildId}`);
    const actor = {
      id: auth.user.id,
      name: auth.user.name,
      avatar: auth.user.avatar ?? null,
    };
    if (path[2] === "invite" && req.method === "GET")
      return NextResponse.json({ url: inviteUrl(guildId) });
    if (!auth.guild.installed)
      throw new HttpError(409, "Invite Orbit to this server first");
    if (path[2] === "commands" && path.length === 3 && req.method === "GET") {
      const guild = await getGuild(guildId);
      if (!guild)
        throw new HttpError(409, "Orbit is still syncing this server");
      return NextResponse.json(getCommandCatalog(guild.config));
    }
    if (path[2] === "actions" && path[3] && req.method === "GET") {
      if (isDemo()) throw new HttpError(404, "No live jobs in demo mode");
      const q = createQueue("discord-actions");
      try {
        const job = await q.getJob(path[3]);
        if (
          !job ||
          job.data.guildId !== guildId ||
          job.data.actorId !== actor.id
        )
          throw new HttpError(404, "Action not found");
        return NextResponse.json({
          state: await job.getState(),
          error: job.failedReason ? diagnosticText(job.failedReason) : null,
          result: job.returnvalue,
        });
      } finally {
        await q.close();
      }
    }
    if (path.length === 2 && req.method === "GET")
      return NextResponse.json(
        await loadDashboard(guildId, auth, {
          communityKind: z
            .enum(["poll", "announcement"])
            .optional()
            .parse(new URL(req.url).searchParams.get("community") ?? undefined),
          ownLedger: new URL(req.url).searchParams.get("ownLedger") === "true",
        })
      );
    if (
      path[2] === "my-transactions" &&
      path.length === 3 &&
      req.method === "GET"
    ) {
      const query = new URL(req.url).searchParams;
      return NextResponse.json(
        await getOwnEconomyHistory(guildId, actor.id, {
          page: z.coerce
            .number()
            .int()
            .min(1)
            .max(10000)
            .parse(query.get("page") ?? 1),
          pageSize: 5,
        })
      );
    }
    if (
      path[2] === "news-preview" &&
      path.length === 3 &&
      req.method === "POST"
    )
      return NextResponse.json(
        await previewNewsRouting(guildId, await body(req))
      );
    if (path[2] === "community") {
      if (path.length === 3 && req.method === "GET") {
        const params = new URL(req.url).searchParams;
        return NextResponse.json(
          await listCommunityPosts(guildId, {
            kind: params.get("kind"),
            state: params.get("state") ?? "all",
            page: params.get("page") ?? 1,
            pageSize: params.get("pageSize") ?? 12,
          })
        );
      }
      if (path.length === 3 && req.method === "POST") {
        const key = z.uuid().parse(req.headers.get("Idempotency-Key"));
        return NextResponse.json(
          await createCommunityPost(guildId, actor.id, await body(req), key),
          { status: 201 }
        );
      }
      const id = z.uuid().parse(path[3]);
      const post = await getCommunityPost(guildId, id);
      if (!post)
        throw new HttpError(404, "Community post not found in this server");
      if (path.length === 4 && req.method === "GET")
        return NextResponse.json(post);
      if (path.length === 4 && req.method === "PATCH") {
        const input = z
          .object({ version: z.number().int().positive(), input: z.unknown() })
          .strict()
          .parse(await body(req));
        return NextResponse.json(
          await editCommunityPost(
            guildId,
            id,
            input.version,
            actor.id,
            input.input
          )
        );
      }
      if (path.length === 4 && req.method === "DELETE") {
        const input = z
          .object({ version: z.number().int().positive() })
          .strict()
          .parse(await body(req));
        await deleteCommunityPost(guildId, id, input.version, actor.id);
        return NextResponse.json({ ok: true, discordMessageDeleted: false });
      }
      if (path.length === 5 && path[4] === "actions" && req.method === "POST") {
        const input = communityActionSchema.parse(await body(req));
        if (input.action === "schedule") {
          if (!input.scheduledFor)
            throw new HttpError(422, "Choose a UTC send time");
          return NextResponse.json({
            post: await scheduleCommunityPost(
              guildId,
              id,
              input.version,
              actor.id,
              input.scheduledFor
            ),
            demo: isDemo(),
            deliveryConfirmed: false,
          });
        }
        if (input.action === "cancel")
          return NextResponse.json({
            post: await cancelCommunityPost(
              guildId,
              id,
              input.version,
              actor.id
            ),
            demo: isDemo(),
          });
        if (post.version !== input.version)
          throw new CommunityConflict(
            "This record changed. Refresh before trying again."
          );
        if (isDemo())
          return NextResponse.json({
            post: await simulateCommunityAction(
              guildId,
              id,
              input.version,
              actor.id,
              input.action
            ),
            demo: true,
            simulated: true,
          });
        const intent = z
          .uuid()
          .parse(req.headers.get("Idempotency-Key") ?? randomUUID());
        const job = await enqueueAction(
          guildId,
          actor.id,
          "community",
          { id, version: input.version, action: input.action },
          `community-${id}-${input.version}-${input.action}-${intent}`
        );
        return NextResponse.json(
          { accepted: true, jobId: job.id, demo: false },
          { status: 202 }
        );
      }
      throw new HttpError(404, "Endpoint not found");
    }
    if (path[2] === "history" && req.method === "GET") {
      const u = new URL(req.url);
      const kind = z.enum(HISTORY_KINDS).parse(u.searchParams.get("kind"));
      // One shared contract (`@orbit/core/history-query`) builds and parses
      // these parameters, so the dashboard cannot request a filter the route
      // quietly ignores. Sorting is further checked per dataset in @orbit/db.
      const params = parseHistoryQuery(u.searchParams);
      return NextResponse.json(
        await queryHistory(guildId, kind, {
          ...params,
          sort: params.sort as never,
        })
      );
    }
    if (path[2] === "config" && req.method === "PATCH")
      return NextResponse.json(
        await saveConfig(guildId, await body(req), actor)
      );
    if (path[2] === "resources") {
      const kind = path[3] as ResourceKind;
      if (!Object.hasOwn(resourceSchemas, kind))
        throw new HttpError(404, "Unknown resource type");
      const id = path[4];
      if (id) z.string().uuid().parse(id);
      if (req.method === "POST" && !id)
        return NextResponse.json(
          await saveResource(guildId, kind, await body(req), actor),
          { status: 201 }
        );
      const resource = id ? await getResource(guildId, id) : null;
      if (id && (!resource || resource.kind !== kind))
        throw new HttpError(404, "Resource not found");
      if (req.method === "PATCH" && id)
        return NextResponse.json(
          await saveResource(guildId, kind, await body(req), actor, id)
        );
      if (req.method === "DELETE" && id) {
        await deleteResource(guildId, kind, id, actor);
        return NextResponse.json({ ok: true });
      }
      if (
        req.method === "POST" &&
        resource &&
        path[5] === "test" &&
        kind === "source"
      ) {
        if (!isDemo() && resource.data.adapter === "webhook") {
          const [c] = await database()
            .db.select({ sourceId: schema.webhookSecrets.sourceId })
            .from(schema.webhookSecrets)
            .where(
              and(
                eq(schema.webhookSecrets.guildId, guildId),
                eq(schema.webhookSecrets.sourceId, resource.id)
              )
            );
          if (!c)
            throw new HttpError(
              400,
              "Generate webhook credentials first. No requests can be accepted without a signing secret."
            );
        }
        // Demo never fabricates provider metadata: it returns one clearly
        // labelled simulated item with the same card contract as live ones.
        const polled = isDemo()
          ? {
              items: [
                {
                  id: "demo-test",
                  title: "Your source is ready for a test flight",
                  summary:
                    "This is a simulated preview. No external source was fetched and nothing was sent to Discord.",
                  url: "",
                  attribution: "unknown" as const,
                  publisher: "",
                  publishedAt: "",
                  image: null,
                  tags: [],
                  sourceLabel: resource.name,
                },
              ],
              notices: [
                "Simulated preview: no external request, no Discord delivery.",
              ],
            }
          : await pollSourceDetailed(resource);
        const items = polled.items;
        if (!isDemo())
          await saveResource(
            guildId,
            "source",
            {
              name: resource.name,
              enabled: resource.enabled,
              data: {
                ...resource.data,
                health: "healthy",
                lastChecked: new Date().toISOString(),
                lastError: "",
              },
            },
            actor,
            resource.id
          );
        return NextResponse.json({
          ok: true,
          count: items.length,
          shown: Math.min(items.length, 3),
          items: items
            .slice(0, 3)
            .map((item) =>
              newsCard(item, { sourceName: resource.name, simulated: isDemo() })
            ),
          notices: polled.notices,
          officialOnly:
            resource.data.adapter === "steam" && !!resource.data.officialOnly,
          demo: isDemo(),
        });
      }
      if (
        req.method === "POST" &&
        resource &&
        path[5] === "send-test" &&
        kind === "source"
      ) {
        if (!resource.data.channelId)
          throw new HttpError(400, "Choose a destination channel first");
        if (isDemo()) {
          const r = await reserveDelivery({
            guildId,
            sourceId: id!,
            externalId: `test-${randomUUID()}`,
            title: `Test message from ${resource.name}`,
            url: "",
            channelId: resource.data.channelId,
          });
          if (r)
            await demoTransaction((d) => {
              const row = d.deliveries.find((v) => v.id === r.id)!;
              row.status = "delivered";
              row.attempts = 1;
              row.deliveredAt = new Date().toISOString();
            });
        } else {
          const job = await enqueueAction(
            guildId,
            actor.id,
            "test-message",
            { sourceId: id },
            randomUUID()
          );
          await audit(
            guildId,
            actor,
            "tested",
            resource.name,
            "Queued a test message"
          );
          return NextResponse.json({ ok: true, demo: false, jobId: job.id });
        }
        await audit(
          guildId,
          actor,
          "tested",
          resource.name,
          isDemo()
            ? "Simulated a test delivery. No Discord message was sent."
            : "Queued a test message"
        );
        return NextResponse.json({ ok: true, demo: isDemo() });
      }
      if (
        req.method === "POST" &&
        resource &&
        path[5] === "publish" &&
        kind === "panel"
      ) {
        if (!resource.data.channelId)
          throw new HttpError(400, "Choose a destination channel first");
        if (!isDemo()) {
          const job = await enqueueAction(
            guildId,
            actor.id,
            "publish-panel",
            { panelId: id },
            randomUUID()
          );
          await audit(
            guildId,
            actor,
            "published",
            resource.name,
            "Queued role-panel publication"
          );
          return NextResponse.json({ ok: true, demo: false, jobId: job.id });
        }
        await audit(
          guildId,
          actor,
          "published",
          resource.name,
          isDemo()
            ? "Simulated role-panel publication. No message was sent."
            : "Queued role-panel publication"
        );
        return NextResponse.json({ ok: true, demo: isDemo() });
      }
      if (
        req.method === "POST" &&
        resource &&
        path[5] === "webhook" &&
        kind === "source"
      ) {
        if (isDemo())
          return NextResponse.json({
            url: `/api/webhooks/${id}`,
            secret: "demo-only-not-a-live-webhook",
            demo: true,
          });
        const secret = randomBytes(32).toString("hex");
        await database()
          .db.insert(schema.webhookSecrets)
          .values({
            sourceId: id!,
            guildId,
            secret: encrypt(secret, required("APP_SECRET")),
          })
          .onConflictDoUpdate({
            target: schema.webhookSecrets.sourceId,
            set: { secret: encrypt(secret, required("APP_SECRET")) },
          });
        await database()
          .db.update(schema.resources)
          .set({
            data: sql`${schema.resources.data} || '{"health":"healthy"}'::jsonb`,
          })
          .where(
            and(
              eq(schema.resources.id, id!),
              eq(schema.resources.guildId, guildId)
            )
          );
        await audit(
          guildId,
          actor,
          "updated",
          resource.name,
          "Rotated the incoming webhook secret"
        );
        return NextResponse.json({
          url: `${required("APP_URL")}/api/webhooks/${id}`,
          secret,
        });
      }
    }
    if (path[2] === "economy" && req.method === "POST") {
      const input = await body(req),
        type = z.enum(["daily", "transfer", "purchase"]).parse(path[3]);
      const key = z
        .string()
        .min(8)
        .max(120)
        .parse(req.headers.get("idempotency-key"));
      const toUserId =
        type === "transfer" ? snowflake.parse(input.toUserId) : undefined;
      if (toUserId && !isDemo()) {
        const r = await fetch(
          `https://discord.com/api/v10/guilds/${guildId}/members/${toUserId}`,
          {
            headers: { Authorization: `Bot ${required("DISCORD_TOKEN")}` },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (!r.ok)
          throw new HttpError(400, "Recipient must be a member of this server");
      }
      const result = await economyTransaction({
        guildId,
        userId: actor.id,
        userName: actor.name,
        type,
        key: `dashboard-${actor.id}-${key}`,
        toUserId,
        amount:
          type === "transfer"
            ? z.number().int().positive().max(100000000).parse(input.amount)
            : undefined,
        itemId:
          type === "purchase"
            ? z.string().uuid().parse(input.itemId)
            : undefined,
        note: z.string().max(200).optional().parse(input.note),
      });
      if (result.roleId && !isDemo())
        await enqueueAction(
          guildId,
          actor.id,
          "claim-role",
          { itemId: input.itemId },
          `claim-${key}`
        );
      return NextResponse.json(result);
    }
    if (path[2] === "music" && req.method === "POST") {
      const input = z
        .object({
          action: z.enum([
            "play",
            "pause",
            "resume",
            "skip",
            "stop",
            "shuffle",
            "repeat",
            "volume",
            "remove",
            "seek",
          ]),
          query: z.string().min(2).max(200).optional(),
          volume: z.number().int().min(0).max(100).optional(),
          position: z.number().int().min(1).max(86400).optional(),
          repeat: z.enum(["off", "track", "queue"]).optional(),
          trackId: z.string().max(100).optional(),
        })
        .parse(await body(req));
      const g = (await getDashboardData(guildId)).guild;
      if (!g.config.modules.music)
        throw new HttpError(400, "The music module is disabled");
      if (isDemo()) {
        const state = (await getDashboardData(guildId)).music;
        switch (input.action) {
          case "pause":
            state.paused = true;
            break;
          case "resume":
            state.paused = false;
            break;
          case "skip":
            state.current = state.tracks.shift() ?? null;
            state.position = 0;
            break;
          case "stop":
            state.current = null;
            state.tracks = [];
            state.paused = false;
            state.position = 0;
            break;
          case "shuffle":
            state.tracks = state.tracks
              .map((t) => ({ t, r: Math.random() }))
              .sort((a, b) => a.r - b.r)
              .map(({ t }) => t);
            break;
          case "repeat":
            state.repeat = input.repeat ?? "off";
            break;
          case "volume":
            state.volume = input.volume ?? 65;
            break;
          case "remove":
            state.tracks = state.tracks.filter((t) => t.id !== input.trackId);
            break;
          case "seek":
            if (!state.current)
              throw new HttpError(400, "Nothing is playing right now.");
            if (!input.position)
              throw new HttpError(400, "Choose a position in seconds.");
            state.position = Math.min(
              input.position * 1000,
              state.current.duration > 0
                ? state.current.duration - 1000
                : input.position * 1000
            );
            break;
          case "play": {
            if (!input.query) throw new HttpError(400, "Enter a track title");
            assertMusicQueueAdmission(
              state,
              actor.id,
              1,
              g.config.music.maxQueue,
              g.config.music.maxPerMember ?? 0
            );
            const t = {
              id: randomUUID(),
              title: input.query,
              author: "Demo request · no audio playback",
              duration: 180000,
              uri: "",
              requestedBy: actor.name,
              requestedById: actor.id,
            };
            if (!state.current) state.current = t;
            else state.tracks.push(t);
            break;
          }
        }
        state.updatedAt = new Date().toISOString();
        await putMusicState(guildId, state);
      } else {
        const job = await enqueueAction(
          guildId,
          actor.id,
          "music",
          input,
          randomUUID()
        );
        await audit(
          guildId,
          actor,
          "updated",
          "Music request",
          `Accepted ${input.action} for the bot; execution/playback is not yet confirmed.`
        );
        return NextResponse.json(
          { accepted: true, demo: false, jobId: job.id },
          { status: 202 }
        );
      }
      await audit(
        guildId,
        actor,
        "updated",
        "Music queue",
        `Music action: ${input.action}`
      );
      return NextResponse.json({ ok: true, demo: isDemo() });
    }
    if (path[2] === "game-search" && req.method === "GET") {
      const q = new URL(req.url).searchParams.get("q") ?? "";
      if (isDemo())
        return NextResponse.json(
          [
            "Stardew Valley",
            "Hollow Knight",
            "Hades II",
            "Baldur’s Gate 3",
            "Celeste",
          ]
            .filter((t) => t.toLowerCase().includes(q.toLowerCase()))
            .map((title, i) => ({
              id: `00000000-0000-4000-8000-00000000000${i}`,
              title,
            }))
        );
      return NextResponse.json(await searchGames(q));
    }
    throw new HttpError(404, "Endpoint not found");
  } catch (error) {
    const status =
      error instanceof HttpError ||
      error instanceof BotActionUnavailableError ||
      error instanceof CommunityConflict
        ? error.status
        : // A provider outage is reported as a bad gateway, never as a bad
          // request, so the dashboard can tell "fix your setup" from "retry".
          error instanceof UpstreamError
          ? 502
          : error instanceof ZodError
            ? 422
            : 400;
    const message =
      error instanceof ZodError
        ? error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")
        : error instanceof Error
          ? error.message
          : "Something went wrong";
    const retryAfterSeconds = (() => {
      if (error instanceof HttpError) return error.retryAfterSeconds;
      if (!(error instanceof UpstreamError) || !error.retryAfterMs)
        return undefined;
      return Math.max(1, Math.ceil(error.retryAfterMs / 1000));
    })();
    return NextResponse.json(
      { error: message, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) },
      {
        status,
        ...(retryAfterSeconds
          ? { headers: { "Retry-After": String(retryAfterSeconds) } }
          : {}),
      }
    );
  }
}
async function privateHandle(req: Request, context: Context) {
  const response = await handle(req, context);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const GET = privateHandle;
export const POST = privateHandle;
export const PATCH = privateHandle;
export const DELETE = privateHandle;
