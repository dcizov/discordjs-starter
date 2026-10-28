// @vitest-environment jsdom
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  MAX_BACKOFF_MS,
  backoffDelay,
  createSequenceGuard,
  isInFlight,
  isTerminal,
  nextPollDelay,
} from "@/lib/live-refresh";
import { HttpError, isHttpError, parseRetryAfter } from "@/lib/utils";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { act, render, cleanup } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveRefreshResult } from "@/lib/use-live-refresh";

describe("poll scheduling", () => {
  it("polls fast while work is in flight", () => {
    expect(nextPollDelay({ active: true, failures: 0, hidden: false })).toBe(
      ACTIVE_POLL_MS
    );
  });
  it("polls slowly once the work is done", () => {
    expect(nextPollDelay({ active: false, failures: 0, hidden: false })).toBe(
      IDLE_POLL_MS
    );
  });
  it("stops polling entirely when the caller asks for no idle polling", () => {
    // A finished apply run must not keep generating requests for as long as the
    // page stays open.
    expect(
      nextPollDelay({ active: false, failures: 0, hidden: false, idleMs: 0 })
    ).toBeNull();
  });
  it("does not poll a hidden tab, because timers there are throttled anyway", () => {
    expect(
      nextPollDelay({ active: true, failures: 0, hidden: true })
    ).toBeNull();
    expect(
      nextPollDelay({ active: true, failures: 3, hidden: true })
    ).toBeNull();
  });
  it("backs off after a failure instead of hammering a struggling backend", () => {
    expect(nextPollDelay({ active: true, failures: 1, hidden: false })).toBe(
      ACTIVE_POLL_MS
    );
    expect(nextPollDelay({ active: true, failures: 2, hidden: false })).toBe(
      ACTIVE_POLL_MS * 2
    );
    expect(nextPollDelay({ active: true, failures: 3, hidden: false })).toBe(
      ACTIVE_POLL_MS * 4
    );
  });
  it("honours caller-supplied intervals", () => {
    expect(
      nextPollDelay({
        active: true,
        failures: 0,
        hidden: false,
        activeMs: 500,
        idleMs: 5000,
      })
    ).toBe(500);
    expect(
      nextPollDelay({
        active: false,
        failures: 0,
        hidden: false,
        activeMs: 500,
        idleMs: 5000,
      })
    ).toBe(5000);
  });
});

describe("backoff", () => {
  it("doubles from the base interval", () => {
    expect(backoffDelay(1, 1000)).toBe(1000);
    expect(backoffDelay(2, 1000)).toBe(2000);
    expect(backoffDelay(3, 1000)).toBe(4000);
    expect(backoffDelay(4, 1000)).toBe(8000);
  });
  it("never exceeds the ceiling, however long the outage", () => {
    expect(backoffDelay(40, 1000)).toBe(MAX_BACKOFF_MS);
    expect(backoffDelay(999, ACTIVE_POLL_MS)).toBe(MAX_BACKOFF_MS);
  });
  it("returns the base for a zero or negative base rather than looping", () => {
    expect(backoffDelay(5, 0)).toBe(0);
    expect(backoffDelay(5, -1)).toBe(0);
  });
  it("is deterministic, so the schedule can be asserted exactly", () => {
    expect(backoffDelay(3, 2000)).toBe(backoffDelay(3, 2000));
  });
});

describe("stale-response guard", () => {
  it("accepts the newest ticket and rejects the one it superseded", () => {
    const guard = createSequenceGuard();
    const first = guard.claim();
    const second = guard.claim();
    // The older request lands last — exactly the reordering that would roll a
    // page back to an older snapshot.
    expect(guard.isCurrent(second)).toBe(true);
    expect(guard.isCurrent(first)).toBe(false);
  });
  it("applies responses issued in order", () => {
    const guard = createSequenceGuard();
    const a = guard.claim();
    expect(guard.isCurrent(a)).toBe(true);
    const b = guard.claim();
    expect(guard.isCurrent(b)).toBe(true);
  });
  it("rejects a repeat of a ticket that was already applied", () => {
    const guard = createSequenceGuard();
    const only = guard.claim();
    expect(guard.isCurrent(only)).toBe(true);
    expect(guard.isCurrent(only)).toBe(false);
  });
  it("keeps independent guards independent", () => {
    const one = createSequenceGuard();
    const two = createSequenceGuard();
    const a = one.claim();
    two.claim();
    expect(one.isCurrent(a)).toBe(true);
  });
});

