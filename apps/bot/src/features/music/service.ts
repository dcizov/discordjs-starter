import { assertMusicQueueAdmission } from "@orbit/core/music-policy";
import type { MusicState, Track } from "@orbit/core";
import { safeText } from "@orbit/core";
import { safeImageUrl } from "@orbit/core/feed-content";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import {
  audit,
  emptyMusic,
  getGuild,
  putMusicState,
  setHealth,
} from "@orbit/db";
import {
  ChannelType,
  Events,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildMember,
} from "discord.js";
import { randomUUID } from "node:crypto";
import { type Track as LavalinkTrack, type Player } from "shoukaku";
import { MusicBackend } from "./backend";
import {
  DEFAULT_IDLE_SECONDS,
  EMPTY_CHANNEL_GRACE_SECONDS,
  IdleDisconnector,
} from "./idle";
import type {
  MusicSearchProvider,
  MusicSearchProviderId,
} from "@orbit/core/music-sources";
import { MusicNodeMetadata } from "./node";
import { joinMusicVoice, MusicDiscordConnector } from "./voice";
import { MusicPluginRest, sponsorBlockCategories } from "./plugins";
import { MusicSearchSessions } from "./search-session";
import {
  musicNodeDescription,
  musicSourceFailureReport,
  resolveMusicQuery,
} from "./source";
const MAX_SEARCH_RESULTS = 5;

/** Result of one text search: candidates plus the provider that answered. */
export type MusicSearchResult = {
  tracks: ResolvedTrack[];
  provider: MusicSearchProvider | null;
};
const INVALID_SEARCH =
  "That search result is no longer available. Run /search again.";

type Authority = {
  guild: Guild;
  stored: NonNullable<Awaited<ReturnType<typeof getGuild>>>;
  voice: NonNullable<GuildMember["voice"]["channel"]>;
  me: GuildMember;
};

/** One already-resolved track, before it is admitted to a queue. */
export type ResolvedTrack = {
  encoded: string;
  title: string;
  author: string;
  duration: number;
  uri: string;
  source: string;
  /** Validated public artwork URL from the provider, when it supplied one. */
  artwork?: string | null;
};

