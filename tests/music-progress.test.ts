import { describe, expect, it } from "vitest";
import {
  clampVolume,
  playbackProgress,
  PLAYBACK_STALE_AFTER_MS,
} from "@orbit/core/music-progress";
import type { MusicState, Track } from "@orbit/core";

const track = (duration: number): Track => ({
  id: "t1",
  title: "A quiet track",
  author: "Someone",
  duration,
  uri: "",
  requestedBy: "Member",
  requestedById: "120000000000000099",
});
const snapshotAt = Date.parse("2026-10-25T12:00:00.000Z");
function state(overrides: Partial<MusicState> = {}): MusicState {
  return {
    current: track(180000),
    tracks: [],
    paused: false,
    volume: 65,
    repeat: "off",
    position: 30000,
    updatedAt: new Date(snapshotAt).toISOString(),
    ...overrides,
  };
}

describe("playback progress from a persisted snapshot", () => {
  it("interpolates only while playing and uses the snapshot timestamp", () => {
    const playing = playbackProgress(state(), snapshotAt + 5000);
    expect(playing.status).toBe("playing");
    expect(playing.interpolated).toBe(true);
    expect(playing.position).toBe(35000);
    expect(playing.percent).toBe(19);
  });

  it("does not advance while paused, stopped or before the snapshot time", () => {
    const paused = playbackProgress(
      state({ paused: true }),
      snapshotAt + 60000
    );
    expect(paused).toMatchObject({
      status: "paused",
      position: 30000,
      interpolated: false,
    });
    const idle = playbackProgress(state({ current: null }), snapshotAt + 60000);
    expect(idle).toMatchObject({
      status: "idle",
      position: 0,
      percent: null,
      interpolated: false,
    });
    const skewed = playbackProgress(state(), snapshotAt - 60000);
    expect(skewed.position).toBe(30000);
    expect(skewed.interpolated).toBe(false);
  });

  it("clamps at the track duration and never divides by an unknown one", () => {
    const nearTheEnd = playbackProgress(
      state({ position: 175000 }),
      snapshotAt + 10000
    );
    expect(nearTheEnd.position).toBe(180000);
    expect(nearTheEnd.percent).toBe(100);
    const liveStream = playbackProgress(
      state({ current: track(0) }),
      snapshotAt + 1000
    );
    expect(liveStream.duration).toBeNull();
    expect(liveStream.percent).toBeNull();
    expect(liveStream.position).toBe(31000);
    const broken = playbackProgress(
      state({
        position: Number.NaN,
        current: { ...track(120000), duration: Number.NaN },
      }),
      Number.NaN
    );
    expect(broken.position).toBe(0);
    expect(broken.duration).toBeNull();
    expect(broken.percent).toBeNull();
  });

  it("stops extrapolating once the snapshot is too old to trust", () => {
    const fresh = playbackProgress(state(), snapshotAt + 60000);
    expect(fresh).toMatchObject({ status: "playing", stale: false });
    expect(fresh.ageMs).toBe(60000);

    // The bot persists a running player at least every ~15 s. Silence for
    // longer than the threshold must not keep drawing a moving bar.
    const stale = playbackProgress(
      state(),
      snapshotAt + PLAYBACK_STALE_AFTER_MS + 1
    );
    expect(stale).toMatchObject({
      status: "stale",
      stale: true,
      interpolated: false,
      position: 30000,
    });
    expect(stale.percent).toBe(17);

    // Staleness is measured in server time, so a visitor with a fast clock
    // does not make a healthy snapshot look abandoned.
    const fastClock = playbackProgress(state(), snapshotAt + 5 * 60000, {
      clockOffsetMs: 5 * 60000 - 5000,
    });
    expect(fastClock).toMatchObject({ status: "playing", stale: false });
    expect(fastClock.position).toBe(35000);

    // Paused, idle and unknown-time snapshots are never reported as "playing".
    expect(
      playbackProgress(state({ paused: true }), snapshotAt + 1).status
    ).toBe("paused");
    expect(
      playbackProgress(state({ updatedAt: "not-a-date" }), snapshotAt + 1).stale
    ).toBe(false);
  });

  it("ignores an unparseable snapshot time instead of guessing", () => {
    const result = playbackProgress(
      state({ updatedAt: "not-a-date" }),
      snapshotAt + 5000
    );
    expect(result.snapshotAt).toBeNull();
    expect(result.interpolated).toBe(false);
    expect(result.position).toBe(30000);
  });

  it("keeps optimistic volume inside the accepted range", () => {
    expect(clampVolume(64.6)).toBe(65);
    expect(clampVolume(-20)).toBe(0);
    expect(clampVolume(340)).toBe(100);
    expect(clampVolume(Number.NaN)).toBe(0);
  });
});
