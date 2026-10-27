import {
  ChannelType,
  OverwriteType,
  PermissionFlagsBits,
  type CategoryChannel,
  type Guild,
  type GuildMember,
  type TextChannel,
} from "discord.js";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import {
  OPENER_ALLOW,
  SUPPORT_ALLOW,
  ticketChannelName,
  type TicketConfig,
} from "@orbit/core/tickets";

/**
 * Creating and tearing down ticket channels.
 *
 * This is the most permission-sensitive thing the bot does: it creates
 * channels and writes overwrites. Two rules hold throughout.
 *
 * 1. **Every Discord call that can fail is caught and reported, not thrown.**
 *    A member asking for help must get a sentence explaining what happened,
 *    not a stack trace and silence.
 * 2. **The bot checks what it can do before it starts, and stays honest if it
 *    loses the permission partway through.** A ticket row can exist with no
 *    channel; that is a defined state, not a broken one.
 */

export type ChannelResult =
  | { ok: true; channel: TextChannel }
  | {
      ok: false;
      reason: string;
      /** True when the bot's permissions are at fault. */ permission: boolean;
    };

const permissionFlags = (names: readonly string[]) =>
  names
    .map(
      (name) => (PermissionFlagsBits as unknown as Record<string, bigint>)[name]
    )
    .filter((bit): bit is bigint => typeof bit === "bigint")
    .reduce((acc, bit) => acc | bit, 0n);

/**
 * What the bot needs before it can open a ticket at all.
 *
 * Checked up front so a member is told "Orbit cannot do that here" instead of
 * watching a half-made channel appear and then fail.
 */
export function missingChannelPermissions(guild: Guild): {
  manageChannels: boolean;
  viewAndSend: boolean;
} {
  const me = guild.members.me;
  const bits = me?.permissions;
  return {
    manageChannels: !bits?.has(PermissionFlagsBits.ManageChannels),
    viewAndSend: !(
      bits?.has(PermissionFlagsBits.ViewChannel) &&
      bits?.has(PermissionFlagsBits.SendMessages)
    ),
  };
}

/**
 * Create the channel for a ticket, with overwrites that make it private to the
 * opener and the support roles.
 *
 * `@everyone` is denied ViewChannel first, then the opener, the support roles
 * and the bot are allowed. Order matters only in that the deny is explicit —
 * without it a category that grants ViewChannel would leave the ticket public.
 */
export async function createTicketChannel(
  guild: Guild,
  config: TicketConfig,
  input: { number: number; subject: string | null; openerId: string }
): Promise<ChannelResult> {
  const missing = missingChannelPermissions(guild);
  if (missing.manageChannels)
    return {
      ok: false,
      permission: true,
      reason:
        "Orbit needs the **Manage Channels** permission to open a ticket here.",
    };
  if (missing.viewAndSend)
    return {
      ok: false,
      permission: true,
      reason:
        "Orbit needs to be able to **view and send messages** in the ticket it creates.",
    };

  let parent: CategoryChannel | null = null;
  if (config.categoryId) {
    const fetched = await guild.channels
      .fetch(config.categoryId)
      .catch(() => null);
    if (fetched?.type === ChannelType.GuildCategory) parent = fetched;
    else
      logger.warn(
        { guildId: guild.id, categoryId: config.categoryId },
        "Configured ticket category is gone or not a category; creating beside the panel instead"
      );
  }

  const supportIds = config.supportRoleIds.length
    ? config.supportRoleIds
    : // With no support roles configured, the server's Manage Server holders
      // are the staff. They keep their access through that permission, so the
      // overwrites only need to keep everyone else out.
      [];

  try {
    const channel = await guild.channels.create({
      name: ticketChannelName(input.number, input.subject),
      type: ChannelType.GuildText,
      parent: parent?.id ?? null,
      topic: `Ticket #${input.number} · opened by <@${input.openerId}>`,
      permissionOverwrites: [
        // Deny first. A category that grants ViewChannel would otherwise make
        // every ticket public, which is the worst possible default.
        {
          id: guild.id,
          type: OverwriteType.Role,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: input.openerId,
          type: OverwriteType.Member,
          allow: permissionFlags(OPENER_ALLOW),
        },
        ...supportIds.map((id) => ({
          id,
          type: OverwriteType.Role,
          allow: permissionFlags(SUPPORT_ALLOW),
        })),
        // The bot must be able to see its own channel: staff overwrites are
        // not guaranteed to include it.
        {
          id: guild.members.me?.id ?? guild.client.user!.id,
          type: OverwriteType.Member,
          allow: permissionFlags([
            "ViewChannel",
            "SendMessages",
            "ReadMessageHistory",
            "ManageChannels",
            "AttachFiles",
            "EmbedLinks",
          ]),
        },
      ],
      reason: `Ticket #${input.number} opened by ${input.openerId}`,
    });
    return { ok: true, channel: channel as TextChannel };
  } catch (error) {
    const reason = errorDiagnostic(error);
    logger.warn(
      { guildId: guild.id, openerId: input.openerId, error: reason },
      "Ticket channel could not be created"
    );
    return {
      ok: false,
      permission: /permission/i.test(reason),
      reason: `Orbit could not create the ticket channel: ${reason}`,
    };
  }
}

/**
 * Read a ticket's messages into transcript lines.
 *
 * Bounded, and tolerant of the channel being gone: a transcript is best
 * effort. Failing to build one must never block closing, because closing is
 * what stops the channel existing.
 */
export async function collectTranscriptLines(
  channel: TextChannel,
  limit = 500
): Promise<
  {
    authorId: string;
    authorName: string;
    sentAt: string;
    content: string;
    attachmentNames: string[];
    system: boolean;
  }[]
> {
  try {
    const messages = await channel.messages.fetch({ limit });
    return [...messages.values()]
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
      .map((message) => ({
        authorId: message.author.id,
        authorName:
          message.author.globalName ?? message.author.username ?? "Unknown",
        sentAt: message.createdAt.toISOString(),
        // Attachments are named, never fetched or retained.
        content: message.content || "",
        attachmentNames: [...message.attachments.values()].map(
          (a) => a.name ?? "attachment"
        ),
        system: message.author.bot || message.system === true,
      }));
  } catch (error) {
    logger.warn(
      { channelId: channel.id, error: errorDiagnostic(error) },
      "Transcript could not be read; closing without one"
    );
    return [];
  }
}

/**
 * Delete a ticket's channel.
 *
 * A missing channel is a success: the wanted end state is already true.
 */
export async function deleteTicketChannel(
  channel: TextChannel
): Promise<{ ok: boolean; reason?: string }> {
  try {
    await channel.delete();
    return { ok: true };
  } catch (error) {
    const reason = errorDiagnostic(error);
    // Already deleted is the outcome we wanted.
    if (/unknown channel|not found/i.test(reason)) return { ok: true };
    logger.warn(
      { channelId: channel.id, error: reason },
      "Ticket channel could not be deleted"
    );
    return { ok: false, reason };
  }
}

/** Whether a member can be resolved in this guild, for support checks. */
export async function fetchMember(
  guild: Guild,
  userId: string
): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch {
    return null;
  }
}
