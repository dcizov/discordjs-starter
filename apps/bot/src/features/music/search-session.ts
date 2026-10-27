import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { randomUUID } from "node:crypto";
import type { ResolvedTrack } from "./service";

/**
 * Bounded, single-use search results.
 *
 * A select menu cannot carry track data itself, so `/search` stores at most
 * five resolved candidates in memory and puts only an opaque id in the
 * `custom_id`. Consequences that matter:
 *
 * - the session is bound to one guild and one user, so another member cannot
 *   spend someone else's results;
 * - it expires quickly (the listener is looking at the message right now);
 * - claiming is single-use, so a double click or a replayed interaction cannot
 *   enqueue the same tracks twice;
 * - nothing is enqueued until the listener chooses, and the chosen tracks are
 *   re-validated and re-authorized in `MusicService.playSelection`.
 *
 * The store is per-process (one bot process owns its interactions), unlike
 * permissions or queue state which live in Postgres.
 */
export const SEARCH_SESSION_TTL_MS = 120_000;
export const SEARCH_SELECT_PREFIX = "music:pick:";

export type SearchSession = {
  id: string;
  guildId: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  tracks: ResolvedTrack[];
};

export class MusicSearchSessions {
  private sessions = new Map<string, SearchSession>();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs = SEARCH_SESSION_TTL_MS,
    private readonly maxSessions = 500
  ) {}

  create(input: {
    guildId: string;
    userId: string;
    tracks: ResolvedTrack[];
  }): SearchSession {
    this.sweep();
    const createdAt = this.now();
    const session: SearchSession = {
      id: randomUUID(),
      guildId: input.guildId,
      userId: input.userId,
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      tracks: input.tracks.slice(0, 5),
    };
    this.sessions.set(session.id, session);
    while (this.sessions.size > this.maxSessions)
      this.sessions.delete(this.sessions.keys().next().value!);
    return session;
  }

  /** Reads without consuming, for rendering a status message. */
  peek(id: string): SearchSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  /**
   * Consumes a session for exactly one interaction by the same member in the
   * same guild. Another member's attempt does not burn the owner's results.
   */
  claim(id: string, owner: { guildId: string; userId: string }) {
    const session = this.peek(id);
    if (!session) return null;
    if (session.guildId !== owner.guildId || session.userId !== owner.userId)
      return null;
    this.sessions.delete(id);
    return session;
  }

  /** Drops every session of one guild (bot removed, or guild gone). */
  forgetGuild(guildId: string) {
    for (const [id, session] of this.sessions)
      if (session.guildId === guildId) this.sessions.delete(id);
  }

  private sweep() {
    const now = this.now();
    for (const [id, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(id);
  }
}

/** Select menu rows are limited to five options here, by design. */
export function searchResultComponents(session: SearchSession) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${SEARCH_SELECT_PREFIX}${session.id}`)
    .setPlaceholder("Choose one of these tracks")
    .setMinValues(1)
    .setMaxValues(Math.min(5, session.tracks.length))
    .addOptions(
      session.tracks.map((track, index) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(track.title.slice(0, 100))
          .setDescription(
            truncate(
              [track.author, track.source, durationLabel(track.duration)]
                .filter(Boolean)
                .join(" · "),
              100
            )
          )
          .setValue(String(index))
      )
    );
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)];
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function durationLabel(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return "Live / unknown length";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const hours = Math.floor(minutes / 60);
  return hours
    ? `${hours}:${String(minutes % 60).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}
