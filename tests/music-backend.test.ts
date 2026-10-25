import { EventEmitter } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Client } from "discord.js";
import { Shoukaku } from "shoukaku";
import { WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicBackend } from "../apps/bot/src/features/music/backend";
import { MusicDiscordConnector } from "../apps/bot/src/features/music/voice";

const backends: MusicBackend[] = [];
const servers: Array<() => Promise<void>> = [];
const auth = "PRIVATE_OFFLINE_BACKEND_PASSWORD";
async function listen(server: Server, port = 0) {
  await new Promise<void>((resolve) =>
    server.listen(port, "127.0.0.1", resolve)
  );
  return (server.address() as AddressInfo).port;
}
async function unusedPort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
function transport() {
  const client = Object.assign(new EventEmitter(), {
    user: { id: "120000000000000001" },
    isReady: () => false,
    ws: { shards: new Map() },
  });
  return {
    client,
    connector: new MusicDiscordConnector(client as unknown as Client),
  };
}
async function fakeLavalink(port: number, password = auth) {
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end("{}"); // session-resumption PATCH only, no provider/Discord I/O
  });
  const websocket = new WebSocketServer({ noServer: true });
  const sessions: Array<string | undefined> = [];
  let accepted = 0;
  server.on("upgrade", (request, socket, head) => {
    if (request.headers.authorization !== password) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    websocket.handleUpgrade(request, socket, head, (connection) => {
      accepted++;
      sessions.push(request.headers["session-id"] as string | undefined);
      connection.send(
        JSON.stringify({
          op: "ready",
          sessionId: "PRIVATE_BACKEND_SESSION",
          resumed: false,
        })
      );
    });
  });
  await listen(server, port);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const client of websocket.clients) client.terminate();
    await Promise.all([
      new Promise<void>((resolve) => websocket.close(() => resolve())),
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
    ]);
  };
  servers.push(close);
  return { sessions, close, accepted: () => accepted };
}
function recovering(port: number) {
  const t = transport();
  const backend = new MusicBackend(
    t.connector,
    [{ name: "main", url: `127.0.0.1:${port}`, auth }],
    { resume: true, resumeTimeout: 60, restTimeout: 0.1 },
    { retryDelayMs: 10, maxRetryDelayMs: 30 }
  );
  const errors: string[] = [];
  const ready = vi.fn();
  const disconnected = vi.fn();
  backend.on("error", (_name, error) => errors.push(error.message));
  backend.on("ready", ready);
  backend.on("disconnect", disconnected);
  backends.push(backend);
  t.client.emit("clientReady");
  return { backend, errors, ready, disconnected };
}
const eventually = (check: () => unknown) =>
  vi.waitFor(check, { interval: 10, timeout: 3000 });
const pause = () => new Promise((resolve) => setTimeout(resolve, 80));
afterEach(async () => {
  for (const backend of backends.splice(0)) backend.stop();
  for (const close of servers.splice(0)) await close();
});

describe("real Shoukaku WebSockets with an offline local Lavalink fixture", () => {
  it("reproduces 4.3.0 closing its successful retry because the old connectError is retained", async () => {
    const port = await unusedPort();
    const t = transport();
    const backend = new Shoukaku(
      t.connector,
      [{ name: "main", url: `127.0.0.1:${port}`, auth }],
      {
        reconnectTries: 10,
        reconnectInterval: 0.05,
      }
    );
    const errors: string[] = [];
    backend.on("error", (_name, error) => errors.push(error.message));
    t.client.emit("clientReady");
    await eventually(() => expect(errors.join(" ")).toContain("ECONNREFUSED"));
    const server = await fakeLavalink(port);
    await eventually(() => expect(server.accepted()).toBe(1));
    await eventually(() => expect(backend.nodes.size).toBe(0));
    expect(backend.getIdealNode()).toBeUndefined();
    expect(errors.join(" ")).toContain(
      "closed before a connection was established"
    );
  });

  it("recovers when the bot starts before Lavalink and keeps the later connection open", async () => {
    const port = await unusedPort();
    const t = recovering(port);
    await eventually(() => expect(t.disconnected).toHaveBeenCalled());
    const server = await fakeLavalink(port);
    await eventually(() => expect(t.backend.getIdealNode()).toBeDefined());
    await pause();
    expect(t.backend.options.reconnectTries).toBe(1);
    expect(t.ready).toHaveBeenCalledOnce();
    expect(t.backend.nodes.size).toBe(1);
    expect(server.accepted()).toBe(1);
    expect(t.backend.getIdealNode()?.sessionId).toBe("PRIVATE_BACKEND_SESSION");
  });

  it("keeps retrying after extended downtime instead of permanently dropping the configured node", async () => {
    const port = await unusedPort();
    const t = recovering(port);
    await eventually(() =>
      expect(t.disconnected.mock.calls.length).toBeGreaterThanOrEqual(5)
    );
    const server = await fakeLavalink(port);
    await eventually(() => expect(t.ready).toHaveBeenCalledOnce());
    expect(t.backend.getIdealNode()).toBeDefined();
    expect(server.accepted()).toBe(1);
  });

  it("recovers from a backend restart with the same node/REST identity and resumable session header", async () => {
    const port = await unusedPort();
    const first = await fakeLavalink(port);
    const t = recovering(port);
    await eventually(() => expect(t.ready).toHaveBeenCalledOnce());
    const original = t.backend.getIdealNode();
    await first.close();
    await eventually(() => expect(t.disconnected).toHaveBeenCalled());
    const restarted = await fakeLavalink(port);
    await eventually(() => expect(t.ready).toHaveBeenCalledTimes(2));
    expect(t.backend.getIdealNode()).toBe(original);
    expect(restarted.sessions).toContain("PRIVATE_BACKEND_SESSION");
    expect(restarted.accepted()).toBe(1);
  });

  it("does not claim readiness for an authentication failure or leak the password", async () => {
    const port = await unusedPort();
    await fakeLavalink(port, "a-different-offline-password");
    const t = recovering(port);
    await eventually(() => expect(t.disconnected).toHaveBeenCalled());
    expect(t.backend.getIdealNode()).toBeUndefined();
    expect(t.ready).not.toHaveBeenCalled();
    expect(t.errors.join(" ")).toContain("401");
    expect(t.errors.join(" ")).not.toContain(auth);
  });

  it("cancels pending retry timers on shutdown; a later backend must not reconnect", async () => {
    const port = await unusedPort();
    const t = recovering(port);
    await eventually(() => expect(t.disconnected).toHaveBeenCalled());
    t.backend.stop();
    const server = await fakeLavalink(port);
    await pause();
    expect(server.accepted()).toBe(0);
    expect(t.backend.nodes.size).toBe(0);
    expect(t.ready).not.toHaveBeenCalled();
  });

  it("closes an established socket on shutdown without its automatic reconnect", async () => {
    const port = await unusedPort();
    const server = await fakeLavalink(port);
    const t = recovering(port);
    await eventually(() => expect(t.ready).toHaveBeenCalledOnce());
    t.backend.stop();
    await pause();
    expect(server.accepted()).toBe(1);
    expect(t.backend.nodes.size).toBe(0);
    expect(t.ready).toHaveBeenCalledOnce();
  });
});
