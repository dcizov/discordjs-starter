import { PermissionFlagsBits as P, Routes } from "discord.js";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChannelPermissionExport,
  buildServerRoleExport,
  collectServerRoleExport,
  parseChannelExportArgs,
  writeChannelPermissionExport,
} from "../apps/bot/src/channel-export";

const guildId = "120000000000000001";
const roleId = "120000000000000201";
const at = new Date("2026-10-24T12:00:00Z");
function fixture() {
  return {
    guild: {
      id: guildId,
      name: "Test community",
      owner_id: "120000000000000099",
      secret: "never-export-this",
    },
    roles: [
      {
        id: guildId,
        name: "@everyone",
        position: 0,
        managed: false,
        permissions: P.ViewChannel.toString(),
      },
      {
        id: roleId,
        name: "Community helpers",
        position: 9,
        managed: true,
        permissions: (P.ManageRoles | (1n << 120n)).toString(),
        color: 0xaabbcc,
        colors: {
          primary_color: 0xaabbcc,
          secondary_color: 0x112233,
          tertiary_color: null,
          secret: "never-export-this",
        },
        hoist: true,
        mentionable: false,
        icon: "role-icon-hash",
        unicode_emoji: null,
        flags: 1,
        tags: {
          bot_id: "120000000000000999",
          integration_id: "120000000000000998",
          premium_subscriber: null,
          subscription_listing_id: "120000000000000997",
          available_for_purchase: null,
          guild_connections: null,
          secret: "never-export-this",
        },
        members: ["never-export-this"],
        secret: "never-export-this",
      },
    ],
  };
}
const build = () => buildServerRoleExport(fixture(), { guildId }, at);

