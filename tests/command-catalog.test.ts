import { defaultConfig } from "@orbit/core";
import { getCommandCatalog } from "@orbit/core/command-catalog";
import { commandDefinitions } from "@orbit/core/commands";
import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { commandDefinitions as botDefinitions } from "../apps/bot/src/commands";

const catalog = () => getCommandCatalog(structuredClone(defaultConfig));
const find = (path: string) => catalog().commands.find((c) => c.path === path)!;
describe("implemented command catalog", () => {
  it("uses the bot registration builders themselves, not a duplicate command list", () => {
    expect(botDefinitions).toBe(commandDefinitions);
    const result = catalog();
    expect(result.source).toBe("registration-definitions");
    expect(result.registrationVerified).toBe(false);
    expect(result.rootCount).toBe(26);
    expect(result.invocationCount).toBe(35);
    expect(new Set(result.commands.map((c) => c.root))).toEqual(
      new Set(commandDefinitions.map((c) => c.name))
    );
    expect(new Set(result.commands.map((c) => c.id)).size).toBe(35);
    expect(result.commands.every((c) => c.serverOnly)).toBe(true);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it("flattens all implemented subcommands into usable invocations", () => {
    expect(
      catalog()
        .commands.filter((c) => ["shop", "deals", "news"].includes(c.root))
        .map((c) => c.path)
    ).toEqual([
      "shop list",
      "shop buy",
      "shop claim",
      "deals search",
      "deals info",
      "deals now",
      "deals watch",
      "deals feed",
      "deals pause",
      "deals list",
      "news list",
      "news test",
    ]);
    expect(find("shop buy").usage).toBe("/shop buy <item>");
    expect(find("balance").usage).toBe("/balance [member]");
    expect(find("timeout").usage).toBe("/timeout <member> <reason> <minutes>");
    expect(find("ping").usage).toBe("/ping");
  });
  it("retains argument constraints, types, autocomplete, and choices", () => {
    expect(find("play").arguments[0]).toMatchObject({
      type: "String",
      required: true,
      minLength: 2,
      maxLength: 200,
    });
    expect(
      find("timeout").arguments.find((a) => a.name === "minutes")
    ).toMatchObject({ type: "Integer", minValue: 1, maxValue: 40320 });
    expect(find("volume").arguments[0]).toMatchObject({
      minValue: 0,
      maxValue: 100,
    });
    expect(find("role-panel").arguments[0].autocomplete).toBe(true);
    expect(find("shop claim").arguments[0].autocomplete).toBe(true);
    expect(find("deals info").arguments[0].autocomplete).toBe(true);
    expect(find("deals watch").arguments[0].autocomplete).toBe(true);
    expect(find("repeat").arguments[0].choices).toEqual([
      { name: "Off", value: "off" },
      { name: "Current track", value: "track" },
      { name: "Entire queue", value: "queue" },
    ]);
  });
  it("preserves actual default permission masks without claiming effective authorization", () => {
    expect(find("warn").defaultPermissions).toEqual({
      bitfield: PermissionFlagsBits.ModerateMembers.toString(),
      names: ["ModerateMembers"],
    });
    expect(find("role-panel").defaultPermissions.names).toEqual([
      "ManageRoles",
    ]);
    expect(find("ping").defaultPermissions).toEqual({
      bitfield: null,
      names: [],
    });
  });
  it("documents subcommand runtime permissions that parent defaults do not express", () => {
    expect(find("deals watch").defaultPermissions.names).toEqual([]);
    expect(find("deals watch").runtimePermissions).toEqual(["ManageGuild"]);
    expect(find("news test").runtimePermissions).toEqual(["ManageGuild"]);
    expect(find("deals search").runtimePermissions).toEqual([]);
    expect(find("news list").runtimePermissions).toEqual([]);
  });
  it("derives module status from this server without changing definitions or another server", () => {
    const config = structuredClone(defaultConfig);
    config.modules.music = false;
    config.modules.economy = false;
    const result = getCommandCatalog(config);
    expect(
      result.commands
        .filter((c) => c.module === "music")
        .every((c) => !c.moduleEnabled)
    ).toBe(true);
    expect(result.commands.find((c) => c.path === "daily")?.moduleEnabled).toBe(
      false
    );
    expect(result.commands.find((c) => c.path === "ping")?.moduleEnabled).toBe(
      true
    );
    expect(find("play").moduleEnabled).toBe(true);
    expect(
      result.commands.find((c) => c.path === "queue")?.notes.join(" ")
    ).toContain("read even when");
    expect(find("cases").notes.join(" ")).toContain("remains readable");
  });
});
