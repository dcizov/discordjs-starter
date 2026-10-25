import { describe, expect, it, vi, afterEach } from "vitest";
import { PermissionFlagsBits, GatewayIntentBits } from "discord.js";
import { inviteUrl } from "@orbit/core/environment";
import {
  baselineInvitePermissions,
  botGuildPermissions,
  elevatedRoleMask,
  knownDiscordPermissionMask,
  gatewayIntentNames,
  permissionMatrix,
  permissionState,
  Permissions,
  roleAssignmentIssue,
} from "@orbit/core/permissions";
import { moduleSetup, sourceSetupIssue } from "@orbit/core/module-setup";
import { createDemo } from "../packages/db/src/demo-seed";
afterEach(() => vi.unstubAllEnvs());
function context() {
  const demo = createDemo();
  return {
    guild: demo.guilds[0],
    resources: demo.resources,
    demo: false,
    integrations: { itad: true, lavalink: true },
    health: [
      {
        name: "Music backend",
        status: "healthy" as const,
        latency: 0,
        detail: "test",
        updatedAt: "2026-10-25T12:00:00Z",
      },
    ],
  };
}
describe("code-derived least-privilege permissions and setup", () => {
  it("matches the installed Discord bitfields exactly (including the legacy expression alias)", () => {
    expect(knownDiscordPermissionMask).toBe(
      Object.values(PermissionFlagsBits).reduce(
        (mask, value) => mask | value,
        0n
      )
    );
    for (const [name, value] of Object.entries(Permissions))
      expect(value).toBe(
        PermissionFlagsBits[
          name === "ManageExpressions"
            ? "ManageGuildExpressions"
            : (name as keyof typeof PermissionFlagsBits)
        ]
      );
  });
  it("fails closed for unknown future or sensitive permission grants, without losing raw export bits", () => {
    const role = {
      id: "safe",
      name: "Community",
      color: "",
      position: 1,
      managed: false,
      permissions: (1n << 120n).toString(),
    };
    expect(roleAssignmentIssue(role, 10, "guild")).toContain("unrecognized");
    for (const permissions of [
      Permissions.PinMessages,
      Permissions.ViewAuditLog,
      Permissions.CreateEvents,
    ])
      expect(
        roleAssignmentIssue(
          { ...role, permissions: permissions.toString() },
          10,
          "guild"
        )
      ).toContain("elevated");
    expect(
      roleAssignmentIssue({ ...role, permissions: "" }, 10, "guild")
    ).toContain("not available");
  });
  it("requests basic posting only in an invite, not role/moderation/voice/admin powers", () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "120000000000000001");
    const invite = new URL(inviteUrl("120000000000000002")!);
    expect(invite.searchParams.get("scope")).toBe("bot applications.commands");
    expect(invite.searchParams.get("permissions")).toBe("19456");
    expect(BigInt(baselineInvitePermissions) & elevatedRoleMask).toBe(0n);
    expect(
      BigInt(baselineInvitePermissions) &
        (Permissions.Connect | Permissions.Speak)
    ).toBe(0n);
  });
  it("keeps privileged Portal intents separate from normal voice and requests no presence", () => {
    expect(gatewayIntentNames.map((name) => GatewayIntentBits[name])).toEqual([
      1, 2, 512, 32768, 1024, 128,
    ]);
    expect(gatewayIntentNames).not.toContain("GuildPresences");
    expect(
      permissionMatrix.find((feature) => feature.key === "voice")!.required
    ).toEqual(["ViewChannel", "Connect", "Speak"]);
    expect(
      permissionMatrix.find((feature) => feature.key === "news")!.required
    ).not.toContain("ManageWebhooks");
    expect(
      permissionMatrix.find((feature) => feature.key === "posting")!.required
    ).not.toContain("ReadMessageHistory");
  });
  it("does not turn missing/legacy permission snapshots into green checks", () => {
    expect(permissionState(undefined, ["Connect"])).toBe("unknown");
    expect(permissionState("bad", ["Connect"])).toBe("unknown");
    expect(permissionState("0", ["Connect"])).toBe("missing");
    expect(
      botGuildPermissions([
        {
          id: "one",
          name: "role",
          color: "",
          position: 1,
          permissions: "8",
          managed: false,
        },
      ])
    ).toBeUndefined();
  });
  it("combines only roles assigned to the bot, not an unrelated administrator role", () => {
    const data = context();
    const bits = botGuildPermissions(data.guild.roles)!;
    expect(permissionState(bits, ["ManageRoles"])).toBe("present");
    expect(permissionState(bits, ["BanMembers"])).toBe("missing");
    expect(permissionState("8", ["BanMembers"])).toBe("present"); // permission bits, NOT hierarchy bypass
    const higher = { ...data.guild.roles[3], position: 20, permissions: "8" };
    expect(roleAssignmentIssue(higher, 10, data.guild.id)).toContain("above");
  });
  it("keeps configuration, missing credentials, and actual playback proof separate", () => {
    const data = context();
    expect(moduleSetup(data, "music")).toMatchObject({ state: "configured" });
    expect(moduleSetup(data, "music").detail).toContain("authorized live test");
    data.integrations.lavalink = false;
    expect(moduleSetup(data, "music").state).toBe("needs-setup");
    data.demo = true;
    expect(moduleSetup(data, "music").state).toBe("configured"); // expressly sample config, never audio
    data.guild.config.modules.music = false;
    expect(moduleSetup(data, "music").state).toBe("paused");
  });
  it("flags a deleted DJ role instead of implying everyone may control music", () => {
    const data = context();
    data.guild.config.music.djRoleId = "120000000000000777";
    expect(moduleSetup(data, "music")).toMatchObject({
      state: "needs-setup",
      detail: expect.stringContaining("no longer exists"),
    });
    data.guild.config.music.djRoleId = "";
    expect(moduleSetup(data, "music").state).toBe("configured");
  });
  it("does not count Stage-only or denied channels as usable voice", () => {
    const data = context();
    data.guild.channels = data.guild.channels.map((channel) => ({
      ...channel,
      type: channel.type === "voice" ? "stage" : channel.type,
    }));
    expect(moduleSetup(data, "music")).toMatchObject({
      state: "needs-setup",
      detail: expect.stringContaining("Stage"),
    });
  });
  it("keeps supplied starter feeds setup-required and supports direct destinations OR routes", () => {
    const data = context();
    const starter = data.resources.find(
      (item) => item.kind === "source" && item.data.adapter === "mojang"
    )!;
    expect(sourceSetupIssue(starter)).toContain("verified RSS/Atom");
    expect(moduleSetup(data, "news")).toMatchObject({ state: "needs-setup" });
    starter.enabled = false;
    data.resources = data.resources.filter((item) => item.kind !== "route");
    expect(moduleSetup(data, "news").state).toBe("configured"); // Steam has a direct destination
    const steam = data.resources.find(
      (item) => item.kind === "source" && item.data.adapter === "steam"
    )!;
    steam.data.channelId = "";
    expect(moduleSetup(data, "news").state).toBe("needs-setup");
    data.resources.push({
      ...steam,
      id: "route",
      kind: "route",
      data: { sourceIds: [steam.id], channelId: data.guild.channels[0].id },
    });
    expect(moduleSetup(data, "news").state).toBe("configured");
  });
  it("checks real destination permission snapshots, never just a canSend flag", () => {
    const data = context();
    const deal = data.resources.find(
      (item) => item.kind === "deal" && item.enabled
    )!;
    const destination = data.guild.channels.find(
      (channel) => channel.id === deal.data.channelId
    )!;
    expect(moduleSetup(data, "deals").state).toBe("configured");
    destination.permissionBits = undefined;
    expect(destination.canSend).toBe(true);
    expect(moduleSetup(data, "deals").state).toBe("not-verified");
    destination.permissionBits = "0";
    expect(moduleSetup(data, "deals").state).toBe("needs-setup");
  });
  it("uses the same role protection policy for setup and assignment rather than banning every nonzero bit", () => {
    const data = context();
    const role = data.guild.roles.find((item) => item.name === "PC gaming")!;
    role.permissions = Permissions.ViewChannel.toString();
    expect(roleAssignmentIssue(role, 10, data.guild.id)).toBeNull();
    expect(moduleSetup(data, "roles").state).toBe("configured");
    role.permissions = Permissions.Administrator.toString();
    expect(moduleSetup(data, "roles")).toMatchObject({
      state: "needs-setup",
      detail: expect.stringContaining("protected"),
    });
  });
});
