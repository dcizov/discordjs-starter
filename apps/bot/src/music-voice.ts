import { Events, GatewayIntentBits, Status, type Client } from "discord.js";
import {
  Connectors,
  type Connection,
  type NodeOption,
  type Player,
  type Shoukaku,
} from "shoukaku";
import { errorDiagnostic } from "@orbit/core/diagnostics";

type VoicePacket = { t: string; d: Record<string, any> };
export type VoiceHandshakeTrace = {
  guildId: string;
  shardId: number;
  joinSent: boolean;
  clientReady: boolean;
  shardReady: boolean;
  voiceIntent: boolean;
  stateReceived: boolean;
  serverReceived: boolean;
  endpointPresent: boolean;
  channelId: string;
  phase: "preparing" | "joining";
  rawListenerAttached: boolean;
  identityMatches: boolean;
  unexpectedState: boolean;
  wrongShardEvent: boolean;
  guildVoiceEvents: number;
};

export type VoiceHandshakeDiagnostic = VoiceHandshakeTrace & {
  stage: "gateway-failed" | "player-failed" | "player-created";
  cleanupSent: boolean;
  elapsedMs: number;
};

/** No raw Shoukaku debug logging: those messages contain voice session IDs. */
export class MusicDiscordConnector extends Connectors.DiscordJS {
  private traces = new Map<string, VoiceHandshakeTrace>();
  private earlyServers = new Map<string, VoicePacket>();
  private leaveWaiters = new Set<() => void>();
  constructor(private readonly discord: Client) {
    super(discord);
  }
  private rawListener?: (packet: VoicePacket, shardId: number) => void;
  private readyListener?: () => void;
  private initialized = false;
  private disposed = false;

