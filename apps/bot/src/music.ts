import type { MusicState, Track } from "@orbit/core";
import { assertFeedUrl, isPublicAddress, safeText } from "@orbit/core";
import { logger } from "@orbit/core/logger";
import { emptyMusic, getGuild, putMusicState, setHealth } from "@orbit/db";
import { PermissionFlagsBits, type Client, type GuildMember } from "discord.js";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import {
  Connectors,
  LoadType,
  Shoukaku,
  type Track as LavalinkTrack,
  type Player,
} from "shoukaku";
export class MusicService {
  readonly backend: Shoukaku | null;
  private sessions = new Map<string, MusicState>();
  private locks = new Map<string, Promise<unknown>>();
  private lastSave = new Map<string, number>();
  constructor(private client: Client) {
    this.backend =
      process.env.LAVALINK_URL && process.env.LAVALINK_PASSWORD
        ? new Shoukaku(
            new Connectors.DiscordJS(client),
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
              reconnectTries: 10,
              reconnectInterval: 5,
            }
          )
        : null;
    this.backend?.on("ready", () => {
      void setHealth("Music backend", "healthy", 0, "Lavalink connected");
      logger.info("Lavalink connected");
    });
    this.backend?.on("error", (_name, error) => {
      logger.warn({ error: error.message }, "Lavalink connection error");
      void setHealth(
        "Music backend",
        "degraded",
        0,
        "Lavalink connection error"
      );
    });
    this.backend?.on(
      "disconnect",
      () =>
        void setHealth("Music backend", "offline", 0, "Lavalink disconnected")
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
  private async persist(id: string) {
    const state = this.state(id);
    state.updatedAt = new Date().toISOString();
    await putMusicState(id, state);
  }
  private wire(player: Player) {
    player.on("end", (event) => {
      if (event.reason === "replaced" || event.reason === "cleanup") return;
      void this.locked(player.guildId, async () => {
        const state = this.state(player.guildId);
        if (event.reason === "finished" && state.current) {
          if (state.repeat === "track") state.tracks.unshift(state.current);
          else if (state.repeat === "queue") state.tracks.push(state.current);
        }
        await this.next(player.guildId, player);
      }).catch((e) =>
        logger.error(
          { error: e.message, guildId: player.guildId },
          "Queue advance failed"
        )
      );
    });
    player.on("update", (update) => {
      const state = this.state(player.guildId);
      state.position = update.state.position;
      if (Date.now() - (this.lastSave.get(player.guildId) ?? 0) > 15000) {
        this.lastSave.set(player.guildId, Date.now());
        void this.persist(player.guildId).catch((e) =>
          logger.error({ error: e.message }, "Music snapshot failed")
        );
      }
    });
    player.on("exception", (error) =>
      logger.warn(
        {
          guildId: player.guildId,
          error: safeText(error.exception.message, 200),
        },
        "Audio source playback failed"
      )
    );
    player.on("closed", () => {
      if (this.backend?.players.get(player.guildId) !== player) return;
      void this.locked(player.guildId, async () => {
        this.sessions.set(player.guildId, emptyMusic());
        await this.persist(player.guildId);
      }).catch((e) =>
        logger.warn({ error: e.message }, "Voice close snapshot failed")
      );
    });
  }
  private async next(id: string, player: Player) {
    const state = this.state(id);
    state.current = state.tracks.shift() ?? null;
    state.position = 0;
    state.paused = false;
    if (state.current?.encoded)
      await player.playTrack({ track: { encoded: state.current.encoded } });
    else {
      state.current = null;
      await this.backend?.leaveVoiceChannel(id);
    }
    await this.persist(id);
  }
  private async resolve(query: string) {
    const node = this.backend?.getIdealNode();
    if (!node)
      throw new Error(
        "The music backend is unavailable. Ask an administrator to configure Lavalink."
      );
    let identifier: string;
    if (/^https?:\/\//i.test(query)) {
      const u = assertFeedUrl(query);
      const allowed = (
        process.env.MUSIC_ALLOWED_HOSTS ?? "soundcloud.com,bandcamp.com"
      )
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (
        !allowed.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))
      )
        throw new Error(
          "This audio source is not enabled. Ask your administrator which sources are supported."
        );
      const ips = await lookup(u.hostname, { all: true });
      if (!ips.length || ips.some((ip) => !isPublicAddress(ip.address)))
        throw new Error("Private audio-source addresses are not allowed");
      identifier = u.toString();
    } else {
      const prefix = process.env.MUSIC_SEARCH_PREFIX ?? "scsearch";
      if (!["scsearch", "bcsearch"].includes(prefix))
        throw new Error(
          "Configure a supported search prefix: scsearch or bcsearch."
        );
      identifier = `${prefix}:${query}`;
    }
    const result = await node.rest.resolve(identifier);
    if (!result || result.loadType === LoadType.EMPTY)
      throw new Error("No playable track was found on the configured source.");
    if (result.loadType === LoadType.ERROR)
      throw new Error(
        `The configured source could not load this track: ${safeText(result.data.message, 180)}`
      );
    return result.loadType === LoadType.TRACK
      ? [result.data]
      : result.loadType === LoadType.PLAYLIST
        ? result.data.tracks
        : result.data.slice(0, 1);
  }
  async action(
    member: GuildMember,
    input: {
      action: string;
      query?: string;
      volume?: number;
      repeat?: "off" | "track" | "queue";
      trackId?: string;
    }
  ) {
    return this.locked(member.guild.id, async () => {
      const guild = member.guild,
        stored = await getGuild(guild.id);
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
      const voice = member.voice.channel;
      if (!voice) throw new Error("Join a voice channel first.");
      const me = await guild.members.fetchMe();
      if (me.voice.channelId && me.voice.channelId !== voice.id)
        throw new Error("Join Orbit’s voice channel to control playback.");
      if (
        !voice
          .permissionsFor(me)
          ?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])
      )
        throw new Error(
          "Orbit needs Connect and Speak permissions in your voice channel."
        );
      let player = this.backend.players.get(guild.id);
      const state = this.state(guild.id);
      if (input.action === "play") {
        if (!input.query)
          throw new Error("Enter a track title or supported source URL.");
        const tracks = await this.resolve(input.query);
        if (state.tracks.length + tracks.length > stored.config.music.maxQueue)
          throw new Error("This request would exceed the queue limit.");
        if (!player) {
          player = await this.backend.joinVoiceChannel({
            guildId: guild.id,
            channelId: voice.id,
            shardId: guild.shardId,
            deaf: true,
          });
          state.volume = stored.config.music.defaultVolume;
          await player.setGlobalVolume(state.volume);
          this.wire(player);
        }
        state.tracks.push(
          ...tracks.map((t: LavalinkTrack): Track => ({
            id: randomUUID(),
            title: safeText(t.info.title, 200),
            author: safeText(t.info.author, 100),
            duration: t.info.length,
            uri: t.info.uri ?? "",
            encoded: t.encoded,
            requestedBy: safeText(member.displayName, 80),
          }))
        );
        if (!state.current) await this.next(guild.id, player);
      } else {
        if (!player)
          throw new Error(
            "Nothing is playing right now. Add a track with /play."
          );
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
            this.sessions.set(guild.id, emptyMusic());
            await this.backend.leaveVoiceChannel(guild.id);
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
      }
      await this.persist(guild.id);
      return {
        message: "Your listening room is right on track.",
        queued: state.tracks.length,
      };
    });
  }
  async heartbeat() {
    const node = this.backend?.getIdealNode();
    await setHealth(
      "Music backend",
      node ? "healthy" : "offline",
      0,
      node ? "Lavalink connected" : "Configure Lavalink to enable music"
    );
  }
  async shutdown() {
    if (!this.backend) return;
    for (const id of this.backend.players.keys()) {
      await this.backend.leaveVoiceChannel(id).catch(() => {});
      await putMusicState(id, emptyMusic());
    }
  }
}
