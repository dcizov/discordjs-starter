import { and, desc, eq } from "drizzle-orm";
import { isDemo } from "@orbit/core/environment";
import {
  parseTemplateDocument,
  type ServerTemplateDocument,
} from "@orbit/core/templates";
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
