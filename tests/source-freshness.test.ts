import { describe, expect, it } from "vitest";
import { sourceFreshness } from "@orbit/core/source-health";

/**
 * A source badge must reflect measured checks, not saved configuration. These
 * cases pin the distinction between "the poller ran recently", "it did not" and
 * "we have no idea" — the three states a dashboard usually collapses into one
 * reassuring green dot.
 */
const now = new Date("2026-10-25T12:00:00.000Z").getTime();
const source = (data: Record<string, unknown>, enabled = true) =>
  ({
    enabled,
    data: { adapter: "steam", intervalMinutes: 30, ...data },
  }) as any;
const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();

describe("source freshness", () => {
  it("reports a recent check as fresh with the measured age", () => {
    const result = sourceFreshness(source({ lastChecked: ago(12) }), now);
    expect(result.state).toBe("fresh");
    expect(result.ageMinutes).toBeCloseTo(12, 5);
    expect(result.label).toBe("Checked recently");
    expect(result.detail).toContain("Last checked 12 min ago");
    expect(result.detail).toContain("every 30 min");
  });

  it("allows schedule slack before calling a source late", () => {
    // 30 min interval + 50% grace = 45 min.
    expect(sourceFreshness(source({ lastChecked: ago(44) }), now).state).toBe(
      "fresh"
    );
    expect(sourceFreshness(source({ lastChecked: ago(46) }), now).state).toBe(
      "overdue"
    );
  });

  it("reports an overdue check with the real age and no health claim", () => {
    const result = sourceFreshness(source({ lastChecked: ago(60 * 4) }), now);
    expect(result.state).toBe("overdue");
    expect(result.label).toBe("Check overdue");
    expect(result.detail).toContain("Last checked 4 h ago");
    expect(result.detail).toContain("not proof that it ran");
    // No quantified health score is invented.
    expect(result.detail).not.toMatch(/\d+ %|score|health: /i);
  });

  it("treats a source that has never run as unknown, never healthy", () => {
    const result = sourceFreshness(source({}), now);
    expect(result.state).toBe("never-checked");
    expect(result.ageMinutes).toBeNull();
    expect(result.label).toBe("Never checked");
  });

  it("does not guess when the stored timestamp is unreadable", () => {
    const result = sourceFreshness(
      source({ lastChecked: "yesterday-ish" }),
      now
    );
    expect(result.state).toBe("unknown");
    expect(result.label).toBe("Check time unknown");
  });

  it("says a paused source is not expected to check", () => {
    const result = sourceFreshness(
      source({ lastChecked: ago(600) }, false),
      now
    );
    expect(result.state).toBe("unknown");
    expect(result.label).toBe("Paused");
    expect(result.detail).toContain("no check is expected");
  });

  it("falls back to a sane schedule instead of dividing by zero", () => {
    const result = sourceFreshness(
      source({ lastChecked: ago(10), intervalMinutes: 0 }),
      now
    );
    expect(result.expectedMinutes).toBe(30);
    expect(result.state).toBe("fresh");
  });

  it("uses the caller's clock so server and client agree", () => {
    const data = source({ lastChecked: ago(12) });
    // Same input, one hour later: the check is now an hour and 12 minutes old.
    const later = sourceFreshness(data, now + 60 * 60000);
    expect(later.state).toBe("overdue");
    expect(later.detail).toContain("1 h");
  });
});
