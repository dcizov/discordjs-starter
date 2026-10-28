import "server-only";
import type {
  Member,
  MemberWire,
  MembersPage,
  MembersPageWire,
} from "@orbit/core";
import { personAvatarUrl } from "./discord-images";

/**
 * The one place a member's avatar URL is derived.
 *
 * Everything that sends a person to the browser goes through here: the member
 * directory, the member detail view, the XP leaderboard, audit actors and
 * ticket participants. Before this existed, each caller decided for itself
 * whether to derive the URL, and the directory decided not to — it returned
 * `listMembers()` untouched, so every row rendered initials while the
 * leaderboard on the same server rendered a real picture.
 *
 * The hashes are already in the database; nothing has to be re-synced.
 *
 * `server-only` is deliberate: `personAvatarUrl` reaches for the Discord CDN
 * and the demo illustration allowlist, neither of which belongs in a client
 * bundle.
 */

/** One member, as the browser receives it. */
export function toMemberWire(member: Member, guildId: string): MemberWire {
  return {
    ...member,
    avatarUrl: personAvatarUrl({
      guildId,
      userId: member.userId,
      guildAvatar: member.guildAvatar ?? null,
      avatar: member.avatar ?? null,
    }),
  };
}

/** A whole page of the roster. */
export function toMembersPageWire(
  page: MembersPage,
  guildId: string
): MembersPageWire {
  return { ...page, rows: page.rows.map((row) => toMemberWire(row, guildId)) };
}
