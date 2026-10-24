import { canManageGuild, timingSafeStringEqual } from "@orbit/core";
import { describe, expect, it } from "vitest";
describe("Discord dashboard authorization", () => {
  it("allows owners, administrators, and members with Manage Guild", () => {
    expect(canManageGuild({ owner: true, permissions: "0" })).toBe(true);
    expect(canManageGuild({ permissions: "8" })).toBe(true);
    expect(canManageGuild({ permissions: "32" })).toBe(true);
    expect(canManageGuild({ permissions: String((1n << 50n) | 32n) })).toBe(
      true
    );
  });
  it("does not mistake moderation or role management for Manage Guild", () => {
    for (const p of ["0", "2", "4", "8192", "268435456", "1099511627776"])
      expect(canManageGuild({ permissions: p })).toBe(false);
  });
  it("fails closed on missing or malformed permission bitfields", () => {
    for (const p of ["", "not-permissions", "1.5", undefined as any])
      expect(canManageGuild({ permissions: p })).toBe(false);
  });
});

it("rejects invalid OAuth state safely even when character counts match but byte counts differ", () => {
  expect(timingSafeStringEqual("secret", "secret")).toBe(true);
  expect(timingSafeStringEqual("secret", "secrex")).toBe(false);
  expect(timingSafeStringEqual("éééééé", "secret")).toBe(false);
  expect(timingSafeStringEqual("", "secret")).toBe(false);
});
