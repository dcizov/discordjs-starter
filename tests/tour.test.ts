import { describe, expect, it } from "vitest";
import {
  TOUR_VERSION,
  readTourProgress,
  saveTourProgress,
  shouldShowTour,
  stepIndex,
  tourStorageKey,
} from "../apps/web/components/layout/tour-model";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

describe("first-visit tour policy", () => {
  it("shows once per person and remembers both finish and dismissal", () => {
    const storage = memoryStorage();
    expect(shouldShowTour(storage, "user-a")).toBe(true);
    expect(saveTourProgress(storage, "user-a", "skipped")).toBe(true);
    expect(shouldShowTour(storage, "user-a")).toBe(false);
    expect(readTourProgress(storage, "user-a")).toEqual({
      version: TOUR_VERSION,
      outcome: "skipped",
    });
    // A different person still sees their own introduction.
    expect(shouldShowTour(storage, "user-b")).toBe(true);
    expect(storage.values.get(tourStorageKey("user-a"))).toContain('"skipped"');
  });

  it("does not repeat when the same person switches servers", () => {
    const storage = memoryStorage();
    saveTourProgress(storage, "user-a", "finished");
    // Completion is keyed by user id only, so guild changes keep it dismissed.
    for (const guild of ["1", "2", "3"])
      expect(guild && shouldShowTour(storage, "user-a")).toBe(false);
    expect(tourStorageKey("user-a")).not.toContain("guild");
  });

  it("re-introduces the tour after a version bump or an unknown record", () => {
    const storage = memoryStorage({
      [tourStorageKey("user-a")]: JSON.stringify({
        version: 0,
        outcome: "finished",
      }),
    });
    expect(shouldShowTour(storage, "user-a")).toBe(true);
    storage.setItem(tourStorageKey("user-a"), "{not json");
    expect(readTourProgress(storage, "user-a")).toBeNull();
    storage.setItem(
      tourStorageKey("user-a"),
      JSON.stringify({ version: TOUR_VERSION, outcome: "maybe" })
    );
    expect(readTourProgress(storage, "user-a")).toBeNull();
  });

  it("survives unavailable or full storage without breaking the dashboard", () => {
    expect(shouldShowTour(null, "user-a")).toBe(true);
    expect(saveTourProgress(null, "user-a", "finished")).toBe(false);
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveTourProgress(full, "user-a", "finished")).toBe(false);
    expect(shouldShowTour(full, "user-a")).toBe(true);
    expect(saveTourProgress(memoryStorage(), "", "finished")).toBe(false);
  });

  it("keeps step navigation inside the list", () => {
    expect(stepIndex(0, -1, 6)).toBe(0);
    expect(stepIndex(5, 1, 6)).toBe(5);
    expect(stepIndex(1, 1, 6)).toBe(2);
    expect(stepIndex(0, 0, 0)).toBe(0);
  });
});
