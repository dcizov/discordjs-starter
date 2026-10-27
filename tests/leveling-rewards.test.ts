import { describe, expect, it } from "vitest";
import {
  owedRewards,
  pendingRewards,
  renderAnnouncement,
  rewardRoleIssue,
  rewardsToRevoke,
  type LevelReward,
} from "@orbit/core/leveling-rewards";

const r = (level: number, roleId: string): LevelReward => ({ level, roleId });
const R5 = r(5, "role-5");
const R10 = r(10, "role-10");
const R20 = r(20, "role-20");
const ALL = [R5, R10, R20];

describe("which rewards are owed", () => {
  it("stacks every reward reached", () => {
    expect(owedRewards(10, ALL, true)).toEqual([R5, R10]);
    expect(owedRewards(4, ALL, true)).toEqual([]);
    expect(owedRewards(20, ALL, true)).toEqual([R5, R10, R20]);
  });

  it("keeps only the highest tier when replacing", () => {
    expect(owedRewards(10, ALL, false)).toEqual([R10]);
    expect(owedRewards(20, ALL, false)).toEqual([R20]);
  });

  it("applies every reward sharing the top level", () => {
    // Two roles at one level is a deliberate configuration, not a conflict.
    const shared = [r(5, "a"), r(5, "b"), r(10, "c")];
    expect(owedRewards(5, shared, false)).toEqual([r(5, "a"), r(5, "b")]);
  });

  it("owes nothing before the first reward level", () => {
    expect(owedRewards(0, ALL, true)).toEqual([]);
  });
});

describe("what still needs granting", () => {
  it("separates new grants from ones already recorded", () => {
    const result = pendingRewards({
      owed: [R5, R10],
      grants: [
        { level: 5, roleId: "role-5", grantedAt: "2026-01-01", error: null },
      ],
      availableRoleIds: ["role-5", "role-10"],
    });
    expect(result.toGrant).toEqual([R10]);
    // Already granted stays granted. This is what stops a retry from
    // announcing the same level twice.
    expect(result.already).toEqual([R5]);
  });

  it("reports a reward whose role was deleted instead of dropping it", () => {
    const result = pendingRewards({
      owed: [R5, R10],
      grants: [],
      availableRoleIds: ["role-5"],
    });
    expect(result.toGrant).toEqual([R5]);
    expect(result.missingRole).toEqual([R10]);
  });

  it("offers a previously refused reward for retry", () => {
    const result = pendingRewards({
      owed: [R5],
      grants: [
        { level: 5, roleId: "role-5", grantedAt: null, error: "Missing perms" },
      ],
      availableRoleIds: ["role-5"],
    });
    expect(result.retry).toEqual([R5]);
    expect(result.toGrant).toEqual([]);
  });

  it("does not retry a reward whose role vanished while failing", () => {
    const result = pendingRewards({
      owed: [R5],
      grants: [
        { level: 5, roleId: "role-5", grantedAt: null, error: "Missing perms" },
      ],
      availableRoleIds: [],
    });
    expect(result.retry).toEqual([]);
    expect(result.missingRole).toEqual([R5]);
  });
});

describe("revoking rewards", () => {
  it("only ever revokes roles it granted itself", () => {
    // A role the member earned another way must survive a reward config change.
    const revoked = rewardsToRevoke({
      owed: [R10],
      grants: [
        { level: 5, roleId: "role-5", grantedAt: "2026-01-01", error: null },
      ],
      heldRoleIds: ["role-5", "given-by-someone-else"],
      stack: true,
    });
    expect(revoked).toEqual(["role-5"]);
    expect(revoked).not.toContain("given-by-someone-else");
  });

  it("does not try to remove a role the member no longer has", () => {
    expect(
      rewardsToRevoke({
        owed: [],
        grants: [
          { level: 5, roleId: "role-5", grantedAt: "2026-01-01", error: null },
        ],
        heldRoleIds: [],
        stack: true,
      })
    ).toEqual([]);
  });

  it("with replace, the dropped lower tiers are revoked too", () => {
    // Losing the earlier tiers is the point of replace, so the same rule
    // applies; only the owed set differs.
    const revoked = rewardsToRevoke({
      owed: [R20],
      grants: [
        { level: 5, roleId: "role-5", grantedAt: "2026-01-01", error: null },
        { level: 10, roleId: "role-10", grantedAt: "2026-01-01", error: null },
      ],
      heldRoleIds: ["role-5", "role-10", "role-20"],
      stack: false,
    });
    expect(revoked.sort()).toEqual(["role-10", "role-5"]);
  });
});

describe("whether a reward role may be granted", () => {
  const ok = {
    roleExists: true,
    managed: false,
    isEveryone: false,
    hasAdministrator: false,
    aboveBotReach: false,
  };
  it("allows an ordinary role", () => {
    expect(rewardRoleIssue(ok)).toBeNull();
  });

  it("refuses Administrator with no override", () => {
    // The one rule with no configuration escape: reaching a level must never
    // be a route to Administrator.
    expect(rewardRoleIssue({ ...ok, hasAdministrator: true })).toMatch(
      /must never grant Administrator/
    );
  });

  it("refuses @everyone, managed and unreachable roles", () => {
    expect(rewardRoleIssue({ ...ok, isEveryone: true })).toMatch(/@everyone/);
    expect(rewardRoleIssue({ ...ok, managed: true })).toMatch(/integration/);
    expect(rewardRoleIssue({ ...ok, aboveBotReach: true })).toMatch(
      /above the roles it rewards/
    );
    expect(rewardRoleIssue({ ...ok, roleExists: false })).toMatch(
      /no longer exists/
    );
  });
});

describe("the announcement template", () => {
  it("replaces only the placeholders that exist", () => {
    expect(
      renderAnnouncement("{member} reached level {level}!", {
        member: "Ada",
        level: 7,
      })
    ).toBe("Ada reached level 7!");
    expect(
      renderAnnouncement("{member} earned {role}", {
        member: "Ada",
        level: 7,
        role: "Regular",
      })
    ).toBe("Ada earned Regular");
  });

  it("does not interpret anything else", () => {
    // A server must not be able to smuggle a mention or markup into a message
    // that gets posted publicly.
    expect(
      renderAnnouncement("@everyone {member} <@123> \\n {nope}", {
        member: "Ada",
        level: 1,
      })
    ).toBe("@everyone Ada <@123> \\n {nope}");
  });

  it("removes an unfulfilled role placeholder rather than leaving it", () => {
    expect(
      renderAnnouncement("Level {level}: {role}", { member: "Ada", level: 3 })
    ).toBe("Level 3: ");
  });
});
