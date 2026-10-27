import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type TextChannel,
} from "discord.js";
import { safeText } from "@orbit/core";
import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import {
  isSupport,
  mayAct,
  mayOpen,
  renderTranscript,
  type TicketConfig,
} from "@orbit/core/tickets";
import type { TicketRow } from "@orbit/db";
import {
  closeTicket,
  countOpenForMember,
  getTicketByChannel,
  openTicket,
  reopenTicket,
  claimTicket,
  setTicketChannel,
  touchTicket,
} from "@orbit/db";
import { audit } from "@orbit/db";
import type { CommandContext } from "./context";
import {
  collectTranscriptLines,
  createTicketChannel,
  deleteTicketChannel,
} from "../features/tickets/service";

/**
 * `/ticket`.
 *
 * Every path checks authorization server-side against live guild state, the
 * same way the rest of the bot does: the command's own subcommand permissions
 * are a hint to the client and nothing more.
 *
 * The flow is deliberately tolerant of a half-finished state. A ticket row can
 * exist without a channel, and a channel can exist without a row; both are
 * handled rather than assumed away.
 */

const requiresGuild = (context: CommandContext) => {
  const guild = context.guild;
  if (!guild) throw new Error("Tickets only work in a server.");
  return guild;
};

/** Resolve the ticket the actor means: from this channel, or from the flag. */
async function resolveTarget(context: CommandContext) {
  const guild = requiresGuild(context);
  // A command run inside a ticket channel means *that* ticket. That is the
  // common case by a wide margin, so it is tried first.
  const here = await getTicketByChannel(guild.id, context.i.channelId ?? "");
  if (here) return here;
  return null;
}

