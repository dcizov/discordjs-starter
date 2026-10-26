/**
 * When Orbit leaves a voice channel.
 *
 * Every path that ends playback used to leave voice immediately: a finished
 * queue, a failing track, or a queue that emptied after a skip. That reads as a
 * random disconnect to the listeners, and worse, it destroyed the player so the
 * next `/play` had to rebuild the whole voice connection. This module owns the
 * decision and the timers:
 *
 * - **queue finished / track failed / nothing left** → wait `idleDisconnectSeconds`
 *   (guild setting, default 60) so somebody can queue the next track without a
 *   reconnect; `0` restores the old immediate leave.
 * - **channel empty** → wait a fixed grace period
 *   ({@link EMPTY_CHANNEL_GRACE_SECONDS}) in case a listener reconnects.
 * - **explicit stop, disconnect, or node loss** → the caller leaves directly and
 *   cancels any pending timer; there is nothing to wait for.
 *
 * The controller holds one timer per guild. Scheduling again replaces the pending
 * timer instead of stacking, `cancel` is safe to call when nothing is scheduled,
 * and handles are `unref`ed so a pending leave cannot keep the process alive.
 * Timers are injected, so tests assert the policy without waiting in real time.
 */

export type IdleReason = "queue-finished" | "track-failed" | "alone";

/** How long Orbit waits after the last listener leaves the voice channel. */
export const EMPTY_CHANNEL_GRACE_SECONDS = 15;

/** Default wait before leaving voice once nothing is queued. */
export const DEFAULT_IDLE_SECONDS = 60;

export type TimerHandle = unknown;

export interface TimerSource {
  set(callback: () => void, milliseconds: number): TimerHandle;
  clear(handle: TimerHandle): void;
}

/** Production timers: `unref` so a scheduled leave never holds the process open. */
export const systemTimers: TimerSource = {
  set(callback, milliseconds) {
    const handle = setTimeout(callback, milliseconds);
    // Node's timer type is not in the DOM lib used by the web build.
    (handle as unknown as { unref?: () => void }).unref?.();
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

type Pending = {
  handle: TimerHandle;
  reason: IdleReason;
  dueAt: number;
};

export class IdleDisconnector {
  private readonly pending = new Map<string, Pending>();
  private readonly timers: TimerSource;
  private readonly now: () => number;

  constructor(
    /**
     * Runs when the grace period elapses. The caller re-checks the guild state
     * inside its own lock: "idle" is a snapshot, not an authorization.
     */
    private readonly onIdle: (guildId: string, reason: IdleReason) => void,
    options: { timers?: TimerSource; now?: () => number } = {}
  ) {
    this.timers = options.timers ?? systemTimers;
    this.now = options.now ?? Date.now;
  }

  /**
   * Schedule the leave. Re-scheduling always replaces the previous reason and
   * deadline, so "queue finished" can be upgraded to "track failed" without two
   * timers racing to leave twice.
   */
  schedule(guildId: string, reason: IdleReason, seconds: number) {
    this.cancel(guildId);
    const delay = Math.max(0, Math.round(seconds * 1000));
    const handle = this.timers.set(() => {
      // Only the timer that is still registered may fire; a replaced timer that
      // somehow survived `clear` must not leave the channel early.
      if (this.pending.get(guildId)?.handle !== handle) return;
      this.pending.delete(guildId);
      try {
        this.onIdle(guildId, reason);
      } catch {
        // The callback reports its own failures; a timer cannot propagate one.
      }
    }, delay);
    this.pending.set(guildId, { handle, reason, dueAt: this.now() + delay });
  }

  cancel(guildId: string) {
    const pending = this.pending.get(guildId);
    if (!pending) return;
    this.timers.clear(pending.handle);
    this.pending.delete(guildId);
  }

  clear() {
    for (const guildId of [...this.pending.keys()]) this.cancel(guildId);
  }

  /** Pending reason, for logs and tests; `undefined` when nothing is scheduled. */
  reason(guildId: string) {
    return this.pending.get(guildId)?.reason;
  }

  /** Milliseconds until the pending leave, or `undefined` when none is pending. */
  dueIn(guildId: string) {
    const pending = this.pending.get(guildId);
    return pending ? Math.max(0, pending.dueAt - this.now()) : undefined;
  }

  get size() {
    return this.pending.size;
  }
}