export class MusicService {
  readonly backend: MusicBackend | null;
  private sessions = new Map<string, MusicState>();
  /** Explicit `/search` selections, scoped to this bot process. */
  readonly searches = new MusicSearchSessions();
  private locks = new Map<string, Promise<unknown>>();
  private lastSave = new Map<string, number>();
  private metadata = new MusicNodeMetadata();
  private voiceConnector: MusicDiscordConnector;
  /**
   * Owns every "leave voice later" timer. Nothing else in this class calls
   * `setTimeout`, so a shutdown or an explicit stop cannot leave one behind.
   */
  private idle = new IdleDisconnector((guildId, reason) => {
    void this.leaveWhenIdle(guildId, reason).catch((error) =>
      logger.warn(
        { guildId, reason, error: errorDiagnostic(error) },
        "Idle voice cleanup failed"
      )
    );
  });
  private readonly onVoiceState: (
    oldState: { channelId: string | null; guild: Guild },
    newState: { channelId: string | null; guild: Guild }
  ) => void;
  constructor(private client: Client) {
    this.voiceConnector = new MusicDiscordConnector(client);
    // "Everybody left the channel" is the one teardown a listener expects, but
    // it still gets a grace period so a re-joining listener keeps the player.
    this.onVoiceState = (oldState, newState) => {
      const guildId = newState.guild.id;
      const player = this.backend?.players.get(guildId);
      if (!player) return;
      const channel = newState.guild.members.me?.voice.channel;
      // Only react to changes in the channel Orbit is actually sitting in.
      if (
        !channel ||
        (oldState.channelId !== channel.id && newState.channelId !== channel.id)
      )
        return;
      const humans = channel.members.filter((member) => !member.user.bot).size;
      if (humans === 0) {
        // Playing to an empty channel is not playback anybody asked for. The
        // short grace covers a reconnecting listener; a queue that is still
        // running keeps its longer idle timer otherwise.
        this.idle.schedule(guildId, "alone", EMPTY_CHANNEL_GRACE_SECONDS);
      } else if (this.idle.reason(guildId) === "alone") {
        this.idle.cancel(guildId);
      }
    };
    client.on(Events.VoiceStateUpdate, this.onVoiceState);
    this.backend =
      process.env.LAVALINK_URL && process.env.LAVALINK_PASSWORD
        ? new MusicBackend(
            this.voiceConnector,
            [
              {
                name: "main",
                url: process.env.LAVALINK_URL,
                auth: process.env.LAVALINK_PASSWORD,
                secure: process.env.LAVALINK_SECURE === "true",
              },
            ],
            {
              resume: true,
              resumeTimeout: 60,
              restTimeout: 15,
              structures: { rest: MusicPluginRest },
            }
          )
        : null;
    this.backend?.on("ready", (name, resumed, resumedByLibrary) => {
      void setHealth("Music backend", "healthy", 0, "Lavalink connected");
      logger.info({ resumed, resumedByLibrary }, "Lavalink connected");
      // A restarted server may accept a new session without any old players.
      // Do not leave a phantom now-playing state, or replay queued music/jobs.
      if (!resumed && !resumedByLibrary)
        for (const [id, player] of this.backend?.players ?? []) {
          if (player.node.name !== name) continue;
          void this.locked(id, async () => {
            if (this.backend?.players.get(id) !== player) return;
            this.idle.cancel(id);
            await this.backend.leaveVoiceChannel(id);
            this.sessions.set(id, emptyMusic());
            await this.persist(id);
            logger.info(
              { guildId: id },
              "Cleared stale music session after backend restart; no tracks replayed"
            );
          }).catch((error) =>
            logger.warn(
              { error: errorDiagnostic(error), guildId: id },
              "Could not clear restarted music session"
            )
          );
        }
      const node = this.backend?.nodes.get(name);
      if (node)
        void this.metadata
          .read(node, true)
          .then((info) => {
            logger.info(
              { backend: musicNodeDescription(info) },
              "Lavalink metadata loaded"
            );
          })
          .catch((error) => {
            logger.warn(
              { error: errorDiagnostic(error) },
              "Lavalink metadata unavailable; will retry on lookup"
            );
          });
    });
    this.backend?.on("error", (_name, error) => {
      logger.warn(
        { error: errorDiagnostic(error) },
        "Lavalink connection error"
      );
      void setHealth(
        "Music backend",
        "degraded",
        0,
        "Lavalink connection error"
      );
    });
    this.backend?.on("reconnecting", (_name, _tries, seconds) => {
      logger.warn(
        { retryInSeconds: seconds },
        "Lavalink disconnected; automatic retry scheduled"
      );
    });
    this.backend?.on(
      "disconnect",
      () =>
        void setHealth(
          "Music backend",
          "degraded",
          0,
          "Lavalink disconnected; retrying automatically"
        )
    );
  }
  private async locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(fn);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  state(id: string) {
    if (!this.sessions.has(id)) this.sessions.set(id, emptyMusic());
    return this.sessions.get(id)!;
  }
  /**
   * Display-only limits for `/queue`. These come from the stored guild config;
   * when the row cannot be read the schema defaults are shown rather than a
   * number invented per call. Admission decisions still use the stored config.
   */
  async limits(id: string) {
    try {
      const stored = await getGuild(id);
      return {
        maxQueue: stored?.config.music.maxQueue ?? 100,
        idleDisconnectSeconds:
          stored?.config.music.idleDisconnectSeconds ?? DEFAULT_IDLE_SECONDS,
      };
    } catch (error) {
      logger.warn(
        { guildId: id, error: errorDiagnostic(error) },
        "Could not read the music limits; showing the defaults"
      );
      return { maxQueue: 100, idleDisconnectSeconds: DEFAULT_IDLE_SECONDS };
    }
  }
  private async persist(id: string) {
    const state = this.state(id);
    state.updatedAt = new Date().toISOString();
    await putMusicState(id, state);
  }
  private wire(player: Player) {
    player.on("end", (event) => {
      if (event.reason === "replaced" || event.reason === "cleanup") return;
      void this.locked(player.guildId, async () => {
        if (this.backend?.players.get(player.guildId) !== player) return;
        const state = this.state(player.guildId);
        if (event.reason === "finished" && state.current) {
          if (state.repeat === "track") state.tracks.unshift(state.current);
          else if (state.repeat === "queue") state.tracks.push(state.current);
        }
        await this.next(
          player.guildId,
          player,
          event.reason === "loadFailed" ? "track-failed" : "queue-finished"
        );
      }).catch((e) =>
        logger.error(
          { error: e.message, guildId: player.guildId },
          "Queue advance failed"
        )
      );
    });
    player.on("update", (update) => {
      if (this.backend?.players.get(player.guildId) !== player) return;
      const state = this.state(player.guildId);
      state.position = update.state.position;
      if (Date.now() - (this.lastSave.get(player.guildId) ?? 0) > 15000) {
        this.lastSave.set(player.guildId, Date.now());
        void this.persist(player.guildId).catch((e) =>
          logger.error({ error: e.message }, "Music snapshot failed")
        );
      }
    });
    player.on("exception", (event) => {
      if (this.backend?.players.get(player.guildId) !== player) return;
      // The failing track is still `state.current` here; Lavalink sends the
      // exception before the matching end event, so the source is known.
      const failing = this.state(player.guildId).current;
      const detail = musicSourceFailureReport(event.exception, {
        stage: "playback",
        source: failing?.source ?? null,
        info: player.node.info,
      });
      logger.warn(
        { guildId: player.guildId, error: detail.details },
        "Audio source playback failed"
      );
      void audit(
        player.guildId,
        {
          id: this.client.user?.id ?? "system:music",
          name: "Orbit",
          // Bot rows used to be avatar-less, which the dashboard rendered as a
          // generic glyph next to real member pictures.
          avatar: this.client.user?.avatar ?? null,
        },
        "failed",
        "music playback",
        detail.summary,
        { details: detail.details }
      ).catch((error) =>
        logger.warn(
          { error: errorDiagnostic(error) },
          "Could not save music playback failure"
        )
      );
    });
    player.on("closed", () => {
      if (this.backend?.players.get(player.guildId) !== player) return;
      this.idle.cancel(player.guildId);
      void this.locked(player.guildId, async () => {
        if (this.backend?.players.get(player.guildId) !== player) return;
        this.sessions.set(player.guildId, emptyMusic());
        await this.persist(player.guildId);
      }).catch((e) =>
        logger.warn({ error: e.message }, "Voice close snapshot failed")
      );
    });
  }
  /**
   * Start the next queued track, or hand the guild to the idle policy.
   *
   * Nothing here leaves voice directly: `stop` and `disconnect` are explicit
   * actions that bypass this method, and every other empty-queue path waits
   * first so a listener can queue another track without a reconnect.
   */
  private async next(
    id: string,
    player: Player,
    reason: "queue-finished" | "track-failed" = "queue-finished"
  ) {
    const state = this.state(id);
    state.current = state.tracks.shift() ?? null;
    state.position = 0;
    state.paused = false;
    if (state.current?.encoded) {
      try {
        await player.playTrack({ track: { encoded: state.current.encoded } });
        // A track is starting; any pending leave from the previous one is void.
        this.idle.cancel(id);
      } catch (error) {
        // A rejected play request must not strand the queue on a track that
        // never started: drop it, keep the rest, and report through the caller.
        state.current = null;
        await this.persist(id);
        throw error;
      }
    } else {
      state.current = null;
      await this.waitBeforeLeaving(id, reason);
    }
    await this.persist(id);
  }

