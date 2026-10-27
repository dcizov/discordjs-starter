import { describe, expect, it } from "vitest";
import {
  CONFIG_STEP_KEY,
  overwriteStepKey,
  rebuildRunProgress,
  type TemplateRunStep,
  type TemplateRunStepKind,
} from "../packages/core/src/template-run-steps";

/**
 * An interrupted apply run has to resume exactly. These tests cover the rule
 * that decides what a previous attempt had already achieved — pure, because the
 * decision is the part worth testing and it must work without a guild.
 */

const step = (
  over: Partial<TemplateRunStep> & { key: string; kind: TemplateRunStepKind }
): TemplateRunStep => ({
  id: `s-${over.key}`,
  runId: "run-1",
  action: "create",
  targetId: null,
  state: "done",
  error: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const present = {
  roles: new Set(["111", "222"]),
  channels: new Set(["333"]),
};
const nameForKey = (key: string) => key.replace(/^(role|channel):/, "");

const rebuild = (steps: TemplateRunStep[], withPresent = present) =>
  rebuildRunProgress({ steps, present: withPresent, nameForKey });

describe("rebuilding an interrupted run", () => {
  it("treats a run with no recorded steps as a fresh start", () => {
    const out = rebuild([]);
    expect(out.roleIds.size).toBe(0);
    expect(out.channelIds.size).toBe(0);
    expect(out.created).toEqual([]);
    expect(out.reused).toEqual([]);
    expect(out.finished.size).toBe(0);
  });

  it("maps a created role to the id the first attempt produced", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", targetId: "111" }),
    ]);
    expect(out.roleIds.get("role:mod")).toBe("111");
    expect(out.created).toEqual([
      { key: "role:mod", name: "mod", id: "111", kind: "role" },
    ]);
    expect(out.reused).toEqual([]);
  });

  it("maps a created channel to the id the first attempt produced", () => {
    const out = rebuild([
      step({ key: "channel:general", kind: "channel", targetId: "333" }),
    ]);
    expect(out.channelIds.get("channel:general")).toBe("333");
    expect(out.created[0]).toEqual({
      key: "channel:general",
      name: "general",
      id: "333",
      kind: "channel",
    });
  });

  it("keeps adopted resources in reused rather than claiming to have made them", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", action: "reuse", targetId: "111" }),
    ]);
    expect(out.reused).toHaveLength(1);
    expect(out.created).toEqual([]);
    expect(out.roleIds.get("role:mod")).toBe("111");
  });

  it("retries a step the previous attempt failed", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", state: "failed", error: "boom" }),
    ]);
    expect(out.roleIds.size).toBe(0);
    expect(out.created).toEqual([]);
    expect(out.reused).toEqual([]);
    expect(out.finished.has("role:mod")).toBe(false);
  });

  it("remakes a resource that was created but has since disappeared", () => {
    // The mapping would otherwise point channel overwrites and configuration
    // bindings at an id that no longer resolves.
    const out = rebuild([
      step({ key: "role:mod", kind: "role", targetId: "999" }),
    ]);
    expect(out.roleIds.size).toBe(0);
    expect(out.created).toEqual([]);
    expect(out.finished.has("role:mod")).toBe(false);
  });

  it("drops a done step that recorded no target id", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", targetId: null }),
    ]);
    expect(out.roleIds.size).toBe(0);
  });

  it("remembers steps that produce no resource, so they are not repeated", () => {
    const out = rebuild([
      step({
        key: overwriteStepKey("channel:general"),
        kind: "overwrites",
        targetId: "333",
      }),
      step({ key: CONFIG_STEP_KEY, kind: "config" }),
    ]);
    expect(out.finished.has("channel:general#overwrites")).toBe(true);
    expect(out.finished.has(CONFIG_STEP_KEY)).toBe(true);
    // Neither is a resource, so neither belongs in the created/reused report.
    expect(out.created).toEqual([]);
    expect(out.reused).toEqual([]);
    expect(out.channelIds.size).toBe(0);
  });

  it("keeps the two resource kinds in separate namespaces", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", targetId: "111" }),
      step({ key: "channel:general", kind: "channel", targetId: "333" }),
    ]);
    expect(out.roleIds.get("channel:general")).toBeUndefined();
    expect(out.channelIds.get("role:mod")).toBeUndefined();
    expect(out.roleIds.get("role:mod")).toBe("111");
    expect(out.channelIds.get("channel:general")).toBe("333");
  });

  it("reports the whole run, not just the attempt that finished it", () => {
    // Two roles created before the crash, one after it: all three belong in the
    // report, and the two made earlier must not be recounted as reused.
    const out = rebuild([
      step({ key: "role:a", kind: "role", targetId: "111" }),
      step({ key: "role:b", kind: "role", targetId: "222" }),
    ]);
    expect(out.created.map((r) => r.key)).toEqual(["role:a", "role:b"]);
    expect(out.reused).toEqual([]);
  });

  it("names steps from the template so the report is readable", () => {
    const out = rebuild([
      step({ key: "role:mod", kind: "role", targetId: "111" }),
    ]);
    expect(out.created[0]?.name).toBe("mod");
  });
});

describe("step keys", () => {
  it("names an overwrite step after its channel", () => {
    expect(overwriteStepKey("channel:general")).toBe(
      "channel:general#overwrites"
    );
  });

  it("gives configuration a key of its own", () => {
    expect(CONFIG_STEP_KEY).toBe("config");
  });
});