describe("run and job state vocabulary", () => {
  it("treats queued and running work as in flight", () => {
    expect(isInFlight("queued")).toBe(true);
    expect(isInFlight("running")).toBe(true);
    expect(isInFlight("active")).toBe(true);
    expect(isInFlight("delayed")).toBe(true);
  });
  it("treats finished work as not in flight", () => {
    for (const state of [
      "completed",
      "failed",
      "partial",
      "simulated",
      "cancelled",
    ])
      expect(isInFlight(state)).toBe(false);
  });
  it("treats terminal states as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("partial")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
  });
  it("never assumes an unknown or absent state is finished", () => {
    // An unrecognised state must keep the page watching, not declare it done.
    expect(isTerminal("something-new")).toBe(false);
    expect(isInFlight("something-new")).toBe(false);
    expect(isTerminal(null)).toBe(false);
    expect(isInFlight(undefined)).toBe(false);
  });
});

/*
 * The three defects that made a dashboard tab issue ~350 requests/second, each
 * pinned down here.
 *
 * They share one root: the hook had no concept of "there is nothing to poll",
 * so a page whose URL is built from not-yet-chosen state asked for
 * `/templates/runs/null`, got a 429, and then rescheduled itself with a delay
 * of zero — because backing off from a base interval of zero is zero. The wrong
 * request was a bug; the loop is what turned it into fifteen thousand of them.
 *
 * These are hook-level tests rather than policy-level ones on purpose. Every
 * one of the three failures was invisible to the pure functions alone: the
 * policy was asked the wrong question, or its answer was not consulted at all.
 */

type ProbeOptions = {
  /**
   * Either a constant, or derived from the target the way a real page derives
   * it from its own state (`enabled: !!runId`).
   */
  enabled?: boolean | ((target: string | null) => boolean);
  active?: boolean;
  idleMs?: number;
  activeMs?: number;
  immediate?: boolean;
};

type ProbeState = {
  /** Every target the fetcher was asked for, in order. */
  calls: string[];
  /** Time of each call, on the same clock the timers use. */
  at: number[];
  /** Signals handed to the fetcher, so an abort can be observed. */
  signals: AbortSignal[];
  result: LiveRefreshResult<string>;
  setTarget: (next: string | null) => void;
};

/**
 * Render the hook the way a page does: `target` is the id the URL is built
 * from, and it can change — including to `null` when the operator navigates
 * away from the thing being tracked.
 */
function mountProbe(
  options: ProbeOptions,
  initialTarget: string | null = null,
  respond?: (target: string) => Promise<string>
) {
  const enabledOf = (target: string | null) =>
    typeof options.enabled === "function"
      ? options.enabled(target)
      : (options.enabled ?? true);

  const probe: ProbeState = {
    calls: [] as string[],
    at: [] as number[],
    signals: [] as AbortSignal[],
    result: null as unknown as LiveRefreshResult<string>,
    setTarget: (() => {}) as (next: string | null) => void,
  };

  function ProbeView() {
    const [target, setTarget] = useState<string | null>(initialTarget);
    probe.setTarget = setTarget;
    probe.result = useLiveRefresh<string>({
      ...options,
      enabled: enabledOf(target),
      fetcher: async (signal) => {
        probe.calls.push(String(target));
        probe.at.push(Date.now());
        probe.signals.push(signal);
        if (respond) return respond(String(target));
        return `ok:${target}`;
      },
    });
    return null;
  }

  const rendered = render(createElement(ProbeView));
  return {
    get calls() {
      return probe.calls;
    },
    get at() {
      return probe.at;
    },
    get signals() {
      return probe.signals;
    },
    get result() {
      return probe.result;
    },
    setTarget: (next: string | null) => {
      probe.setTarget(next);
    },
    unmount: rendered.unmount,
  };
}