  /** Schedule (or perform) the idle voice cleanup for one guild. */
  private async waitBeforeLeaving(
    id: string,
    reason: "queue-finished" | "track-failed"
  ) {
    const seconds = await this.idleSeconds(id);
    // 0 is an explicit "leave as soon as the queue ends" choice.
    this.idle.schedule(id, reason, seconds);
  }

  private async idleSeconds(id: string) {
    try {
      const stored = await getGuild(id);
      return stored?.config.music.idleDisconnectSeconds ?? DEFAULT_IDLE_SECONDS;
    } catch (error) {
      logger.warn(
        { guildId: id, error: errorDiagnostic(error) },
        "Could not read the idle timeout; using the default"
      );
      return DEFAULT_IDLE_SECONDS;
    }
  }

  /**
   * Timer callback: leave only if the guild is still idle.
   *
   * Runs inside the per-guild lock and re-reads the live state, so a track queued
   * between scheduling and firing keeps the player.
   */
  private async leaveWhenIdle(guildId: string, reason: string) {
    if (!this.backend) return;
    await this.locked(guildId, async () => {
      const player = this.backend!.players.get(guildId);
      if (!player) return;
      const state = this.state(guildId);
      if (state.current || state.tracks.length) {
        logger.info(
          { guildId, reason },
          "Idle disconnect cancelled: a track is queued or playing"
        );
        return;
      }
      await this.backend!.leaveVoiceChannel(guildId);
      this.sessions.set(guildId, emptyMusic());
      await this.persist(guildId);
      logger.info({ guildId, reason }, "Left voice after the queue went idle");
    });
  }
  /** Metadata a listener may see and that a later selection may rely on. */
  private describe(t: LavalinkTrack): ResolvedTrack {
    return {
      encoded: t.encoded,
      title: safeText(t.info.title, 200) || "Untitled track",
      author: safeText(t.info.author, 100),
      duration: Number.isFinite(t.info.length) ? Math.max(0, t.info.length) : 0,
      uri: safeText(t.info.uri ?? "", 2000),
      source: safeText(t.info.sourceName ?? "", 40),
      // Provider artwork only: validated https image URL from the source
      // manager, never a stream/endpoint URL. Absent stays absent.
      artwork: safeImageUrl(String(t.info.artworkUrl ?? "")) || null,
    };
  }

