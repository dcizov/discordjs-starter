"use client";
import type { TemplatePlan, TemplatePlanItem } from "@orbit/core/templates";
import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Download,
  Pencil,
  CircleSlash,
  Copy as CopyIcon,
  Layers,
  Loader2,
  Plus,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh, isInFlight, isTerminal } from "@/lib/use-live-refresh";
import { TemplateBuilderDialog } from "./template-builder";
import type { StoredTemplate } from "./template-builder";
import { PageHeader } from "./page-header";
import { useWorkspace } from "./workspace";
import { IdentityImage } from "./identity/image";
import { Button } from "./ui/button";
import {
  Badge,
  Card,
  Field,
  FormSelect,
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

type TemplateRun = {
  id: string;
  /** Present on the server's run rows; used to re-select the template after a
   * reload rediscovers a run that is still in flight. */
  templateId?: string;
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
  // null = build a new template; a StoredTemplate = edit that one.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [builderTemplate, setBuilderTemplate] = useState<StoredTemplate | null>(
    null
  );
  const [selected, setSelected] = useState<string>("");
  /**
   * The server the template would be applied to.
   *
   * Defaults to the workspace the page is open on, but a template is portable —
   * it addresses its own roles and channels by key, not by Discord id — so any
   * other server the user manages and has Orbit installed in is a valid target.
   * The server decides which ones those are, not the browser.
   */
  const [targetGuildId, setTargetGuildId] = useState(data.guild.id);
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [planError, setPlanError] = useState("");
  const [planning, setPlanning] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  // The run is identified by id, not held only in `run`, so the poller and the
  // reload-recovery path can both attach to the same piece of backend work.
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<TemplateRun | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState("");
  const [duplicating, setDuplicating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  /** The capture job, when one is on the bot rather than already stored. */
  const [captureJobId, setCaptureJobId] = useState<string | null>(null);

  /** True while the backend is doing template work this page cares about. */
  const busy =
    !!captureJobId || capturing || isInFlight(run?.state) || applying;

  /**
   * The template list is the surface every other operation lands on: a capture
   * adds a row, a delete removes one, an apply changes nothing but its run.
   *
   * It polls fast while work is in flight and slowly otherwise, so a second
   * tab or a worker finishing a job shows up without a manual reload. The
   * selected template is preserved across refreshes, and a refresh never
   * touches anything the visitor is editing.
   */
  const list = useLiveRefresh<{
    templates: StoredTemplate[];
    omissions: string[];
  }>({
    fetcher: (signal) =>
      api("/templates", "GET", undefined, undefined, { signal }),
    active: busy,
    // An idle surface still notices another tab's change, but does not hammer.
    idleMs: 30_000,
    onUpdate: (response) => {
      setTemplates(response.templates);
      setOmissions(response.omissions);
      setSelected((current) =>
        current && response.templates.some((t) => t.id === current)
          ? current
          : (response.templates[0]?.id ?? "")
      );
    },
  });

  useEffect(() => {
    if (list.data) return;
    if (list.error) {
      setError(list.error.message);
      setLoadFailed(true);
      return;
    }
    setError("");
    setLoadFailed(false);
  }, [list.data, list.error]);

  const load = useCallback(() => list.refresh(), [list]);

  /**
   * Follow a capture that the bot is still working on.
   *
   * Capture is the one template operation with no run row to poll — it is a
   * plain bot action — so the job's own status is watched until it settles,
   * then the list is refreshed to pick up the new template. `idleMs: 0` keeps
   * it from polling once the job has finished.
   */
  useLiveRefresh<{ state: string; error?: string | null }>({
    fetcher: (signal) =>
      api(`/actions/${captureJobId}`, "GET", undefined, undefined, { signal }),
    active: !!captureJobId,
    idleMs: 0,
    immediate: !!captureJobId,
    onUpdate: (job) => {
      if (job.state === "completed") {
        setCaptureJobId(null);
        setCapturing(false);
        list.refresh();
      } else if (job.state === "failed") {
        setCaptureJobId(null);
        setCapturing(false);
        setCaptureError(
          job.error || "The bot could not finish capturing this server."
        );
      } else if (["unknown", "removed", "cancelled"].includes(job.state)) {
        setCaptureJobId(null);
        setCapturing(false);
        setCaptureError(
          "This capture is no longer available. It may have finished; refresh to check."
        );
      }
    },
  });

  /**
   * Rediscover an apply that is still running after a reload, a reconnect or a
   * second tab. The run belongs to the worker, not to the browser that asked
   * for it, so the server — not local state — is asked what is in flight.
   */
  useEffect(() => {
    let cancelled = false;
    api<{ run: TemplateRun | null }>("/templates/active")
      .then(({ run: active }) => {
        if (!cancelled && active && !runId) {
          setRunId(active.id);
          setRun(active);
          if (active.templateId) setSelected(active.templateId);
        }
      })
      .catch(() => {
        // Recovery is best-effort: a failure here must not break the page.
      });
    return () => {
      cancelled = true;
    };
    // Mount-only by design: later status comes from the run poller below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Follow the apply run while the worker owns it.
   *
   * `idleMs: 0` is deliberate: once a run reaches a terminal state there is
   * nothing left to poll, and a finished run must not keep generating requests.
   */
  const runFeed = useLiveRefresh<TemplateRun>({
    fetcher: (signal) =>
      api(`/templates/runs/${runId}`, "GET", undefined, undefined, { signal }),
    active: !!runId && isInFlight(run?.state),
    idleMs: 0,
    immediate: !!runId,
    onUpdate: (next) => {
      setRun(next);
      setApplying(isInFlight(next.state));
      // A finished apply changes what the plan should say, so refresh the list
      // and re-derive the preview rather than leaving it describing the
      // server as it was before the run.
      if (isTerminal(next.state)) list.refresh();
    },
  });

  const template = templates?.find((t) => t.id === selected) ?? null;
  const sources = new Map(data.guilds.map((g) => [g.id, g]));

  /**
   * A plan describes one target. Pointing the same template at another server
   * invalidates the fingerprint, the explicit mappings (which name resources in
   * the old target) and any run being followed, so all three are dropped rather
   * than quietly reused.
   */
  function changeTarget(next: string) {
    if (next === targetGuildId) return;
    setTargetGuildId(next);
    setPlan(null);
    setPlanError("");
    setMapping({});
    setRun(null);
    setRunId(null);
    setApplyError("");
  }

  /**
   * Every server the user manages that Orbit is actually in. A target the bot
   * was never invited to cannot be applied to, so it is not offered; the server
   * refuses it regardless.
   */
  const targets = data.guilds.filter((g) => g.installed);
  const targetName =
    targets.find((g) => g.id === targetGuildId)?.name ?? data.guild.name;

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
          targetGuildId,
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

  /**
   * Queue the apply and follow the run, rather than blocking on the job.
   *
   * `waitForBotAction` gives up after 30 seconds and reports "may still be
   * processing". A template apply routinely takes longer than that, and the
   * worker keeps going either way — so the page hands the job off, records the
   * run id and lets the run poller report queued → running → completed.
   * Closing the tab does not cancel anything.
   */
  async function apply() {
    if (!template || !plan) return;
    setApplying(true);
    setApplyError("");
    setRun(null);
    setRunId(null);
    try {
      const accepted = await api<{ runId: string; jobId?: string }>(
        `/templates/${template.id}/apply`,
        "POST",
        {
          targetGuildId,
          fingerprint: plan.fingerprint,
          ...(Object.keys(mapping).length ? { mapping } : {}),
        },
        undefined,
        { awaitJob: false }
      );
      setRunId(accepted.runId);
    } catch (e) {
      setApplyError(
        e instanceof Error ? e.message : "The apply could not start."
      );
      setApplying(false);
    }
  }

  /**
   * Copy a template under a new name.
   *
   * Keys are copied verbatim: they are the template's own addressing scheme,
   * not Discord ids, so the copy stays portable.
   */
  async function duplicate(item: StoredTemplate) {
    setDuplicating(true);
    setError("");
    try {
      const copy = await api<StoredTemplate>(
        `/templates/${item.id}/duplicate`,
        "POST",
        { name: `${item.name} (copy)` },
        undefined,
        { awaitJob: false }
      );
      await load();
      if (copy?.id) setSelected(copy.id);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The template could not be duplicated."
      );
    } finally {
      setDuplicating(false);
    }
  }

  /**
   * One sentence describing what the backend is doing right now, for the live
   * region and for the visible progress line. Progress is only claimed when a
   * run actually reports step counts; otherwise it says what it knows.
   */
  const statusMessage = (() => {
    if (captureJobId)
      return "The bot is capturing this server’s structure. You can close this page; the capture continues on the server.";
    if (!run) return "";
    if (run.state === "queued")
      return "Apply queued. It will start on its own and keep running if you close this page.";
    if (run.state === "running") {
      const total =
        (run.result?.created?.length ?? 0) +
        (run.result?.reused?.length ?? 0) +
        (run.result?.failed?.length ?? 0);
      return total
        ? `Applying now. ${total} step${total === 1 ? "" : "s"} done so far.`
        : "Applying now. Progress updates as each step finishes.";
    }
    const failed = run.result?.failed?.length ?? 0;
    if (run.state === "completed")
      return `Apply finished. ${run.result?.created?.length ?? 0} created, ${run.result?.reused?.length ?? 0} reused.`;
    if (run.state === "partial")
      return `Apply finished with problems. ${failed} step${failed === 1 ? "" : "s"} failed.`;
    if (run.state === "failed")
      return `Apply failed. ${run.error ?? ""}`.trim();
    return STATE_COPY[run.state];
  })();

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
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreateOpen(true)}
          >
            <Download size={12} aria-hidden />
            Capture this server
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setBuilderTemplate(null);
              setBuilderOpen(true);
            }}
          >
            <Plus size={12} aria-hidden />
            New template
          </Button>
        </div>
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

      {/* Visible counterpart to the live region above: a spinner alone tells a
          sighted visitor "something is happening" but not what, and tells a
          screen reader nothing at all. */}
      {(captureJobId || isInFlight(run?.state)) && (
        <div
          role="status"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[11px] leading-relaxed text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200"
        >
          <Loader2
            size={13}
            className="mt-0.5 shrink-0 animate-spin"
            aria-hidden
          />
          <span>{statusMessage}</span>
        </div>
      )}

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
          <SectionHeader
            icon={Layers}
            title={
              targetGuildId === data.guild.id
                ? "Apply to this server"
                : `Apply to ${targetName}`
            }
          />
          <div className="space-y-4 p-5">
            {!template ? (
              <p className="text-xs text-muted-foreground">
                Choose a template to preview what it would do here.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <label
                    htmlFor="template-target"
                    className="text-[11px] font-medium text-foreground"
                  >
                    Apply to
                  </label>
                  <FormSelect
                    id="template-target"
                    className="h-8 w-auto min-w-44 text-[11px]"
                    aria-label="Server to apply this template to"
                    value={targetGuildId}
                    onValueChange={changeTarget}
                    options={targets.map((g) => ({
                      value: g.id,
                      label:
                        g.id === data.guild.id
                          ? `${g.name} (this server)`
                          : g.name,
                    }))}
                  />
                  {targetGuildId !== data.guild.id && (
                    <span className="text-[11px] text-muted-foreground">
                      This template is applied additively; nothing is read from
                      or written to{" "}
                      <span className="font-medium text-foreground">
                        {data.guild.name}
                      </span>
                      .
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBuilderTemplate(template);
                      setBuilderOpen(true);
                    }}
                  >
                    <Pencil size={12} aria-hidden />
                    Edit template
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={duplicating}
                    onClick={() => void duplicate(template)}
                  >
                    <CopyIcon size={12} aria-hidden />
                    {duplicating ? "Duplicating…" : "Duplicate"}
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Preview{" "}
                  <span className="font-medium text-foreground">
                    {template.name}
                  </span>{" "}
                  against{" "}
                  <span className="font-medium text-foreground">
                    {targetName}
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
                {/*
                  Status is announced, not only animated. A spinner conveys
                  "something is happening" to a sighted visitor and nothing at
                  all to a screen reader, so the same state is published as
                  text in a polite live region.
                */}
                <p aria-live="polite" className="sr-only">
                  {statusMessage}
                </p>
                {captureError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-[11px] text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                    {captureError}
                    <button
                      className="ml-2 underline"
                      onClick={() => {
                        setCaptureError("");
                        void load();
                      }}
                    >
                      Dismiss and refresh
                    </button>
                  </div>
                )}
                {runFeed.error && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    Orbit could not re-read this apply run
                    {isInFlight(run?.state)
                      ? " — it is still running and will update automatically."
                      : "."}
                    <button className="ml-2 underline" onClick={runFeed.retry}>
                      Try again
                    </button>
                  </div>
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

      <TemplateBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        template={builderTemplate}
        onSaved={() => void load()}
      />
      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async ({ jobId }) => {
          setCreateOpen(false);
          setCaptureJobId(jobId);
          // A capture runs in the worker and may still be going: refresh now to
          // show what exists, and let the list keep polling until it lands.
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
  onCreated: (info: { jobId: string | null }) => Promise<void>;
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
      // Only the bot can read permission overwrites, so a capture is a job.
      // It is not awaited here: the worker owns it from this point and the page
      // follows its own progress, so a capture that takes longer than the
      // action bridge's 30s patience is not reported as a failure while it is
      // in fact still running.
      const response = await api<{
        id?: string;
        demo?: boolean;
        note?: string;
        jobId?: string;
      }>(
        "/templates",
        "POST",
        {
          name: name.trim(),
          description: description.trim(),
          include,
        },
        undefined,
        { awaitJob: false }
      );
      if (!response?.id) {
        setNotice(
          "The bot is capturing this server’s structure. The template appears here when it finishes — you can close this dialog and even this tab; the capture is running on the server."
        );
        await onCreated({ jobId: response?.jobId ?? null });
        return;
      }
      setName("");
      setDescription("");
      await onCreated({ jobId: null });
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