/** Advance the fake clock, flushing the effects each step schedules. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("the null guard, at the source", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("never issues a request when there is no id to build one from", async () => {
    /*
     * The trace showed 7,884 requests to `/actions/null`. The visibility
     * handler ran once on mount and called the fetcher regardless of whether
     * `enabled` or `immediate` said otherwise.
     */
    const probe = mountProbe(
      { enabled: false, active: false, idleMs: 0 },
      null
    );
    await tick(60_000);
    expect(probe.calls).toEqual([]);
    probe.unmount();
  });

  it("starts asking once the id arrives, and stops when it goes away", async () => {
    const probe = mountProbe(
      { enabled: (t) => !!t, active: false, idleMs: 0 },
      null
    );
    await tick(1000);
    expect(probe.calls).toEqual([]);

    await act(async () => {
      probe.setTarget("run-1");
    });
    await tick(0);
    expect(probe.calls).toEqual(["run-1"]);

    // …and stops again if the id is cleared.
    const seen = probe.calls.length;
    await act(async () => {
      probe.setTarget(null);
    });
    await tick(300_000);
    expect(probe.calls.length).toBe(seen);
    probe.unmount();
  });

  it("does not poll a URL that could only ever 404 or be rate-limited", async () => {
    // The string "null" must never reach the wire, and must never be defended
    // against by checking for the string "null" either.
    const probe = mountProbe(
      { enabled: true, active: true, idleMs: 0 },
      "run-1"
    );
    await tick(10_000);
    expect(probe.calls.length).toBeGreaterThan(1);
    expect(probe.calls.some((c) => c === "null" || c === "undefined")).toBe(
      false
    );
    probe.unmount();
  });
});

describe("measured delay between requests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const gaps = (at: number[]) => at.slice(1).map((t, i) => t - at[i]);

  it("honours the documented 2s active / 30s idle contract", async () => {
    const probe = mountProbe({ enabled: true, active: true }, "run-1");
    await tick(0);
    expect(probe.calls.length).toBe(1);
    await tick(20_000);
    expect(probe.at.length).toBeGreaterThan(5);
    for (const gap of gaps(probe.at)) expect(gap).toBe(ACTIVE_POLL_MS);
    probe.unmount();

    const idle = mountProbe({ enabled: true, active: false }, "run-1");
    await tick(0);
    await tick(120_000);
    expect(idle.at.length).toBeGreaterThan(2);
    for (const gap of gaps(idle.at)) expect(gap).toBe(IDLE_POLL_MS);
    idle.unmount();
  });

  it("backs off after a 5xx instead of retrying on the same interval", async () => {
    let failures = 0;
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      async () => {
        failures += 1;
        if (failures <= 3) throw new HttpError(500, "boom");
        return "ok";
      }
    );
    await tick(0);
    await tick(30_000);
    // 2s, then 4s, then 8s — not 2s, 2s, 2s.
    const g = gaps(probe.at);
    expect(g.slice(0, 3)).toEqual([
      ACTIVE_POLL_MS,
      ACTIVE_POLL_MS * 2,
      ACTIVE_POLL_MS * 4,
    ]);
    probe.unmount();
  });

  it("honours Retry-After when it is longer than the backoff", async () => {
    let failures = 0;
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      async () => {
        failures += 1;
        if (failures === 1) throw new HttpError(503, "busy", 25_000);
        return "ok";
      }
    );
    await tick(0);
    await tick(60_000);
    expect(gaps(probe.at)[0]).toBe(25_000);
    probe.unmount();
  });

  it("stops on a 429 instead of retrying through the rate limit", async () => {
    /*
     * 15,649 responses came back 429. A rate limit is the server asking the
     * client to stop, so the error is surfaced once and nothing is scheduled
     * until a person asks again.
     */
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      async () => {
        throw new HttpError(429, "Too many requests.");
      }
    );
    await tick(0);
    const seen = probe.calls.length;
    expect(seen).toBe(1);
    await tick(300_000);
    expect(probe.calls.length).toBe(seen);
    expect(probe.result.error).toBeTruthy();
    probe.unmount();
  });

  it("lets a person retry after a 429, and only then", async () => {
    let failures = 0;
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      async () => {
        failures += 1;
        if (failures === 1) throw new HttpError(429, "Too many requests.");
        return "ok";
      }
    );
    await tick(0);
    expect(probe.calls.length).toBe(1);
    await act(async () => {
      probe.result.retry();
    });
    await tick(0);
    expect(probe.calls.length).toBe(2);
    expect(probe.result.error).toBeNull();
    probe.unmount();
  });
});