  /**
   * One backend lookup. `limit` applies to text search only (1 for quick play,
   * the candidate count for `/search`); an explicit URL or playlist is never
   * truncated here.
   */
  private async resolve(
    query: string,
    options: {
      provider?: MusicSearchProviderId | string | null;
      limit?: number;
    } = {}
  ) {
    const node = this.backend?.getIdealNode();
    if (!node)
      throw new Error(
        "Lavalink is configured but not connected. Orbit is retrying automatically. Wait for 'Lavalink connected' in the bot logs; check that both bot and lavalink services are running. This is not a Discord voice-permission error."
      );
    const info = await this.metadata.read(node).catch((error) => {
      logger.warn(
        { error: errorDiagnostic(error) },
        "Lavalink metadata unavailable for lookup"
      );
      return null;
    });
    return resolveMusicQuery(node.rest, query, { info, ...options });
  }

  /**
   * Authority checks shared by every playback control.
   *
   * Called inside the per-guild lock, against freshly fetched guild/member
   * state, so a dashboard snapshot is never treated as execution authority.
   * The dashboard queues an action; this runs again when the bot executes it.
   */
  private async controllable(member: GuildMember): Promise<Authority> {
    const guild = member.guild,
      stored = await getGuild(guild.id);
    if (!stored?.config.modules.music)
      throw new Error("Music is paused in this server.");
    if (!this.backend)
      throw new Error("Lavalink is not configured. See docs/MUSIC.md.");
    const djRoleId = stored.config.music.djRoleId;
    // A deleted/re-created role must not silently widen access to everyone,
    // and it must not dead-end managers who can repair the setting either.
    const djRoleExists =
      !djRoleId || !!member.guild.roles?.cache?.has(djRoleId);
    if (
      djRoleId &&
      !djRoleExists &&
      !member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
      throw new Error(
        "The DJ role configured for music no longer exists in this server, so playback controls are limited to Manage Server members. Ask a manager to choose a DJ role in Music settings."
      );
    if (
      djRoleExists &&
      djRoleId &&
      !member.roles.cache.has(djRoleId) &&
      !member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
      throw new Error("The DJ role is required to control music.");
    const voice = member.voice.channel;
    if (!voice) throw new Error("Join a voice channel first.");
    if (voice.type !== ChannelType.GuildVoice)
      throw new Error(
        "Use a normal server voice channel. Stage-channel speaker promotion is not supported."
      );
    if ("nsfw" in voice && voice.nsfw)
      throw new Error(
        "Music is restricted to non-NSFW voice channels. Choose a clean recording in an appropriate channel."
      );
    const me = await guild.members.fetchMe({ force: true });
    if (me.voice.channelId && me.voice.channelId !== voice.id)
      throw new Error("Join Orbit’s voice channel to control playback.");
    if (
      !voice
        .permissionsFor(me)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ])
    )
      throw new Error(
        "Orbit needs View Channel, Connect and Speak permissions in your voice channel, including its channel overrides."
      );
    if (
      me.voice.channelId !== voice.id &&
      voice.full &&
      !voice.permissionsFor(me)?.has(PermissionFlagsBits.MoveMembers)
    )
      throw new Error(
        "This voice channel is full. Choose a non-full channel or grant the bot Move Members to bypass the user limit."
      );
    return { guild, stored, voice, me };
  }

