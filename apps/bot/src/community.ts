import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { fingerprint, isDemo } from "@orbit/core";
import {
  communityInputSchema,
  CommunityConflict,
  communityModule,
  assertCommunityVersion,
  COMMUNITY_GRACE_MS,
  COMMUNITY_REQUEST_MAX_AGE_MS,
  type CommunityPost,
  type CommunityResult,
} from "@orbit/core/community";
import {
  getGuild,
  getCommunityPost,
  claimCommunityPost,
  finishCommunityPost,
  recordCommunityResult,
  rejectCommunityPost,
} from "@orbit/db";
import {
  ChannelType,
  PermissionFlagsBits,
  Routes,
  PollLayoutType,
  RateLimitError,
  REST,
  type Client,
  type APIMessage,
  type APIPoll,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord.js";

/** Do not let the SDK silently requeue a message create on a 429 or pre-emptive throttle. */
export function createCommunityRest(token: string) {
  return new REST({
    version: "10",
    timeout: 15_000,
    retries: 0,
    rejectOnRateLimit: () => true,
  }).setToken(token);
}
function assertFreshPublication(input: CommunityExecution) {
  if (
    input.action === "publish" &&
    !input.scheduled &&
    (!Number.isFinite(input.requestedAt) ||
      Date.now() - input.requestedAt! > COMMUNITY_REQUEST_MAX_AGE_MS)
  )
    throw new Error(
      "This publication request expired. Refresh the record and submit a new explicit request."
    );
}
/** Public REST types match discord.js 14.27. No Components V2 or voter-list calls. */
export function communityPayload(
  post: CommunityPost
): RESTPostAPIChannelMessageJSONBody {
  const data = communityInputSchema.parse({
    kind: post.kind,
    title: post.title,
    channelId: post.channelId,
    body: post.body,
    poll: post.poll,
  });
  const base = {
    allowed_mentions: {
      parse: [] as never[],
      users: [] as string[],
      roles: [] as string[],
      replied_user: false,
    },
    nonce: fingerprint(post.guildId, post.id, "community").slice(0, 24),
    enforce_nonce: true,
  };
  if (data.kind === "poll") {
    return {
      ...base,
      poll: {
        question: { text: data.poll.question },
        answers: data.poll.answers.map((text) => ({ poll_media: { text } })),
        duration: data.poll.durationHours,
        allow_multiselect: data.poll.allowMultiselect,
        layout_type: PollLayoutType.Default,
      },
    };
  }
  return {
    ...base,
    embeds: [
      {
        title: data.title,
        description: data.body,
        color: 0x8b5cf6,
        footer: { text: "Community announcement · Orbit" },
      },
    ],
  };
}
/** Discord omits results in some responses. Missing is UNKNOWN, not zero. */
export function communityPollResult(
  poll: APIPoll,
  now = Date.now()
): CommunityResult {
  return {
    checkedAt: new Date(now).toISOString(),
    expiresAt: poll.expiry,
    finalized: poll.results?.is_finalized === true,
    answers: poll.answers.slice(0, 10).map((answer) => ({
      id: answer.answer_id,
      text: answer.poll_media.text ?? "Answer",
      votes: poll.results
        ? (poll.results.answer_counts.find((c) => c.id === answer.answer_id)
            ?.count ?? 0)
        : null,
    })),
  };
}
function publicFailure(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  const code = Number((error as { code?: unknown })?.code);
  if (status === 403)
    return "Discord denied this action. Check current channel overwrites and the feature's bot permissions; no Administrator grant is needed.";
  if (status === 404)
    return "The Discord channel or message no longer exists or is not visible to Orbit.";
  if (status === 400)
    return "Discord rejected the message or poll data. Check the configured content and poll limits.";
  if (error instanceof RateLimitError || status === 429)
    return "Discord rate-limited this action. Inspect the current record before retrying.";
  return `Discord did not confirm the action${Number.isSafeInteger(code) && code > 0 ? ` (code ${code})` : ""}. Inspect the channel and Audit log; do not resend blindly.`;
}
export type CommunityExecution = {
  guildId: string;
  id: string;
  version: number;
  actorId: string;
  action: "publish" | "refresh" | "close";
  scheduled?: boolean;
  requestedAt?: number;
};
async function communityDestination(
  client: Client,
  post: CommunityPost,
  actorId: string,
  action: CommunityExecution["action"]
) {
  const { guildId } = post;
  // Ownership affects member.permissions; refreshing roles alone is insufficient.
  const guild = await client.guilds.fetch({
    guild: guildId,
    force: true,
    withCounts: false,
  });
  await guild.roles.fetch();
  const actor = await guild.members.fetch({ user: actorId, force: true });
  if (!actor.permissions.has(PermissionFlagsBits.ManageGuild))
    throw new CommunityConflict(
      "The requester no longer has Manage Server permission."
    );
  const stored = await getGuild(guildId);
  if (!stored?.installed)
    throw new CommunityConflict("Orbit is no longer installed in this server.");
  if (
    action === "publish" &&
    stored.config.modules[communityModule(post.kind)] !== true
  )
    throw new CommunityConflict(
      "This module is paused; publication was blocked."
    );
  const channel = await guild.channels.fetch(post.channelId, { force: true });
  const me = await guild.members.fetchMe({ force: true });
  const required =
    action === "publish"
      ? [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          post.kind === "poll"
            ? PermissionFlagsBits.SendPolls
            : PermissionFlagsBits.EmbedLinks,
        ]
      : [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
        ];
  if (
    !channel ||
    channel.guild.id !== guildId ||
    channel.type !== ChannelType.GuildText ||
    !channel.permissionsFor(me)?.has(required) ||
    !channel.permissionsFor(actor)?.has(PermissionFlagsBits.ViewChannel)
  ) {
    const message =
      "Choose an ordinary server text channel visible to the manager. Check Orbit's View Channel and Send Messages plus Send Polls (polls), Embed Links (announcements), or Read Message History (poll results/close).";
    throw new CommunityConflict(message);
  }
  return channel;
}
/** The caller provides createCommunityRest. Never automatically replay an ambiguous create. */
export async function executeCommunity(
  client: Client,
  rest: Pick<REST, "post" | "get">,
  input: CommunityExecution
) {
  if (isDemo())
    throw new Error("Live community execution is disabled in demo mode.");
  const { guildId, id, version, actorId, action } = input;
  const post = await getCommunityPost(guildId, id);
  if (!post) throw new Error("Community post not found in this server.");
  assertCommunityVersion(post, version);
  assertFreshPublication(input);
  let channel;
  try {
    channel = await communityDestination(client, post, actorId, action);
  } catch (error) {
    const message =
      error instanceof CommunityConflict
        ? error.message
        : "Preflight could not be completed. No publication attempt was made. Check current manager membership, channel access and Discord availability.";
    if (action === "publish") {
      try {
        await rejectCommunityPost(guildId, id, version, actorId, message);
      } catch (persistenceError) {
        logger.warn(
          { guildId, postId: id, error: errorDiagnostic(persistenceError) },
          "Could not record a rejected publication; no message was sent"
        );
      }
    }
    throw new Error(message);
  }
  if (action !== "publish") {
    if (
      post.kind !== "poll" ||
      !post.messageId ||
      !["published", "closed"].includes(post.state)
    )
      throw new Error(
        "Only published native polls support refresh or early close."
      );
    const route = Routes.channelMessage(channel.id, post.messageId);
    let message: APIMessage;
    try {
      message = (await rest.get(route, {
        signal: AbortSignal.timeout(15_000),
      })) as APIMessage;
      if (message.author.id !== client.user?.id || !message.poll)
        throw new Error("This message is not an Orbit-owned native poll.");
      if (
        action === "close" &&
        (!message.poll.expiry || Date.parse(message.poll.expiry) > Date.now())
      )
        message = (await rest.post(
          Routes.expirePoll(channel.id, post.messageId),
          { signal: AbortSignal.timeout(15_000) }
        )) as APIMessage;
    } catch (error) {
      throw new Error(publicFailure(error));
    }
    if (!message.poll)
      throw new Error("Discord did not return a poll. No result was invented.");
    const result = communityPollResult(message.poll);
    const closed =
      action === "close" ||
      (!!result.expiresAt && Date.parse(result.expiresAt) <= Date.now());
    const updated = await recordCommunityResult(
      guildId,
      id,
      version,
      actorId,
      result,
      closed
    );
    return {
      id: updated.id,
      state: updated.state,
      messageId: updated.messageId,
    };
  }
  // The database rechecks installation/module/revision/state atomically, then commits BEFORE REST.
  const payload = communityPayload(post); // Validate persisted data before claiming, and before any create request.
  assertFreshPublication(input);
  const claimed = await claimCommunityPost(
    guildId,
    id,
    version,
    actorId,
    !!input.scheduled,
    undefined,
    input.scheduled
      ? undefined
      : input.requestedAt! + COMMUNITY_REQUEST_MAX_AGE_MS
  );
  const remaining =
    input.scheduled && claimed.scheduledFor
      ? Date.parse(claimed.scheduledFor) + COMMUNITY_GRACE_MS - Date.now()
      : 15_000;
  let message: APIMessage;
  try {
    message = (await rest.post(Routes.channelMessages(channel.id), {
      body: payload,
      signal: AbortSignal.timeout(Math.max(1, Math.min(15_000, remaining))),
    })) as APIMessage;
    if (!/^\d{17,20}$/.test(message.id))
      throw new Error("No Discord message ID in response");
  } catch (error) {
    const status = Number((error as { status?: unknown })?.status);
    const definitive =
      error instanceof RateLimitError ||
      (status >= 400 && status < 500 && status !== 408);
    const errorText = publicFailure(error);
    await finishCommunityPost(guildId, id, claimed.version, actorId, {
      state: definitive ? "failed" : "unconfirmed",
      error: errorText,
    });
    throw new Error(errorText);
  }
  // A failed DB write here deliberately leaves sending -> maintenance unconfirmed; never resend.
  const updated = await finishCommunityPost(
    guildId,
    id,
    claimed.version,
    actorId,
    {
      state: "published",
      messageId: message.id,
      result: message.poll ? communityPollResult(message.poll) : null,
    }
  );
  return { id: updated.id, state: updated.state, messageId: updated.messageId };
}
