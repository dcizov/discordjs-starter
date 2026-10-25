import { EventEmitter } from "node:events";
import {
  GatewayIntentBits,
  IntentsBitField,
  Status,
  type Client,
} from "discord.js";
import {
  Shoukaku,
  Connection,
  Constants,
  type Node,
  type Player,
} from "shoukaku";
import { describe, expect, it, vi } from "vitest";
import {
  joinMusicVoice,
  MusicDiscordConnector,
} from "../apps/bot/src/features/music/voice";
const guildId = "120000000000000001",
  botId = "120000000000000012",
  channelId = "120000000000000111";
type Mode =
  "state-first" | "server-first" | "no-server" | "no-events" | "wrong-channel";
function setup(
  mode: Mode = "state-first",
  initiallyJoined = false,
  alreadyReady = false,
  synchronous = false
) {
  let activeMode = mode;
  const client = Object.assign(new EventEmitter(), {
    user: { id: botId },
    guilds: { cache: new Map([[guildId, { shardId: 0 }]]) },
    ws: {
      shards: new Map<
        number,
        { status: Status; send: ReturnType<typeof vi.fn> }
      >(),
    },
    isReady: () => alreadyReady,
    options: {
      intents: new IntentsBitField([GatewayIntentBits.GuildVoiceStates]),
    },
  });
  let joined = initiallyJoined;
  const state = (id: string | null) =>
    client.emit("raw", {
      t: "VOICE_STATE_UPDATE",
      d: {
        guild_id: guildId,
        user_id: botId,
        channel_id: id,
        session_id: "PRIVATE_VOICE_SESSION",
        self_deaf: true,
        self_mute: false,
      },
    });
  const server = () =>
    client.emit("raw", {
      t: "VOICE_SERVER_UPDATE",
      d: {
        guild_id: guildId,
        endpoint: "private-voice.discord.example",
        token: "PRIVATE_VOICE_TOKEN",
      },
    });
  const send = vi.fn((payload: any) => {
    const dispatch = () => {
      if (payload.d.channel_id === null) {
        joined = false;
        state(null);
        return;
      }
      if (activeMode === "no-events") return;
      const wasJoined = joined;
      joined = true;
      if (activeMode === "server-first" && !wasJoined) server();
      state(activeMode === "wrong-channel" ? "120000000000000999" : channelId);
      if (
        (activeMode === "state-first" || activeMode === "wrong-channel") &&
        !wasJoined
      )
        server();
    };
    if (synchronous) dispatch();
    else queueMicrotask(dispatch);
  });
  client.ws.shards.set(0, { send, status: Status.Ready });
  const connector = new MusicDiscordConnector(client as unknown as Client);
  const backend = new Shoukaku(connector, [], {
    voiceConnectionTimeout: 0.025,
  });
  if (!alreadyReady) client.emit("clientReady");
  const node = {
    manager: backend,
    name: "test",
    rest: {
      updatePlayer: vi.fn(async () => ({})),
      destroyPlayer: vi.fn(async () => undefined),
    },
  } as unknown as Node;
  vi.spyOn(backend, "getIdealNode").mockReturnValue(node);
  return {
    client,
    connector,
    backend,
    send,
    node,
    state,
    setMode: (value: Mode) => {
      activeMode = value;
    },
  };
}
const options = { guildId, channelId, shardId: 0, currentChannelId: null };