  override listen(nodes: NodeOption[]) {
    if (this.rawListener) return;
    // Replace (do NOT also call) the inherited listener so shard identity is
    // retained and ownership/cleanup can be tested. The 4.3 connector otherwise
    // only waits for a future clientReady, even for an already-ready client.
    this.rawListener = (packet, shardId) => this.raw(packet, shardId);
    this.discord.on(Events.Raw, this.rawListener);
    this.readyListener = () => {
      if (this.disposed || this.initialized) return;
      this.initialized = true;
      this.ready(nodes);
    };
    if (this.discord.isReady()) queueMicrotask(this.readyListener);
    else this.discord.once(Events.ClientReady, this.readyListener);
  }
  dispose() {
    this.disposed = true;
    if (this.rawListener) this.discord.off(Events.Raw, this.rawListener);
    if (this.readyListener)
      this.discord.off(Events.ClientReady, this.readyListener);
    for (const cancel of [...this.leaveWaiters]) cancel();
    this.traces.clear();
    this.earlyServers.clear();
  }
  begin(guildId: string, shardId: number, channelId: string) {
    if (this.traces.has(guildId))
      throw new Error(
        "A voice join is already in progress for this server; no existing attempt was interrupted."
      );
    if (
      this.disposed ||
      !this.rawListener ||
      !this.discord.listeners(Events.Raw).includes(this.rawListener)
    )
      throw new Error(
        "The Discord raw voice listener is not attached. Restart the intended bot process; no voice request was sent."
      );
    if (!this.discord.user?.id || this.manager?.id !== this.discord.user.id)
      throw new Error(
        "Discord/Shoukaku bot identity is not initialized or does not match; no voice request was sent."
      );
    const actualShard = this.discord.guilds.cache.get(guildId)?.shardId;
    if (actualShard === undefined)
      throw new Error(
        "The target guild is not cached by this Discord gateway client; no voice request was sent."
      );
    if (actualShard !== shardId)
      throw new Error(
        `The target guild belongs to gateway shard ${actualShard}, not ${shardId}; no voice request was sent.`
      );
    this.earlyServers.delete(guildId);
    const trace: VoiceHandshakeTrace = {
      guildId,
      channelId,
      phase: "preparing",
      rawListenerAttached: true,
      identityMatches: true,
      unexpectedState: false,
      wrongShardEvent: false,
      guildVoiceEvents: 0,
      shardId,
      joinSent: false,
      clientReady: this.discord.isReady(),
      shardReady: this.discord.ws.shards.get(shardId)?.status === Status.Ready,
      voiceIntent: this.discord.options.intents.has(
        GatewayIntentBits.GuildVoiceStates
      ),
      stateReceived: false,
      serverReceived: false,
      endpointPresent: false,
    };
    this.traces.set(guildId, trace);
    return trace;
  }
  owns(guildId: string, trace: VoiceHandshakeTrace) {
    return this.traces.get(guildId) === trace;
  }
  finish(guildId: string, trace: VoiceHandshakeTrace) {
    if (!this.owns(guildId, trace)) return;
    this.traces.delete(guildId);
    this.earlyServers.delete(guildId);
  }
  sendPacket(shardId: number, payload: any, important: boolean) {
    if (this.disposed)
      throw new Error(
        "The music connector is stopped; no voice request was sent."
      );
    const actualShard = this.discord.guilds.cache.get(
      payload?.d?.guild_id
    )?.shardId;
    if (actualShard !== undefined && actualShard !== shardId)
      throw new Error(
        `The target guild belongs to gateway shard ${actualShard}, not ${shardId}.`
      );
    const shard = this.discord.ws.shards.get(shardId);
    const isJoin = payload?.op === 4 && !!payload.d?.channel_id;
    const trace = this.traces.get(payload?.d?.guild_id);
    if (trace && isJoin) {
      trace.clientReady = this.discord.isReady();
      trace.shardReady = shard?.status === Status.Ready;
      trace.voiceIntent = this.discord.options.intents.has(
        GatewayIntentBits.GuildVoiceStates
      );
    }
    if (!shard)
      throw new Error(
        `Discord gateway shard ${shardId} is unavailable; no voice request could be sent.`
      );
    if (shard.status !== Status.Ready)
      throw new Error(
        `Discord gateway shard ${shardId} is not ready; the voice request was not queued for later delivery. Wait for gateway recovery, then submit a fresh request.`
      );
    if (
      isJoin &&
      !this.discord.options.intents.has(GatewayIntentBits.GuildVoiceStates)
    )
      throw new Error(
        "The running Discord client is missing GuildVoiceStates. Update/restart the intended bot process; this is a code intent, not a privileged Developer Portal toggle."
      );
    shard.send(payload, important);
    if (trace && isJoin) trace.joinSent = true;
  }
  raw(packet: VoicePacket, shardId?: number, deferred = false) {
    if (
      !this.manager ||
      this.disposed ||
      !["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE"].includes(packet.t)
    )
      return;
    const guildId = packet.d?.guild_id;
    const trace = this.traces.get(guildId);
    if (trace) {
      if (!deferred)
        trace.guildVoiceEvents = Math.min(1000, trace.guildVoiceEvents + 1);
      if (shardId !== undefined && shardId !== trace.shardId) {
        trace.wrongShardEvent = true;
        return;
      }
      if (trace.phase === "preparing") return; // stale leave is observed independently
      if (!trace.joinSent) {
        // SDK connect() installs its waiter after sendVoiceUpdate(). A sync
        // transport must not deliver the acknowledgement before that waiter.
        queueMicrotask(() => {
          if (this.owns(guildId, trace) && trace.joinSent)
            this.raw(packet, shardId, true);
        });
        return;
      }
    }
    const ownState =
      packet.t === "VOICE_STATE_UPDATE" &&
      packet.d?.user_id === this.discord.user?.id;
    if (
      ownState &&
      trace &&
      packet.d.channel_id &&
      packet.d.channel_id !== trace.channelId
    ) {
      trace.unexpectedState = true;
      return; // never pair an old/wrong-channel session with this join's server
    }
    if (ownState && trace && packet.d.channel_id === trace.channelId)
      trace.stateReceived = true;
    if (packet.t === "VOICE_SERVER_UPDATE") {
      if (trace) {
        trace.serverReceived = true;
        trace.endpointPresent = !!packet.d.endpoint;
      }
      const connection = this.manager.connections.get(guildId);
      // Discord events need not arrive in Shoukaku 4.3's assumed state-first order.
      if (connection && !connection.sessionId && packet.d.endpoint) {
        this.earlyServers.set(guildId, packet);
        return;
      }
    }
    super.raw(packet);
    if (ownState && packet.d.channel_id && this.earlyServers.has(guildId)) {
      const early = this.earlyServers.get(guildId)!;
      this.earlyServers.delete(guildId);
      super.raw(early);
    } else if (ownState && !packet.d.channel_id)
      this.earlyServers.delete(guildId);
  }
  leave(guildId: string, shardId: number) {
    this.sendPacket(
      shardId,
      {
        op: 4,
        d: {
          guild_id: guildId,
          channel_id: null,
          self_deaf: false,
          self_mute: false,
        },
      },
      false
    );
  }
  async clearStaleVoice(
    guildId: string,
    shardId: number,
    timeoutMs = 4000,
    request?: () => Promise<unknown>
  ) {
    // Install the observer BEFORE sending, including for synchronous test transports.
    let cleanup: Promise<unknown> = Promise.resolve();
    const acknowledged = new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        this.discord.off("raw", listener);
        this.leaveWaiters.delete(cancel);
      };
      const cancel = () => {
        stop();
        reject(
          new Error("The music connector stopped during stale voice cleanup.")
        );
      };
      const listener = (packet: VoicePacket, fromShard?: number) => {
        if (
          packet.t === "VOICE_STATE_UPDATE" &&
          (fromShard === undefined || fromShard === shardId) &&
          packet.d.guild_id === guildId &&
          packet.d.user_id === this.discord.user?.id &&
          packet.d.channel_id === null
        ) {
          stop();
          resolve();
        }
      };
      const timer = setTimeout(() => {
        stop();
        reject(
          new Error(
            "Discord did not acknowledge leaving the stale voice connection. Check that only one bot process uses this token and that its gateway is connected."
          )
        );
      }, timeoutMs);
      this.leaveWaiters.add(cancel);
      this.discord.on("raw", listener);
      try {
        if (request) {
          cleanup = request();
          void cleanup.catch((error) => {
            stop();
            reject(error);
          });
        } else this.leave(guildId, shardId);
      } catch (error) {
        stop();
        reject(error);
      }
    });
    // ACK may arrive before Shoukaku finishes destroying the old REST player.
    // Keep ownership until BOTH settle, even when one fails: upstream leave()
    // deletes the guild player map after its await and could erase a new player.
    const results = await Promise.allSettled([acknowledged, cleanup]);
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
  }
}

