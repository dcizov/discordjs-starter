/**
 * Resuming an interrupted template apply.
 *
 * An apply run creates Discord resources one round trip at a time, and the
 * process can die between any two of them. `template_run_steps` records what
 * each step did; this module owns the rule for turning those records back into
 * a usable mapping, so that a retry reuses exactly the resources the first
 * attempt created instead of trying to recognise them by name.
 *
 * Everything here is pure — no Discord, no database — because the interesting
 * part is the decision, not the I/O.
 */

/** What kind of Discord resource a step produced. */
export type TemplateRunStepKind = "role" | "channel" | "overwrites" | "config";
/** Whether the step made something new or adopted something already there. */
export type TemplateRunStepAction = "create" | "reuse";
export type TemplateRunStepState = "pending" | "done" | "failed";

export type TemplateRunStep = {
  id: string;
  runId: string;
  key: string;
  kind: TemplateRunStepKind;
  action: TemplateRunStepAction;
  targetId: string | null;
  state: TemplateRunStepState;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Template key of the step that applies a channel's permission overwrites. */
export function overwriteStepKey(channelKey: string): string {
  return `${channelKey}#overwrites`;
}

/**
 * Template key of the step that writes the template's configuration.
 *
 * Configuration produces no Discord resource, so this step exists purely so a
 * resume can tell whether it already landed.
 */
export const CONFIG_STEP_KEY = "config";

export type RebuiltResource = {
  key: string;
  name: string;
  id: string;
  kind: "role" | "channel";
};

export type RebuiltProgress = {
  /** Template role key → Discord role id. */
  roleIds: Map<string, string>;
  /** Template channel key → Discord channel id. */
  channelIds: Map<string, string>;
  /** Resources an earlier attempt created, so the report covers the whole run. */
  created: RebuiltResource[];
  /** Resources an earlier attempt adopted because they already existed. */
  reused: RebuiltResource[];
  /** Keys already finished, including those that produced no id of their own. */
  finished: Set<string>;
};

export type RebuildInput = {
  /** Every step recorded for this run, in any order. */
  steps: readonly TemplateRunStep[];
  /**
   * Discord ids that still exist in the target server, so a mapping pointing at
   * something since deleted is dropped and made again rather than trusted.
   */
  present: { roles: ReadonlySet<string>; channels: ReadonlySet<string> };
  /** Human-readable name for a template key, used only for the report. */
  nameForKey: (key: string) => string;
};

/**
 * Rebuild what a previous attempt of this run had already achieved.
 *
 * Only `done` steps count: a `failed` step is exactly the thing a retry is
 * meant to have another go at. A `done` step whose target has since vanished is
 * treated as not done, because holding on to it would point channel overwrites
 * and configuration bindings at an id that no longer resolves.
 */
export function rebuildRunProgress({
  steps,
  present,
  nameForKey,
}: RebuildInput): RebuiltProgress {
  const roleIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const created: RebuiltResource[] = [];
  const reused: RebuiltResource[] = [];
  const finished = new Set<string>();

  for (const step of steps) {
    if (step.state !== "done") continue;
    const resource = resourceKind(step.kind);
    // Overwrites and configuration leave no mapping behind; they are recorded
    // only so a resume knows not to repeat them.
    if (!resource) {
      finished.add(step.key);
      continue;
    }
    const alive = step.targetId
      ? (resource === "role" ? present.roles : present.channels).has(
          step.targetId
        )
      : false;
    if (!step.targetId || !alive) continue;
    (resource === "role" ? roleIds : channelIds).set(step.key, step.targetId);
    (step.action === "create" ? created : reused).push({
      key: step.key,
      name: nameForKey(step.key),
      id: step.targetId,
      kind: resource,
    });
    finished.add(step.key);
  }

  return { roleIds, channelIds, created, reused, finished };
}

function resourceKind(kind: TemplateRunStepKind): "role" | "channel" | null {
  if (kind === "role") return "role";
  if (kind === "channel") return "channel";
  return null;
}
