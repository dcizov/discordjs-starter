import type { MusicState } from "./types";

/**
 * Playback position derived from a backend snapshot plus its timestamp.
 *
 * The bot persists `position` together with `updatedAt`, so interpolation is
 * only honest while the player is genuinely playing: a paused, stopped or
 * disconnected player keeps the snapshot position instead of advancing.
 * Unknown durations (live streams) never produce a percentage, and a snapshot
 * older than {@link PLAYBACK_STALE_AFTER_MS} is reported as unconfirmed rather
 * than extrapolated into an indefinite "Now playing".
 */
export const PLAYBACK_STALE_AFTER_MS = 90_000;

export type PlaybackProgress = {
  /** `stale` = there is a track, but the state is too old to trust. */
  status: "idle" | "paused" | "playing" | "stale";
  position: number;
  duration: number | null;
  /** 0–100, or null when the duration is unknown. */
  percent: number | null;
  /** True when position includes time elapsed since the snapshot. */
  interpolated: boolean;
  snapshotAt: number | null;
  /** Age of the snapshot in server time, or null when it cannot be known. */
  ageMs: number | null;
  /** True when the snapshot is too old to describe current playback. */
  stale: boolean;
};

export function playbackProgress(
  state: Pick<MusicState, "current" | "paused" | "position" | "updatedAt">,
  now: number,
  options: { staleAfterMs?: number; clockOffsetMs?: number } = {}
): PlaybackProgress {
  // `now` is the browser clock; the snapshot uses the server clock. Subtract
  // the offset observed when the payload arrived so a small skew does not
  // invent minutes of playback, and so staleness measures server-side age.
  const clock = Number.isFinite(now)
    ? now - (options.clockOffsetMs ?? 0)
    : Number.NaN;
  const rawDuration = Number(state.current?.duration);
  const duration =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.round(rawDuration)
      : null;
  const rawPosition = Number(state.position);
  const parsed = Date.parse(state.updatedAt);
  const snapshotAt = Number.isFinite(parsed) ? parsed : null;
  const staleAfterMs = Math.max(
    0,
    options.staleAfterMs ?? PLAYBACK_STALE_AFTER_MS
  );
  const ageMs =
    snapshotAt !== null && Number.isFinite(clock)
      ? Math.max(0, clock - snapshotAt)
      : null;
  const stale =
    state.current !== null && ageMs !== null && ageMs > staleAfterMs;
  const status: PlaybackProgress["status"] = !state.current
    ? "idle"
    : stale
      ? "stale"
      : state.paused
        ? "paused"
        : "playing";
  // A leftover position from a stopped player is not progress.
  let position =
    status !== "idle" && Number.isFinite(rawPosition) && rawPosition > 0
      ? rawPosition
      : 0;
  let interpolated = false;
  if (
    status === "playing" &&
    snapshotAt !== null &&
    Number.isFinite(clock) &&
    clock > snapshotAt
  ) {
    position += clock - snapshotAt;
    interpolated = true;
  }
  if (duration !== null) position = Math.min(position, duration);
  position = Math.max(0, Math.round(position));
  return {
    status,
    position,
    duration,
    percent:
      duration === null
        ? null
        : Math.min(100, Math.max(0, Math.round((position / duration) * 100))),
    interpolated,
    snapshotAt,
    ageMs,
    stale,
  };
}

/** Keep an optimistic volume inside the value the backend will accept. */
export function clampVolume(value: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}