  async action(
    member: GuildMember,
    input: {
      action: string;
      query?: string;
      /** Explicit text-search provider; unknown values are rejected in resolve. */
      source?: MusicSearchProviderId | string | null;
      volume?: number;
      repeat?: "off" | "track" | "queue";
      trackId?: string;
      position?: number;
    }
  ) {
    return this.locked(member.guild.id, async () => {
      const authority = await this.controllable(member);
      const { guild } = authority;
      if (input.action === "play") {
        if (!input.query)
          throw new Error("Enter a track title or supported source URL.");
        // Quick play takes the first result; `source` only selects the text
        // search provider, never the routing of a pasted link.
        const resolved = await this.resolve(input.query, {
          provider: input.source,
          limit: 1,
        });
        // Quick play is exactly one track for a text search (the resolver was
        // asked for one); a pasted playlist keeps all of its tracks.
        const chosen =
          resolved.kind === "search"
            ? resolved.tracks.slice(0, 1)
            : resolved.tracks;
        const tracks = chosen.map((t: LavalinkTrack) => this.describe(t));
        return this.enqueue(member, authority, tracks);
      }
      const player = this.backend!.players.get(guild.id);
      if (input.action === "stop" && !player) {
        await this.backend!.leaveVoiceChannel(guild.id);
        if (authority.me.voice.channelId)
          await this.voiceConnector.clearStaleVoice(guild.id, guild.shardId);
        this.sessions.set(guild.id, emptyMusic());
        await this.persist(guild.id);
        return {
          message: "Stopped and cleared the pending voice connection.",
          queued: 0,
        };
      }
      if (!player)
        throw new Error(
          "Nothing is playing right now. Add a track with /play."
        );
      const state = this.state(guild.id);
      // Any control means a listener is present and engaged.
      this.idle.cancel(guild.id);
      switch (input.action) {
        case "pause":
          await player.setPaused(true);
          state.paused = true;
          break;
        case "resume":
          await player.setPaused(false);
          state.paused = false;
          break;
        case "skip":
          await player.stopTrack();
          break;
        case "stop":
          // Explicit stop is the one path that leaves immediately.
          this.sessions.set(guild.id, emptyMusic());
          await this.backend!.leaveVoiceChannel(guild.id);
          break;
        case "volume":
          if (
            !Number.isInteger(input.volume) ||
            input.volume! < 0 ||
            input.volume! > 100
          )
            throw new Error("Volume must be from 0 to 100.");
          await player.setGlobalVolume(input.volume!);
          state.volume = input.volume!;
          break;
        case "seek":
          if (!state.current)
            throw new Error(
              "Nothing is playing right now, so there is nothing to seek."
            );
          if (!Number.isInteger(input.position) || input.position! < 0)
            throw new Error("Enter a seek position in seconds.");
          {
            const duration = Number(state.current.duration);
            const limit =
              Number.isFinite(duration) && duration > 0 ? duration : null;
            if (limit === null)
              throw new Error(
                "This source has no known duration (for example a live stream), so seeking is unavailable."
              );
            // Lavalink positions are milliseconds; the command and the
            // dashboard both speak seconds.
            const target = Math.min(input.position! * 1000, limit - 1000);
            if (target < 1000) throw new Error("Seek at least one second in.");
            await player.seekTo(target);
            state.position = target;
          }
          break;
        case "shuffle":
          for (let i = state.tracks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [state.tracks[i], state.tracks[j]] = [
              state.tracks[j],
              state.tracks[i],
            ];
          }
          break;
        case "repeat":
          if (!["off", "track", "queue"].includes(input.repeat ?? ""))
            throw new Error("Invalid repeat mode");
          state.repeat = input.repeat!;
          break;
        case "remove":
          state.tracks = state.tracks.filter((t) => t.id !== input.trackId);
          break;
        default:
          throw new Error("Unknown music action");
      }
      await this.persist(guild.id);
      return {
        message: "Your listening room is right on track.",
        queued: state.tracks.length,
      };
    });
  }

