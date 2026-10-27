"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSequenceGuard, nextPollDelay } from "./live-refresh";

export type LiveRefreshOptions<T> = {
  /**
   * Fetch the current value. Receives an `AbortSignal` that fires when the
   * request is superseded or the component goes away.
   */
  fetcher: (signal: AbortSignal) => Promise<T>;
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
  // Read through refs so the callbacks stay referentially stable and the
  // effects do not resubscribe on every render.
  const latest = useRef({
    fetcher,
    onUpdate,
    active,
    activeMs,
    idleMs,
    visible,
  });
  latest.current = { fetcher, onUpdate, active, activeMs, idleMs, visible };

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
      ...(a !== undefined ? { activeMs: a } : {}),
      ...(i !== undefined ? { idleMs: i } : {}),
    });
    if (delay === null) return;
    timer.current = setTimeout(() => runRef.current(), delay);
  }, [clearTimer]);

  const run = useCallback(async () => {
    if (!mounted.current) return;
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
      setError(cause instanceof Error ? cause : new Error(String(cause)));
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
      if (isVisible) {
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

  // Becoming active is the interesting transition: fetch at once instead of
  // waiting out a slow idle interval. Becoming inactive just re-plans, which
  // drops the fast timer.
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      clearTimer();
      void run();
    } else {
      planNext();
    }
    wasActive.current = active;
  }, [active, clearTimer, planNext, run]);

  const refresh = useCallback(() => {
    failures.current = 0;
    clearTimer();
    void run();
  }, [clearTimer, run]);

  const retry = useCallback(() => {
    failures.current = 0;
    setError(null);
    clearTimer();
    void run();
  }, [clearTimer, run]);

  return { data, error, refreshing, updatedAt, refresh, retry };
}

// Re-exported so a page can derive `active` from the same state vocabulary the
// policy uses, instead of re-declaring which run/job states count as finished.
export { isInFlight, isTerminal } from "./live-refresh";
