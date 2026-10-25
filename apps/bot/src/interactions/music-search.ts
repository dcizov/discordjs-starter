import { MessageFlags, type StringSelectMenuInteraction } from "discord.js";
import type { MusicService } from "../features/music/service";
import {
  SEARCH_SELECT_PREFIX,
  durationLabel,
} from "../features/music/search-session";

/**
 * Turn a `/search` selection into queue entries.
 *
 * The `custom_id` only carries an opaque session id: titles, sources and
 * durations come from the stored candidates, never from the interaction. The
 * session is claimed once, so a double click (or a replay) cannot enqueue the
 * same tracks twice, and `playSelection` re-runs the voice, DJ-role and queue
 * checks against fresh member state before anything is queued.
 */
export async function handleMusicSearchPick(
  i: StringSelectMenuInteraction,
  music: MusicService
) {
  if (!i.guildId) return;
  const session = music.searches.claim(
    i.customId.slice(SEARCH_SELECT_PREFIX.length),
    { guildId: i.guildId, userId: i.user.id }
  );
  if (!session) {
    await i
      .update({
        content:
          "These results expired or were already used. Run `/search` again to get a fresh list.",
        embeds: [],
        components: [],
      })
      .catch(() => {});
    return;
  }
  const indices = [
    ...new Set(
      i.values
        .map((value) => Number(value))
        .filter(
          (value) =>
            Number.isInteger(value) &&
            value >= 0 &&
            value < session.tracks.length
        )
    ),
  ];
  const chosen = indices.map((index) => session.tracks[index]);
  if (!chosen.length) {
    await i
      .update({
        content: "That option is no longer valid. Run `/search` again.",
        embeds: [],
        components: [],
      })
      .catch(() => {});
    return;
  }
  try {
    const member = await i.guild!.members.fetch({
      user: i.user.id,
      force: true,
    });
    await music.playSelection(member, chosen);
    await i.update({
      content:
        chosen.length === 1
          ? `Queued **${chosen[0].title}** · ${durationLabel(chosen[0].duration)}.`
          : `Queued ${chosen.length} tracks: ${chosen
              .map((track) => `**${track.title}**`)
              .join(", ")}.`,
      allowedMentions: { parse: [] },
      embeds: [],
      components: [],
    });
  } catch (error) {
    await i
      .update({
        content: `Nothing was queued: ${
          error instanceof Error ? error.message : "the request failed"
        }`,
        embeds: [],
        components: [],
      })
      .catch(() => {});
  }
}

/** Ephemeral notice used when a component belongs to a different feature. */
export const UNKNOWN_COMPONENT = {
  content: "That control is no longer available.",
  flags: MessageFlags.Ephemeral,
} as const;
