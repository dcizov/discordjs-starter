import { describe, expect, it } from "vitest";
import {
  NEUTRAL_ROLE_COLOR,
  assignableRoles,
  describeRoles,
  effectiveHierarchyCeiling,
  roleSwatch,
  rolesBelowCeiling,
  sortRolesByHierarchy,
  splitRolesForDisplay,
} from "../packages/core/src/roles";

const role = (id: string, name: string, position: number, managed = false) => ({
  id,
  name,
  color: "",
  position,
  managed,
});

describe("role colour resolution", () => {
  it("uses a Discord colour when there is one", () => {
    expect(roleSwatch("#ff0000")).toEqual({ css: "#ff0000", hasColor: true });
  });

  it("treats #000000 as no colour, not as black", () => {
    // Discord stores #000000 for "no colour". Painting that as black would make
    // the dot vanish on a dark background.
    const swatch = roleSwatch("#000000");
    expect(swatch.hasColor).toBe(false);
    expect(swatch.css).toBe(NEUTRAL_ROLE_COLOR);
  });

  it("falls back to a neutral colour when there is none", () => {
    for (const input of ["", null, undefined]) {
      expect(roleSwatch(input).hasColor, String(input)).toBe(false);
      expect(roleSwatch(input).css, String(input)).toBe(NEUTRAL_ROLE_COLOR);
    }
  });

  it("never passes an unparseable value through to CSS", () => {
    for (const input of ["red", "#f00", "#gggggg", "rgb(1,2,3)", "  "]) {
      expect(roleSwatch(input).hasColor, input).toBe(false);
      expect(roleSwatch(input).css, input).toBe(NEUTRAL_ROLE_COLOR);
    }
  });

  it("normalises case and surrounding whitespace", () => {
    expect(roleSwatch("  #AABBCC ")).toEqual({
      css: "#aabbcc",
      hasColor: true,
    });
  });

  it("always returns a usable CSS colour, whatever it is given", () => {
    // Colour is decoration; the name is the signal. Nothing here may produce
    // an invalid or empty colour that breaks the swatch.
    for (const input of ["", null, "#000000", "nonsense", "#123456"]) {
      expect(roleSwatch(input).css).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("hierarchy ordering", () => {
  it("puts the highest position first, as Discord does", () => {
    const ordered = sortRolesByHierarchy([
      role("3", "Member", 1),
      role("1", "Admin", 10),
      role("2", "Mod", 5),
    ]);
    expect(ordered.map((r) => r.name)).toEqual(["Admin", "Mod", "Member"]);
  });

  it("breaks equal positions by name so renders are stable", () => {
    const first = sortRolesByHierarchy([
      role("a", "Zebra", 5),
      role("b", "Apple", 5),
    ]);
    const second = sortRolesByHierarchy([
      role("b", "Apple", 5),
      role("a", "Zebra", 5),
    ]);
    expect(first.map((r) => r.name)).toEqual(["Apple", "Zebra"]);
    expect(second.map((r) => r.name)).toEqual(["Apple", "Zebra"]);
  });

  it("does not mutate the list it was given", () => {
    const input = [role("1", "Low", 1), role("2", "High", 9)];
    sortRolesByHierarchy(input);
    expect(input.map((r) => r.name)).toEqual(["Low", "High"]);
  });

  it("handles the empty and single cases", () => {
    expect(sortRolesByHierarchy([])).toEqual([]);
    expect(sortRolesByHierarchy([role("1", "Only", 3)])).toHaveLength(1);
  });
});

describe("compact overflow", () => {
  const many = [1, 2, 3, 4, 5].map((n) => role(String(n), `R${n}`, n));

  it("splits into drawn and collapsed roles", () => {
    const { visible, overflow } = splitRolesForDisplay(many, 2);
    expect(visible.map((r) => r.name)).toEqual(["R1", "R2"]);
    expect(overflow.map((r) => r.name)).toEqual(["R3", "R4", "R5"]);
  });

  it("reports no overflow when everything fits", () => {
    const { visible, overflow } = splitRolesForDisplay(many, 10);
    expect(visible).toHaveLength(5);
    expect(overflow).toEqual([]);
  });

  it("collapses everything rather than slicing negatively", () => {
    const { visible, overflow } = splitRolesForDisplay(many, 0);
    expect(visible).toEqual([]);
    expect(overflow).toHaveLength(5);
  });

  it("describes collapsed roles for the accessible name", () => {
    expect(describeRoles([role("1", "Alpha", 1)])).toBe("Alpha");
    expect(describeRoles([role("1", "Alpha", 1), role("2", "Beta", 2)])).toBe(
      "Alpha and Beta"
    );
    expect(
      describeRoles([
        role("1", "Alpha", 1),
        role("2", "Beta", 2),
        role("3", "Gamma", 3),
      ])
    ).toBe("Alpha, Beta and Gamma");
    expect(describeRoles([])).toBe("");
  });
});

describe("roles that can be assigned", () => {
  const everyone = "100000000000000001";
  const roles = [
    role(everyone, "@everyone", 0),
    role("2", "Mod", 5),
    role("3", "Bot role", 4, true),
    role("4", "Member", 1),
  ];

  it("excludes @everyone, which cannot be assigned or removed", () => {
    const names = assignableRoles(roles, everyone).map((r) => r.name);
    expect(names).not.toContain("@everyone");
  });

  it("excludes managed roles, which Discord owns", () => {
    const names = assignableRoles(roles, everyone).map((r) => r.name);
    expect(names).not.toContain("Bot role");
    expect(names).toEqual(["Mod", "Member"]);
  });

  it("keeps every ordinary role", () => {
    expect(assignableRoles(roles, everyone)).toHaveLength(2);
  });
});

describe("hierarchy ceilings", () => {
  const roles = [
    role("1", "Owner", 10),
    role("2", "Admin", 8),
    role("3", "Mod", 5),
    role("4", "Member", 1),
  ];

  it("excludes roles at or above the caller's own highest role", () => {
    // Discord's rule: you cannot manage a role at or above your own top role.
    const names = rolesBelowCeiling(roles, 8).map((r) => r.name);
    expect(names).toEqual(["Mod", "Member"]);
    expect(names).not.toContain("Admin");
  });

  it("takes the lower of the actor's and the bot's reach", () => {
    // The point of the whole guard: a dashboard user must not borrow the bot's
    // privileges. Whichever ceiling is lower wins.
    expect(effectiveHierarchyCeiling(9, 3)).toBe(3);
    expect(effectiveHierarchyCeiling(2, 7)).toBe(2);
    expect(effectiveHierarchyCeiling(5, 5)).toBe(5);
  });

  it("leaves nothing assignable when the bot sits at the bottom", () => {
    const ceiling = effectiveHierarchyCeiling(10, 1);
    expect(rolesBelowCeiling(roles, ceiling)).toEqual([]);
  });

  it("leaves nothing assignable when the actor sits at the bottom", () => {
    const ceiling = effectiveHierarchyCeiling(1, 10);
    expect(rolesBelowCeiling(roles, ceiling)).toEqual([]);
  });
});