describe("real Shoukaku handshake with an offline gateway transport fixture", () => {
  it.each(["state-first", "server-first"] as const)(
    "creates a player with either Discord event order (%s)",
    async (order) => {
      const t = setup(order);
      const player = await joinMusicVoice(t.backend, t.connector, options);
      expect(player.guildId).toBe(guildId);
      expect(t.node.rest.updatePlayer).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId,
          playerOptions: {
            voice: expect.objectContaining({
              channelId,
              sessionId: "PRIVATE_VOICE_SESSION",
              token: "PRIVATE_VOICE_TOKEN",
            }),
          },
        })
      );
      await t.backend.leaveVoiceChannel(guildId);
    }
  );
  it("forwards synchronous transport acknowledgements only after the SDK installs its waiter", async () => {
    const t = setup("server-first", false, false, true);
    const report = vi.fn();
    const player = await joinMusicVoice(
      t.backend,
      t.connector,
      options,
      report
    );
    expect(report.mock.calls[0][0].guildVoiceEvents).toBe(2);
    expect(player.guildId).toBe(guildId);
    expect(t.node.rest.updatePlayer).toHaveBeenCalledTimes(1);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("can retry a failed attempt without leaked listeners, stale packets or an older cleanup cancelling it", async () => {
    const t = setup("no-events");
    await joinMusicVoice(t.backend, t.connector, options).catch(
      () => undefined
    );
    expect(t.backend.connections.size).toBe(0);
    expect(t.backend.players.size).toBe(0);
    expect(t.client.listenerCount("raw")).toBe(1);
    t.setMode("server-first");
    const player = await joinMusicVoice(t.backend, t.connector, options);
    expect(t.backend.players.get(guildId)).toBe(player);
    expect(t.send.mock.calls.map(([packet]) => packet.d.channel_id)).toEqual([
      channelId,
      null,
      channelId,
    ]);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("separates a player REST failure AFTER both gateway events, and emits only scalar safe diagnostics", async () => {
    const t = setup();
    const report = vi.fn();
    vi.mocked(t.node.rest.updatePlayer).mockRejectedValueOnce(
      new Error("Player REST unavailable")
    );
    await expect(
      joinMusicVoice(t.backend, t.connector, options, report)
    ).rejects.toThrow(
      "both voice handshake events; Lavalink player setup failed"
    );
    const diagnostic = report.mock.calls[0][0];
    expect(diagnostic).toMatchObject({
      stage: "player-failed",
      stateReceived: true,
      serverReceived: true,
      endpointPresent: true,
      rawListenerAttached: true,
      identityMatches: true,
    });
    expect(
      Object.values(diagnostic).every((value) => typeof value !== "object")
    ).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toMatch(/PRIVATE_|private-voice/);
    expect(t.backend.players.size).toBe(0);
  });
  it("does not forward another bot's state or another guild's server payload to this join", async () => {
    const t = setup("no-events");
    const pending = joinMusicVoice(t.backend, t.connector, options);
    t.client.emit(
      "raw",
      {
        t: "VOICE_STATE_UPDATE",
        d: {
          guild_id: guildId,
          user_id: "another-bot",
          channel_id: channelId,
          session_id: "PRIVATE_WRONG_SESSION",
        },
      },
      0
    );
    t.client.emit(
      "raw",
      {
        t: "VOICE_SERVER_UPDATE",
        d: {
          guild_id: "another-guild",
          token: "PRIVATE_WRONG_TOKEN",
          endpoint: "private-wrong.example",
        },
      },
      0
    );
    await expect(pending).rejects.toThrow(
      "own voice state received: false; voice server received: false"
    );
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("drops voice events from an incorrect shard and reports the routing mismatch", async () => {
    const t = setup("no-events");
    const pending = joinMusicVoice(t.backend, t.connector, options);
    t.client.emit(
      "raw",
      {
        t: "VOICE_STATE_UPDATE",
        d: {
          guild_id: guildId,
          user_id: botId,
          channel_id: channelId,
          session_id: "PRIVATE_WRONG_SESSION",
        },
      },
      1
    );
    await expect(pending).rejects.toThrow("wrong-shard event: true");
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("rejects detached listeners or a mismatched bot identity before sending a join", async () => {
    const t = setup();
    t.backend.id = "another-bot";
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("identity");
    expect(t.send).not.toHaveBeenCalled();
    t.backend.id = botId;
    t.connector.dispose();
    expect(t.client.listenerCount("raw")).toBe(0);
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("not attached");
    expect(t.send).not.toHaveBeenCalled();
  });
  it("initializes identity and registers one raw listener when constructed after clientReady", async () => {
    const t = setup("server-first", false, true);
    await Promise.resolve();
    expect(t.backend.id).toBe(botId);
    expect(t.client.listenerCount("raw")).toBe(1);
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).resolves.toHaveProperty("guildId", guildId);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("rejects a concurrent join before it can disconnect an in-flight attempt", async () => {
    const t = setup("no-events");
    const first = joinMusicVoice(t.backend, t.connector, options).catch(
      (error: Error) => error
    );
    await Promise.resolve();
    const connection = t.backend.connections.get(guildId);
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("already in progress");
    expect(t.backend.connections.get(guildId)).toBe(connection);
    await first;
  });
  it("does not pair a stale own state from another channel with this attempt's server event", async () => {
    const t = setup("wrong-channel");
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("unexpected channel: true");
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("validates the target guild's real shard, not merely whether some shard exists", async () => {
    const t = setup();
    t.client.ws.shards.set(1, { send: vi.fn(), status: Status.Ready });
    await expect(
      joinMusicVoice(t.backend, t.connector, { ...options, shardId: 1 })
    ).rejects.toThrow("belongs to gateway shard 0");
    expect(t.send).not.toHaveBeenCalled();
  });

  it("waits for old Lavalink player destruction as well as the Discord leave acknowledgement", async () => {
    const t = setup("state-first", true);
    const connection = new Connection(t.backend, {
      guildId,
      channelId,
      shardId: 0,
    });
    connection.state = Constants.State.CONNECTED;
    t.backend.connections.set(guildId, connection);
    let release!: () => void;
    const destroyed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const old = {
      destroy: () => destroyed,
      clean: vi.fn(),
    } as unknown as Player;
    t.backend.players.set(guildId, old);
    const pending = joinMusicVoice(t.backend, t.connector, {
      ...options,
      currentChannelId: channelId,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const channelsBeforeDestruction = t.send.mock.calls.map(
      ([packet]) => packet.d.channel_id
    );
    release();
    const player = await pending;
    expect(channelsBeforeDestruction).toEqual([null]);
    expect(t.backend.players.get(guildId)).toBe(player);
    expect(old.clean).toHaveBeenCalledTimes(1);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("does not send an old cleanup leave if a replacement appeared during its await", async () => {
    const t = setup("no-events");
    const replacement = new Connection(t.backend, {
      guildId,
      channelId,
      shardId: 0,
    });
    const player = {
      destroy: async () => undefined,
      clean: vi.fn(),
    } as unknown as Player;
    const leave = vi
      .spyOn(t.backend, "leaveVoiceChannel")
      .mockImplementationOnce(async () => {
        await Promise.resolve();
        t.backend.connections.set(guildId, replacement);
        t.backend.players.set(guildId, player);
      });
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("cleanup sent: false");
    expect(t.backend.connections.get(guildId)).toBe(replacement);
    expect(t.backend.players.get(guildId)).toBe(player);
    expect(t.send.mock.calls).toHaveLength(1); // failed attempt's join only, not a destructive leave
    leave.mockRestore();
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("refuses an uncached guild rather than guessing which client/shard owns it", async () => {
    const t = setup();
    t.client.guilds.cache.clear();
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("not cached");
    expect(t.send).not.toHaveBeenCalled();
  });
  it("reproduces a same-channel no-op timeout, then recovers by leaving the orphan first", async () => {
    const t = setup("state-first", true);
    // This is the upstream failure mode: no fresh VOICE_SERVER_UPDATE on a no-op join.
    await expect(
      t.backend.joinVoiceChannel({ guildId, channelId, shardId: 0 })
    ).rejects.toThrow("not established");
    expect(t.backend.connections.has(guildId)).toBe(false);
    expect(t.send.mock.calls.at(-1)![0].d.channel_id).toBe(channelId); // upstream did not leave
    const player = await joinMusicVoice(t.backend, t.connector, {
      ...options,
      currentChannelId: channelId,
    });
    expect(player.guildId).toBe(guildId);
    expect(t.send.mock.calls.map(([packet]) => packet.d.channel_id)).toEqual([
      channelId,
      null,
      channelId,
    ]);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("cleans up a failed join before player creation and reports missing events without secrets", async () => {
    const t = setup("no-server");
    const error = await joinMusicVoice(t.backend, t.connector, options).catch(
      (error: Error) => error
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("own voice state received: true");
    expect(message).toContain("voice server received: false");
    for (const secret of [
      "PRIVATE_VOICE_SESSION",
      "PRIVATE_VOICE_TOKEN",
      "private-voice.discord.example",
    ])
      expect(message).not.toContain(secret);
    expect(t.send.mock.calls.at(-1)![0].d.channel_id).toBeNull();
    expect(t.backend.players.size).toBe(0);
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("distinguishes no gateway acknowledgements from a provider or UDP failure", async () => {
    const t = setup("no-events");
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow(
      "own voice state received: false; voice server received: false"
    );
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("fails explicitly for an absent gateway shard instead of silently dropping the join", async () => {
    const t = setup();
    t.client.ws.shards.clear();
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("gateway shard 0 is unavailable");
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("does not silently enqueue a join on a reconnecting shard or later replay it", async () => {
    const t = setup();
    t.client.ws.shards.get(0)!.status = Status.Connecting;
    const error = await joinMusicVoice(t.backend, t.connector, options).catch(
      (error: Error) => error
    );
    expect(String(error)).toContain("is not ready");
    expect(String(error)).toContain("target shard ready: false");
    expect(String(error)).toContain("Join sent: false");
    expect(t.send).not.toHaveBeenCalled();
    t.client.ws.shards.get(0)!.status = Status.Ready;
    expect(t.send).not.toHaveBeenCalled();
    expect(t.backend.connections.size).toBe(0);
  });
  it("identifies a running client without the normal voice intent before joining", async () => {
    const t = setup();
    t.client.options.intents.remove(GatewayIntentBits.GuildVoiceStates);
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("GuildVoiceStates intent enabled: false");
    expect(
      t.send.mock.calls.every(([packet]) => packet.d.channel_id === null)
    ).toBe(true); // cleanup only
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });

  it("detaches temporary stale-leave observers when disposed", async () => {
    const t = setup("no-events");
    t.client.ws.shards.set(0, { send: vi.fn(), status: Status.Ready });
    const pending = t.connector.clearStaleVoice(guildId, 0, 1000);
    expect(t.client.listenerCount("raw")).toBe(2);
    t.connector.dispose();
    await expect(pending).rejects.toThrow("connector stopped");
    expect(t.client.listenerCount("raw")).toBe(0);
  });
  it("does not mistake another member's voice event for the bot's leave acknowledgement", async () => {
    const t = setup();
    t.client.ws.shards.set(0, { send: vi.fn(), status: Status.Ready });
    const pending = t.connector.clearStaleVoice(guildId, 0, 10);
    t.client.emit("raw", {
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: guildId, user_id: "someone-else", channel_id: null },
    });
    await expect(pending).rejects.toThrow("did not acknowledge");
    expect(t.client.listenerCount("raw")).toBe(1); // only the connector remains
  });
});