/** Guild locking/voice permissions are checked by MusicService before this call. */
export async function joinMusicVoice(
  backend: Shoukaku,
  connector: MusicDiscordConnector,
  options: {
    guildId: string;
    channelId: string;
    shardId: number;
    currentChannelId: string | null;
  },
  onDiagnostic?: (diagnostic: VoiceHandshakeDiagnostic) => void
): Promise<Player> {
  const { guildId, channelId, shardId, currentChannelId } = options;
  const started = performance.now();
  const report = (diagnostic: VoiceHandshakeDiagnostic) => {
    try {
      onDiagnostic?.(diagnostic);
    } catch {
      /* reporting cannot break a voice lifecycle */
    }
  };
  const trace = connector.begin(guildId, shardId, channelId);
  let connection: Connection | undefined;
  try {
    if (currentChannelId || backend.connections.has(guildId)) {
      if (backend.connections.has(guildId) && currentChannelId)
        await connector.clearStaleVoice(guildId, shardId, 4000, () =>
          backend.leaveVoiceChannel(guildId)
        );
      else if (currentChannelId)
        await connector.clearStaleVoice(guildId, shardId);
      else await backend.leaveVoiceChannel(guildId);
    }
    trace.phase = "joining";
    const pending = backend.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: true,
    });
    connection = backend.connections.get(guildId);
    const player = await pending;
    report({
      ...trace,
      stage: "player-created",
      cleanupSent: false,
      elapsedMs: Math.round(performance.now() - started),
    });
    return player;
  } catch (error) {
    const snapshot = { ...trace };
    // Also clean up joins which failed BEFORE Shoukaku created a player.
    // Its built-in failure branch drops the connection but otherwise strands voice.
    let leaveSent = false;
    try {
      const active = backend.connections.get(guildId);
      // Never let a failed/stale attempt destroy somebody else's new player.
      // Production callers also hold MusicService's existing per-guild lock.
      if (
        connector.owns(guildId, trace) &&
        (!active || active === connection) &&
        !backend.players.has(guildId)
      ) {
        await backend.leaveVoiceChannel(guildId);
        if (
          trace.joinSent &&
          connector.owns(guildId, trace) &&
          !backend.connections.has(guildId) &&
          !backend.players.has(guildId)
        ) {
          connector.leave(guildId, shardId);
          leaveSent = true;
        }
      }
    } catch {
      /* retain the original failure and report incomplete cleanup */
    }
    report({
      ...snapshot,
      stage:
        snapshot.stateReceived &&
        snapshot.serverReceived &&
        snapshot.endpointPresent
          ? "player-failed"
          : "gateway-failed",
      cleanupSent: leaveSent,
      elapsedMs: Math.round(performance.now() - started),
    });
    throw new Error(
      [
        snapshot.stateReceived &&
        snapshot.serverReceived &&
        snapshot.endpointPresent
          ? "Discord supplied both voice handshake events; Lavalink player setup failed."
          : "Discord voice handshake failed before a Lavalink audio player was created.",
        `Join sent: ${snapshot.joinSent}; own voice state received: ${snapshot.stateReceived}; voice server received: ${snapshot.serverReceived}; endpoint present: ${snapshot.endpointPresent}; voice-leave cleanup sent: ${leaveSent}.`,
        `Gateway client ready: ${snapshot.clientReady}; target shard ready: ${snapshot.shardReady}; GuildVoiceStates intent enabled: ${snapshot.voiceIntent}.`,
        `Raw voice listener attached: ${snapshot.rawListenerAttached}; bot identity matches: ${snapshot.identityMatches}; guild voice events observed: ${snapshot.guildVoiceEvents}; own state for unexpected channel: ${snapshot.unexpectedState}; wrong-shard event: ${snapshot.wrongShardEvent}.`,
        errorDiagnostic(error),
        "Check channel capacity and View Channel/Connect/Speak permissions, GuildVoiceStates intent, the gateway shard, and that only ONE host/editor/Compose bot uses this token. Try a normal, non-full voice channel. This is not a YouTube lookup/plugin or browser-audio failure; changing Docker's published audio ports does not repair missing gateway events.",
      ].join("\n")
    );
  } finally {
    connector.finish(guildId, trace);
  }
}