export async function ticketsCommand(context: CommandContext) {
  const { i, member, config } = context;
  const sub = i.options.getSubcommand();
  const settings: TicketConfig = config.tickets;
  const guildObj = requiresGuild(context);

  if (!config.modules.tickets && sub !== "info")
    throw new Error("Tickets are paused on this server.");

  if (sub === "open") {
    const subject = i.options.getString("subject");
    const decision = mayOpen({
      openCount: await countOpenForMember(guildObj.id, i.user.id),
      config: settings,
      moduleEnabled: config.modules.tickets,
    });
    if (!decision.ok) throw new Error(decision.reason);
    if (decision.needsSubject && !subject)
      throw new Error(
        "Describe what you need, e.g. `/ticket open subject: Billing problem`."
      );

    const record = await openTicket({
      guildId: guildObj.id,
      openerId: i.user.id,
      subject,
    });

    const created = await createTicketChannel(guildObj, settings, {
      number: record.number,
      subject: record.subject,
      openerId: i.user.id,
    });

    if (!created.ok) {
      // The row exists but no channel does. Reported honestly rather than
      // cleaned up silently: an operator can find it and finish the job, and
      // the member knows to tell someone.
      await context.reply({
        title: created.permission
          ? "Orbit cannot open that here"
          : "The channel could not be created",
        description: created.reason,
        tone: "error",
        footer: `Ticket #${record.number} was recorded without a channel.`,
      });
      return;
    }
    await setTicketChannel(guildObj.id, record.id, created.channel.id);

    if (settings.welcomeMessage) {
      await created.channel
        .send({ content: safeText(settings.welcomeMessage, 1000) })
        .catch(() => undefined);
    }

    await audit(
      guildObj.id,
      { id: i.user.id, name: i.user.username, avatar: i.user.avatar },
      "ticket.open",
      record.id,
      `Opened ticket #${record.number} in <#${created.channel.id}>${
        record.subject ? ` — ${record.subject}` : ""
      }`
    );

    await context.reply({
      title: `Ticket #${record.number}`,
      description: `It is ready: <#${created.channel.id}>. Someone will be with you shortly.`,
      tone: "success",
    });
    return;
  }

  const ticket = await resolveTarget(context);
  if (!ticket && sub !== "info")
    throw new Error(
      "Run this inside a ticket channel, or open one with `/ticket open`."
    );

  const roles = [...member.roles.cache.keys()];
  const staff = isSupport(settings, {
    memberRoleIds: roles,
    canManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
  });

  if (sub === "info") {
    if (!ticket) {
      const open = await countOpenForMember(guildObj.id, i.user.id);
      await context.reply({
        title: "Tickets",
        description: config.modules.tickets
          ? `You have ${open} open ${open === 1 ? "ticket" : "tickets"}. Use \`/ticket open\` to start one.`
          : "Tickets are paused on this server.",
        tone: "info",
      });
      return;
    }
    await context.reply({
      title: `Ticket #${ticket.number}`,
      description: [
        ticket.subject ? `**Subject:** ${ticket.subject}` : null,
        `**State:** ${ticket.state}`,
        `**Opened by:** <@${ticket.openerId}>`,
        ticket.claimerId ? `**Handled by:** <@${ticket.claimerId}>` : null,
        ticket.channelId ? `**Channel:** <#${ticket.channelId}>` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      tone: "info",
    });
    return;
  }

  const allowed = mayAct(ticket!, {
    actorId: i.user.id,
    canManageGuild: member.permissions.has(PermissionFlagsBits.ManageGuild),
    isSupportMember: staff,
  });

  if (sub === "claim") {
    if (!allowed.claim)
      throw new Error(
        allowed.reason ??
          (ticket!.claimerId
            ? "Someone has already claimed this ticket."
            : "Only support staff can claim a ticket.")
      );
    const claimed = await claimTicket(guildObj.id, ticket!.id, i.user.id);
    if (!claimed) throw new Error("This ticket was claimed a moment ago.");
    if (ticket!.channelId) {
      const channel = await guildObj.channels
        .fetch(ticket!.channelId)
        .catch(() => null);
      if (channel?.isTextBased() && "send" in channel)
        await (channel as TextChannel)
          .send({
            content: `<@${i.user.id}> is on it.`,
            allowedMentions: { parse: [] },
          })
          .catch(() => undefined);
    }
    await context.reply({
      description: "Claimed. It is yours.",
      tone: "success",
    });
    return;
  }

  if (sub === "close") {
    if (!allowed.close)
      throw new Error(allowed.reason ?? "You cannot close this ticket.");
    await close(
      i.client,
      guildObj.id,
      ticket!,
      i.user.id,
      i.options.getString("reason"),
      settings,
      {
        id: i.user.id,
        name: i.user.username,
        avatar: i.user.avatar,
      }
    );
    await context.reply({
      description: `Ticket #${ticket!.number} is closed.`,
      tone: "success",
    });
    return;
  }

  if (sub === "reopen") {
    if (!allowed.reopen)
      throw new Error(
        allowed.reason ?? "Only support staff can reopen a ticket."
      );
    const reopened = await reopenTicket(guildObj.id, ticket!.id);
    if (!reopened) throw new Error("This ticket is already open.");
    await audit(
      guildObj.id,
      { id: i.user.id, name: i.user.username, avatar: i.user.avatar },
      "ticket.reopen",
      ticket!.id,
      `Reopened ticket #${ticket!.number}`
    );
    await context.reply({ description: "Reopened.", tone: "success" });
    return;
  }
}

/** Close a ticket: transcript, audit, then the channel. */
async function close(
  client: Client,
  guildId: string,
  ticket: TicketRow,
  closerId: string,
  reason: string | null,
  settings: TicketConfig,
  actor: { id: string; name: string; avatar: string | null }
) {
  let transcript: string | null = null;
  let truncated = false;

  if (ticket.channelId) {
    // Read first, delete second: once the channel is gone there is nothing
    // left to read, and Discord's retention of a deleted channel is not
    // something to depend on for a support record.
    const lines = await readTranscriptLines(client, ticket.channelId!);
    if (lines) {
      const rendered = renderTranscript(
        {
          number: ticket.number,
          subject: ticket.subject,
          openedAt: ticket.openedAt,
          closedAt: new Date().toISOString(),
        },
        lines
      );
      transcript = rendered.text;
      truncated = rendered.truncated;
    }
  }

  await closeTicket(guildId, ticket.id, {
    closerId,
    reason,
    transcript,
    truncated,
  });

  await audit(
    guildId,
    actor,
    "ticket.close",
    ticket.id,
    `Closed ticket #${ticket.number}${reason ? ` — ${reason}` : ""}`
  );

  if (ticket.channelId && !settings.keepChannelOnClose) {
    const channel = await deleteChannelById(client, ticket.channelId!);
    void channel;
  }
}

async function readTranscriptLines(client: Client, channelId: string) {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) return null;
    return await collectTranscriptLines(channel as TextChannel);
  } catch (error) {
    logger.warn(
      { channelId, error: errorDiagnostic(error) },
      "Transcript could not be collected"
    );
    return null;
  }
}

async function deleteChannelById(client: Client, channelId: string) {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.type !== ChannelType.GuildText) return false;
    return (await deleteTicketChannel(channel as TextChannel)).ok;
  } catch (error) {
    logger.warn(
      { channelId, error: errorDiagnostic(error) },
      "Ticket channel could not be deleted"
    );
    return false;
  }
}

/** Any message in a ticket resets the auto-close clock. */
export async function noteTicketActivity(
  guildId: string,
  channelId: string
): Promise<void> {
  const ticket = await getTicketByChannel(guildId, channelId);
  if (!ticket || ticket.state === "closed") return;
  await touchTicket(guildId, ticket.id);
}