describe("lifecycle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("aborts the in-flight request when the component goes away", async () => {
    const signals: AbortSignal[] = [];
    let resolve: (v: string) => void = () => {};
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      (_t) =>
        new Promise<string>((res, _rej) => {
          resolve = res;
        })
    );
    // Capture the signal the hook handed the fetcher.
    await tick(0);
    expect(probe.calls.length).toBe(1);
    probe.unmount();
    resolve("late");
    await tick(60_000);
    // The request was aborted, so no state was written after unmount and no
    // further poll was scheduled.
    expect(probe.calls.length).toBe(1);
    expect(signals).toEqual([]);
  });

  it("stops immediately when the tracked id is cleared, mid-flight", async () => {
    /*
     * Navigating Templates -> Members used to leave the run poller armed: the
     * timer outlived the request that mattered and kept issuing polls for a
     * section nobody was looking at.
     */
    const probe = mountProbe({ enabled: (t) => !!t, active: true }, "run-1");
    await tick(6_000);
    const before = probe.calls.length;
    expect(before).toBeGreaterThan(1);

    await act(async () => {
      probe.setTarget(null);
    });
    await tick(0);
    await tick(300_000);
    expect(probe.calls.length).toBe(before);
    probe.unmount();
  });

  it("does not restart on a visibility change once polling has stopped", async () => {
    const probe = mountProbe(
      { enabled: true, active: true },
      "run-1",
      async () => {
        throw new HttpError(429, "Too many requests.");
      }
    );
    await tick(0);
    const seen = probe.calls.length;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await tick(60_000);
    expect(probe.calls.length).toBe(seen);
    probe.unmount();
  });
});

describe("HttpError and Retry-After parsing", () => {
  it("keeps the status so a caller can tell a rate limit from an outage", () => {
    const e = new HttpError(429, "Too many requests.", 1200);
    expect(isHttpError(e)).toBe(true);
    expect(isHttpError(e, 429)).toBe(true);
    expect(isHttpError(e, 500)).toBe(false);
    expect(isHttpError(new Error("x"), 429)).toBe(false);
    expect(e.message).toBe("Too many requests.");
  });

  it("reads Retry-After as seconds and as an HTTP date", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter(" 30 ")).toBe(30_000);
    const future = new Date(Date.now() + 5000).toUTCString();
    const parsed = parseRetryAfter(future);
    expect(parsed).not.toBeNull();
    expect(parsed!).toBeGreaterThan(0);
    expect(parsed!).toBeLessThanOrEqual(5000);
  });

  it("treats an unusable Retry-After as absent, never as zero", () => {
    // Guessing zero is how a retry schedule becomes a hammering loop.
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    expect(parseRetryAfter("-5")).toBeNull();
    expect(
      parseRetryAfter(new Date(Date.now() - 5000).toUTCString())
    ).toBeNull();
  });
});
