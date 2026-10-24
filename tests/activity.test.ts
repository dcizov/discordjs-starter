import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activitySnapshot,
  aggregateActivityRecords,
  calendarKey,
  chartTimeZone,
  shiftCalendarKey,
} from "../packages/core/src/activity";
import { relativeTime } from "../apps/web/lib/utils";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const referenceAt = "2026-10-25T23:30:00Z";
const record = (createdAt: string, userId = "one", type = "activity") => ({
  createdAt,
  userId,
  type,
});
describe("server-serialized activity snapshots and calendar windows", () => {
  it("produces identical initial labels and values regardless of the host/browser default timezone", () => {
    vi.stubEnv("TZ", "UTC");
    const server = activitySnapshot(referenceAt, "Europe/Berlin", [
      { key: "2026-10-26", events: 3, members: 2 },
    ]);
    vi.stubEnv("TZ", "America/Los_Angeles");
    const client = activitySnapshot(referenceAt, "Europe/Berlin", [
      { key: "2026-10-26", events: 3, members: 2 },
    ]);
    expect(client).toEqual(server);
    expect(JSON.parse(JSON.stringify(server))).toEqual(server);
    expect(server.ranges[7].buckets.at(-1)).toMatchObject({
      key: "2026-10-26",
      label: "Oct 26",
      events: 3,
      members: 2,
    });
  });
  it("has real 7/14/30-day windows, each paired with its real preceding calendar window", () => {
    const value = activitySnapshot(referenceAt, "UTC", []);
    for (const days of [7, 14, 30] as const) {
      const buckets = value.ranges[days].buckets;
      expect(buckets).toHaveLength(days);
      expect(new Set(buckets.map((bucket) => bucket.key)).size).toBe(days);
      expect(buckets[0].key).toBe(shiftCalendarKey("2026-10-25", 1 - days));
      expect(buckets.at(-1)!.key).toBe("2026-10-25");
      expect(buckets.at(-1)!.previous.key).toBe(
        shiftCalendarKey("2026-10-25", -days)
      );
      expect(
        buckets.every(
          (bucket) => bucket.events === 0 && bucket.previous.events === 0
        )
      ).toBe(true);
    }
  });
  it("uses measured preceding-period counts rather than scaling or inventing a comparison line", () => {
    const snapshot = activitySnapshot(referenceAt, "UTC", [
      { key: "2026-10-25", events: 2, members: 1 },
      { key: "2026-10-18", events: 8, members: 3 },
    ]);
    expect(snapshot.ranges[7].buckets.at(-1)).toMatchObject({
      events: 2,
      members: 1,
      previous: { key: "2026-10-18", events: 8, members: 3 },
    });
    expect(snapshot.ranges[14].buckets.at(-1)).toMatchObject({
      previous: { key: "2026-10-11", events: 0, members: 0 },
    });
  });
  it("buckets records near guild midnight under the label for that same timezone", () => {
    const counts = aggregateActivityRecords(
      [
        record("2026-10-24T21:59:59Z"),
        record("2026-10-24T22:00:00Z"),
        record("2026-10-24T22:10:00Z", "two"),
        record("2026-10-24T22:20:00Z"),
        record("2026-10-25T23:00:00Z", "three"),
        record("2026-10-26T00:00:00Z", "future"),
        record("2026-10-24T22:00:00Z", "daily", "daily"),
      ],
      referenceAt,
      "Europe/Berlin"
    );
    expect(counts).toEqual([
      { key: "2026-10-24", events: 1, members: 1 },
      { key: "2026-10-25", events: 3, members: 2 },
      { key: "2026-10-26", events: 1, members: 1 },
    ]);
    expect(
      activitySnapshot(
        referenceAt,
        "Europe/Berlin",
        counts
      ).ranges[7].buckets.at(-2)
    ).toMatchObject({
      key: "2026-10-25",
      label: "Oct 25",
      events: 3,
      members: 2,
    });
  });
  it("keeps both repeated hours of the 25-hour Berlin DST day in one calendar bucket", () => {
    const counts = aggregateActivityRecords(
      [
        record("2026-10-25T00:30:00Z"),
        record("2026-10-25T01:30:00Z", "two"),
        record("2026-10-25T22:59:59Z"),
        record("2026-10-25T23:00:00Z"),
      ],
      referenceAt,
      "Europe/Berlin"
    );
    expect(counts).toEqual([
      { key: "2026-10-25", events: 3, members: 2 },
      { key: "2026-10-26", events: 1, members: 1 },
    ]);
  });
  it("handles the 23-hour US spring DST day and calendar arithmetic across month/year boundaries", () => {
    const counts = aggregateActivityRecords(
      [
        record("2026-03-08T04:59:59Z"),
        record("2026-03-08T05:00:00Z"),
        record("2026-03-08T07:30:00Z"),
        record("2026-03-09T03:59:59Z"),
        record("2026-03-09T04:00:00Z"),
      ],
      "2026-03-09T05:00:00Z",
      "America/New_York"
    );
    expect(counts.map((count) => [count.key, count.events])).toEqual([
      ["2026-03-07", 1],
      ["2026-03-08", 3],
      ["2026-03-09", 1],
    ]);
    expect(shiftCalendarKey("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftCalendarKey("2028-03-01", -1)).toBe("2028-02-29");
  });
  it("does not change an initial serialized snapshot when browser midnight passes", () => {
    const before = activitySnapshot(
      "2026-10-24T21:59:59Z",
      "Europe/Berlin",
      []
    );
    const labels = JSON.stringify(before);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
    expect(JSON.stringify(before)).toBe(labels);
    expect(before.ranges[7].buckets.at(-1)!.key).toBe("2026-10-24");
    expect(
      activitySnapshot("2026-10-24T22:00:00Z", "Europe/Berlin", []).ranges[7]
        .end
    ).toBe("2026-10-25");
    vi.restoreAllMocks();
  });
  it("labels demo samples, keeps overlapping dates consistent across ranges, and never invents production history", () => {
    const demo = activitySnapshot(referenceAt, "UTC", [], true);
    expect(demo.demo).toBe(true);
    expect(demo.ranges[14].buckets.at(-1)!.events).toBe(
      demo.ranges[7].buckets.at(-1)!.events
    );
    const live = activitySnapshot(referenceAt, "UTC", []);
    expect(live.demo).toBe(false);
    expect(
      live.ranges[30].buckets.every(
        (bucket) => bucket.events === 0 && bucket.members === 0
      )
    ).toBe(true);
  });
  it("uses deterministic UTC for missing/invalid legacy timezones", () => {
    expect(chartTimeZone("not-a-zone")).toBe("UTC");
    expect(chartTimeZone()).toBe("UTC");
    expect(chartTimeZone("+02:00")).toBe("UTC");
    expect(calendarKey(referenceAt, "UTC")).toBe("2026-10-25");
  });
  it("renders nearby relative times against the shared server reference, not the browser clock", () => {
    expect(relativeTime("2026-10-25T23:29:01Z", referenceAt)).toBe("Just now");
    expect(relativeTime("2026-10-25T23:29:00Z", referenceAt)).toBe("1 min ago");
    expect(relativeTime("2026-10-24T23:30:00Z", referenceAt)).toBe("1d ago");
    expect(relativeTime("invalid", referenceAt)).toBe("Time unavailable");
  });
});
