import type { Client } from "discord.js";
import { Connectors, type Player, type Shoukaku } from "shoukaku";
import { errorDiagnostic } from "@orbit/core/diagnostics";

type VoicePacket = { t: string; d: Record<string, any> };
export type VoiceHandshakeTrace = {
  guildId: string;
  shardId: number;
  joinSent: boolean;
  stateReceived: boolean;
  serverReceived: boolean;
  endpointPresent: boolean;
};

/** No raw Shoukaku debug logging: those messages contain voice session IDs. */
export class MusicDiscordConnector extends Connectors.DiscordJS {
  private traces = new Map<string, VoiceHandshakeTrace>();
  private earlyServers = new Map<string, VoicePacket>();
  constructor(private readonly discord: Client) {
    super(discord);
  }
  begin(guildId: string, shardId: number) {
    this.earlyServers.delete(guildId);
    const trace = {
      guildId,
      shardId,
      joinSent: false,
      stateReceived: false,
      serverReceived: false,
      endpointPresent: false,
    };
    this.traces.set(guildId, trace);
    return trace;
  }
  finish(guildId: string) {
    this.traces.delete(guildId);
    this.earlyServers.delete(guildId);
  }
  sendPacket(shardId: number, payload: any, important: boolean) {
    const shard = this.discord.ws.shards.get(shardId);
    if (!shard)
      throw new Error(
        `Discord gateway shard ${shardId} is unavailable; no voice request could be sent.`
      );
    const trace = this.traces.get(payload?.d?.guild_id);
    if (trace && payload?.op === 4 && payload.d.channel_id)
      trace.joinSent = true;
    shard.send(payload, important);
  }
  raw(packet: VoicePacket) {
    if (!this.manager) return;
    const guildId = packet.d?.guild_id;
    const trace = this.traces.get(guildId);
    const ownState =
      packet.t === "VOICE_STATE_UPDATE" && packet.d.user_id === this.manager.id;
    if (ownState && trace && packet.d.channel_id) trace.stateReceived = true;
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
    await new Promise<void>((resolve, reject) => {
      const stop = () => {
        clearTimeout(timer);
        this.discord.off("raw", listener);
      };
      const listener = (packet: VoicePacket) => {
        if (
          packet.t === "VOICE_STATE_UPDATE" &&
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
      this.discord.on("raw", listener);
      try {
        if (request)
          void request().catch((error) => {
            stop();
            reject(error);
          });
        else this.leave(guildId, shardId);
      } catch (error) {
        stop();
        reject(error);
      }
    });
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
  }
): Promise<Player> {
  const { guildId, channelId, shardId, currentChannelId } = options;
  if (currentChannelId || backend.connections.has(guildId)) {
    // Observe the leave BEFORE issuing it. A failed join can leave no Shoukaku
    // map entry while Discord still considers the bot connected to that channel.
    if (backend.connections.has(guildId) && currentChannelId)
      await connector.clearStaleVoice(guildId, shardId, 4000, () =>
        backend.leaveVoiceChannel(guildId)
      );
    else if (currentChannelId)
      await connector.clearStaleVoice(guildId, shardId);
    else await backend.leaveVoiceChannel(guildId);
  }
  const trace = connector.begin(guildId, shardId);
  try {
    return await backend.joinVoiceChannel({
      guildId,
      channelId,
      shardId,
      deaf: true,
    });
  } catch (error) {
    const snapshot = { ...trace };
    // Also clean up joins which failed BEFORE Shoukaku created a player.
    // Its built-in failure branch drops the connection but otherwise strands voice.
    let leaveSent = false;
    try {
      await backend.leaveVoiceChannel(guildId);
      connector.leave(guildId, shardId);
      leaveSent = true;
    } catch {
      /* retain the original failure and report incomplete cleanup */
    }
    throw new Error(
      [
        snapshot.stateReceived &&
        snapshot.serverReceived &&
        snapshot.endpointPresent
          ? "Discord supplied both voice handshake events; Lavalink player setup failed."
          : "Discord voice handshake failed before a Lavalink audio player was created.",
        `Join sent: ${snapshot.joinSent}; own voice state received: ${snapshot.stateReceived}; voice server received: ${snapshot.serverReceived}; endpoint present: ${snapshot.endpointPresent}; voice-leave cleanup sent: ${leaveSent}.`,
        errorDiagnostic(error),
        "Check channel capacity and Connect/Speak permissions, GuildVoiceStates intent, the gateway shard, and that only ONE host/editor/Compose bot uses this token. Try a normal, non-full voice channel. This is not a YouTube lookup/plugin or browser-audio failure; changing Docker's published audio ports does not repair missing gateway events.",
      ].join("\n")
    );
  } finally {
    connector.finish(guildId);
  }
}
