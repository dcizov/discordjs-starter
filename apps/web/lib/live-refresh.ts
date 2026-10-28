/**
 * Polling policy for dashboard surfaces that track backend work.
 *
 * This module is deliberately React-free. Every scheduling decision is a pure
 * function of observable state, so the behaviour that is easy to get wrong —
 * polling forever after the work finished, retrying in a tight loop while the
 * backend is down, acting on a response that a newer request has already
 * superseded — is unit-testable without a DOM. The React binding in
 * `use-live-refresh.ts` is thin glue over these decisions.
 *
 * Why bounded polling rather than a socket: the work being tracked (a BullMQ
 * job, an apply run) progresses in seconds, is owned by the worker rather than
 * by the browser, and must survive the page being closed. Polling a small
 * status document is enough, adds no connection state to the app, and degrades
 * to "the operator reloads" instead of "the operator sees a dead socket".
 */

/** Poll every this often while the tracked work is in flight. */
export const ACTIVE_POLL_MS = 2_000;
/** Poll every this often while nothing is in flight. 0 means "do not poll". */
export const IDLE_POLL_MS = 30_000;
/** How long to keep retrying after repeated failures before slowing right down. */
export const MAX_BACKOFF_MS = 60_000;

export type PollInputs = {
  /** The tracked work is still in flight. */
  active: boolean;
  /** Consecutive failed polls, 0 when the last poll succeeded. */
  failures: number;
  /** The tab is hidden, so timers are throttled and nobody is looking. */
  hidden: boolean;
  /** Poll interval while active. */
  activeMs?: number;
  /** Poll interval while idle; 0 disables idle polling entirely. */
  idleMs?: number;
  /**
   * A `Retry-After` the server asked for, in milliseconds. Honoured when it
   * is longer than the backoff we would otherwise have used, and ignored when
   * it is absent or unparseable.
   */
  retryAfterMs?: number | null;
};

/**
 * Milliseconds until the next poll, or `null` when nothing should be scheduled.
 *
 * The idle branch is what stops a dashboard tab from quietly re-requesting the
 * same list forever: with the default `idleMs` of 30s an idle surface still
 * notices another tab's change, and passing `idleMs: 0` stops it completely.
 *
 * Errors back off instead of hammering a backend that is already struggling,
 * and a hidden tab does not poll at all — it reconciles once on return.
 */
export function nextPollDelay({
  active,
  failures,
  hidden,
  activeMs = ACTIVE_POLL_MS,
  idleMs = IDLE_POLL_MS,
  retryAfterMs = null,
}: PollInputs): number | null {
  if (hidden) return null;
  /*
   * Resolve the interval for this state first, and let a zero interval end the
   * decision here.
   *
   * `idleMs: 0` means "there is nothing to poll once the work has settled", and
   * that promise has to survive a failure too. The previous version branched on
   * `failures` before it looked at the interval, and backing off from a base of
   * zero is zero — so a rate-limited tab rescheduled itself with a delay of
   * 0ms, forever. That is what produced ~350 requests/second against
   * `/templates/runs/null`: the request was wrong, but the loop is what turned
   * a wrong request into 15,000 of them.
   */
  const base = active ? activeMs : idleMs;
  if (base <= 0) return null;
  if (failures <= 0) return base;
  const backoff = backoffDelay(failures, base);
  return typeof retryAfterMs === "number" && retryAfterMs > 0
    ? Math.max(backoff, retryAfterMs)
    : backoff;
}

/**
 * Exponential backoff with a hard ceiling, doubling from `base`.
 *
 * Deterministic, so a test can assert the exact schedule instead of tolerating
 * a range. The ceiling keeps a long outage from producing an interval nobody
 * would wait for.
 */
export function backoffDelay(failures: number, base: number): number {
  if (base <= 0) return 0;
  if (failures <= 1) return base;
  const exponent = Math.min(failures - 1, 20);
  return Math.min(base * 2 ** exponent, MAX_BACKOFF_MS);
}

/**
 * Discards responses that a newer request has already superseded.
 *
 * Two requests can be in flight at once (an interval fires while a manual
 * refresh is still running), and the one that started first can land last.
 * Without a guard, a slow stale response overwrites fresh data with an older
 * snapshot — which is worse than showing nothing.
 */
export function createSequenceGuard() {
  let issued = 0;
  let applied = 0;
  return {
    /** Take the next ticket for an outgoing request. */
    claim() {
      issued += 1;
      return issued;
    },
    /**
     * True when `ticket` is the newest request taken so far. Calling this also
     * records the ticket as applied, so an older response arriving afterwards
     * is rejected even if this one is dropped by the caller.
     */
    isCurrent(ticket: number) {
      // Strictly newer: a ticket is honoured at most once, so a duplicated
      // delivery cannot re-apply a value that has already been superseded.
      const current = ticket > applied;
      if (current) applied = ticket;
      return current;
    },
  };
}

/** Run/job states that mean "the backend is still working on this". */
export const IN_FLIGHT_STATES = [
  "queued",
  "running",
  "active",
  "waiting",
  "delayed",
] as const;

export function isInFlight(state: string | null | undefined): boolean {
  return !!state && (IN_FLIGHT_STATES as readonly string[]).includes(state);
}

/** Terminal states, kept explicit so an unknown state is never treated as done. */
export const TERMINAL_STATES = [
  "completed",
  "succeeded",
  "failed",
  "partial",
  "cancelled",
] as const;

export function isTerminal(state: string | null | undefined): boolean {
  return !!state && (TERMINAL_STATES as readonly string[]).includes(state);
}
