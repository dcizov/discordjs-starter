import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  PERMISSION_BITS,
  permissionBit,
} from "../packages/core/src/permission-bits";
import {
  ADMINISTRATOR_BIT,
  ASSIGNABLE_PERMISSIONS,
} from "../packages/core/src/template-builder";

/**
 * `packages/core` must stay free of discord.js so the dashboard can bundle it,
 * which is only safe while the local table actually agrees with discord.js.
 * These tests are the drift alarm: they run in node, where importing
 * discord.js is fine, and fail if upstream adds, renames or revalues a bit.
 */

describe("permission bit table", () => {
  it("carries every bit discord.js defines, with the same value", () => {
    const upstream = Object.entries(PermissionFlagsBits).filter(
      ([, value]) => typeof value === "bigint"
    );
    expect(Object.keys(PERMISSION_BITS).length).toBe(upstream.length);
    for (const [name, value] of upstream) {
      expect(PERMISSION_BITS[name], name).toBe(value);
    }
  });

  it("defines no bit discord.js does not know about", () => {
    for (const name of Object.keys(PERMISSION_BITS)) {
      expect(
        (PermissionFlagsBits as Record<string, unknown>)[name],
        name
      ).toBeDefined();
    }
  });

  it("resolves Administrator to the bit Discord documents", () => {
    expect(ADMINISTRATOR_BIT).toBe(PermissionFlagsBits.Administrator);
    expect(ADMINISTRATOR_BIT).toBe(8n);
  });

  it("gives every assignable permission a real bit", () => {
    for (const name of ASSIGNABLE_PERMISSIONS) {
      expect(permissionBit(name), name).toBe(
        (PermissionFlagsBits as Record<string, bigint>)[name]
      );
    }
  });

  it("returns undefined for a name that is not a permission", () => {
    expect(permissionBit("NotAPermission")).toBeUndefined();
  });

  it("never lists Administrator among the assignable permissions", () => {
    expect(
      (ASSIGNABLE_PERMISSIONS as readonly string[]).includes("Administrator")
    ).toBe(false);
  });
});
