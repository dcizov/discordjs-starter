import { ChannelType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateRunStep } from "../packages/core/src/template-run-steps";

/**
 * Crash recovery for a template apply, end to end.
 *
 * The pure tests in `template-run-steps.test.ts` prove the rule for rebuilding a
 * run, and the SQL tests prove the steps survive. This proves the apply engine
 * actually uses them: that an interrupted run does not recreate what it already
 * made, and that the fingerprint guard does not mistake its own work for a
 * stale plan.
 */

// ---------------------------------------------------------------- fake storage

type Step = Omit<TemplateRunStep, "id" | "createdAt" | "updatedAt">;

const state = {
  run: {} as Record<string, any>,
  steps: [] as Step[],
  template: null as any,
  guildRow: null as any,
  savedConfigs: [] as any[],
  /**
   * Crash hooks, both on paths with no try/catch around them — which is the
   * whole point: a crash is different from a step failing, because a failed
   * step is caught and the run finishes as "partial", while a crash leaves the
   * run "running" with half its work done and recorded.
   */
  /** Throw on the Nth `guild.roles.cache.find`, i.e. part-way through the roles. */
  crashOnFind: -1,
  /** Throw when the configuration step reads the guild, after channels are done. */
  crashOnGetGuild: false,
  findCalls: 0,
};

vi.mock("@orbit/db", () => ({
  getGuild: async (id: string) => {
    if (state.crashOnGetGuild) throw new Error("worker crashed");
    return state.guildRow?.id === id ? state.guildRow : null;
  },
  getTemplate: async () => state.template,
  getTemplateRun: async (id: string) =>
    state.run.id === id ? state.run : null,
  updateTemplateRun: async (id: string, patch: Record<string, any>) => {
    Object.assign(state.run, patch);
  },
  listTemplateRunSteps: async (runId: string) =>
    state.steps.filter((step) => step.runId === runId),
  recordTemplateRunStep: async (input: {
    runId: string;
    key: string;
    kind: string;
    action: string;
    targetId?: string | null;
    state: string;
    error?: string | null;
  }) => {
    const existing = state.steps.find(
      (step) => step.runId === input.runId && step.key === input.key
    );
    const next = {
      runId: input.runId,
      key: input.key,
      kind: input.kind,
      action: input.action,
      targetId: input.targetId ?? null,
      state: input.state,
      error: input.error ?? null,
    } as Step;
    if (existing) Object.assign(existing, next);
    else state.steps.push(next);
  },
  saveConfig: async (guildId: string, config: any, actor: any) => {
    state.savedConfigs.push({ guildId, config, actor });
  },
  saveTemplate: async () => {
    throw new Error("not used by apply");
  },
}));

