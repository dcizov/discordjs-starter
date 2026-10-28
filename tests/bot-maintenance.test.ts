import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "discord.js";
import type { MusicService } from "../apps/bot/src/features/music/service";
const f = vi.hoisted(() => ({
  sync: vi.fn(),
  state: vi.fn(),
  health: vi.fn(),
  beat: vi.fn(),
  roster: vi.fn(),
}));
vi.mock("../apps/bot/src/infrastructure/guild-sync", () => ({
  syncGuild: f.sync,
}));
vi.mock("../apps/bot/src/infrastructure/roster-sync", () => ({
  reconcileRosters: f.roster,
}));
vi.mock("@orbit/db", () => ({
  putMusicState: f.state,
  emptyMusic: () => ({}),
  setHealth: f.health,
}));
vi.mock("@orbit/core/logger", () => ({ logger: { warn: vi.fn() } }));
import { startMaintenance } from "../apps/bot/src/infrastructure/maintenance";
function dependencies() {
  return {
    client: {
      guilds: { cache: new Map([["guild", { id: "guild" }]]) },
      isReady: () => true,
      ws: { ping: 42 },
    } as unknown as Client,
    music: { heartbeat: f.beat } as unknown as MusicService,
    abort: new AbortController(),
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  f.roster.mockResolvedValue(0);
  for (const mock of [f.sync, f.state, f.health, f.beat])
    mock.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("owned bot maintenance", () => {
  it("initializes snapshots/heartbeat and clears both intervals on abort", async () => {
    const { client, music, abort } = dependencies();
    const stop = await startMaintenance(client, music, abort.signal);
    expect(f.sync).toHaveBeenCalledOnce();
    expect(f.state).toHaveBeenCalledOnce();
    // One sweep at startup, after the guild list is known.
    expect(f.roster).toHaveBeenCalledOnce();
    // Heartbeat, guild snapshot, roster reconciliation, the voice XP tick and
    // the hourly ticket sweep. The count is asserted so a new timer has to
    // acknowledge itself here, which is what makes `clear()` trustworthy: the
    // test's real point is the assertion below, that every one of them is gone
    // after abort.
    expect(vi.getTimerCount()).toBe(5);
    await vi.advanceTimersByTimeAsync(30000);
    expect(f.beat).toHaveBeenCalledTimes(2);
    // The hourly sweep is not the 30-second beat: nothing extra yet.
    expect(f.roster).toHaveBeenCalledOnce();
    abort.abort();
    await stop?.();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(300000);
    expect(f.beat).toHaveBeenCalledTimes(2);
    // Still only the startup sweep: the hourly timer was cleared on abort.
    expect(f.roster).toHaveBeenCalledOnce();
  });
  it("does not initialize snapshots or timers after stop during guild sync", async () => {
    let complete!: () => void;
    f.sync.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        complete = resolve;
      })
    );
    const { client, music, abort } = dependencies();
    const pending = startMaintenance(client, music, abort.signal);
    abort.abort();
    complete();
    await pending;
    expect(f.state).not.toHaveBeenCalled();
    expect(f.health).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("drains an in-flight heartbeat before the caller can write final offline health", async () => {
    const { client, music, abort } = dependencies();
    const stop = await startMaintenance(client, music, abort.signal);
    let finish!: () => void;
    f.health.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      })
    );
    vi.advanceTimersByTime(30000);
    abort.abort();
    let stopped = false;
    const pending = stop!().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish();
    await pending;
    expect(f.beat).toHaveBeenCalledOnce();
    expect(stopped).toBe(true);
  });
});
