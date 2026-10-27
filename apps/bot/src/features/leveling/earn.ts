import {
  PermissionFlagsBits,
  type Client,
  type Guild,
  type Message,
  type VoiceState,
} from "discord.js";
import { fingerprint } from "@orbit/core/safety";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import {
  cappedIntervals,
  cooldownElapsed,
  defaultVoiceEligibility,
  messageEarns,
  normalizeForFingerprint,
  rollAward,
  voiceChannelCounts,
  voiceIntervalAwards,
  voiceMemberEligible,
  type VoicePresence,
} from "@orbit/core/leveling";
import { getGuild } from "@orbit/db";
import type { GuildConfig } from "@orbit/core";
import {
  awardXp,
  closeVoiceSession,
  getXpTotal,
  listVoiceSessions,
  markVoiceInterval,
  openVoiceSession,
  type XpAwardResult,
} from "@orbit/db";

/**
 * Turning activity into XP.
 *
 * The rules live in `@orbit/core/leveling` and are tested without Discord.
 * This file is the part that knows about gateway events: it decides whether an
 * event is worth an award at all, builds an idempotency key, and hands the
 * decision to the storage layer — which is what actually guarantees the award
 * happens once.
 */

/**
 * Shortest message that counts.
 *
 * Below this, "participation" is a single emoji or a reaction-as-message, and
 * counting it makes the leaderboard measure keystrokes.
 */
/** How often the voice ticker runs. The award interval is per-guild config. */
export const VOICE_TICK_MS = 30_000;

type XpSettings = GuildConfig["xp"];

async function settingsFor(guildId: string): Promise<XpSettings | null> {
  const stored = await getGuild(guildId);
  if (!stored) return null;
  if (!stored.config.modules.xp) return null;
  return stored.config.xp;
}

/**
 * Whether a message is worth an award, before any XP is involved.
 *
 * Every branch here is a reason to do nothing, and each one returns rather
 * than throwing: a message that should not earn is not an error.
 */
/**
 * Award XP for a message.
 *
 * The idempotency key is the message id, so an edit — which fires
 * MessageUpdate, not MessageCreate — cannot earn twice, and a redelivered
 * event collides and loses.
 *
 * Deletion does not claw the XP back. Reversing an award would make a member's
 * level oscillate on someone else's delete, and would let a member farm and
 * then scrub their way to a clean history. The award stands; nobody can spend
 * it anyway.
 */
export async function awardMessageXp(message: Message): Promise<void> {
  try {
    if (!message.guildId || message.author.system) return;
    const settings = await settingsFor(message.guildId);
    if (!settings?.messageEnabled) return;
    const member =
      message.member ??
      (await message.guild?.members.fetch(message.author.id).catch(() => null));
    if (!member) return;

    const eligible = messageEarns(
      {
        bot: message.author.bot,
        webhook: !!message.webhookId,
        channelId: message.channelId,
        content: message.content ?? "",
        roleIds: [...member.roles.cache.keys()],
      },
      settings
    );
    // A message that should not earn is not an error; it is simply nothing.
    if (!eligible.earns) return;

    const current = await getXpTotal(message.guildId, message.author.id);
    if (
      !cooldownElapsed(current.lastMessageAt, settings.messageCooldownSeconds)
    )
      return;

    const hash = fingerprint(
      message.guildId,
      "xp-message",
      normalizeForFingerprint(message.content ?? "")
    );
    // Same message twice in a row earns once. Only the hash is kept, so the
    // database never learns what anyone said.
    if (hash === current.lastMessageHash) return;

    const amount = rollAward(settings.messageMin, settings.messageMax);
    await awardXp(message.guildId, message.author.id, {
      key: `message:${message.id}`,
      kind: "message",
      amount,
      fingerprint: hash,
    });
  } catch (error) {
    logger.warn(
      { guildId: message.guildId, error: errorDiagnostic(error) },
      "Message XP could not be awarded"
    );
  }
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

function presenceOf(state: VoiceState): VoicePresence {
  return {
    userId: state.id,
    bot: state.member?.user.bot ?? false,
    mute: state.mute ?? false,
    deaf: state.deaf ?? false,
    selfMute: state.selfMute ?? false,
    selfDeaf: state.selfDeaf ?? false,
  };
}

/**
 * Reconcile stored sessions with what the gateway says.
 *
 * Join, leave, move and reconnect all arrive here. A move is a leave and a
 * join, which is what makes "in one channel for the whole interval" a
 * meaningful question.
 */
export async function noteVoiceState(
  before: VoiceState,
  after: VoiceState
): Promise<void> {
  try {
    const guildId = after.guild.id;
    const settings = await settingsFor(guildId);
    if (!settings?.voiceEnabled) return;
    const from = before.channelId;
    const to = after.channelId;
    if (from === to) return;
    if (from) await closeVoiceSession(guildId, after.id);
    if (to) await openVoiceSession(guildId, after.id, to);
  } catch (error) {
    logger.warn(
      { guildId: after.guild.id, error: errorDiagnostic(error) },
      "Voice session could not be updated"
    );
  }
}

/**
 * Break every open session, because nothing that happened while the process
 * was down can be vouched for.
 *
 * This is the restart rule. Without it the bot would wake up, see a session
 * that started six hours ago, and happily pay out for time nobody observed —
 * crediting offline hours. Marking sessions broken means the next award waits
 * for a whole interval that was actually watched.
 */
export async function breakSessionsAfterRestart(
  client: Client
): Promise<number> {
  let broken = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      const sessions = await listVoiceSessions(guild.id);
      for (const session of sessions) {
        await markVoiceInterval(guild.id, session.userId, {
          intervalStart: new Date(),
          broken: true,
        });
        broken += 1;
      }
    } catch (error) {
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Voice sessions could not be broken after restart"
      );
    }
  }
  return broken;
}

