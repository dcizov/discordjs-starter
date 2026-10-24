import type { GuildRole } from "@orbit/core";
import {
  assertAssignableRole,
  assertModeratable,
  Permissions,
  planRoleAssignment,
} from "@orbit/core";
import { describe, expect, it } from "vitest";
const role = (
  id: string,
  position = 2,
  permissions = "0",
  managed = false
): GuildRole => ({
  id,
  name: id,
  color: "#fff",
  position,
  permissions,
  managed,
});
const roles = [
  role("a"),
  role("b"),
  role("c"),
  role("admin", 3, "8"),
  role("managed", 3, "0", true),
  role("high", 12),
];
const plan = (
  overrides: Partial<Parameters<typeof planRoleAssignment>[0]> = {}
) =>
  planRoleAssignment({
    roles,
    botPosition: 10,
    guildId: "everyone",
    currentIds: [],
    requestedIds: ["a"],
    allowedIds: ["a", "b"],
    prerequisiteIds: [],
    exclusiveIds: [],
    maxRoles: 2,
    single: false,
    ...overrides,
  });
describe("self-role assignment safety", () => {
  it("adds only explicitly configured community roles", () => {
    expect(plan()).toEqual({ add: ["a"], remove: [] });
    expect(() => plan({ requestedIds: ["c"] })).toThrow("not part");
  });
  it("protects @everyone, managed, privileged and higher roles", () => {
    expect(() =>
      assertAssignableRole(role("everyone"), 10, "everyone")
    ).toThrow();
    for (const id of ["admin", "managed", "high"])
      expect(() =>
        assertAssignableRole(
          roles.find((r) => r.id === id),
          10,
          "everyone"
        )
      ).toThrow();
    for (const p of Object.values(Permissions))
      expect(() =>
        assertAssignableRole(role("danger", 2, p.toString()), 10, "everyone")
      ).toThrow();
    expect(() => assertAssignableRole(undefined, 10, "everyone")).toThrow();
    expect(() =>
      assertAssignableRole(role("equal", 10), 10, "everyone")
    ).toThrow();
  });
  it("checks prerequisites only when adding, so members can always opt out", () => {
    expect(() => plan({ prerequisiteIds: ["c"] })).toThrow("prerequisite");
    expect(
      plan({ currentIds: ["a"], requestedIds: [], prerequisiteIds: ["c"] })
    ).toEqual({ add: [], remove: ["a"] });
    expect(plan({ currentIds: ["c"], prerequisiteIds: ["c"] })).toEqual({
      add: ["a"],
      remove: [],
    });
  });
  it("enforces limits, single selection and exclusivity", () => {
    expect(() => plan({ requestedIds: ["a", "b"], maxRoles: 1 })).toThrow(
      "Too many"
    );
    expect(() => plan({ requestedIds: ["a", "b"], single: true })).toThrow();
    expect(() =>
      plan({ requestedIds: ["a", "b"], exclusiveIds: ["a", "b"] })
    ).toThrow("exclusive");
  });
  it("removes conflicting roles across panels without touching unrelated roles", () => {
    expect(
      plan({
        currentIds: ["b", "c", "unrelated"],
        requestedIds: ["a"],
        allowedIds: ["a", "b"],
        exclusiveIds: ["a", "c"],
      })
    ).toEqual({ add: ["a"], remove: ["b", "c"] });
  });
  it("rejects unsafe removals as well as additions", () => {
    expect(() =>
      plan({ currentIds: ["admin"], requestedIds: [], allowedIds: ["admin"] })
    ).toThrow("elevated");
  });
  it("does not duplicate role grants", () => {
    expect(plan({ currentIds: ["a"], requestedIds: ["a", "a"] })).toEqual({
      add: [],
      remove: [],
    });
  });
});
describe("moderation hierarchy", () => {
  it("requires both the moderator and bot to outrank the target", () => {
    expect(() => assertModeratable(5, 10, 5, false, false)).toThrow();
    expect(() => assertModeratable(20, 10, 10, false, false)).toThrow();
    expect(() => assertModeratable(20, 10, 2, true, false)).toThrow();
    expect(() => assertModeratable(20, 10, 2, false, true)).toThrow();
    expect(() => assertModeratable(5, 10, 2, false, false)).not.toThrow();
  });
});