describe("read-only server role export", () => {
  it("includes everyone, hierarchy, metadata, exact permissions and unknown high bits", () => {
    const data = build();
    expect(data.format).toBe("orbit.discord-server-roles");
    expect(data.exportedAt).toBe(at.toISOString());
    expect(data.roles.map((r) => r.id)).toEqual([roleId, guildId]);
    expect(data.roles[0]).toMatchObject({
      name: "Community helpers",
      position: 9,
      isEveryone: false,
      managed: true,
      color: 0xaabbcc,
      colors: { primary: 0xaabbcc, secondary: 0x112233, tertiary: null },
      hoist: true,
      mentionable: false,
      icon: "role-icon-hash",
      unicodeEmoji: null,
      flags: 1,
      permissions: {
        names: ["ManageRoles"],
        unknownBitfield: (1n << 120n).toString(),
      },
    });
    expect(data.roles[0].permissions.bitfield).toBe(
      (P.ManageRoles | (1n << 120n)).toString()
    );
    expect(data.roles[1].isEveryone).toBe(true);
    expect(data).not.toHaveProperty("channels");
    expect(data.warnings).toEqual([]);
    expect(JSON.stringify(data)).not.toContain("never-export-this");
  });
  it("decodes present-null Discord tag flags as true", () => {
    expect(build().roles[0].tags).toEqual({
      botId: "120000000000000999",
      integrationId: "120000000000000998",
      premiumSubscriber: true,
      subscriptionListingId: "120000000000000997",
      availableForPurchase: true,
      guildConnections: true,
    });
  });
  it("keeps absent optional metadata unknown rather than inventing defaults", () => {
    expect(build().roles[1]).toMatchObject({
      color: null,
      colors: null,
      hoist: null,
      mentionable: null,
      icon: null,
      unicodeEmoji: null,
      flags: null,
      tags: null,
    });
    const raw = fixture();
    raw.roles[1].tags = {} as (typeof raw.roles)[1]["tags"];
    expect(buildServerRoleExport(raw, { guildId }).roles[0].tags).toMatchObject(
      {
        premiumSubscriber: false,
        availableForPurchase: false,
        guildConnections: false,
      }
    );
  });
  it("exports unicode role icons without manufacturing a CDN URL", () => {
    const raw = fixture();
    const roles = [{ ...raw.roles[1], icon: null, unicode_emoji: "🌙" }];
    expect(
      buildServerRoleExport({ guild: raw.guild, roles }, { guildId }).roles[0]
    ).toMatchObject({ icon: null, unicodeEmoji: "🌙" });
  });
  it("shares the same richer role serialization with the channel export", () => {
    const raw = fixture();
    const channelData = buildChannelPermissionExport(
      { ...raw, channels: [] },
      { guildId },
      at
    );
    expect(channelData.roles).toEqual(build().roles);
  });
  it("warns if Discord did not return everyone without fabricating the role", () => {
    const raw = fixture();
    expect(
      buildServerRoleExport({ ...raw, roles: [raw.roles[1]] }, { guildId })
        .warnings
    ).toEqual([{ code: "EVERYONE_ROLE_NOT_RETURNED" }]);
  });
  it("rejects mixed-server data and duplicate roles", () => {
    const raw = fixture();
    expect(() =>
      buildServerRoleExport(
        { ...raw, guild: { ...raw.guild, id: roleId } },
        { guildId }
      )
    ).toThrow("different server");
    expect(() =>
      buildServerRoleExport(
        { ...raw, roles: [...raw.roles, raw.roles[1]] },
        { guildId }
      )
    ).toThrow("duplicate role");
  });
  it.each([-1, 0x1000000, 0.5])("rejects invalid RGB values (%s)", (color) => {
    const raw = fixture();
    expect(() =>
      buildServerRoleExport(
        { ...raw, roles: [{ ...raw.roles[1], color }] },
        { guildId }
      )
    ).toThrow();
  });
  it("performs exactly two scoped GET requests, never channels or member lists", async () => {
    const raw = fixture();
    const get = vi.fn(async (route: `/${string}`) => {
      if (route === Routes.guild(guildId)) return raw.guild;
      if (route === Routes.guildRoles(guildId)) return raw.roles;
      throw new Error("Unexpected endpoint");
    });
    expect(
      (await collectServerRoleExport({ get }, { guildId }, () => at)).roles
    ).toHaveLength(2);
    expect(get.mock.calls.flat()).toEqual([
      Routes.guild(guildId),
      Routes.guildRoles(guildId),
    ]);
  });
  it("validates the server ID before any request and propagates access failures", async () => {
    const get = vi.fn();
    await expect(
      collectServerRoleExport({ get }, { guildId: "../other" })
    ).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
    get.mockRejectedValueOnce(new Error("Missing Access"));
    await expect(collectServerRoleExport({ get }, { guildId })).rejects.toThrow(
      "Missing Access"
    );
  });
});
describe("role export CLI and private output", () => {
  const folders: string[] = [];
  afterEach(async () => {
    for (const dir of folders.splice(0))
      await rm(dir, { recursive: true, force: true });
  });
  it("parses role-only mode and rejects channel selection or repeated flags", () => {
    expect(
      parseChannelExportArgs(["--roles-only", "--guild", guildId])
    ).toMatchObject({ rolesOnly: true, guildId });
    expect(() =>
      parseChannelExportArgs([
        "--roles-only",
        "--guild",
        guildId,
        "--channel",
        roleId,
      ])
    ).toThrow("cannot be combined");
    expect(() =>
      parseChannelExportArgs([
        "--roles-only",
        "--roles-only",
        "--guild",
        guildId,
      ])
    ).toThrow("only once");
  });
  it("writes a private role-only JSON file and never clobbers it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orbit-role-export-"));
    folders.push(dir);
    const path = join(dir, "roles.json");
    await writeChannelPermissionExport(build(), path);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(build());
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(writeChannelPermissionExport(build(), path)).rejects.toThrow(
      "already exists"
    );
  });
  it("provides role export help and refuses live reads in demo mode", () => {
    const run = (args: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "apps/bot/src/export-channels.ts",
          "--roles-only",
          ...args,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10000,
          env: {
            ...process.env,
            DEMO_MODE: "true",
            DISCORD_TOKEN: "private-test-token",
          },
        }
      );
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("roles:export");
    expect(help.stderr).toBe("");
    const denied = run(["--guild", guildId, "--stdout"]);
    expect(denied.status).toBe(1);
    expect(denied.stdout).toBe("");
    expect(denied.stderr).not.toContain("private-test-token");
  });
});