vi.mock("@orbit/core/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

const { applyTemplateRun } =
  await import("../apps/bot/src/features/templates/apply");

// ------------------------------------------------------------------ fake guild

type FakeRole = {
  id: string;
  name: string;
  managed: boolean;
  position: number;
  permissions: { bitfield: bigint };
};
type FakeChannel = {
  id: string;
  name: string;
  type: ChannelType;
  parentId: string | null;
  isThread: () => boolean;
  edit: (patch: any) => Promise<void>;
};

class Cache<V> extends Map<string, V> {
  find(predicate: (value: V) => boolean): V | undefined {
    for (const value of this.values()) if (predicate(value)) return value;
    return undefined;
  }
}

let roleSeq = 0;
let channelSeq = 0;

function makeGuild() {
  roleSeq = 0;
  channelSeq = 0;
  const roles = new Cache<FakeRole>();
  const channels = new Cache<FakeChannel>();
  const edits: { id: string; patch: any }[] = [];
  const createdRoleNames: string[] = [];

  const roleFind = roles.find.bind(roles);
  roles.find = (predicate: (value: FakeRole) => boolean) => {
    state.findCalls += 1;
    if (state.findCalls === state.crashOnFind)
      throw new Error("worker crashed");
    return roleFind(predicate);
  };

  const guild = {
    id: "880000000000000001",
    name: "Target server",
    edits,
    createdRoleNames,
    roles: {
      cache: roles,
      create: async (opts: any) => {
        createdRoleNames.push(opts.name);
        roleSeq += 1;
        const id = `88000000000000${String(1000 + roleSeq)}`;
        const role: FakeRole = {
          id,
          name: opts.name,
          managed: false,
          position: roleSeq,
          permissions: { bitfield: 0n },
        };
        roles.set(id, role);
        return role;
      },
    },
    channels: {
      cache: channels,
      create: async (opts: any) => {
        channelSeq += 1;
        const id = `88000000000000${String(2000 + channelSeq)}`;
        const channel: FakeChannel = {
          id,
          name: opts.name,
          type: opts.type,
          parentId: opts.parent ?? null,
          isThread: () => false,
          edit: async (patch: any) => {
            edits.push({ id, patch });
          },
        };
        channels.set(id, channel);
        return channel;
      },
    },
    // Administrator, so the preview reports no permission blockers.
    members: {
      me: {
        id: "880000000000000099",
        roles: { highest: { position: 100 } },
        permissions: { bitfield: 8n },
      },
    },
    client: { user: { id: "880000000000000099", avatar: null } },
  };
  return guild;
}

// ------------------------------------------------------------------ the fixture

const document = () => ({
  version: 1 as const,
  kind: "both" as const,
  name: "Recoverable",
  description: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  omitted: [] as string[],
  structure: {
    roles: [
      {
        key: "role:alpha",
        name: "Alpha",
        color: null,
        permissions: "1024",
        hoist: false,
        mentionable: false,
        position: 0,
      },
      {
        key: "role:beta",
        name: "Beta",
        color: null,
        permissions: "1024",
        hoist: false,
        mentionable: false,
        position: 1,
      },
    ],
    channels: [
      {
        key: "channel:general",
        name: "general",
        type: "text" as const,
        parentKey: null,
        topic: null,
        nsfw: false,
        position: 0,
        overwrites: [
          { roleKey: "role:alpha", allow: "1024", deny: "0" as const },
        ],
      },
    ],
  },
  config: { bindings: { auditChannelKey: "channel:general" } },
});

const RUN_ID = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.steps = [];
  state.savedConfigs = [];
  state.findCalls = 0;
  state.crashOnFind = -1;
  state.crashOnGetGuild = false;
  state.template = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Recoverable",
    sourceGuildId: "880000000000000002",
    data: document(),
  };
  state.guildRow = {
    id: "880000000000000001",
    config: {
      locale: "en",
      timezone: "UTC",
      modules: {},
      economy: {},
      music: {},
      moderation: {},
    },
  };
  state.run = {
    id: RUN_ID,
    guildId: "880000000000000001",
    templateId: state.template.id,
    actorId: "880000000000000099",
    state: "queued",
    plan: { sourceGuildId: "880000000000000002" },
    result: null,
    error: null,
  };
});

const input = (fingerprint: string) => ({
  templateId: state.template.id,
  runId: RUN_ID,
  fingerprint,
  mapping: {},
});

/** The fingerprint a preview against the untouched target produces. */
async function previewFingerprint(guild: any) {
  const { previewTemplate } = await import("@orbit/core/templates");
  const { applyTarget } =
    await import("../apps/bot/src/features/templates/apply");
  return previewTemplate({
    template: document(),
    target: applyTarget(guild),
  }).fingerprint;
}

// ---------------------------------------------------------------------- tests

