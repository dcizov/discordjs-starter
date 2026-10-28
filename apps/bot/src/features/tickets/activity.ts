import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { noteTicketActivity as record } from "../../commands/tickets";

/**
 * Any message in a ticket restarts its auto-close clock.
 *
 * Kept in its own module so the gateway does not import a command handler:
 * the gateway needs one small function, and the alternative would pull the
 * whole command surface into the event path.
 */
export async function noteTicketActivity(message: {
  guildId: string | null;
  channelId: string;
}): Promise<void> {
  if (!message.guildId) return;
  try {
    await record(message.guildId, message.channelId);
  } catch (error) {
    // A missed touch only means the clock was not reset. It must never stop
    // the message being handled.
    logger.warn(
      { guildId: message.guildId, error: errorDiagnostic(error) },
      "Ticket activity could not be recorded"
    );
  }
}
