import { previewNewsRouting } from "@orbit/db/src/news-preview";
import { getOwnEconomyHistory } from "@orbit/db";
import { assertMusicQueueAdmission } from "@orbit/core/music-policy";
import { musicSearchProvider } from "@orbit/core/music-sources";
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
import { loadDashboard, withAuditAvatarUrl } from "@/lib/dashboard";
import { toMembersPageWire } from "@/lib/member-wire";
import { feedIdentity } from "@orbit/core/feed-identity";
import { assertOrigin, body, rateLimit } from "@/lib/security";
import type { MembersPageWire, ResourceKind } from "@orbit/core";
import { encrypt, resourceSchemas, snowflake } from "@orbit/core";
import { inviteUrl, isDemo, required } from "@orbit/core/environment";
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
import { diagnosticText } from "@orbit/core/diagnostics";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { pollSourceDetailed, searchGames } from "@orbit/core/feeds";
import { UpstreamError } from "@orbit/core/integration-http";
import { HISTORY_KINDS, parseHistoryQuery } from "@orbit/core/history-query";
import { parseMembersQuery } from "@orbit/core/members-query";
import {
  buildTemplate,
  previewTemplate,
  TEMPLATE_OMISSIONS,
} from "@orbit/core/templates";
import {
  buildBlankTemplate,
  buildFromBlueprint,
  duplicateTemplateDocument,
  validateTemplateDocument,
} from "@orbit/core/template-builder";
import { applyTargetFromSnapshot, assertTargetAllowed } from "@/lib/templates";
import { deleteTemplate } from "@orbit/db";
import { newsCard } from "@orbit/core/news-presentation";
import { createQueue, enqueueAction } from "@orbit/core/queue";
import {
  audit,
  createTemplateRun,
  database,
  deleteResource,
  economyTransaction,
  getDashboardData,
  getGuild,
  queryHistory,
  getResource,
  getActiveTemplateRun,
  getTemplate,
  getTemplateRun,
  updateTemplate,
  listMembers,
  listTemplates,
  putMusicState,
  saveTemplate,
  updateTemplateRun,
  reserveDelivery,
  saveConfig,
  saveResource,
  schema,
  getRosterSync,
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
    if (path[2] === "members") {
      // The roster the bot synchronized, never a guess assembled from accounts.
      if (path.length === 3 && req.method === "GET") {
        // The roster carries avatar *hashes*; the URL is derived here, on the
        // server, so the directory shows the same picture as the leaderboard.
        // `MembersPageWire` requires `avatarUrl`, so forgetting this is a
        // compile error rather than a page full of initials.
        const page: MembersPageWire = toMembersPageWire(
          await listMembers(
            guildId,
            parseMembersQuery(new URL(req.url).searchParams)
          ),
          guildId
        );
        return NextResponse.json(page);
      }
      // Editing one member's roles. `path[3]` is the target's user id.
      if (path.length === 5 && path[4] === "roles" && req.method === "POST") {
        const targetId = z
          .string()
          .regex(/^\d{17,20}$/)
          .parse(path[3]);
        const body = z
          .object({
            mode: z.enum(["offer", "apply"]),
            roleIds: z
              .array(z.string().regex(/^\d{17,20}$/))
              .max(200)
              .optional(),
          })
          .parse(await req.json());
        if (isDemo())
          return NextResponse.json({
            demo: true,
            accepted: false,
            message:
              "Demo mode has no live server to change. Role editing is only offered against a real guild, where the bot's own permissions and hierarchy can be checked.",
            roles: [],
            reason: "Role changes are not available in demo mode.",
          });
        // An apply is deduplicated so a double submit cannot race itself; the
        // change is a set operation, so replaying it changes nothing anyway.
        // An offer is always fresh — it must reflect the hierarchy right now.
        const key =
          body.mode === "apply"
            ? `member-roles-apply-${targetId}-${z
                .uuid()
                .parse(req.headers.get("Idempotency-Key") ?? randomUUID())}`
            : `member-roles-offer-${targetId}-${Date.now()}`;
        const job = await enqueueAction(
          guildId,
          actor.id,
          "member-roles",
          {
            targetId,
            mode: body.mode,
            roleIds: body.roleIds ?? [],
          },
          key
        );
        return NextResponse.json(
          { accepted: true, jobId: job.id, demo: false },
          { status: 202 }
        );
      }
      if (path[3] === "sync" && path.length === 4 && req.method === "POST") {
        if (isDemo())
          return NextResponse.json({
            demo: true,
            message:
              "Demo mode already holds a complete roster; a live sync would ask Discord. Nothing was requested.",
            sync: await getRosterSync(guildId),
          });
        const job = await enqueueAction(
          guildId,
          actor.id,
          "sync-roster",
          {},
          `roster-sync-${Date.now()}`
        );
        return NextResponse.json(
          { accepted: true, jobId: job.id },
          { status: 202 }
        );
      }
      throw new HttpError(404, "Endpoint not found");
    }
    if (path[2] === "templates") {
      // Templates are readable only through the guild they were captured from.
      // `auth.guilds` is the list this user may manage, so an id alone never
      // grants access to another community's blueprint.
      const sources = auth.guilds.filter((g) => g.installed).map((g) => g.id);
      if (path.length === 3 && req.method === "GET")
        return NextResponse.json({
          templates: await listTemplates(sources),
          omissions: TEMPLATE_OMISSIONS,
        });
      if (path.length === 3 && req.method === "POST") {
        const input = z
          .object({
            name: z.string().min(1).max(100),
            description: z.string().max(500).default(""),
            include: z
              .object({
                structure: z.boolean().default(true),
                config: z.boolean().default(true),
              })
              .strict()
              .optional(),
            /**
             * Build from a researched starter instead of capturing. Needs no
             * Discord access, so it is saved directly rather than queued.
             */
            blueprint: z.string().min(1).max(40).optional(),
            /** Create an empty template to build by hand. */
            blankKind: z
              .enum(["structure", "configuration", "both"])
              .optional(),
          })
          .strict()
          .parse(await body(req));
        // A blueprint or a blank needs no Discord access, so it is built and
        // stored here instead of being queued for the bot.
        if (input.blueprint || input.blankKind) {
          const document = input.blueprint
            ? buildFromBlueprint(input.blueprint, {
                name: input.name,
                description: input.description,
              })
            : buildBlankTemplate({
                name: input.name,
                description: input.description,
                kind: input.blankKind!,
              });
          if (!document)
            throw new HttpError(404, "That starter template is not available.");
          const check = validateTemplateDocument(document);
          if (check.issues.some((issue) => issue.severity === "error"))
            throw new HttpError(
              422,
              `This starter cannot be saved: ${check.issues[0]!.message}`
            );
          const created = await saveTemplate({
            sourceGuildId: guildId,
            name: document.name,
            description: document.description,
            createdBy: actor.id,
            document,
          });
          return NextResponse.json(
            { ...created, blueprint: input.blueprint ?? null },
            { status: 201 }
          );
        }
        if (!input.include)
          throw new HttpError(
            400,
            "Choose a starter, a blank template, or what to capture."
          );
        if (!input.include.structure && !input.include.config)
          throw new HttpError(
            400,
            "Choose structure, Orbit configuration, or both."
          );
        const guild = await getGuild(guildId);
        if (!guild) throw new HttpError(409, "This server is still syncing");
        if (isDemo()) {
          // The demo has no Discord session, so the captured document comes from
          // the same demo snapshot the dashboard displays.
          const document = buildTemplate({
            name: input.name,
            description: input.description,
            include: input.include,
            structure: {
              roles: guild.roles.map((role) => ({
                id: role.id,
                name: role.name,
                color: role.color,
                position: role.position,
                permissions: role.permissions,
                managed: role.managed || !!role.assignedToBot,
              })),
              channels: guild.channels.map((channel) => ({
                id: channel.id,
                name: channel.name,
                type: channel.type,
                parentId: null,
                overwrites: [],
              })),
            },
            config: guild.config,
          });
          const saved = await saveTemplate({
            sourceGuildId: guildId,
            name: document.name,
            description: document.description,
            createdBy: actor.id,
            document,
          });
          return NextResponse.json(
            { ...saved, demo: true, note: "Captured from the demo snapshot." },
            { status: 201 }
          );
        }
        // Only the bot can read permission overwrites, so capturing is a job.
        const job = await enqueueAction(
          guildId,
          actor.id,
          "capture-template",
          input,
          `capture-template-${Date.now()}`
        );
        return NextResponse.json(
          { accepted: true, jobId: job.id },
          { status: 202 }
        );
      }
      // Reload/reconnect recovery: the run belongs to the worker, not to the
      // browser tab that started it, so a returning page asks the server what
      // is still in flight rather than trusting anything it kept in memory.
      if (path[3] === "active" && path.length === 4 && req.method === "GET")
        return NextResponse.json({
          run: await getActiveTemplateRun(guildId),
        });
      if (path[3] === "runs" && path[4] && req.method === "GET") {
        const run = await getTemplateRun(path[4]);
        if (!run) throw new HttpError(404, "Apply run not found");
        /**
         * A run belongs to the server the template was applied *to*, which is
         * not always the server whose dashboard is open — a cross-server apply
         * is started from the template's home server and its run lives on the
         * target.
         *
         * So the check is "the caller manages the run's server", not "the run
         * is in this workspace". `auth.guilds` is the Discord-derived list this
         * user administers, so an id alone still grants nothing. A run the user
         * cannot manage is reported as missing rather than forbidden, so the
         * endpoint does not confirm that it exists.
         */
        if (
          run.guildId !== guildId &&
          !auth.guilds.some((g) => g.id === run.guildId)
        )
          throw new HttpError(404, "Apply run not found");
        return NextResponse.json(run);
      }
      const id = path[3] ? z.string().uuid().parse(path[3]) : null;
      if (id) {
        const template = await getTemplate(id, sources);
        if (!template) throw new HttpError(404, "Template not found");
        if (path.length === 4 && req.method === "GET")
          return NextResponse.json(template);

        /**
         * Duplicate. Keys are copied verbatim: they are the template's own
         * addressing scheme, not Discord ids, so they stay valid anywhere.
         */
        if (
          path[4] === "duplicate" &&
          path.length === 5 &&
          req.method === "POST"
        ) {
          const input = z
            .object({ name: z.string().min(1).max(100) })
            .strict()
            .parse(await body(req));
          const document = duplicateTemplateDocument(template.data, {
            name: input.name,
          });
          const check = validateTemplateDocument(document);
          if (check.issues.some((issue) => issue.severity === "error"))
            throw new HttpError(
              409,
              `This template cannot be duplicated: ${check.issues[0]!.message}`
            );
          const copy = await saveTemplate({
            sourceGuildId: template.sourceGuildId,
            name: document.name,
            description: document.description,
            createdBy: actor.id,
            document,
          });
          return NextResponse.json(copy, { status: 201 });
        }

        /**
         * Save an edited document.
         *
         * Validation runs here, not only in the browser: the document is
         * re-parsed against the schema and checked for dangling references, so
         * a hand-crafted request cannot store a template that references a role
         * it does not contain.
         */
        if (path.length === 4 && req.method === "PATCH") {
          const input = z
            .object({
              name: z.string().min(1).max(100).optional(),
              document: z.unknown(),
            })
            .strict()
            .parse(await body(req));
          const check = validateTemplateDocument(input.document);
          const blocking = check.issues.filter(
            (issue) => issue.severity === "error"
          );
          if (blocking.length)
            throw new HttpError(
              422,
              `This template cannot be saved: ${blocking[0]!.message}`
            );
          if (!check.document)
            throw new HttpError(422, "This template document is not valid.");
          const saved = await updateTemplate({
            id,
            name: input.name?.trim() || check.document.name,
            description: check.document.description,
            document: check.document,
          });
          if (!saved) throw new HttpError(404, "Template not found");
          return NextResponse.json(saved);
        }

        if (path[4] === "preview" && req.method === "POST") {
          const { targetGuildId, mapping } = z
            .object({
              targetGuildId: snowflake,
              mapping: z.record(z.string(), z.string()).optional(),
            })
            .strict()
            .parse(await body(req));
          const target = assertTargetAllowed(
            await getGuild(targetGuildId),
            auth.guilds
          );
          return NextResponse.json({
            template: { id: template.id, name: template.name },
            target: { id: target.id, name: target.name },
            plan: previewTemplate({
              template: template.data,
              target: applyTargetFromSnapshot(target),
              mapping,
            }),
          });
        }
        if (path[4] === "apply" && req.method === "POST") {
          const input = z
            .object({
              targetGuildId: snowflake,
              fingerprint: z.string().min(3).max(80),
              mapping: z.record(z.string(), z.string()).optional(),
            })
            .strict()
            .parse(await body(req));
          const target = assertTargetAllowed(
            await getGuild(input.targetGuildId),
            auth.guilds
          );
          const plan = previewTemplate({
            template: template.data,
            target: applyTargetFromSnapshot(target),
            mapping: input.mapping,
          });
          if (plan.blockers.length)
            throw new HttpError(409, plan.blockers[0].message);
          if (plan.fingerprint !== input.fingerprint)
            throw new HttpError(
              409,
              "This server changed since your preview. Preview again before applying."
            );
          if (isDemo()) {
            // Demo mode must not pretend it created Discord resources.
            const run = await createTemplateRun({
              guildId: target.id,
              templateId: template.id,
              actorId: actor.id,
              plan: {
                ...plan,
                sourceGuildId: template.sourceGuildId,
                demo: true,
              },
            });
            await updateTemplateRun(run.id, {
              state: "simulated",
              result: {
                created: [],
                reused: plan.items
                  .filter((item) => item.action === "reuse")
                  .map((item) => ({
                    key: item.key,
                    name: item.name,
                    id: item.targetId,
                  })),
                failed: [],
                configured: [],
                message:
                  "Demo mode: nothing was created in a Discord server. This is the plan that a live apply would execute.",
              },
            });
            // Same shape as the live branch, so the page reads one thing.
            return NextResponse.json(
              { runId: run.id, accepted: true, demo: true },
              { status: 202 }
            );
          }
          const run = await createTemplateRun({
            guildId: target.id,
            templateId: template.id,
            actorId: actor.id,
            plan: { ...plan, sourceGuildId: template.sourceGuildId },
          });
          const job = await enqueueAction(
            target.id,
            actor.id,
            "apply-template",
            {
              templateId: template.id,
              runId: run.id,
              fingerprint: input.fingerprint,
              mapping: input.mapping ?? {},
            },
            `apply-template-${run.id}`
          );
          return NextResponse.json(
            { runId: run.id, jobId: job.id, accepted: true },
            { status: 202 }
          );
        }
        if (path.length === 4 && req.method === "DELETE") {
          if (template.sourceGuildId !== guildId)
            throw new HttpError(
              403,
              "Only the server this template was captured from can delete it."
            );
          await deleteTemplate(template.id, template.sourceGuildId);
          return NextResponse.json({ ok: true });
        }
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
      const result = await queryHistory(guildId, kind, {
        ...params,
        sort: params.sort as never,
      });
      // Audit rows carry the hash that was recorded with the action. The URL is
      // derived here, on the server, from that stored hash — never from the
      // actor's current profile and never with a per-row Discord request. The
      // paged table is built from this response, so this is the only place the
      // historical picture can survive.
      if (kind === "audit")
        return NextResponse.json({
          ...result,
          rows: (
            result.rows as { actorId: string; actorAvatar: string | null }[]
          ).map(withAuditAvatarUrl),
        });
      return NextResponse.json(result);
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
            feedIdentity: feedIdentity(resource),
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
          // Approved provider id only; the bot maps it to a search prefix and
          // re-validates it. Arbitrary Lavalink prefixes/ids are never accepted.
          source: z.string().max(32).optional(),
          volume: z.number().int().min(0).max(100).optional(),
          position: z.number().int().min(1).max(86400).optional(),
          repeat: z.enum(["off", "track", "queue"]).optional(),
          trackId: z.string().max(100).optional(),
        })
        .parse(await body(req));
      if (input.source && !musicSearchProvider(input.source))
        throw new HttpError(
          400,
          "Unknown search provider. Choose SoundCloud, YouTube, YouTube Music or Bandcamp, or leave it to the server default."
        );
      if (input.source && input.action !== "play")
        throw new HttpError(
          400,
          "A search provider only applies to the play action."
        );
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
            const provider = input.source
              ? musicSearchProvider(input.source)
              : undefined;
            const t = {
              id: randomUUID(),
              title: input.query,
              // The preview has no backend lookup, so it says so instead of
              // implying that a provider searched for anything.
              author: provider
                ? `Demo request · ${provider.label} not searched · no audio playback`
                : "Demo request · no audio playback",
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
