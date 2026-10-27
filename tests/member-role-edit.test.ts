import { describe, expect, it } from "vitest";
import {
  offerableRoles,
  planMemberRoleChanges,
  type EditableRole,
  type RoleChangeRequest,
} from "@orbit/core/member-role-edit";
import { Permissions } from "@orbit/core/permissions";

/**
 * These are the rules that keep a dashboard from handing out power it should
 * not. They are pure so every branch can be reached in a test; the bot and the
 * API both go through the same function.
 */

const GUILD = "100000000000000001";
const EVERYONE = GUILD;

const role = (
  id: string,
  name: string,
  position: number,
  permissions: bigint | string = 0n,
  managed = false
): EditableRole => ({
  id,
  name,
  color: "#ff0000",
  position,
  managed,
  permissions:
    typeof permissions === "string" ? permissions : permissions.toString(),
});

const everyone = role(EVERYONE, "@everyone", 0);
const member = role("100000000000000010", "Member", 1);
const artist = role("100000000000000011", "Artist", 2);
const helper = role("100000000000000012", "Helper", 3);
const mod = role(
  "100000000000000013",
  "Moderator",
  8,
  Permissions.ManageMessages
);
const admin = role(
  "100000000000000014",
  "Admin",
  12,
  Permissions.Administrator
);
const botRole = role(
  "100000000000000020",
  "Nitro Booster",
  5,
  0n,
  true // managed
);

const ALL = [everyone, member, artist, helper, mod, admin, botRole];

const base: RoleChangeRequest = {
  guildId: GUILD,
  currentRoleIds: [],
  desiredRoleIds: [],
  roles: ALL,
  actorHighestPosition: 10,
  botHighestPosition: 9,
  actorPermissionBits: Permissions.ManageRoles.toString(),
};

describe("planning a member role change", () => {
  it("adds and removes the roles that are in reach", () => {
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [member.id, artist.id],
      desiredRoleIds: [artist.id, helper.id],
    });
    expect(plan.add).toEqual([helper.id]);
    expect(plan.remove).toEqual([member.id]);
    expect(plan.denied).toEqual([]);
    expect(plan.noop).toBe(false);
  });

  it("does nothing when the request matches reality", () => {
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [artist.id],
      desiredRoleIds: [artist.id],
    });
    expect(plan.add).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.noop).toBe(true);
  });

  it("refuses @everyone in both directions", () => {
    expect(
      planMemberRoleChanges({
        ...base,
        currentRoleIds: [],
        desiredRoleIds: [EVERYONE],
      }).denied
    ).toEqual([
      { roleId: EVERYONE, reason: "@everyone cannot be added or removed." },
    ]);
    // Removing it would be worse, but it is refused just the same.
    expect(
      planMemberRoleChanges({
        ...base,
        currentRoleIds: [EVERYONE],
        desiredRoleIds: [],
      }).denied.map((d) => d.roleId)
    ).toEqual([EVERYONE]);
  });

  it("refuses managed roles", () => {
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [botRole.id],
      desiredRoleIds: [],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.denied[0].reason).toMatch(/managed by an integration/);
  });

  it("excludes roles at or above the actor's own top role", () => {
    // The actor's highest role is at 10, so a role at 10 is out of reach, not
    // just one above it. Discord's rule, not a conservative reading.
    const atCeiling = role("100000000000000030", "At ceiling", 10);
    const plan = planMemberRoleChanges({
      ...base,
      roles: [...ALL, atCeiling],
      currentRoleIds: [],
      desiredRoleIds: [atCeiling.id],
    });
    expect(plan.add).toEqual([]);
    expect(plan.denied[0].roleId).toBe(atCeiling.id);
  });

  it("applies the lower of the actor's and the bot's reach", () => {
    // The actor can reach 10 but the bot only 9, so a role at 9 is refused
    // even though the actor outranks it. A dashboard user must not be able to
    // borrow the bot's position — and vice versa.
    const aboveBot = role("100000000000000031", "Above bot", 9);
    const plan = planMemberRoleChanges({
      ...base,
      roles: [...ALL, aboveBot],
      currentRoleIds: [],
      desiredRoleIds: [aboveBot.id],
    });
    expect(plan.add).toEqual([]);
    expect(plan.denied[0].roleId).toBe(aboveBot.id);
    // Below both ceilings it is fine.
    expect(
      planMemberRoleChanges({
        ...base,
        currentRoleIds: [],
        desiredRoleIds: [helper.id],
      }).add
    ).toEqual([helper.id]);
  });

  it("refuses a role granting permissions the actor lacks", () => {
    // The actor has Manage Roles but not Manage Messages, so handing out the
    // Moderator role would be escalation.
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [],
      desiredRoleIds: [mod.id],
    });
    expect(plan.add).toEqual([]);
    expect(plan.denied[0].reason).toMatch(
      /permissions the acting member does not hold/
    );
  });

  it("lets an administrator grant a role they do not literally hold", () => {
    // An administrator already holds everything, so there is nothing to exceed.
    const plan = planMemberRoleChanges({
      ...base,
      actorPermissionBits: (
        Permissions.ManageRoles | Permissions.Administrator
      ).toString(),
      actorHighestPosition: 13,
      botHighestPosition: 13,
      currentRoleIds: [],
      desiredRoleIds: [mod.id],
    });
    expect(plan.add).toEqual([mod.id]);
    expect(plan.denied).toEqual([]);
  });

  it("refuses everything when the actor lacks Manage Roles", () => {
    const plan = planMemberRoleChanges({
      ...base,
      actorPermissionBits: "0",
      currentRoleIds: [member.id],
      desiredRoleIds: [],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.denied[0].reason).toMatch(/no longer has Manage Roles/);
  });

  it("refuses a change when the actor's permissions cannot be read", () => {
    const plan = planMemberRoleChanges({
      ...base,
      actorPermissionBits: "not-a-number",
      currentRoleIds: [member.id],
      desiredRoleIds: [],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.denied).toHaveLength(1);
    expect(plan.denied[0].reason).toMatch(/could not be read/);
  });

  it("refuses a role whose permissions cannot be read", () => {
    const opaque = role("100000000000000032", "Opaque", 2, "unavailable");
    const plan = planMemberRoleChanges({
      ...base,
      roles: [...ALL, opaque],
      currentRoleIds: [],
      desiredRoleIds: [opaque.id],
    });
    expect(plan.add).toEqual([]);
    expect(plan.denied[0].reason).toMatch(
      /This role's permissions could not be read/
    );
  });

  it("refuses a role that no longer exists", () => {
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [],
      desiredRoleIds: ["100000000000000099"],
    });
    expect(plan.add).toEqual([]);
    expect(plan.denied[0].reason).toMatch(/no longer exists/);
  });

  it("never lets a refusal become a removal", () => {
    // A member holding a managed role and a role above the ceiling keeps both:
    // the client's list simply omits what it was not allowed to offer.
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [botRole.id, admin.id, artist.id],
      desiredRoleIds: [artist.id],
    });
    expect(plan.remove).toEqual([]);
    expect(plan.add).toEqual([]);
    expect(plan.denied.map((d) => d.roleId).sort()).toEqual(
      [botRole.id, admin.id].sort()
    );
  });

  it("reports each refused role once", () => {
    // A role can break several rules at once; one clear reason beats three.
    const plan = planMemberRoleChanges({
      ...base,
      currentRoleIds: [],
      desiredRoleIds: [mod.id, mod.id],
    });
    expect(plan.denied.filter((d) => d.roleId === mod.id)).toHaveLength(1);
  });
});

