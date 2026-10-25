import type { MusicState } from "./types";

/**
 * Playback position derived from a backend snapshot plus its timestamp.
 *
 * The bot persists `position` together with `updatedAt`, so interpolation is
 * only honest while the player is genuinely playing: a paused, stopped or
 * disconnected player keeps the snapshot position instead of advancing.
 * Unknown durations (live streams) never produce a percentage.
 */
export type PlaybackProgress = {
  status: "idle" | "paused" | "playing";
  position: number;
  duration: number | null;
  /** 0–100, or null when the duration is unknown. */
  percent: number | null;
  /** True when position includes time elapsed since the snapshot. */
  interpolated: boolean;
  snapshotAt: number | null;
};

export function playbackProgress(
  state: Pick<MusicState, "current" | "paused" | "position" | "updatedAt">,
  now: number
): PlaybackProgress {
  const status: PlaybackProgress["status"] = !state.current
    ? "idle"
    : state.paused
      ? "paused"
      : "playing";
  const rawDuration = Number(state.current?.duration);
  const duration =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.round(rawDuration)
      : null;
  const rawPosition = Number(state.position);
  // A leftover position from a stopped player is not progress.
  let position =
    status !== "idle" && Number.isFinite(rawPosition) && rawPosition > 0
      ? rawPosition
      : 0;
  const parsed = Date.parse(state.updatedAt);
  const snapshotAt = Number.isFinite(parsed) ? parsed : null;
  let interpolated = false;
  if (
    status === "playing" &&
    snapshotAt !== null &&
    Number.isFinite(now) &&
    now > snapshotAt
  ) {
    position += now - snapshotAt;
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
  };
}

/** Keep an optimistic volume inside the value the backend will accept. */
export function clampVolume(value: number) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, Math.round(numeric)));
}
