/**
 * Pure tour policy, kept out of the dialog so it can be unit-tested without a
 * browser. Storage is passed in, which also covers unavailable/full storage.
 */
export const TOUR_VERSION = 1;

export type TourOutcome = "finished" | "skipped";
export type TourProgress = { version: number; outcome: TourOutcome };

export function tourStorageKey(userId: string) {
  return `orbit:tour:v${TOUR_VERSION}:${userId}`;
}

/** Only the current version counts as seen; bumping the version re-introduces it. */
export function readTourProgress(
  storage: Pick<Storage, "getItem"> | null,
  userId: string
): TourProgress | null {
  if (!storage || !userId) return null;
  try {
    const raw = storage.getItem(tourStorageKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TourProgress>;
    if (parsed?.version !== TOUR_VERSION) return null;
    if (parsed.outcome !== "finished" && parsed.outcome !== "skipped")
      return null;
    return { version: TOUR_VERSION, outcome: parsed.outcome };
  } catch {
    return null;
  }
}

export function saveTourProgress(
  storage: Pick<Storage, "setItem"> | null,
  userId: string,
  outcome: TourOutcome
) {
  if (!storage || !userId) return false;
  try {
    storage.setItem(
      tourStorageKey(userId),
      JSON.stringify({ version: TOUR_VERSION, outcome })
    );
    return true;
  } catch {
    return false;
  }
}

/** Completion is per person, not per server, so switching guilds cannot repeat it. */
export function shouldShowTour(
  storage: Pick<Storage, "getItem"> | null,
  userId: string
) {
  return readTourProgress(storage, userId) === null;
}

export function stepIndex(current: number, delta: number, total: number) {
  if (!Number.isInteger(total) || total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, current + delta));
}
