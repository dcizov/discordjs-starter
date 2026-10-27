import { describe, expect, it } from "vitest";
import { defaultConfig } from "@orbit/core";
import {
  TEMPLATE_LIMITS,
  buildTemplate,
  parseTemplateDocument,
  planFingerprint,
  previewTemplate,
  type GuildApplyTarget,
  type ServerTemplateDocument,
} from "@orbit/core/templates";

const ADMIN = (1n << 3n).toString();
const MANAGE_GUILD = (1n << 5n).toString();
const MANAGE_ROLES = (1n << 28n).toString();
const MANAGE_CHANNELS = (1n << 4n).toString();

const everyone = "120000000000000001";
const memberRole = "120000000000000010";
const botRole = "120000000000000020";

function structure() {
  return {
    roles: [
      {
        id: everyone,
        name: "@everyone",
        color: "#000000",
        position: 0,
        permissions: "0",
        managed: false,
      },
      {
        id: memberRole,
        name: "Member",
        color: "#3366ff",
        position: 3,
        permissions: MANAGE_GUILD,
        managed: false,
      },
      {
        id: botRole,
        name: "Orbit",
        color: "#000000",
        position: 9,
        permissions: ADMIN,
        managed: true,
      },
      {
        id: "120000000000000030",
        name: "Owner",
        color: "#ff0000",
        position: 12,
        permissions: ADMIN,
        managed: false,
      },
    ],
    channels: [
      {
        id: "120000000000000100",
        name: "Start here",
        type: "category" as const,
        parentId: null,
        overwrites: [],
      },
      {
        id: "120000000000000101",
        name: "general",
        type: "text" as const,
        parentId: "120000000000000100",
        topic: "Say hello",
        overwrites: [
          { targetId: everyone, allow: "1024", deny: "0" },
          { targetId: memberRole, allow: "2048", deny: "0" },
          // A role that is not part of the template must not leak an id.
          { targetId: "120000000000000030", allow: "8", deny: "0" },
        ],
      },
      {
        id: "120000000000000102",
        name: "Lounge",
        type: "voice" as const,
        parentId: "120000000000000100",
        overwrites: [],
      },
      {
        id: "120000000000000103",
        name: "A thread-ish announcement",
        type: "other" as const,
        parentId: null,
        overwrites: [],
      },
    ],
  };
}

function built(include = { structure: true, config: true }) {
  const config = structuredClone(defaultConfig);
  config.music.djRoleId = memberRole;
  config.moderation.exemptRoleIds = [memberRole];
  config.auditChannelId = "120000000000000101";
  config.notificationRoleId = memberRole;
  return buildTemplate({
    name: "Community starter",
    description: "A calm place to begin",
    include,
    structure: structure(),
    config,
    createdAt: new Date("2026-10-27T00:00:00Z"),
  });
}

const target: GuildApplyTarget = {
  id: "120000000000000900",
  name: "Target",
  botRolePosition: 5,
  botPermissions: (BigInt(MANAGE_ROLES) | BigInt(MANAGE_CHANNELS)).toString(),
  roles: [
    {
      id: "120000000000000901",
      name: "@everyone",
      managed: false,
      position: 0,
    },
  ],
  channels: [],
};

describe("template capture", () => {
  it("stores portable logical keys and no Discord ids", () => {
    const document = built();
    const text = JSON.stringify(document);
    for (const id of [
      everyone,
      memberRole,
      "120000000000000030",
      "120000000000000100",
      "120000000000000101",
      "120000000000000102",
    ])
      expect(text).not.toContain(id);
    // Highest position first; the integration-managed role is not carried.
    expect(document.structure?.roles.map((r) => r.key)).toEqual([
      "role:owner",
      "role:member",
      "role:everyone",
    ]);
    expect(document.structure?.channels.map((c) => c.key)).toContain(
      "channel:general"
    );
    // Bindings point at keys, so they resolve again on a different server.
    expect(document.config?.music?.djRoleKey).toBe("role:member");
    expect(document.config?.bindings?.auditChannelKey).toBe("channel:general");
    expect(document.config?.bindings?.notificationRoleKey).toBe("role:member");
  });

  it("never carries secrets, members, history or economy data", () => {
    const document = built();
    const text = JSON.stringify(document).toLowerCase();
    for (const secret of [
      "token",
      "secret",
      "webhook",
      "session",
      "password",
      "authorization",
    ])
      expect(text).not.toContain(secret);
    expect(document.omitted.length).toBeGreaterThan(0);
    expect(Object.keys(document)).toEqual(
      expect.arrayContaining(["version", "kind", "name", "omitted"])
    );
    expect(document.version).toBe(1);
    expect(document.kind).toBe("both");
  });

  it("drops managed roles and strips Administrator, and says so", () => {
    const document = built();
    const names = document.structure?.roles.map((r) => r.name) ?? [];
    expect(names).not.toContain("Orbit");
    const owner = document.structure?.roles.find((r) => r.name === "Owner");
    expect(owner).toBeDefined();
    expect((BigInt(owner!.permissions) & (1n << 3n)) === 1n << 3n).toBe(false);
    expect(document.omitted.join(" ")).toContain("Administrator");
    expect(document.omitted.join(" ")).toContain("Integration-managed roles");
  });

  it("keeps only overwrites for roles inside the template", () => {
    const document = built();
    const general = document.structure?.channels.find(
      (c) => c.key === "channel:general"
    );
    expect(
      [...new Set(general?.overwrites.map((o) => o.roleKey))].sort()
    ).toEqual(["role:everyone", "role:member", "role:owner"]);
  });

  it("records channel types it cannot carry instead of guessing", () => {
    const document = built();
    expect(document.structure?.channels.map((c) => c.name)).not.toContain(
      "A thread-ish announcement"
    );
    expect(document.omitted.join(" ")).toContain(
      "of a type Orbit does not create"
    );
  });

  it("carries structure only, or configuration only, when asked", () => {
    const structureOnly = built({ structure: true, config: false });
    expect(structureOnly.structure).toBeDefined();
    expect(structureOnly.config).toBeUndefined();
    expect(structureOnly.kind).toBe("structure");
    const configOnly = built({ structure: false, config: true });
    expect(configOnly.structure).toBeUndefined();
    expect(configOnly.config).toBeDefined();
    expect(configOnly.kind).toBe("configuration");
  });

  it("rejects a document that is not exactly this schema version", () => {
    const document = built();
    expect(parseTemplateDocument(document).name).toBe("Community starter");
    expect(() => parseTemplateDocument({ ...document, version: 2 })).toThrow();
    expect(() =>
      parseTemplateDocument({ ...document, unexpected: true })
    ).toThrow();
    expect(() =>
      parseTemplateDocument({
        ...document,
        structure: {
          roles: [],
          channels: [
            {
              ...document.structure!.channels[0],
              // Unknown field in a nested object.
              surprise: true,
            },
          ],
        },
      })
    ).toThrow();
  });
});

