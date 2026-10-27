import { and, desc, eq, inArray } from "drizzle-orm";
import { isDemo } from "@orbit/core/environment";
import {
  parseTemplateDocument,
  type ServerTemplateDocument,
} from "@orbit/core/templates";
import type {
  TemplateRunStep,
  TemplateRunStepAction,
  TemplateRunStepKind,
  TemplateRunStepState,
} from "@orbit/core/template-run-steps";
import { database } from "./client";
import { demoRead, demoTransaction } from "./demo";
import * as s from "./schema";

/** Demo mode keeps templates in the same JSON store as everything else. */
export type DemoTemplate = {
  id: string;
  sourceGuildId: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  data: ServerTemplateDocument;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};
export type DemoTemplateRun = {
  id: string;
  guildId: string;
  templateId: string;
  actorId: string;
  state: TemplateRun["state"];
  plan: Record<string, any>;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredTemplate = {
  id: string;
  sourceGuildId: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  data: ServerTemplateDocument;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TemplateRun = {
  id: string;
  guildId: string;
  templateId: string;
  actorId: string;
  state:
    "queued" | "running" | "completed" | "partial" | "failed" | "simulated";
  plan: Record<string, any>;
  result: Record<string, any> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const toStored = (row: any): StoredTemplate => ({
  ...row,
  data: parseTemplateDocument(row.data),
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
});

export async function saveTemplate(input: {
  sourceGuildId: string;
  name: string;
  description: string;
  createdBy: string;
  document: ServerTemplateDocument;
}): Promise<StoredTemplate> {
  const data = parseTemplateDocument(input.document);
  if (isDemo()) {
    const created: DemoTemplate = {
      id: crypto.randomUUID(),
      sourceGuildId: input.sourceGuildId,
      name: input.name,
      description: input.description,
      kind: data.kind,
      version: data.version,
      data,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await demoTransaction((store) => {
      store.templates ??= [];
      store.templates.push(created);
      return null;
    });
    return created;
  }
  const [row] = await database()
    .db.insert(s.serverTemplates)
    .values({
      sourceGuildId: input.sourceGuildId,
      name: input.name,
      description: input.description,
      kind: data.kind,
      version: data.version,
      data: data as unknown as Record<string, any>,
      createdBy: input.createdBy,
    })
    .returning();
  return toStored(row);
}

/**
 * Replace a stored template's document.
 *
 * The whole document is replaced rather than patched field by field: a template
 * is one validated unit, and a partial patch could leave a structure that
 * references a role it no longer contains. The caller validates before calling.
 */
export async function updateTemplate(input: {
  id: string;
  name: string;
  description: string;
  document: ServerTemplateDocument;
}): Promise<StoredTemplate | null> {
  const data = parseTemplateDocument(input.document);
  const fields = {
    name: input.name,
    description: input.description,
    kind: data.kind,
    version: data.version,
    data: data as unknown as Record<string, any>,
    updatedAt: new Date(),
  };
  if (isDemo()) {
    const updated = await demoTransaction((store) => {
      const existing = (store.templates ?? []).find((t) => t.id === input.id);
      if (!existing) return null;
      Object.assign(existing, {
        ...fields,
        updatedAt: new Date().toISOString(),
      });
      return existing;
    });
    return updated;
  }
  const [row] = await database()
    .db.update(s.serverTemplates)
    .set(fields)
    .where(eq(s.serverTemplates.id, input.id))
    .returning();
  return row ? toStored(row) : null;
}

/**
 * Templates visible to one workspace.
 *
 * Scoped by the guild the template was captured *from* and by nothing else: a
 * user who can manage guild A cannot list guild B's templates, and knowing an id
 * is not authorization — `getTemplate` takes the allowed source guilds.
 */
export async function listTemplates(
  sourceGuildIds: string[]
): Promise<StoredTemplate[]> {
  if (!sourceGuildIds.length) return [];
  if (isDemo()) {
    const d = await demoRead();
    return (d.templates ?? [])
      .filter((t) => sourceGuildIds.includes(t.sourceGuildId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const rows = await database()
    .db.select()
    .from(s.serverTemplates)
    .orderBy(desc(s.serverTemplates.createdAt));
  return rows
    .filter((row) => sourceGuildIds.includes(row.sourceGuildId))
    .map(toStored);
}

export async function getTemplate(
  id: string,
  sourceGuildIds: string[]
): Promise<StoredTemplate | null> {
  if (!sourceGuildIds.length) return null;
  if (isDemo()) {
    const d = await demoRead();
    const found = (d.templates ?? []).find((t) => t.id === id);
    return found && sourceGuildIds.includes(found.sourceGuildId) ? found : null;
  }
  const [row] = await database()
    .db.select()
    .from(s.serverTemplates)
    .where(eq(s.serverTemplates.id, id));
  if (!row || !sourceGuildIds.includes(row.sourceGuildId)) return null;
  return toStored(row);
}

/**
 * Delete a template, but only from the guild that captured it.
 *
 * The scope is enforced here as well as in the route: a delete that silently
 * matched nothing would look like a success to a caller that guessed wrong.
 */
export async function deleteTemplate(id: string, sourceGuildId: string) {
  if (isDemo()) {
    const found = (await demoRead()).templates?.find((t) => t.id === id);
    if (!found || found.sourceGuildId !== sourceGuildId)
      throw new Error("That template does not belong to this server.");
    await demoTransaction((store) => {
      store.templates = (store.templates ?? []).filter((t) => t.id !== id);
      return null;
    });
    return;
  }
  const deleted = await database()
    .db.delete(s.serverTemplates)
    .where(
      and(
        eq(s.serverTemplates.id, id),
        eq(s.serverTemplates.sourceGuildId, sourceGuildId)
      )
    )
    .returning({ id: s.serverTemplates.id });
  if (!deleted.length)
    throw new Error("That template does not belong to this server.");
}

export async function createTemplateRun(input: {
  guildId: string;
  templateId: string;
  actorId: string;
  plan: Record<string, any>;
}): Promise<TemplateRun> {
  if (isDemo()) {
    const run: DemoTemplateRun = {
      id: crypto.randomUUID(),
      ...input,
      state: "queued",
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await demoTransaction((store) => {
      store.templateRuns ??= [];
      store.templateRuns.push(run);
      return null;
    });
    return run;
  }
  const [row] = await database()
    .db.insert(s.templateRuns)
    .values({ ...input, state: "queued" })
    .returning();
  return {
    ...row,
    plan: row.plan as Record<string, any>,
    result: (row.result as Record<string, any> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as TemplateRun;
}

export async function updateTemplateRun(
  id: string,
  patch: {
    state?: TemplateRun["state"];
    result?: Record<string, any> | null;
    error?: string | null;
  }
) {
  if (isDemo()) {
    await demoTransaction((store) => {
      const run = (store.templateRuns ?? []).find((r) => r.id === id);
      if (!run) return null;
      if (patch.state) run.state = patch.state;
      if (patch.result !== undefined) run.result = patch.result;
      if (patch.error !== undefined) run.error = patch.error;
      run.updatedAt = new Date().toISOString();
      return null;
    });
    return;
  }
  await database()
    .db.update(s.templateRuns)
    .set({
      ...(patch.state ? { state: patch.state } : {}),
      ...(patch.result !== undefined ? { result: patch.result } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      updatedAt: new Date(),
    })
    .where(eq(s.templateRuns.id, id));
}

/**
 * The newest apply run this guild still has in flight, or `null`.
 *
 * A reload, a reconnect or a second tab must not lose sight of work the
 * backend is already doing: the run is owned by the worker, not by the browser
 * that asked for it, so it is rediscovered from the database rather than from
 * anything the page kept in memory.
 */
export async function getActiveTemplateRun(
  guildId: string
): Promise<TemplateRun | null> {
  const ACTIVE = ["queued", "running"];
  const rows = isDemo()
    ? ((await demoRead()).templateRuns ?? [])
        .filter((r) => r.guildId === guildId && ACTIVE.includes(r.state))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : await database()
        .db.select()
        .from(s.templateRuns)
        .where(
          and(
            eq(s.templateRuns.guildId, guildId),
            inArray(s.templateRuns.state, ACTIVE)
          )
        )
        .orderBy(desc(s.templateRuns.createdAt))
        .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    plan: row.plan as Record<string, any>,
    result: (row.result as Record<string, any> | null) ?? null,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt),
  } as TemplateRun;
}

export async function getTemplateRun(id: string): Promise<TemplateRun | null> {
  if (isDemo()) {
    const d = await demoRead();
    return (d.templateRuns ?? []).find((r) => r.id === id) ?? null;
  }
  const [row] = await database()
    .db.select()
    .from(s.templateRuns)
    .where(eq(s.templateRuns.id, id));
  if (!row) return null;
  return {
    ...row,
    plan: row.plan as Record<string, any>,
    result: (row.result as Record<string, any> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  } as TemplateRun;
}

/**
 * The step types live in `@orbit/core` because the rule for rebuilding a run
 * from them is pure and tested there; the database only stores and returns
 * them. Re-exported so callers keep importing from one place.
 */
export type {
  TemplateRunStep,
  TemplateRunStepAction,
  TemplateRunStepKind,
  TemplateRunStepState,
} from "@orbit/core/template-run-steps";

/** Demo mode keeps run steps in the same JSON store as everything else. */
export type DemoTemplateRunStep = TemplateRunStep;

const toRunStep = (row: any): TemplateRunStep => ({
  ...row,
  createdAt:
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : String(row.createdAt),
  updatedAt:
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : String(row.updatedAt),
});

/**
 * Record what one step of an apply run did.
 *
 * Upsert on (runId, key). A resumed run re-records the steps it redoes, and
 * re-recording has to update the existing row rather than leave a second row
 * claiming the same template key resolved to two different Discord ids.
 *
 * Called after each individual Discord call, not at the end of the run: the
 * point of the table is that it survives a crash between two steps.
 */
export async function recordTemplateRunStep(input: {
  runId: string;
  key: string;
  kind: TemplateRunStepKind;
  action: TemplateRunStepAction;
  targetId?: string | null;
  state: TemplateRunStepState;
  error?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  if (isDemo()) {
    await demoTransaction((store) => {
      store.templateRunSteps ??= [];
      const existing = store.templateRunSteps.find(
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
        updatedAt: now,
      };
      if (existing) Object.assign(existing, next);
      else
        store.templateRunSteps.push({
          id: crypto.randomUUID(),
          createdAt: now,
          ...next,
        });
      return null;
    });
    return;
  }
  await database()
    .db.insert(s.templateRunSteps)
    .values({
      runId: input.runId,
      key: input.key,
      kind: input.kind,
      action: input.action,
      targetId: input.targetId ?? null,
      state: input.state,
      error: input.error ?? null,
    })
    .onConflictDoUpdate({
      target: [s.templateRunSteps.runId, s.templateRunSteps.key],
      set: {
        kind: input.kind,
        action: input.action,
        targetId: input.targetId ?? null,
        state: input.state,
        error: input.error ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Every step recorded for a run, oldest first.
 *
 * A resumed run reads this to rebuild the template-key → Discord-id mapping
 * instead of rediscovering resources by name.
 */
export async function listTemplateRunSteps(
  runId: string
): Promise<TemplateRunStep[]> {
  if (isDemo()) {
    const d = await demoRead();
    return (d.templateRunSteps ?? [])
      .filter((step) => step.runId === runId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const rows = await database()
    .db.select()
    .from(s.templateRunSteps)
    .where(eq(s.templateRunSteps.runId, runId))
    .orderBy(s.templateRunSteps.createdAt);
  return rows.map(toRunStep);
}
