import {
  ADMINISTRATOR_BIT,
  STARTER_BLUEPRINTS,
  blankChannel,
  blankOverwrite,
  blankRole,
  buildBlankTemplate,
  buildFromBlueprint,
  canMoveDown,
  canMoveUp,
  duplicateTemplateDocument,
  getBlueprint,
  moveItem,
  nextTemplateKey,
  permissionBitfield,
  permissionNames,
  renameTemplateDocument,
  splitPermissions,
  validateTemplateDocument,
} from "@orbit/core/template-builder";
import type { ServerTemplateDocument } from "@orbit/core/templates";
import { describe, expect, it } from "vitest";

const doc = (
  patch: Partial<ServerTemplateDocument> = {}
): ServerTemplateDocument => ({
  version: 1,
  kind: "both",
  name: "Baseline",
  description: "",
  createdAt: "2026-10-27T00:00:00.000Z",
  structure: { roles: [], channels: [] },
  config: {},
  omitted: [],
  ...patch,
});

const errors = (value: unknown) =>
  validateTemplateDocument(value).issues.filter((i) => i.severity === "error");

describe("permission rendering", () => {
  it("names a bitfield instead of showing raw digits", () => {
    const bits = permissionBitfield(["ViewChannel", "SendMessages"]);
    expect(permissionNames(bits)).toContain("ViewChannel");
    expect(permissionNames(bits)).toContain("SendMessages");
  });
  it("round-trips names through a bitfield", () => {
    const names = ["ViewChannel", "ManageMessages", "ModerateMembers"];
    expect(permissionNames(permissionBitfield(names)).sort()).toEqual(
      [...names].sort()
    );
  });
  it("reads zero as no permissions", () => {
    expect(permissionNames("0")).toEqual([]);
  });
  it("separates what a template may carry from what it refuses", () => {
    const bits = permissionBitfield(["ViewChannel", "Administrator"]);
    const split = splitPermissions(bits);
    expect(split.allowed).toContain("ViewChannel");
    expect(split.refused).toContain("Administrator");
    expect(split.allowed).not.toContain("Administrator");
  });
  it("never lets Administrator be described as assignable", () => {
    expect(ADMINISTRATOR_BIT.toString()).not.toBe("0");
    expect(splitPermissions(ADMINISTRATOR_BIT.toString()).allowed).toEqual([]);
  });
});

describe("reference integrity", () => {
  it("accepts a document whose references all resolve", () => {
    const value = doc({
      structure: {
        roles: [blankRole({ key: "role:moderator" })],
        channels: [
          blankChannel({ key: "channel:cat", type: "category" }),
          blankChannel({
            key: "channel:general",
            parentKey: "channel:cat",
            overwrites: [blankOverwrite("role:moderator")],
          }),
        ],
      },
      config: { bindings: { auditChannelKey: "channel:general" } },
    });
    expect(errors(value)).toEqual([]);
  });

  it("blocks a channel whose category no longer exists", () => {
    const value = doc({
      structure: {
        roles: [],
        channels: [
          blankChannel({ key: "channel:c", parentKey: "channel:gone" }),
        ],
      },
    });
    expect(errors(value).map((i) => i.path)).toContain(
      "structure.channels[channel:c].parentKey"
    );
  });

  it("blocks a channel parented on a non-category", () => {
    const value = doc({
      structure: {
        roles: [],
        channels: [
          blankChannel({ key: "channel:text" }),
          blankChannel({ key: "channel:child", parentKey: "channel:text" }),
        ],
      },
    });
    expect(errors(value)).toHaveLength(1);
    expect(errors(value)[0]!.message).toContain("not a category");
  });

  it("blocks a channel that is its own parent", () => {
    const value = doc({
      structure: {
        roles: [],
        channels: [
          blankChannel({
            key: "channel:self",
            type: "category",
            parentKey: "channel:self",
          }),
        ],
      },
    });
    expect(errors(value)[0]!.message).toContain("cannot be its own parent");
  });

  it("blocks an overwrite for a role the template does not contain", () => {
    const value = doc({
      structure: {
        roles: [],
        channels: [
          blankChannel({
            key: "channel:c",
            overwrites: [blankOverwrite("role:deleted")],
          }),
        ],
      },
    });
    expect(errors(value)[0]!.message).toContain("no role with that key");
  });

  it("allows role:everyone overwrites without a matching role", () => {
    const value = doc({
      structure: {
        roles: [],
        channels: [
          blankChannel({
            key: "channel:c",
            overwrites: [blankOverwrite("role:everyone")],
          }),
        ],
      },
    });
    expect(errors(value)).toEqual([]);
  });

  it("blocks an overwrite that grants Administrator", () => {
    const value = doc({
      structure: {
        roles: [blankRole({ key: "role:r" })],
        channels: [
          blankChannel({
            key: "channel:c",
            overwrites: [
              {
                roleKey: "role:r",
                allow: permissionBitfield(["Administrator"]),
                deny: "0",
              },
            ],
          }),
        ],
      },
    });
    expect(errors(value)[0]!.message).toContain("never grants Administrator");
  });

  it("blocks bindings that point at a deleted channel or role", () => {
    const value = doc({
      structure: { roles: [], channels: [] },
      config: {
        bindings: {
          auditChannelKey: "channel:gone",
          notificationRoleKey: "role:gone",
        },
        music: { djRoleKey: "role:gone" },
        moderation: { exemptRoleKeys: ["role:gone"] },
      },
    });
    expect(
      errors(value)
        .map((i) => i.path)
        .sort()
    ).toEqual([
      "config.bindings.auditChannelKey",
      "config.bindings.notificationRoleKey",
      "config.moderation.exemptRoleKeys",
      "config.music.djRoleKey",
    ]);
  });

  it("blocks two rows sharing one key", () => {
    const value = doc({
      structure: {
        roles: [blankRole({ key: "role:dup" }), blankRole({ key: "role:dup" })],
        channels: [],
      },
    });
    expect(errors(value)[0]!.message).toContain("Two roles use the key");
  });

  it("warns, without blocking, when a structure template is empty", () => {
    const value = doc({ kind: "both", structure: { roles: [], channels: [] } });
    const issues = validateTemplateDocument(value).issues;
    expect(issues.filter((i) => i.severity === "warning")).toHaveLength(1);
    expect(errors(value)).toEqual([]);
  });

  it("reports schema failures with a path an editor can point at", () => {
    const value = doc({ name: "" });
    expect(errors(value).map((i) => i.path)).toContain("name");
  });
});