describe("template preview", () => {
  const document: ServerTemplateDocument = built();

  it("creates what is missing, reuses what matches, and never deletes", () => {
    const plan = previewTemplate({ template: document, target });
    expect(plan.counts).toEqual({ create: 5, reuse: 1, skip: 0 });
    // @everyone is reused rather than recreated.
    expect(plan.items.find((i) => i.key === "role:everyone")).toMatchObject({
      action: "reuse",
      targetId: target.roles[0].id,
    });
    expect(plan.blockers).toEqual([]);
    expect(JSON.stringify(plan)).not.toContain("delete");
  });

  it("is stable for the same target and changes when a decision changes", () => {
    const first = previewTemplate({ template: document, target });
    const second = previewTemplate({ template: document, target });
    expect(first.fingerprint).toBe(second.fingerprint);
    const changed = previewTemplate({
      template: document,
      target: {
        ...target,
        roles: [
          ...target.roles,
          { id: "r2", name: "Member", managed: false, position: 1 },
        ],
      },
    });
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    expect(changed.items.find((i) => i.key === "role:member")).toMatchObject({
      action: "reuse",
      targetId: "r2",
    });
    expect(planFingerprint([])).toBe("0-0");
  });

  it("honours an explicit mapping and reports a mapping that disappeared", () => {
    const plan = previewTemplate({
      template: document,
      target,
      mapping: {
        "role:member": target.roles[0].id,
        "channel:general": "999",
      },
    });
    expect(plan.items.find((i) => i.key === "role:member")).toMatchObject({
      action: "reuse",
      targetId: target.roles[0].id,
    });
    expect(plan.items.find((i) => i.key === "channel:general")).toMatchObject({
      action: "skip",
    });
    expect(
      plan.items.find((i) => i.key === "channel:general")?.reason
    ).toContain("no longer exists");
  });

  it("blocks on missing permissions instead of creating anything", () => {
    const plan = previewTemplate({
      template: document,
      target: { ...target, botPermissions: "0" },
    });
    expect(plan.blockers.map((b) => b.code)).toEqual([
      "missing-manage-roles",
      "missing-manage-channels",
    ]);
  });

  it("blocks on Discord's role and channel limits", () => {
    const roles = Array.from({ length: 250 }, (_, i) => ({
      id: `r${i}`,
      name: `Role ${i}`,
      managed: false,
      position: i,
    }));
    const plan = previewTemplate({
      template: document,
      target: { ...target, roles },
    });
    expect(plan.blockers.map((b) => b.code)).toContain("role-limit");
    expect(TEMPLATE_LIMITS.roles).toBe(100);
  });

  it("skips a child channel when its category cannot be created", () => {
    const plan = previewTemplate({
      template: document,
      target,
      mapping: { "channel:start-here": "does-not-exist" },
    });
    expect(
      plan.items.find((i) => i.key === "channel:start-here")
    ).toMatchObject({ action: "skip" });
    expect(plan.items.find((i) => i.key === "channel:general")).toMatchObject({
      action: "skip",
    });
  });

  it("describes configuration changes without applying Discord ids", () => {
    const plan = previewTemplate({ template: document, target });
    expect(plan.config?.bindings.map((b) => b.field)).toEqual(
      expect.arrayContaining([
        "music.djRoleId",
        "moderation.exemptRoleIds",
        "auditChannelId",
        "notificationRoleId",
      ])
    );
    const text = JSON.stringify(plan.config);
    expect(text).not.toContain(memberRole);
    expect(text).not.toContain("120000000000000101");
  });

  it("warns when Orbit's role sits at the bottom of the hierarchy", () => {
    const plan = previewTemplate({
      template: document,
      target: { ...target, botRolePosition: 1 },
    });
    expect(plan.warnings.join(" ")).toContain("bottom of the hierarchy");
  });
});
