"use client";
import type { TemplatePlan, TemplatePlanItem } from "@orbit/core/templates";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  CircleSlash,
  Copy as CopyIcon,
  Layers,
  Loader2,
  Plus,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "./page-header";
import { useWorkspace } from "./workspace";
import { IdentityImage } from "./identity/image";
import { Button } from "./ui/button";
import {
  Badge,
  Card,
  Field,
  Input,
  SectionHeader,
  Textarea,
} from "./ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

type StoredTemplate = {
  id: string;
  sourceGuildId: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  data: {
    version: number;
    kind: string;
    name: string;
    description: string;
    omitted: string[];
    structure?: {
      roles: { key: string; name: string; color?: string | null }[];
      channels: { key: string; name: string; type: string }[];
    };
    config?: Record<string, unknown>;
  };
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type TemplateRun = {
  id: string;
  state:
    "queued" | "running" | "completed" | "partial" | "failed" | "simulated";
  result: {
    created?: { key: string; name: string; id?: string }[];
    reused?: { key: string; name: string; id?: string }[];
    failed?: { key: string; name: string; error: string }[];
    configured?: string[];
    message?: string;
  } | null;
  error: string | null;
};

const STATE_COPY: Record<TemplateRun["state"], string> = {
  queued: "Queued — waiting for the bot",
  running: "Applying now",
  completed: "Applied",
  partial: "Finished with problems",
  failed: "Failed",
  simulated: "Demo preview — nothing was created",
};

/**
 * Server templates: an Orbit-managed blueprint of roles, channels and Orbit
 * settings, applied additively to a server you manage.
 *
 * Discord's own server templates copy a *channel layout* and are owned by
 * Discord; they do not exist for Orbit's module configuration, and Discord never
 * serializes Orbit settings. This page says that plainly instead of implying
 * that "template" means Discord's feature.
 */
export function TemplatesPage() {
  const { data, api } = useWorkspace();
  const [templates, setTemplates] = useState<StoredTemplate[] | null>(null);
  const [omissions, setOmissions] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [run, setRun] = useState<TemplateRun | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api<{
        templates: StoredTemplate[];
        omissions: string[];
      }>("/templates");
      setTemplates(response.templates);
      setOmissions(response.omissions);
      setLoadFailed(false);
      setError("");
      setSelected((current) =>
        current && response.templates.some((t) => t.id === current)
          ? current
          : (response.templates[0]?.id ?? "")
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Templates could not load.");
      setLoadFailed(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const template = templates?.find((t) => t.id === selected) ?? null;
  const sources = new Map(data.guilds.map((g) => [g.id, g]));

  /**
   * Preview the plan, including any explicit mappings.
   *
   * Mappings are part of the plan: changing one changes the fingerprint, so the
   * preview is recomputed rather than letting a stale fingerprint be confirmed.
   */
  async function preview(mappingOverride: Record<string, string> = mapping) {
    if (!template) return;
    setPlanning(true);
    setPlanError("");
    setPlan(null);
    try {
      const response = await api<{ plan: TemplatePlan }>(
        `/templates/${template.id}/preview`,
        "POST",
        {
          targetGuildId: data.guild.id,
          ...(Object.keys(mappingOverride).length
            ? { mapping: mappingOverride }
            : {}),
        }
      );
      setPlan(response.plan);
    } catch (e) {
      setPlanError(
        e instanceof Error ? e.message : "The preview could not be computed."
      );
    } finally {
      setPlanning(false);
    }
  }

  async function apply() {
    if (!template || !plan) return;
    setApplying(true);
    setApplyError("");
    setRun(null);
    try {
      const accepted = await api<{ runId: string }>(
        `/templates/${template.id}/apply`,
        "POST",
        {
          targetGuildId: data.guild.id,
          fingerprint: plan.fingerprint,
          ...(Object.keys(mapping).length ? { mapping } : {}),
        }
      );
      // The API already waits for the queued job, but the recorded run is the
      // source of truth for what was created, reused and failed.
      const recorded = await api<TemplateRun>(
        `/templates/runs/${accepted.runId}`
      );
      setRun(recorded);
    } catch (e) {
      setApplyError(
        e instanceof Error ? e.message : "The apply could not start."
      );
    } finally {
      setApplying(false);
    }
  }

  const targetOptions = (item: TemplatePlanItem) =>
    item.kind === "role"
      ? data.guild.roles
          .filter((role) => !role.managed)
          .map((role) => ({ value: role.id, label: role.name }))
      : data.guild.channels
          .filter(
            (channel) => channel.type === channelTypeFor(item.key, template)
          )
          .map((channel) => ({ value: channel.id, label: `#${channel.name}` }));

  return (
    <>
      <PageHeader
        title="A blueprint, not a copy."
        description="Capture this server’s roles, channels and Orbit configuration, then apply it additively to a server you manage."
        badge="Additive"
      >
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={12} aria-hidden />
          New template
        </Button>
      </PageHeader>
      <div className="mb-5 rounded-xl border bg-card/60 px-4 py-3.5 text-[11px] leading-relaxed text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">
            This is Orbit’s own template format.
          </span>{" "}
          Discord’s server templates copy a channel layout and are managed by
          Discord; they cannot carry Orbit modules, settings or bindings. Orbit
          stores the document itself, validates it on preview and again on
          apply, and never writes Discord ids into it — roles, channels and
          bindings are stored as portable keys and mapped when you apply.
        </p>
        <p className="mt-2">
          Applying creates what is missing and reuses what already matches by
          name. It never deletes anything, never overwrites an existing channel,
          and never grants Administrator. Members, messages, audit history,
          economy data, tokens, sessions and webhook URLs are not part of a
          template.
        </p>
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <SectionHeader icon={Boxes} title="Your templates" />
          {loadFailed ? (
            <div className="p-5 text-xs text-muted-foreground">
              {error}{" "}
              <button className="underline" onClick={() => void load()}>
                Try again
              </button>
            </div>
          ) : !templates ? (
            <div className="flex items-center gap-2 p-5 text-xs text-muted-foreground">
              <Loader2 size={13} className="animate-spin" aria-hidden /> Loading
              templates…
            </div>
          ) : templates.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-muted-foreground">
              No templates yet. Create one from this server to reuse its layout
              somewhere else.
            </div>
          ) : (
            <ul className="divide-y">
              {templates.map((item) => {
                const source = sources.get(item.sourceGuildId);
                const active = item.id === selected;
                return (
                  <li key={item.id}>
                    <button
                      className="flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/50 aria-[current=true]:bg-muted/60"
                      aria-current={active}
                      onClick={() => {
                        setSelected(item.id);
                        setPlan(null);
                        setPlanError("");
                        setRun(null);
                        setMapping({});
                        setApplyError("");
                      }}
                    >
                      {source && (
                        <IdentityImage
                          id={source.id}
                          name={source.name}
                          src={source.iconUrl}
                          kind="guild"
                          size={28}
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-xs font-medium">
                            {item.name}
                          </span>
                          <Badge tone="purple" className="text-[9px]">
                            {item.kind}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                          {item.description || "No description"} · from{" "}
                          {source?.name ?? "a server you manage"}
                        </span>
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          {item.data.structure?.roles.length ?? 0} roles ·{" "}
                          {item.data.structure?.channels.length ?? 0} channels ·{" "}
                          {item.data.config ? "Orbit config" : "structure only"}
                        </span>
                      </span>
                      <ArrowRight
                        size={13}
                        aria-hidden
                        className="mt-1 shrink-0 text-muted-foreground"
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <SectionHeader icon={Layers} title="Apply to this server" />
          <div className="space-y-4 p-5">
            {!template ? (
              <p className="text-xs text-muted-foreground">
                Choose a template to preview what it would do here.
              </p>
            ) : (
              <>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Preview{" "}
                  <span className="font-medium text-foreground">
                    {template.name}
                  </span>{" "}
                  against{" "}
                  <span className="font-medium text-foreground">
                    {data.guild.name}
                  </span>
                  . Nothing is created until you confirm.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={planning}
                  onClick={() => void preview()}
                >
                  {planning ? "Working out the plan…" : "Preview changes"}
                </Button>
                {planError && (
                  <p className="text-[11px] text-red-700 dark:text-red-400">
                    {planError}
                  </p>
                )}
                {plan && (
                  <PlanPreview
                    plan={plan}
                    mapping={mapping}
                    onMap={(key, id) => {
                      const next = { ...mapping, [key]: id };
                      setMapping(next);
                      void preview(next);
                    }}
                    onUnmap={(key) => {
                      const next = { ...mapping };
                      delete next[key];
                      setMapping(next);
                      void preview(next);
                    }}
                    optionsFor={targetOptions}
                  />
                )}
                {plan && (
                  <div className="border-t pt-4">
                    <Button
                      size="sm"
                      disabled={
                        applying ||
                        plan.blockers.length > 0 ||
                        plan.counts.create + plan.counts.reuse === 0
                      }
                      onClick={() => void apply()}
                    >
                      {applying ? "Applying…" : "Apply this plan"}
                    </Button>
                    <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                      This applies exactly the preview you just read. If the
                      server changes first, Orbit refuses and asks you to
                      preview again.
                    </p>
                  </div>
                )}
                {applyError && (
                  <p className="text-[11px] text-red-700 dark:text-red-400">
                    {applyError}
                  </p>
                )}
                {run && <RunResult run={run} />}
              </>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-5">
        <SectionHeader icon={ShieldAlert} title="Never in a template" />
        <ul className="grid gap-x-6 gap-y-1.5 p-5 text-[11px] text-muted-foreground sm:grid-cols-2">
          {(omissions.length
            ? omissions
            : [
                "Members and their identities",
                "Messages and audit history",
                "Economy balances and ledger entries",
                "Tokens, OAuth secrets and sessions",
                "Webhook URLs",
              ]
          ).map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CircleSlash
                size={12}
                aria-hidden
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              {item}
            </li>
          ))}
        </ul>
      </Card>

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async () => {
          setCreateOpen(false);
          await load();
        }}
      />
    </>
  );
}

/**
 * A channel item's target type comes from the template document itself, not from
 * its key: two channels in different categories may share a name.
 */
function channelTypeFor(key: string, template: StoredTemplate | null) {
  return template?.data.structure?.channels.find((c) => c.key === key)?.type;
}

function PlanPreview({
  plan,
  mapping,
  onMap,
  onUnmap,
  optionsFor,
}: {
  plan: TemplatePlan;
  mapping: Record<string, string>;
  onMap: (key: string, id: string) => void;
  onUnmap: (key: string) => void;
  optionsFor: (item: TemplatePlanItem) => { value: string; label: string }[];
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge tone="green">{plan.counts.create} to create</Badge>
        <Badge tone="purple">{plan.counts.reuse} to reuse</Badge>
        <Badge>{plan.counts.skip} skipped</Badge>
      </div>
      {plan.blockers.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50/60 p-3 text-[11px] leading-relaxed text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          <p className="mb-1 flex items-center gap-1.5 font-medium">
            <TriangleAlert size={12} aria-hidden /> This plan cannot be applied
          </p>
          <ul className="list-disc space-y-0.5 pl-4">
            {plan.blockers.map((blocker) => (
              <li key={blocker.code}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.warnings.length > 0 && (
        <ul className="space-y-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300">
          {plan.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-1.5">
              <TriangleAlert
                size={12}
                aria-hidden
                className="mt-0.5 shrink-0"
              />
              {warning}
            </li>
          ))}
        </ul>
      )}
      <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
        {plan.items.map((item) => {
          const mapped = mapping[item.key];
          const options = item.action === "skip" ? optionsFor(item) : [];
          return (
            <li key={item.key} className="rounded-lg border px-2.5 py-2">
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    item.action === "create"
                      ? "green"
                      : item.action === "reuse"
                        ? "purple"
                        : "neutral"
                  }
                  className="text-[9px] uppercase"
                >
                  {item.action}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium">
                  {item.kind === "channel" ? "#" : ""}
                  {item.name}
                </span>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                {item.reason}
              </p>
              {item.action === "skip" && options.length > 0 && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">
                    Reuse instead
                  </span>
                  {/* A native select styled by the design system: this is a
                      mapping choice, not a filtered search, so it stays a
                      select rather than pretending to be a combobox. */}
                  <select
                    aria-label={`Map ${item.name} to an existing ${item.kind}`}
                    className="h-6 max-w-[180px] rounded-md border bg-background px-1.5 text-[10px]"
                    value={mapped ?? ""}
                    onChange={(e) =>
                      e.target.value
                        ? onMap(item.key, e.target.value)
                        : onUnmap(item.key)
                    }
                  >
                    <option value="">Nothing</option>
                    {options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {mapped && (
                    <button
                      className="text-[10px] underline"
                      onClick={() => onUnmap(item.key)}
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {plan.config && (
        <div className="rounded-lg border bg-muted/30 p-3 text-[10px] leading-relaxed">
          <p className="mb-1 text-[11px] font-medium">Orbit configuration</p>
          {plan.config.changes.length === 0 &&
          plan.config.bindings.length === 0 ? (
            <p className="text-muted-foreground">
              Nothing to change — the configuration already matches.
            </p>
          ) : (
            <ul className="space-y-0.5 text-muted-foreground">
              {plan.config.changes.map((change) => (
                <li key={change.field}>
                  {change.field} →{" "}
                  <span className="text-foreground">{change.value}</span>
                </li>
              ))}
              {plan.config.bindings.map((binding) => (
                <li key={binding.field}>
                  {binding.field} →{" "}
                  <span className="text-foreground">{binding.target}</span> (
                  {binding.resolution})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">
        Plan fingerprint <span className="font-mono">{plan.fingerprint}</span>
      </p>
    </div>
  );
}

function RunResult({ run }: { run: TemplateRun }) {
  const failed = run.result?.failed ?? [];
  return (
    <div className="rounded-lg border p-3 text-[11px]">
      <p className="flex items-center gap-1.5 font-medium">
        {run.state === "completed" ? (
          <CheckCircle2 size={13} className="text-emerald-600" aria-hidden />
        ) : run.state === "partial" ? (
          <TriangleAlert size={13} className="text-amber-600" aria-hidden />
        ) : run.state === "simulated" ? (
          <CopyIcon size={13} className="text-muted-foreground" aria-hidden />
        ) : (
          <TriangleAlert size={13} className="text-red-600" aria-hidden />
        )}
        {STATE_COPY[run.state]}
      </p>
      <p className="mt-1 text-muted-foreground" aria-live="polite">
        {run.result?.message ??
          `${run.result?.created?.length ?? 0} created · ${run.result?.reused?.length ?? 0} reused · ${failed.length} failed`}
      </p>
      {failed.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[10px] text-red-700 dark:text-red-400">
          {failed.map((item) => (
            <li key={item.key}>
              {item.name}: {item.error}
            </li>
          ))}
        </ul>
      )}
      {run.error && (
        <p className="mt-1.5 text-[10px] text-red-700 dark:text-red-400">
          {run.error}
        </p>
      )}
    </div>
  );
}

function CreateTemplateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const { api } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [include, setInclude] = useState({ structure: true, config: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await api<{
        id?: string;
        demo?: boolean;
        note?: string;
      }>("/templates", "POST", {
        name: name.trim(),
        description: description.trim(),
        include,
      });
      if (!response?.id) {
        setNotice(
          "The bot is capturing this server’s structure. The template appears here when it finishes."
        );
        return;
      }
      setName("");
      setDescription("");
      await onCreated();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The template could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Capture a template</DialogTitle>
          <DialogDescription>
            Roles, channels and Orbit settings from this server, stored as a
            portable document.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <Field label="Template name" required>
            <Input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Starter community"
            />
          </Field>
          <Field label="Description">
            <Textarea
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this layout is for"
            />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[11px] font-medium">Include</legend>
            {(
              [
                ["structure", "Roles, categories, channels and overwrites"],
                ["config", "Orbit modules, settings and bindings"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-start gap-2 text-[11px]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={include[key]}
                  onChange={(e) =>
                    setInclude((current) => ({
                      ...current,
                      [key]: e.target.checked,
                    }))
                  }
                />
                {label}
              </label>
            ))}
            {!include.structure && !include.config && (
              <p className="text-[10px] text-red-700 dark:text-red-400">
                Choose structure, Orbit configuration, or both.
              </p>
            )}
          </fieldset>
          {error && (
            <p className="text-[11px] text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          {notice && (
            <p className="text-[11px] text-muted-foreground">{notice}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={
                busy || !name.trim() || (!include.structure && !include.config)
              }
            >
              {busy ? "Capturing…" : "Capture template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
