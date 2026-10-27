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
import { describe, expect, it } from "vitest";

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