/**
 * One tick: pay every member owed a whole, eligible interval.
 *
 * The award key is derived from the session's own start and interval length
 * rather than from "now", so a restart or a duplicate tick cannot invent a new
 * key for the same interval and pay twice.
 */
export async function tickVoiceXp(client: Client): Promise<number> {
  let awarded = 0;
  for (const guild of client.guilds.cache.values()) {
    try {
      awarded += await tickGuild(guild);
    } catch (error) {
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Voice XP tick failed"
      );
    }
  }
  return awarded;
}

async function tickGuild(guild: Guild): Promise<number> {
  const settings = await settingsFor(guild.id);
  if (!settings?.voiceEnabled) return 0;
  const intervalMs = settings.voiceIntervalSeconds * 1000;
  const now = Date.now();
  let awarded = 0;

  const sessions = await listVoiceSessions(guild.id);
  for (const session of sessions) {
    const start = new Date(session.startedAt).getTime();
    const paid = session.intervalsAwarded;
    // The interval currently being considered began one interval after the
    // last one paid, or at the session start for the first.
    const intervalStart = new Date(
      session.lastIntervalAt
        ? new Date(session.lastIntervalAt).getTime() + intervalMs
        : start
    );
    const intervalEnd = intervalStart.getTime() + intervalMs;
    if (now < intervalEnd) continue;

    const state = guild.voiceStates.cache.get(session.userId);
    const live = state?.channelId;
    // Gone, or moved: the session no longer describes reality.
    if (!live || live !== session.channelId) {
      if (!live) await closeVoiceSession(guild.id, session.userId);
      else await openVoiceSession(guild.id, session.userId, live);
      continue;
    }

    if (!voiceChannelCounts(live, guild.afkChannelId)) {
      // In the AFK channel: never earns, but the session stays open so that
      // moving back to a real channel resumes cleanly.
      await markVoiceInterval(guild.id, session.userId, {
        intervalStart,
        broken: true,
      });
      continue;
    }

    const everyone = [...guild.voiceStates.cache.values()]
      .filter((s) => s.channelId === live)
      .map(presenceOf);
    const eligibility = voiceMemberEligible(
      presenceOf(state!),
      everyone,
      defaultVoiceEligibility
    );

    const whole = voiceIntervalAwards({
      presentWholeInterval: true,
      stableChannel: live === session.channelId,
      eligibleThroughout: eligibility.eligible && !session.brokenAt,
    });

    if (!whole) {
      await markVoiceInterval(guild.id, session.userId, {
        intervalStart,
        broken: true,
      });
      continue;
    }

    const cap = cappedIntervals(
      paid,
      settings.voiceSessionCapMinutes,
      settings.voiceIntervalSeconds
    );
    if (!cap.awarded) {
      // Session cap reached. The interval is still recorded so the window
      // advances and the member is not silently stuck at the same one.
      await markVoiceInterval(guild.id, session.userId, {
        intervalStart,
        broken: true,
      });
      continue;
    }

    const amount = rollAward(settings.voiceMin, settings.voiceMax);
    const result: XpAwardResult = await awardXp(guild.id, session.userId, {
      key: `voice:${session.channelId}:${intervalStart.toISOString()}`,
      kind: "voice",
      amount,
    });
    // Marked paid either way: a duplicate key means it was already paid, and
    // leaving the window where it is would retry forever.
    await markVoiceInterval(guild.id, session.userId, {
      intervalStart,
      broken: false,
    });
    if (result.applied) awarded += 1;
  }
  return awarded;
}

/**
 * Whether Orbit could actually deliver a reward role here.
 *
 * Checked before a reward is offered, so the dashboard does not promise
 * something the bot cannot do. Reused from the member role editor's rules.
 */
export function canManageRewardRoles(guild: Guild): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return me.permissions.has(PermissionFlagsBits.ManageRoles);
}
