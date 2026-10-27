import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IDLE_SECONDS,
  EMPTY_CHANNEL_GRACE_SECONDS,
  IdleDisconnector,
  type TimerSource,
} from "../apps/bot/src/features/music/idle";

/**
 * Fake timers with an explicit clock, so the policy is asserted without waiting.
 * `run` fires only handles that are still registered, mirroring Node.
 */
function fakeTimers() {
  let now = 0;
  const scheduled = new Map<number, { at: number; callback: () => void }>();
  let nextHandle = 1;
  const timers: TimerSource = {
    set(callback, milliseconds) {
      const handle = nextHandle++;
      scheduled.set(handle, { at: now + milliseconds, callback });
      return handle;
    },
    clear(handle) {
      scheduled.delete(handle as number);
    },
  };
  return {
    timers,
    now: () => now,
    /** Advance the clock, firing due timers in time order. */
    async advance(milliseconds: number) {
      now += milliseconds;
      for (const [handle, entry] of [...scheduled].sort(
        (a, b) => a[1].at - b[1].at
      )) {
        if (entry.at > now) continue;
        scheduled.delete(handle);
        entry.callback();
        await Promise.resolve();
      }
    },
    pending: () => scheduled.size,
  };
}

describe("idle voice policy", () => {
  it("waits before leaving when the queue finishes", async () => {
    const clock = fakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleDisconnector(onIdle, {
      timers: clock.timers,
      now: clock.now,
    });
    idle.schedule("guild", "queue-finished", DEFAULT_IDLE_SECONDS);
    await clock.advance(DEFAULT_IDLE_SECONDS * 1000 - 1);
    expect(onIdle).not.toHaveBeenCalled();
    await clock.advance(1);
    expect(onIdle).toHaveBeenCalledWith("guild", "queue-finished");
    expect(idle.size).toBe(0);
  });

  it("replaces a pending timer instead of stacking a second leave", async () => {
    const clock = fakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleDisconnector(onIdle, {
      timers: clock.timers,
      now: clock.now,
    });
    idle.schedule("guild", "queue-finished", 60);
    idle.schedule("guild", "track-failed", 10);
    expect(clock.pending()).toBe(1);
    expect(idle.reason("guild")).toBe("track-failed");
    await clock.advance(10_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    expect(onIdle).toHaveBeenCalledWith("guild", "track-failed");
    await clock.advance(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("cancels on new activity and never fires the cancelled timer", async () => {
    const clock = fakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleDisconnector(onIdle, {
      timers: clock.timers,
      now: clock.now,
    });
    idle.schedule("guild", "queue-finished", 30);
    idle.cancel("guild");
    expect(idle.reason("guild")).toBeUndefined();
    await clock.advance(30_000);
    expect(onIdle).not.toHaveBeenCalled();
    // Cancelling twice is not an error.
    idle.cancel("guild");
  });

  it("leaves immediately when the configured timeout is zero", async () => {
    const clock = fakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleDisconnector(onIdle, {
      timers: clock.timers,
      now: clock.now,
    });
    idle.schedule("guild", "queue-finished", 0);
    await clock.advance(0);
    expect(onIdle).toHaveBeenCalledWith("guild", "queue-finished");
  });

  it("uses the documented empty-channel grace and clears every guild on shutdown", async () => {
    const clock = fakeTimers();
    const onIdle = vi.fn();
    const idle = new IdleDisconnector(onIdle, {
      timers: clock.timers,
      now: clock.now,
    });
    idle.schedule("a", "alone", EMPTY_CHANNEL_GRACE_SECONDS);
    idle.schedule("b", "queue-finished", 300);
    expect(idle.size).toBe(2);
    expect(idle.dueIn("a")).toBe(EMPTY_CHANNEL_GRACE_SECONDS * 1000);
    idle.clear();
    expect(idle.size).toBe(0);
    await clock.advance(1_000_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("keeps running when the callback throws", async () => {
    const clock = fakeTimers();
    const idle = new IdleDisconnector(
      () => {
        throw new Error("cleanup failed");
      },
      { timers: clock.timers, now: clock.now }
    );
    idle.schedule("guild", "queue-finished", 1);
    await expect(clock.advance(1_000)).resolves.toBeUndefined();
    expect(idle.size).toBe(0);
  });
});
