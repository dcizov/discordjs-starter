"use client";
import { useEffect, useRef, useState } from "react";
import { cn, duration } from "@/lib/utils";

/**
 * Seek is a committed jump, not a stream of jobs.
 *
 * Dragging only moves a local draft; one seek request is sent when the
 * listener lets go (pointer up, key up or blur), so a drag across the bar is
 * one authorized bot action instead of one per pixel. Unknown or live
 * durations disable the control entirely rather than pretending to seek.
 */
export function SeekControl({
  position,
  duration: total,
  disabled,
  disabledReason,
  onSeek,
}: {
  /** Backend position in milliseconds. */
  position: number;
  /** Track length in milliseconds, or null when it is not a finite track. */
  duration: number | null;
  disabled?: boolean;
  disabledReason?: string;
  onSeek: (seconds: number) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const waiting = useRef(false);
  const maxSeconds =
    total && Number.isFinite(total) ? Math.max(1, Math.floor(total / 1000)) : 0;
  const shown = Math.min(
    draft ?? Math.max(0, position),
    maxSeconds * 1000 || Math.max(0, position)
  );
  useEffect(() => {
    // A fresh backend position settles the draft; do not keep an old thumb.
    if (draft !== null && Math.abs(position - draft) < 2000) setDraft(null);
  }, [position, draft]);
  if (!maxSeconds) return null;
  async function commit() {
    if (waiting.current || draft === null) return;
    const seconds = Math.round(draft / 1000);
    if (seconds < 1 || Math.abs(draft - position) < 2000) {
      setDraft(null);
      return;
    }
    waiting.current = true;
    setError(false);
    try {
      await onSeek(seconds);
      setDraft(null);
    } catch {
      setError(true);
      setDraft(null);
    } finally {
      waiting.current = false;
    }
  }
  return (
    <div className="mx-auto mt-3 flex max-w-72 items-center gap-2.5">
      <input
        type="range"
        min="0"
        max={maxSeconds}
        step="1"
        value={Math.round(shown / 1000)}
        disabled={disabled}
        aria-label="Seek position"
        aria-valuetext={`${duration(shown)} of ${duration(maxSeconds * 1000)}`}
        aria-describedby="seek-status"
        className={cn(
          "h-1 w-full accent-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-50"
        )}
        onChange={(e) => setDraft(Number(e.target.value) * 1000)}
        onPointerUp={() => void commit()}
        onKeyUp={() => void commit()}
        onBlur={() => void commit()}
      />
      <span
        id="seek-status"
        role="status"
        aria-live="polite"
        className="w-20 shrink-0 text-right text-[9px] text-muted-foreground"
      >
        {disabled
          ? ""
          : error
            ? "Seek failed"
            : draft !== null
              ? `Seek to ${duration(draft)}`
              : "Seek"}
      </span>
      {disabled && disabledReason && (
        <span className="sr-only">{disabledReason}</span>
      )}
    </div>
  );
}