describe("resuming an interrupted apply run", () => {
  it("does not recreate what the crashed attempt already made", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);

    // Crash part-way through the roles: Alpha is created and recorded, then the
    // process dies before Beta is even looked at.
    // Crash part-way through the roles: Alpha is created and recorded, then the
    // process dies before Beta is even looked at.
    state.crashOnFind = 2;
    await expect(
      applyTemplateRun(guild as never, input(fingerprint))
    ).rejects.toThrow("worker crashed");

    // Alpha was made and recorded before the crash.
    expect(state.steps.map((s) => [s.key, s.state])).toEqual([
      ["role:alpha", "done"],
    ]);
    expect(guild.createdRoleNames).toEqual(["Alpha"]);
    // The run was left running, which is what makes a resume legitimate.
    expect(state.run.state).toBe("running");

    const alphaId = state.steps[0]?.targetId;

    // Second attempt. The target has changed because the first attempt changed
    // it, so the fingerprint no longer matches — a resume must not be rejected
    // for work this run did itself.
    const result = await applyTemplateRun(guild as never, input(fingerprint));

    expect(result.state).toBe("completed");
    // Alpha was adopted, not made twice.
    expect(guild.createdRoleNames).toEqual(["Alpha", "Beta"]);
    expect(result.created.map((r) => r.key)).toEqual([
      "role:alpha",
      "role:beta",
      "channel:general",
    ]);
    // Alpha is reported as created, because the report covers the whole run.
    expect(result.created.find((r) => r.key === "role:alpha")?.id).toBe(
      alphaId
    );
    expect(result.reused).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it("keeps the mapping, so overwrites point at the role it made", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);
    // Crash part-way through the roles: Alpha is created and recorded, then the
    // process dies before Beta is even looked at.
    state.crashOnFind = 2;
    await expect(
      applyTemplateRun(guild as never, input(fingerprint))
    ).rejects.toThrow("worker crashed");

    const alphaId = state.steps[0]?.targetId;
    await applyTemplateRun(guild as never, input(fingerprint));

    const overwriteEdits = guild.edits.filter(
      (e) => e.patch.permissionOverwrites
    );
    expect(overwriteEdits).toHaveLength(1);
    expect(overwriteEdits[0]?.patch.permissionOverwrites).toEqual([
      { id: alphaId, allow: 1024n, deny: 0n },
    ]);
  });

  it("writes configuration once, not once per attempt", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);
    // Crash part-way through the roles: Alpha is created and recorded, then the
    // process dies before Beta is even looked at.
    state.crashOnFind = 2;
    await expect(
      applyTemplateRun(guild as never, input(fingerprint))
    ).rejects.toThrow("worker crashed");

    await applyTemplateRun(guild as never, input(fingerprint));

    // Re-saving would duplicate the audit entry without changing anything.
    expect(state.savedConfigs).toHaveLength(1);
    // The binding still resolved, through the recorded channel mapping.
    expect(state.savedConfigs[0].config.auditChannelId).toBe(
      state.steps.find((s) => s.key === "channel:general")?.targetId
    );
  });

  it("does not apply overwrites twice", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);
    // Crash after the channels and their overwrites are done, before config.
    state.crashOnGetGuild = true;
    await expect(
      applyTemplateRun(guild as never, input(fingerprint))
    ).rejects.toThrow("worker crashed");

    const before = guild.edits.filter(
      (e) => e.patch.permissionOverwrites
    ).length;
    state.crashOnGetGuild = false;
    await applyTemplateRun(guild as never, input(fingerprint));
    const after = guild.edits.filter(
      (e) => e.patch.permissionOverwrites
    ).length;
    expect(after).toBe(before);
  });

  it("remakes a resource that vanished between the two attempts", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);
    // Crash part-way through the roles: Alpha is created and recorded, then the
    // process dies before Beta is even looked at.
    state.crashOnFind = 2;
    await expect(
      applyTemplateRun(guild as never, input(fingerprint))
    ).rejects.toThrow("worker crashed");

    // Someone deleted the role the first attempt made.
    const alphaId = state.steps[0]?.targetId as string;
    guild.roles.cache.delete(alphaId);

    const result = await applyTemplateRun(guild as never, input(fingerprint));

    expect(result.state).toBe("completed");
    expect(guild.createdRoleNames).toEqual(["Alpha", "Alpha", "Beta"]);
    // The new id replaced the stale one rather than being added beside it.
    expect(state.steps.filter((s) => s.key === "role:alpha")).toHaveLength(1);
    expect(state.steps.find((s) => s.key === "role:alpha")?.targetId).not.toBe(
      alphaId
    );
  });

  it("still rejects a first attempt whose preview has gone stale", async () => {
    const guild = makeGuild();
    const fingerprint = await previewFingerprint(guild);
    // Someone creates a role called Alpha between the preview and the apply.
    // That flips `role:alpha` from "create" to "reuse", which is exactly the
    // kind of target change the fingerprint exists to catch.
    guild.roles.cache.set("880000000000009001", {
      id: "880000000000009001",
      name: "Alpha",
      managed: false,
      position: 3,
      permissions: { bitfield: 0n },
    });

    const result = await applyTemplateRun(guild as never, input(fingerprint));
    expect(result.state).toBe("stale");
    expect(guild.createdRoleNames).toEqual([]);
    expect(state.steps).toEqual([]);
  });
});