  /**
   * Text search for explicit selection. Returns candidates without queueing
   * anything and without joining voice: the caller shows them, and the chosen
   * track goes through {@link playSelection}, which re-runs every check.
   *
   * The number of candidates is bounded by `MAX_SEARCH_RESULTS` and handed to the
   * resolver, so the backend answers with exactly that many instead of being
   * truncated afterwards. `provider` selects one of the approved text-search
   * providers; omitting it uses `MUSIC_SEARCH_PREFIX`.
   */
  async search(
    member: GuildMember,
    query: string,
    options: {
      limit?: number;
      provider?: MusicSearchProviderId | string | null;
    } = {}
  ): Promise<MusicSearchResult> {
    const stored = await getGuild(member.guild.id);
    if (!stored?.config.modules.music)
      throw new Error("Music is paused in this server.");
    if (!this.backend)
      throw new Error("Lavalink is not configured. See docs/MUSIC.md.");
    if (
      stored.config.music.djRoleId &&
      !member.roles.cache.has(stored.config.music.djRoleId) &&
      !member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
      throw new Error("The DJ role is required to control music.");
    if (query.trim().length < 1 || query.length > 200)
      throw new Error("Enter a search term from 1 to 200 characters.");
    if (/[\u0000-\u001f\u007f]/.test(query))
      throw new Error("Remove control characters from the search term.");
    const bounded = Math.min(
      Math.max(1, Math.floor(options.limit ?? MAX_SEARCH_RESULTS)),
      MAX_SEARCH_RESULTS
    );
    const resolved = await this.resolve(query, {
      provider: options.provider,
      limit: bounded,
    });
    return {
      tracks: resolved.tracks
        .slice(0, bounded)
        .map((t: LavalinkTrack) => this.describe(t)),
      provider: resolved.provider,
    };
  }

  /**
   * Queue tracks the listener explicitly picked from {@link search} results.
   *
   * The selection is untrusted input from an interaction payload, so every
   * field is re-validated here, and a track that is already waiting in this
   * queue is not added twice.
   */
  async playSelection(member: GuildMember, selected: ResolvedTrack[]) {
    if (!Array.isArray(selected) || !selected.length)
      throw new Error("Choose at least one track from the search results.");
    const valid = selected.slice(0, MAX_SEARCH_RESULTS).map((track) => {
      if (!track || typeof track !== "object") throw new Error(INVALID_SEARCH);
      const encoded = typeof track.encoded === "string" ? track.encoded : "";
      if (!encoded || encoded.length > 4096) throw new Error(INVALID_SEARCH);
      return {
        encoded,
        title: safeText(String(track.title ?? ""), 200) || "Untitled track",
        author: safeText(String(track.author ?? ""), 100),
        duration:
          Number.isFinite(track.duration) && track.duration > 0
            ? Math.min(Math.round(track.duration), 24 * 60 * 60 * 1000)
            : 0,
        uri: safeText(String(track.uri ?? ""), 2000),
        source: safeText(String(track.source ?? ""), 40),
        artwork: safeImageUrl(String(track.artwork ?? "")) || null,
      } satisfies ResolvedTrack;
    });
    const unique = [
      ...new Map(valid.map((track) => [track.encoded, track])).values(),
    ];
    return this.locked(member.guild.id, async () => {
      const authority = await this.controllable(member);
      const state = this.state(authority.guild.id);
      // The playing track counts too: a replayed selection must not queue a
      // second copy of the track that is already on air.
      const fresh = unique.filter(
        (track) =>
          state.current?.encoded !== track.encoded &&
          !state.tracks.some((queued) => queued.encoded === track.encoded)
      );
      if (!fresh.length)
        throw new Error(
          fresh.length === unique.length
            ? INVALID_SEARCH
            : "Already in the queue. Nothing was added twice."
        );
      return this.enqueue(member, authority, fresh);
    });
  }

  /**
   * Admit resolved tracks, joining voice when needed. Every queue change is
   * admission-checked as a whole before any voice work happens.
   */
  private async enqueue(
    member: GuildMember,
    authority: Authority,
    tracks: ResolvedTrack[]
  ) {
    const { guild, stored, voice, me } = authority;
    const state = this.state(guild.id);
    // Queuing cancels a pending idle leave before the player lookup, so a
    // playlist added to an idle guild never races the cleanup.
    this.idle.cancel(guild.id);
    let player = this.backend!.players.get(guild.id);
    assertMusicQueueAdmission(
      state,
      member.id,
      tracks.length,
      stored.config.music.maxQueue,
      stored.config.music.maxPerMember ?? 0
    );
    if (!player) {
      const categories = sponsorBlockCategories();
      player = await joinMusicVoice(
        this.backend!,
        this.voiceConnector,
        {
          guildId: guild.id,
          channelId: voice.id,
          shardId: guild.shardId,
          currentChannelId: me.voice.channelId,
        },
        (voiceHandshake) => {
          if (voiceHandshake.stage === "player-created")
            logger.info(
              { voiceHandshake },
              "Discord voice handshake completed; player created, playback not yet proven"
            );
          else
            logger.warn(
              { voiceHandshake },
              "Music join failed at the reported lifecycle stage"
            );
        }
      );
      state.volume = stored.config.music.defaultVolume;
      await player.setGlobalVolume(state.volume);
      this.wire(player);
      if (
        categories.length &&
        player.node.info?.plugins.some(
          (plugin) => plugin.name === "sponsorblock-plugin"
        )
      ) {
        await (player.node.rest as MusicPluginRest)
          .setSponsorBlock(guild.id, categories)
          .catch(async (error) => {
            const detail = `SponsorBlock setup failed; playback may proceed without sponsor skipping.\n${errorDiagnostic(error)}`;
            logger.warn(
              { guildId: guild.id, error: detail },
              "Optional music plugin unavailable"
            );
            await audit(
              guild.id,
              {
                id: member.id,
                name: member.displayName,
                avatar: member.user.avatar,
              },
              "failed",
              "SponsorBlock setup",
              detail
            ).catch(() => {});
          });
      }
    }
    state.tracks.push(
      ...tracks.map((t): Track => ({
        id: randomUUID(),
        title: t.title || "Untitled track",
        author: t.author,
        duration: t.duration,
        uri: t.uri,
        encoded: t.encoded,
        source: t.source,
        artwork: t.artwork ?? null,
        requestedBy: safeText(member.displayName, 80),
        requestedById: member.id,
      }))
    );
    if (!state.current) await this.next(guild.id, player);
    await this.persist(guild.id);
    return {
      message: "Your listening room is right on track.",
      queued: state.tracks.length,
    };
  }

  async heartbeat() {
    const node = this.backend?.getIdealNode();
    await setHealth(
      "Music backend",
      node ? "healthy" : this.backend ? "degraded" : "offline",
      0,
      node
        ? "Lavalink connected"
        : this.backend
          ? "Lavalink configured but disconnected; retrying automatically"
          : "Music disabled: configure LAVALINK_URL and LAVALINK_PASSWORD"
    );
  }
  async shutdown() {
    this.idle.clear();
    this.client.off(Events.VoiceStateUpdate, this.onVoiceState);
    if (!this.backend) {
      this.voiceConnector.dispose();
      return;
    }
    this.backend.stop();
    try {
      for (const id of new Set([
        ...this.backend.players.keys(),
        ...this.backend.connections.keys(),
      ])) {
        await this.backend
          .leaveVoiceChannel(id)
          .catch((error) =>
            logger.warn(
              { guildId: id, error: errorDiagnostic(error) },
              "Music voice cleanup failed during shutdown"
            )
          );
        await putMusicState(id, emptyMusic()).catch((error) =>
          logger.warn(
            { guildId: id, error: errorDiagnostic(error) },
            "Music shutdown snapshot persistence failed after voice cleanup attempt"
          )
        );
      }
    } finally {
      this.voiceConnector.dispose();
    }
  }
}
