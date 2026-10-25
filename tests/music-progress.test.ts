import { describe, expect, it } from "vitest";
import { clampVolume, playbackProgress } from "@orbit/core/music-progress";
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
    const overshoot = playbackProgress(state(), snapshotAt + 10 * 60000);
    expect(overshoot.position).toBe(180000);
    expect(overshoot.percent).toBe(100);
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
