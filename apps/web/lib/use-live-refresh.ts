"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSequenceGuard, nextPollDelay } from "./live-refresh";
import { isHttpError } from "./utils";

export type LiveRefreshOptions<T> = {
  /**
   * Fetch the current value. Receives an `AbortSignal` that fires when the
   * request is superseded or the component goes away.
   */
  fetcher: (signal: AbortSignal) => Promise<T>;
  /**
   * Whether there is anything to poll at all.
   *
   * This is deliberately separate from `active`: `active` says "work is in
   * flight, so poll quickly", while `enabled` says "there is no id yet, so do
   * not ask". Without it a page that builds its URL from state that starts out
   * `null` requests `/templates/runs/null` — a request that can only ever fail,
   * and which the old failure path then retried without delay.
   */
  enabled?: boolean;
  /**
   * Poll while this is true. The caller derives it from the data (a run still
   * reporting `queued` or `running`, a job not yet finished), so fast polling
   * stops the moment the backend says the work is done.
   */
  active?: boolean;
  /** Milliseconds between polls while active. */
  activeMs?: number;
  /** Milliseconds between polls while idle; 0 stops idle polling. */
  idleMs?: number;
  /** Fetch once on mount. Default true. */
  immediate?: boolean;
  /** Called only with values that were newest at the time they landed. */
  onUpdate?: (value: T) => void;
};

export type LiveRefreshResult<T> = {
  data: T | null;
  error: Error | null;
  /** A request is currently in flight. */
  refreshing: boolean;
  /** Timestamp of the last successful update, for "updated 5s ago" copy. */
  updatedAt: number | null;
  /** Fetch now, outside the schedule. */
  refresh: () => void;
  /** Clear the last error and fetch again immediately. */
  retry: () => void;
};

/**
 * Bounded, abortable polling for one resource.
 *
 * Every decision about *when* to poll lives in `live-refresh.ts`; this hook
 * owns only the timer, the `AbortController` and the rendered state.
 */
