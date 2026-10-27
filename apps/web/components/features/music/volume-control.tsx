"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2 } from "lucide-react";
import { clampVolume } from "@orbit/core/music-progress";
import { cn } from "@/lib/utils";

export type VolumeCommit = (value: number) => Promise<"applied" | "queued">;

/**
 * Volume is a committed setting, not a stream of jobs.
 *
 * - the slider moves immediately, so dragging feels direct,
 * - one debounced commit lands per interaction instead of one job per pixel,
 * - a queued live action keeps the chosen value visible while telling the truth
 *   about it ("sent to the bot", not "applied"),
 * - responses that arrive out of order (A slow, B fast) cannot overwrite the
 *   user's latest choice.
 */
export function VolumeControl({
  value,
  onCommit,
  disabled,
  disabledReason,
  live,
}: {
  value: number;
  onCommit: VolumeCommit;
  disabled?: boolean;
  disabledReason?: string;
  live: boolean;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "queued" | "error">(
    "idle"
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sequence = useRef(0);
  const shown = draft ?? clampVolume(value);
  const describedBy = "volume-status";

  useEffect(() => {
    // Reconcile with the server once the committed value catches up.
    if (draft !== null && clampVolume(value) === draft) setDraft(null);
  }, [value, draft]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function commit(next: number) {
    const id = ++sequence.current;
    setStatus("saving");
    try {
      const result = await onCommit(next);
      if (id !== sequence.current) return;
      setStatus(result === "queued" ? "queued" : "idle");
      if (result === "applied") setDraft(null);
    } catch {
      // A stale failure must not roll back a newer choice.
      if (id !== sequence.current) return;
      setStatus("error");
      setDraft(null);
    }
  }

  function schedule(raw: number) {
    const next = clampVolume(raw);
    setDraft(next);
    setStatus("idle");
    if (timer.current) clearTimeout(timer.current);
    // Clear the ref when the timer fires, otherwise a later blur/pointer-up
    // would `flush` an already-committed value and send a duplicate job.
    timer.current = setTimeout(() => {
      timer.current = null;
      void commit(next);
    }, 400);
  }

  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      void commit(shown);
    }
  }

  return (
    <div className="mx-auto mt-5 flex max-w-48 items-center gap-2.5">
      <Volume2
        size={13}
        className={cn(
          "shrink-0",
          disabled ? "text-muted-foreground/50" : "text-muted-foreground"
        )}
        aria-hidden="true"
      />
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        value={shown}
        disabled={disabled}
        aria-label="Playback volume"
        aria-valuetext={`${shown}%`}
        aria-describedby={describedBy}
        className="h-1 w-full disabled:cursor-not-allowed disabled:opacity-50"
        onChange={(e) => schedule(Number(e.target.value))}
        onPointerUp={flush}
        onBlur={flush}
      />
      <span className="w-8 text-[10px] tabular-nums text-muted-foreground">
        {shown}%
      </span>
      <span
        id={describedBy}
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {disabled
          ? (disabledReason ?? "Volume is unavailable right now")
          : status === "saving"
            ? "Saving volume"
            : status === "queued"
              ? live
                ? "Volume sent to the bot; it applies when the bot processes it"
                : "Volume queued"
              : status === "error"
                ? "Volume change failed"
                : `Volume ${shown} percent`}
      </span>
    </div>
  );
}
