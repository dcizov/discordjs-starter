import { eq, and, sql } from "drizzle-orm";
import { authorize, HttpError } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import { assertOrigin, body, rateLimit } from "@/lib/security";
import type { ResourceKind } from "@orbit/core";
import {
  encrypt,
  inviteUrl,
  isDemo,
  required,
  resourceSchemas,
  snowflake,
} from "@orbit/core";
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
import { diagnosticText } from "@orbit/core/diagnostics";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { pollSource, searchGames } from "@orbit/core/feeds";
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
    const actor = { id: auth.user.id, name: auth.user.name };
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
      return NextResponse.json(await loadDashboard(guildId, auth));
    if (path[2] === "history" && req.method === "GET") {
      const u = new URL(req.url);
      const kind = z
        .enum(["audit", "ledger", "deliveries", "cases"])
        .parse(u.searchParams.get("kind"));
      const page = z.coerce
        .number()
        .int()
        .min(1)
        .max(100000)
        .parse(u.searchParams.get("page") ?? 1);
      const pageSize = z.coerce
        .number()
        .int()
        .min(1)
        .max(50)
        .parse(u.searchParams.get("pageSize") ?? 7);
      const query = z
        .string()
        .max(100)
        .parse(u.searchParams.get("query") ?? "");
      const filter = z
        .string()
        .max(30)
        .parse(u.searchParams.get("filter") ?? "all");
      return NextResponse.json(
        await queryHistory(guildId, kind, { page, pageSize, query, filter })
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
        const items = isDemo()
          ? [
              {
                title: "Your source is ready for a test flight",
                summary:
                  "This is a simulated preview. No external source was fetched and nothing was sent to Discord.",
                url: "",
                id: "demo-test",
              },
            ]
          : await pollSource(resource);
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
          items: items.slice(0, 3),
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
          ]),
          query: z.string().min(2).max(200).optional(),
          volume: z.number().int().min(0).max(100).optional(),
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
          case "play": {
            if (!input.query) throw new HttpError(400, "Enter a track title");
            if (state.tracks.length >= g.config.music.maxQueue)
              throw new HttpError(400, "Queue limit reached");
            const t = {
              id: randomUUID(),
              title: input.query,
              author: "Demo request · no audio playback",
              duration: 180000,
              uri: "",
              requestedBy: actor.name,
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
      error instanceof HttpError || error instanceof BotActionUnavailableError
        ? error.status
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
    const retryAfterSeconds =
      error instanceof HttpError ? error.retryAfterSeconds : undefined;
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
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