export function useLiveRefresh<T>({
  fetcher,
  enabled = true,
  active = false,
  activeMs,
  idleMs,
  immediate = true,
  onUpdate,
}: LiveRefreshOptions<T>): LiveRefreshResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);

  const guard = useRef(createSequenceGuard());
  const failures = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  // A `Retry-After` the last failure asked us to respect.
  const retryAfter = useRef<number | null>(null);
  /**
   * Set when the server has told us to stop asking — a 429 above all.
   *
   * Rate limiting is not an outage: polling through it spends the client's
   * whole budget and starves every other surface on the page, which is exactly
   * how the member directory came to render "Too many requests". The error is
   * surfaced once and `retry()` is the only way back in, so the loop is a
   * person's decision rather than the timer's.
   */
  const halted = useRef(false);
  // Read through refs so the callbacks stay referentially stable and the
  // effects do not resubscribe on every render.
  const latest = useRef({
    fetcher,
    onUpdate,
    enabled,
    active,
    activeMs,
    idleMs,
    visible,
  });
  latest.current = {
    fetcher,
    onUpdate,
    enabled,
    active,
    activeMs,
    idleMs,
    visible,
  };

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /**
   * Indirection that breaks the cycle between "run a poll" and "schedule the
   * next one": `planNext` must fire `run`, and `run` must re-plan when it
   * settles, so one of them is reached through a ref instead of a dependency.
   */
  const runRef = useRef<() => void>(() => {});

  /** Schedule the next poll from the current policy. Null means "no timer". */
  const planNext = useCallback(() => {
    clearTimer();
    if (!mounted.current) return;
    if (halted.current) return;
    if (!latest.current.enabled) return;
    const {
      active: isActive,
      activeMs: a,
      idleMs: i,
      visible: isVisible,
    } = latest.current;
    const delay = nextPollDelay({
      active: isActive,
      failures: failures.current,
      hidden: !isVisible,
      retryAfterMs: retryAfter.current,
      ...(a !== undefined ? { activeMs: a } : {}),
      ...(i !== undefined ? { idleMs: i } : {}),
    });
    if (delay === null) return;
    timer.current = setTimeout(() => runRef.current(), delay);
  }, [clearTimer]);

  const run = useCallback(async () => {
    if (!mounted.current) return;
    /*
     * The null guard, at the source.
     *
     * A caller builds its URL from state that is legitimately empty before the
     * operator picks anything. Rather than have every caller remember to check,
     * or match on "null" in a string it should never have built, the hook asks
     * `enabled` before it asks the network.
     */
    if (!latest.current.enabled) return;
    // Never stack requests: if one is still running, the schedule will poll
    // again when it settles.
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    // Supersede anything still in flight from an earlier trigger.
    controller.current?.abort();
    const own = new AbortController();
    controller.current = own;
    const ticket = guard.current.claim();
    try {
      const value = await latest.current.fetcher(own.signal);
      if (!mounted.current || own.signal.aborted) return;
      if (!guard.current.isCurrent(ticket)) return;
      failures.current = 0;
      retryAfter.current = null;
      setData(value);
      setError(null);
      setUpdatedAt(Date.now());
      latest.current.onUpdate?.(value);
    } catch (cause) {
      if (!mounted.current || own.signal.aborted) return;
      // Our own cancellation is not a backend failure: no error, no backoff.
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (!guard.current.isCurrent(ticket)) return;
      failures.current += 1;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (isHttpError(cause)) {
        retryAfter.current = cause.retryAfterMs;
        // 429 is the server saying "stop", so stop. Backoff honours
        // Retry-After for other failures; retrying a rate limit just keeps
        // the client rate-limited and starves the rest of the page.
        if (cause.status === 429) halted.current = true;
      }
      setError(error);
    } finally {
      busy.current = false;
      if (mounted.current) setRefreshing(false);
      planNext();
    }
  }, [planNext]);
  runRef.current = () => void run();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
      controller.current?.abort();
    };
  }, [clearTimer]);

  useEffect(() => {
    if (!enabled) {
      // Nothing to fetch yet, so nothing to schedule either. `planNext` would
      // reach the same conclusion, but only after the fetcher had built a URL
      // out of an id that does not exist yet.
      clearTimer();
      return;
    }
    if (immediate) void run();
    else planNext();
    // Mount-only: `run`/`planNext` are stable and every later trigger is
    // explicit (manual refresh, visibility, or `active` flipping).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A background tab throttles or stops timers, so polling there wastes
  // requests and produces a burst on return. Pause while hidden, reconcile once
  // when the tab comes back.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => {
      const isVisible = document.visibilityState === "visible";
      latest.current.visible = isVisible;
      setVisible(isVisible);
      /*
       * This handler used to call `run()` whenever the tab became visible, with
       * no regard for whether there was anything to fetch. Since it also runs
       * once on mount, every dashboard surface with a not-yet-chosen id fired a
       * request for `/…/null` the moment it appeared — the original source of
       * the traffic in the trace.
       */
      if (isVisible && latest.current.enabled && !halted.current) {
        clearTimer();
        void run();
      } else {
        clearTimer();
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clearTimer, run]);

  /*
   * Losing the thing being polled is a lifecycle event, not a change of
   * schedule: clear the id and the surface stops, immediately and without
   * waiting for a pending timer. Leaving the timer armed meant a run poller
   * kept issuing requests after the operator navigated to another section.
   */
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    if (enabled === wasEnabled.current) return;
    wasEnabled.current = enabled;
    if (!enabled) {
      clearTimer();
      // Abort rather than ignore: an in-flight request would otherwise settle
      // and re-plan from a run the page is no longer looking at.
      controller.current?.abort();
      busy.current = false;
      setRefreshing(false);
    } else {
      halted.current = false;
      failures.current = 0;
      retryAfter.current = null;
      void run();
    }
  }, [enabled, clearTimer, run]);

  // Becoming active is the interesting transition: fetch at once instead of
  // waiting out a slow idle interval. Becoming inactive just re-plans, which
  // drops the fast timer.
  const wasActive = useRef(active);
  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }
    if (active && !wasActive.current) {
      clearTimer();
      void run();
    } else {
      planNext();
    }
    wasActive.current = active;
  }, [active, enabled, clearTimer, planNext, run]);

  const refresh = useCallback(() => {
    failures.current = 0;
    retryAfter.current = null;
    halted.current = false;
    clearTimer();
    void run();
  }, [clearTimer, run]);

  /*
   * The way back in after a 429, and the only one: a person asked, so the
   * schedule resumes with a clean failure count.
   */
  const retry = useCallback(() => {
    failures.current = 0;
    retryAfter.current = null;
    halted.current = false;
    setError(null);
    clearTimer();
    void run();
  }, [clearTimer, run]);

  return { data, error, refreshing, updatedAt, refresh, retry };
}

// Re-exported so a page can derive `active` from the same state vocabulary the
// policy uses, instead of re-declaring which run/job states count as finished.
export { isInFlight, isTerminal } from "./live-refresh";
