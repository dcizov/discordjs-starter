/**
 * Discord jump links.
 *
 * A message link is only built from three snowflakes the bot actually received
 * back from Discord (guild, channel, message). Anything else returns null, so the
 * dashboard omits the link instead of pointing at a message that may not exist.
 */
const snowflake = /^\d{15,25}$/;

export function discordMessageUrl(
  guildId: string,
  channelId: string,
  messageId?: string | null
) {
  if (!messageId) return null;
  if (
    !snowflake.test(guildId) ||
    !snowflake.test(channelId) ||
    !snowflake.test(messageId)
  )
    return null;
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
