import { ChannelType, type Client, type TextChannel } from "discord.js";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import {
  isOrphaned,
  withinRetention,
  type TicketConfig,
} from "@orbit/core/tickets";
import {
  clearTranscript,
  closeTicket,
  deleteTicket,
  listExpiredTranscripts,
  listGuildsWithTickets,
  listOpenTickets,
  listStaleTickets,
  markTicketOrphaned,
  reopenTicket,
} from "@orbit/db";

/**
 * The ticket sweep.
 *
 * Three jobs, all on the same pass, all idempotent:
 *
 * - **Auto-close** tickets that have gone quiet.
 * - **Orphan cleanup** — open tickets whose channel no longer exists.
 * - **Retention** — drop transcripts that have aged out.
 *
 * Every step tolerates failure in isolation. The sweep runs across every
 * guild, so one server with a deleted category or a revoked permission must
 * not stop the others from being swept.
 */

export type SweepResult = {
  autoClosed: number;
  orphans: number;
  transcriptsCleared: number;
  failures: number;
};

const empty = (): SweepResult => ({
  autoClosed: 0,
  orphans: 0,
  transcriptsCleared: 0,
  failures: 0,
});

/**
 * Whether an open ticket's channel is really gone.
 *
 * `fetch` succeeding but returning null is the normal "deleted" signal. A
 * permission error is *not* proof the channel is gone — it only proves the bot
 * cannot see it — so it is treated as "still there" to avoid deleting a live
 * ticket's record.
 */
async function channelIsGone(
  client: Client,
  channelId: string
): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId);
    return !channel;
  } catch (error) {
    logger.warn(
      { channelId, error: errorDiagnostic(error) },
      "Could not confirm whether a ticket channel exists; leaving its record alone"
    );
    return false;
  }
}

export async function sweepTickets(client: Client): Promise<SweepResult> {
  const result = empty();
  const guilds = await listGuildsWithTickets().catch((error) => {
    logger.warn(
      { error: errorDiagnostic(error) },
      "Ticket sweep could not list guilds"
    );
    return [] as string[];
  });

  for (const guildId of guilds) {
    try {
      const config = await ticketConfigFor(guildId);
      if (!config || !config.enabled) continue;

      // 1. Auto-close quiet tickets.
      if (config.autoCloseHours > 0) {
        const cutoff = new Date(Date.now() - config.autoCloseHours * 3600_000);
        for (const ticket of await listStaleTickets(cutoff)) {
          if (ticket.guildId !== guildId) continue;
          const closed = await closeWithTranscript(
            client,
            guildId,
            ticket,
            config,
            "Closed automatically after no activity."
          );
          if (closed) result.autoClosed += 1;
          else result.failures += 1;
        }
      }

      // 2. Orphans: an open ticket whose channel is gone.
      for (const ticket of await listOpenTickets(guildId)) {
        if (!ticket.channelId) continue;
        const gone = await channelIsGone(client, ticket.channelId);
        if (!gone) continue;
        if (!isOrphaned({ state: ticket.state, channelExists: false }))
          continue;

        // The channel is gone, so whatever was in it is gone too. The record
        // is kept and marked rather than deleted: an operator may still need
        // to know the ticket was ever opened.
        await markTicketOrphaned(guildId, ticket.id);
        result.orphans += 1;
      }

      // 3. Retention.
      if (config.retentionDays >= 0) {
        const cutoff = new Date(Date.now() - config.retentionDays * 86400_000);
        for (const ticket of await listExpiredTranscripts(cutoff)) {
          if (ticket.guildId !== guildId) continue;
          if (
            withinRetention(ticket.closedAt, config.retentionDays, new Date())
          )
            continue;
          await clearTranscript(guildId, ticket.id);
          result.transcriptsCleared += 1;
        }
      }
    } catch (error) {
      // One guild's problem must not stop the rest of the sweep.
      result.failures += 1;
      logger.warn(
        { guildId, error: errorDiagnostic(error) },
        "Ticket sweep failed for one guild"
      );
    }
  }
  return result;
}

/**
 * Close one ticket, capturing its transcript first.
 *
 * Shared with the command path in spirit: read, then close, then delete the
 * channel only once the record is safe.
 */
async function closeWithTranscript(
  client: Client,
  guildId: string,
  ticket: Awaited<ReturnType<typeof listOpenTickets>>[number],
  config: TicketConfig,
  reason: string
): Promise<boolean> {
  let transcript: string | null = null;
  let truncated = false;

  if (ticket.channelId) {
    try {
      const channel = await client.channels.fetch(ticket.channelId);
      if (channel?.type === ChannelType.GuildText) {
        const messages = await (channel as TextChannel).messages.fetch({
          limit: 500,
        });
        const lines = [...messages.values()]
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
          .map((message) => ({
            authorId: message.author.id,
            authorName:
              message.author.globalName ?? message.author.username ?? "Unknown",
            sentAt: message.createdAt.toISOString(),
            content: message.content || "",
            attachmentNames: [...message.attachments.values()].map(
              (a) => a.name ?? "attachment"
            ),
            system: message.author.bot || message.system === true,
          }));
        const rendered = await renderTranscriptFor(
          {
            number: ticket.number,
            subject: ticket.subject,
            openedAt: ticket.openedAt,
          },
          lines
        );
        transcript = rendered.text;
        truncated = rendered.truncated;
      }
    } catch (error) {
      logger.warn(
        { guildId, ticketId: ticket.id, error: errorDiagnostic(error) },
        "Transcript could not be read during the sweep; closing anyway"
      );
    }
  }

  const closed = await closeTicket(guildId, ticket.id, {
    closerId: "auto",
    reason,
    transcript,
    truncated,
  });
  if (!closed) return false;

  if (ticket.channelId && !config.keepChannelOnClose) {
    try {
      const channel = await client.channels.fetch(ticket.channelId);
      if (channel?.type === ChannelType.GuildText) await channel.delete();
    } catch (error) {
      logger.warn(
        { channelId: ticket.channelId, error: errorDiagnostic(error) },
        "Ticket channel could not be deleted during the sweep"
      );
    }
  }
  return true;
}

async function ticketConfigFor(guildId: string) {
  const { getGuild } = await import("@orbit/db");
  const guild = await getGuild(guildId);
  if (!guild) return null;
  if (!guild.config.modules.tickets) return null;
  return guild.config.tickets;
}

async function renderTranscriptFor(
  ticket: { number: number; subject: string | null; openedAt: string },
  lines: Parameters<typeof import("@orbit/core/tickets").renderTranscript>[1]
) {
  const { renderTranscript } = await import("@orbit/core/tickets");
  return renderTranscript(
    { ...ticket, closedAt: new Date().toISOString() },
    lines
  );
}

/**
 * Reopening is deliberately not part of the sweep.
 *
 * A ticket closed by the sweep can be reopened by staff, which is the honest
 * fix; automatically reopening something the sweep just closed would fight the
 * operator.
 */
export { reopenTicket, deleteTicket };