describe("what the editor offers", () => {
  it("offers only roles both the actor and the bot can reach", () => {
    const offered = offerableRoles(
      ALL,
      GUILD,
      10,
      9,
      Permissions.ManageRoles.toString()
    );
    const ids = offered.map((r) => r.id);
    expect(ids).toContain(member.id);
    expect(ids).toContain(helper.id);
    expect(ids).not.toContain(everyone.id);
    expect(ids).not.toContain(botRole.id);
    expect(ids).not.toContain(admin.id);
    expect(ids).not.toContain(mod.id); // escalation: grants Manage Messages
  });

  it("offers nothing to an actor without Manage Roles", () => {
    expect(offerableRoles(ALL, GUILD, 10, 9, "0")).toEqual([]);
  });

  it("offers everything below the ceiling to an administrator", () => {
    const offered = offerableRoles(
      ALL,
      GUILD,
      13,
      13,
      (Permissions.ManageRoles | Permissions.Administrator).toString()
    );
    const ids = offered.map((r) => r.id);
    expect(ids).toContain(mod.id);
    expect(ids).toContain(admin.id);
    // Still not @everyone, and still not managed roles.
    expect(ids).not.toContain(everyone.id);
    expect(ids).not.toContain(botRole.id);
  });

  it("offers nothing when the bot is bottom of the hierarchy", () => {
    // The bot cannot manage anything if its own top role is at the very
    // bottom, so nothing the actor can do matters.
    expect(
      offerableRoles(ALL, GUILD, 12, 0, Permissions.ManageRoles.toString())
    ).toEqual([]);
  });
});

describe("the client's list is never authorization evidence", () => {
  it("ignores a request to add a role that was never offered", () => {
    // The picker would not have shown Admin, but a hand-crafted request can
    // still ask. The plan is recomputed from the guild's roles, so it refuses.
    expect(
      planMemberRoleChanges({
        ...base,
        currentRoleIds: [],
        desiredRoleIds: [admin.id],
      }).add
    ).toEqual([]);
  });

  it("ignores a request that quietly drops a protected role", () => {
    // Dropping Admin from the list must not remove it.
    expect(
      planMemberRoleChanges({
        ...base,
        currentRoleIds: [admin.id, member.id],
        desiredRoleIds: [admin.id],
      }).remove
    ).toEqual([member.id]);
  });
});
