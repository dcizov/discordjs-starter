"use client";
import { useEffect, useRef, useState } from "react";

/**
 * A one-second clock that only runs while playback is actually advancing.
 *
 * It starts as `null` so the server render and the first client render agree
 * (no hydration drift), and it is stopped for paused/idle players so a paused
 * track never creeps forward in the UI.
 *
 * Elapsed time is measured with the monotonic `performance.now()` from an
 * anchor taken whenever a fresh dashboard payload arrives, not by sampling
 * `Date.now()` every tick. A system clock correction, a throttled background
 * tab or a slow frame therefore cannot make playback jump between
 * reconciliations. The anchor also records the browser↔server offset from the
 * payload's `referenceAt`, which `playbackProgress` removes so staleness is
 * measured in server time rather than through the visitor's clock.
 */
export function usePlaybackNow(
  active: boolean,
  referenceAt: string | null,
  intervalMs = 1000
) {
  const [tick, setTick] = useState<{ now: number; offset: number } | null>(
    null
  );
  const anchor = useRef<{ perf: number; wall: number; offset: number } | null>(
    null
  );
  useEffect(() => {
    const wall = Date.now();
    const reference = referenceAt ? Date.parse(referenceAt) : Number.NaN;
    anchor.current = {
      perf: performance.now(),
      wall,
      offset: Number.isFinite(reference) ? wall - reference : 0,
    };
    setTick({ now: wall, offset: anchor.current.offset });
    if (!active) return;
    const timer = window.setInterval(() => {
      const origin = anchor.current;
      if (!origin) return;
      setTick({
        now: origin.wall + (performance.now() - origin.perf),
        offset: origin.offset,
      });
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [active, referenceAt, intervalMs]);
  return {
    now: tick?.now ?? null,
    offset: tick?.offset ?? 0,
  };
}