describe("blank, duplicate and rename", () => {
  it("builds a structure-only blank without a config", () => {
    const value = buildBlankTemplate({ name: "Blank", kind: "structure" });
    expect(value.structure).toEqual({ roles: [], channels: [] });
    expect(value.config).toBeUndefined();
    // Saves cleanly; the "nothing to apply yet" warning is expected on a blank.
    expect(errors(value)).toEqual([]);
  });
  it("builds a configuration-only blank without a structure", () => {
    const value = buildBlankTemplate({ name: "Blank", kind: "configuration" });
    expect(value.config).toEqual({});
    expect(value.structure).toBeUndefined();
  });
  it("keeps keys on a duplicate so it stays portable", () => {
    const original = doc({
      structure: { roles: [blankRole({ key: "role:a" })], channels: [] },
    });
    const copy = duplicateTemplateDocument(original, { name: "Copy" });
    expect(copy.name).toBe("Copy");
    expect(copy.structure!.roles[0]!.key).toBe("role:a");
    expect(copy).not.toBe(original);
    // Mutating the copy must not reach back into the original.
    copy.structure!.roles[0]!.name = "changed";
    expect(original.structure!.roles[0]!.name).toBe("New role");
  });
  it("renames without touching the structure", () => {
    const value = renameTemplateDocument(doc({ name: "A" }), { name: "B" });
    expect(value.name).toBe("B");
  });
  it("trims names and descriptions", () => {
    const value = buildBlankTemplate({
      name: "  Padded  ",
      description: "  text  ",
      kind: "both",
    });
    expect(value.name).toBe("Padded");
    expect(value.description).toBe("text");
  });
  it("generates a key that is not already taken", () => {
    expect(nextTemplateKey("role", ["role:new"])).toBe("role:new-2");
    expect(nextTemplateKey("role", [])).toBe("role:new");
    expect(nextTemplateKey("channel", ["channel:new"], "general")).toBe(
      "channel:general"
    );
  });
});

describe("ordering", () => {
  const items = [{ position: 0 }, { position: 1 }, { position: 2 }];
  it("moves an item and renumbers every position", () => {
    expect(moveItem(items, 0, 2).map((i) => i.position)).toEqual([0, 1, 2]);
    const moved = moveItem(
      [
        { position: 0, k: "a" },
        { position: 1, k: "b" },
        { position: 2, k: "c" },
      ],
      0,
      2
    );
    expect(moved.map((i) => i.k)).toEqual(["b", "c", "a"]);
    expect(moved.map((i) => i.position)).toEqual([0, 1, 2]);
  });
  it("clamps out-of-range moves instead of dropping rows", () => {
    const list = [
      { position: 0, k: "a" },
      { position: 1, k: "b" },
    ];
    expect(moveItem(list, 0, 99).map((i) => i.k)).toEqual(["b", "a"]);
    expect(moveItem(list, 0, -5).map((i) => i.k)).toEqual(["a", "b"]);
  });
  it("reports which moves are available", () => {
    expect(canMoveUp(0)).toBe(false);
    expect(canMoveUp(1)).toBe(true);
    expect(canMoveDown(1, 2)).toBe(false);
    expect(canMoveDown(0, 2)).toBe(true);
  });
});

describe("starter blueprints", () => {
  it("ships a small set, each with a reason to exist", () => {
    expect(STARTER_BLUEPRINTS.length).toBeGreaterThanOrEqual(3);
    for (const b of STARTER_BLUEPRINTS) {
      expect(b.summary.length).toBeGreaterThan(20);
      expect(b.bestFor.length).toBeGreaterThan(10);
    }
  });
  it.each(STARTER_BLUEPRINTS.map((b) => [b.id] as const))(
    "blueprint %s validates with no errors",
    (id) => {
      const built = buildFromBlueprint(id)!;
      expect(built).not.toBeNull();
      expect(errors(built)).toEqual([]);
    }
  );
  it.each(STARTER_BLUEPRINTS.map((b) => [b.id] as const))(
    "blueprint %s never grants Administrator",
    (id) => {
      const built = buildFromBlueprint(id)!;
      for (const channel of built.structure?.channels ?? [])
        for (const overwrite of channel.overwrites) {
          expect(splitPermissions(overwrite.allow).refused).toEqual([]);
          expect(splitPermissions(overwrite.deny).refused).toEqual([]);
        }
      for (const role of built.structure?.roles ?? [])
        expect(permissionNames(role.permissions)).not.toContain(
          "Administrator"
        );
    }
  );
  it("lets an operator rename a blueprint", () => {
    expect(buildFromBlueprint("community", { name: "Our server" })!.name).toBe(
      "Our server"
    );
  });
  it("returns null for an unknown blueprint rather than guessing", () => {
    expect(getBlueprint("nope")).toBeNull();
    expect(buildFromBlueprint("nope")).toBeNull();
  });
});
