import { describe, expect, it } from "vitest";
import {
  cappedIntervals,
  defaultVoiceEligibility,
  levelFromTotalXp,
  levelProgress,
  rollAward,
  totalXpForLevel,
  voiceChannelCounts,
  voiceIntervalAwards,
  voiceMemberEligible,
  xpForLevel,
  type VoicePresence,
} from "@orbit/core/leveling";

/**
 * The curve is the contract every level, reward and leaderboard reads, so it
 * is pinned against the published tables rather than against itself.
 */

describe("the level curve", () => {
  it("matches MEE6's published per-level costs", () => {
    // From Mee6/Mee6-documentation, docs/levels_xp.md.
    const published = [100, 155, 220, 295, 380, 475, 580, 695, 820, 955, 1100];
    published.forEach((expected, level) => {
      expect(xpForLevel(level), `level ${level}`).toBe(expected);
    });
  });

  it("matches MEE6's published cumulative totals", () => {
    const published = [
      0, 100, 255, 475, 770, 1150, 1625, 2205, 2900, 3720, 4675,
    ];
    published.forEach((expected, level) => {
      expect(totalXpForLevel(level), `level ${level}`).toBe(expected);
    });
  });

  it("agrees with Carl-bot's documented closed form under a one-level shift", () => {
    // Carl-bot publishes `(5/3)n^3 + (55/2)n^2 + (755/6)n + 100` as the total
    // to reach level n. Their n is one behind MEE6's: carl(n) is what MEE6
    // calls the total for level n + 1. Both describe the same curve.
    const carl = (n: number) =>
      Math.round((5 / 3) * n ** 3 + (55 / 2) * n ** 2 + (755 / 6) * n + 100);
    for (let n = 0; n <= 40; n++) {
      expect(carl(n), `n=${n}`).toBe(totalXpForLevel(n + 1));
    }
  });

  it("keeps the closed form equal to the summed per-level costs", () => {
    // The closed form is an optimisation; if it drifts from the sum, levels
    // silently move. Checked well past any level a guild will reach.
    let running = 0;
    for (let level = 0; level <= 1000; level++) {
      expect(totalXpForLevel(level), `level ${level}`).toBe(running);
      running += xpForLevel(level);
    }
  });

  it("distinguishes the cost of a level from the total to reach it", () => {
    // The two questions everyone confuses. Level 5 costs 475 to leave and has
    // cost 1150 to arrive at.
    expect(xpForLevel(5)).toBe(475);
    expect(totalXpForLevel(5)).toBe(1150);
    expect(xpForLevel(5)).not.toBe(totalXpForLevel(5));
  });

  it("round-trips level and total XP", () => {
    for (let level = 0; level <= 300; level++) {
      const total = totalXpForLevel(level);
      expect(levelFromTotalXp(total)).toBe(level);
      // One XP short of a level is still the level below.
      if (level > 0) expect(levelFromTotalXp(total - 1)).toBe(level - 1);
    }
  });

  it("survives nonsense totals", () => {
    expect(levelFromTotalXp(-5)).toBe(0);
    expect(levelFromTotalXp(Number.NaN)).toBe(0);
    expect(levelFromTotalXp(Number.POSITIVE_INFINITY)).toBe(0);
    expect(totalXpForLevel(-3)).toBe(0);
    expect(totalXpForLevel(1.7)).toBe(totalXpForLevel(1));
  });

  it("reports progress inside the current level", () => {
    // 100 XP is exactly level 1, with nothing towards level 2.
    const at1 = levelProgress(100);
    expect(at1.level).toBe(1);
    expect(at1.into).toBe(0);
    expect(at1.needed).toBe(155);
    expect(at1.remaining).toBe(155);
    expect(at1.percent).toBe(0);

    // Halfway through level 1's 155 costs 100 + 77.
    const mid = levelProgress(177);
    expect(mid.level).toBe(1);
    expect(mid.into).toBe(77);
    expect(mid.percent).toBe(50);
  });
});

