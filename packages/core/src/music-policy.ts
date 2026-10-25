import type { MusicState } from "./types";
/** Called inside MusicService's existing guild lock, before joining voice or mutating the queue. */
export function assertMusicQueueAdmission(
  state: Pick<MusicState, "tracks" | "current">,
  requesterId: string,
  incoming: number,
  maxQueue: number,
  maxPerMember = 0
) {
  if (!Number.isInteger(incoming) || incoming < 1)
    throw new Error("No playable tracks were returned.");
  if (state.tracks.length + incoming > maxQueue)
    throw new Error("This request would exceed the queue limit.");
  if (!maxPerMember) return;
  let pending =
    state.tracks.filter((t) => t.requestedById === requesterId).length +
    incoming;
  // When idle, next() starts the first queued track immediately; only upcoming tracks count.
  if (
    !state.current &&
    (state.tracks.length === 0 || state.tracks[0].requestedById === requesterId)
  )
    pending--;
  if (pending > maxPerMember)
    throw new Error(
      `This entire request would exceed your ${maxPerMember}-track upcoming queue limit. Remove some of your queued tracks or choose a smaller request; no tracks were added.`
    );
}
