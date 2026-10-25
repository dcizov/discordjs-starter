"use client";
import { useEffect, useState } from "react";

/**
 * A one-second clock that only runs while playback is actually advancing.
 *
 * It starts as `null` so the server render and the first client render agree
 * (no hydration drift), and it is stopped for paused/idle players so a paused
 * track never creeps forward in the UI.
 */
export function usePlaybackNow(active: boolean, intervalMs = 1000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [active, intervalMs]);
  return now;
}