describe("rolling an award", () => {
  it("stays inside the configured range", () => {
    for (let i = 0; i < 200; i++) {
      const value = rollAward(15, 25, () => i / 200);
      expect(value).toBeGreaterThanOrEqual(15);
      expect(value).toBeLessThanOrEqual(25);
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("hits both ends of the range", () => {
    expect(rollAward(15, 25, () => 0)).toBe(15);
    expect(rollAward(15, 25, () => 0.999999)).toBe(25);
  });

  it("is stable when min and max are equal", () => {
    expect(rollAward(10, 10, () => 0.5)).toBe(10);
  });

  it("never goes negative when the range is inverted or junk", () => {
    expect(rollAward(25, 15, () => 0.5)).toBeGreaterThanOrEqual(15);
    expect(rollAward(5, 5, () => Number.NaN)).toBe(5);
  });
});

const human = (
  userId: string,
  over: Partial<VoicePresence> = {}
): VoicePresence => ({
  userId,
  ...over,
});

describe("voice eligibility", () => {
  it("needs the configured number of humans", () => {
    const alone = [human("1")];
    expect(voiceMemberEligible(human("1"), alone).eligible).toBe(false);
    const pair = [human("1"), human("2")];
    expect(voiceMemberEligible(human("1"), pair).eligible).toBe(true);
  });

  it("never counts bots towards the minimum", () => {
    // A human plus a bot is still one human.
    const withBot = [human("1"), human("2", { bot: true })];
    expect(voiceMemberEligible(human("1"), withBot).eligible).toBe(false);
  });

  it("excludes bots entirely", () => {
    const pair = [human("1", { bot: true }), human("2"), human("3")];
    expect(voiceMemberEligible(human("1", { bot: true }), pair).reason).toMatch(
      /Bots do not earn/
    );
  });

  it("excludes the deafened but allows the self-muted by default", () => {
    const three = [human("1"), human("2"), human("3")];
    expect(
      voiceMemberEligible(human("1", { selfMute: true }), three).eligible
    ).toBe(true);
    expect(
      voiceMemberEligible(human("1", { selfDeaf: true }), three).eligible
    ).toBe(false);
    expect(
      voiceMemberEligible(human("1", { deaf: true }), three).eligible
    ).toBe(false);
    expect(
      voiceMemberEligible(human("1", { mute: true }), three).eligible
    ).toBe(false);
  });

  it("lets a server choose differently about mute and deafen", () => {
    const three = [human("1"), human("2"), human("3")];
    expect(
      voiceMemberEligible(human("1", { selfMute: true }), three, {
        ...defaultVoiceEligibility,
        allowSelfMute: false,
      }).reason
    ).toMatch(/Self-muted/);
    expect(
      voiceMemberEligible(human("1", { selfDeaf: true }), three, {
        ...defaultVoiceEligibility,
        allowSelfDeaf: true,
      }).eligible
    ).toBe(true);
  });

  it("explains itself", () => {
    const alone = [human("1")];
    const result = voiceMemberEligible(human("1"), alone);
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/At least 2 people/);
  });
});

describe("voice channels and intervals", () => {
  it("excludes the AFK channel", () => {
    expect(voiceChannelCounts("100", null)).toBe(true);
    expect(voiceChannelCounts("100", "200")).toBe(true);
    expect(voiceChannelCounts("200", "200")).toBe(false);
  });

  it("awards whole intervals only", () => {
    const whole = {
      presentWholeInterval: true,
      stableChannel: true,
      eligibleThroughout: true,
    };
    expect(voiceIntervalAwards(whole)).toBe(true);
    // Any break in any of the three means no award for that interval: no
    // partial credit, because a partial rule can be gamed at the boundary.
    expect(voiceIntervalAwards({ ...whole, presentWholeInterval: false })).toBe(
      false
    );
    expect(voiceIntervalAwards({ ...whole, stableChannel: false })).toBe(false);
    expect(voiceIntervalAwards({ ...whole, eligibleThroughout: false })).toBe(
      false
    );
  });

  it("caps a session's earning length", () => {
    // 60-minute cap at 60-second intervals is 60 awarded intervals.
    expect(cappedIntervals(0, 60, 60).awarded).toBe(true);
    expect(cappedIntervals(59, 60, 60).awarded).toBe(true);
    expect(cappedIntervals(60, 60, 60)).toEqual({
      awarded: false,
      exhausted: true,
    });
    // No cap means no ceiling.
    expect(cappedIntervals(100000, 0, 60).awarded).toBe(true);
  });

  it("scales the cap to the interval length", () => {
    // A 10-minute cap at 5-minute intervals is two intervals, not ten.
    expect(cappedIntervals(1, 10, 300).awarded).toBe(true);
    expect(cappedIntervals(2, 10, 300).awarded).toBe(false);
  });
});
