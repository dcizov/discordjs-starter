"use client";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, CalendarClock, Vote } from "lucide-react";
import {
  newerCommunityPage,
  communityModule,
  communityStates,
  type CommunityKind,
  type CommunityPage as PostPage,
  type CommunityPost,
} from "@orbit/core/community";
import { useWorkspace } from "../../workspace";
import { PageHeader } from "../../page-header";
import { ModuleSetupBanner } from "../../module-setup";
import { Button } from "../../ui/button";
import { Card, Field, Select, EmptyState } from "../../ui/primitives";

import { PostEditor } from "./draft-editor";
import { PostRecord } from "./post-record";
import { PostReview, type PostAction, type PostIntent } from "./post-review";
export function CommunityPage({ kind }: { kind: CommunityKind }) {
  const { data, api, saveConfig } = useWorkspace();
  const moduleKey = communityModule(kind),
    poll = kind === "poll",
    enabled = data.guild.config.modules[moduleKey] === true;
  const empty: PostPage = {
    asOf: data.presentation.referenceAt,
    kind,
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
  };
  const [page, setPage] = useState<PostPage>(
    data.community?.kind === kind ? data.community : empty
  );
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [editor, setEditor] = useState<{
    post: CommunityPost | null;
    key: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<PostIntent | null>(null);
  const [utc, setUtc] = useState("");
  const zone = data.guild.config.timezone;
  const lastAction = useRef<HTMLElement | null>(null),
    refreshButton = useRef<HTMLButtonElement>(null);
  function remember() {
    lastAction.current = document.activeElement as HTMLElement | null;
  }
  function confirmAction(post: CommunityPost, action: PostAction) {
    if (action === "schedule") setUtc("");
    remember();
    setError("");
    setConfirm({ post, action, key: crypto.randomUUID() });
  }
  function restoreFocus(event: Event) {
    event.preventDefault();
    const target = lastAction.current;
    if (target?.isConnected && !(target as HTMLButtonElement).disabled)
      target.focus();
    else refreshButton.current?.focus();
  }
  useEffect(() => {
    const incoming = data.community;
    if (incoming?.kind === kind && filter === "all" && page.page === 1)
      setPage((current) => newerCommunityPage(current, incoming));
  }, [data.community, kind, filter, page.page]);
  async function load(number = page.page, state = filter) {
    const next = await api<PostPage>(
      `/community?kind=${kind}&page=${number}&state=${encodeURIComponent(state)}`
    );
    setPage(next);
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Action failed. Refresh the record before retrying."
      );
    } finally {
      setBusy(false);
    }
  }
  async function perform() {
    if (!confirm) return;
    const { post, action } = confirm;
    await run(async () => {
      try {
        if (action === "delete")
          await api(`/community/${post.id}`, "DELETE", {
            version: post.version,
          });
        else
          await api(
            `/community/${post.id}/actions`,
            "POST",
            {
              action,
              version: post.version,
              ...(action === "schedule"
                ? { scheduledFor: new Date(`${utc}Z`).toISOString() }
                : {}),
            },
            { "Idempotency-Key": confirm.key }
          );
        toast.success(
          action === "publish"
            ? data.demo
              ? "Simulated publication — no Discord message sent"
              : "Discord confirmed publication"
            : action === "schedule"
              ? "Schedule saved — delivery is not yet confirmed"
              : action === "delete"
                ? "Stored record deleted; Discord message left unchanged"
                : data.demo
                  ? "Simulation updated; Discord was not contacted"
                  : "Record updated"
        );
      } finally {
        await load();
      }
      // Keep the focus scope open until refreshed state and enabled controls are ready.
      setConfirm(null);
    });
  }
  return (
    <section
      data-community-workspace
      aria-label={poll ? "Poll management" : "Announcement management"}
    >
      <PageHeader
        title={poll ? "Native polls" : "Announcements"}
        description={
          poll
            ? "Ask a clear question. Members vote in Discord; Orbit stores aggregates, never voter identities. Native polls are not an anonymity feature."
            : "Write once, publish deliberately. Schedule one announcement in UTC with clear server-time previews."
        }
      >
        <Button
          ref={refreshButton}
          variant="outline"
          onClick={() => void run(() => load())}
          disabled={busy}
        >
          <RefreshCw size={14} />
          Refresh
        </Button>
        <Button
          disabled={!enabled || busy}
          onClick={() => {
            remember();
            setError("");
            setEditor({ post: null, key: crypto.randomUUID() });
          }}
        >
          <Plus size={14} />
          New {poll ? "poll" : "announcement"}
        </Button>
      </PageHeader>
      <ModuleSetupBanner module={moduleKey} />
      <noscript>
        Records are readable without JavaScript. Enable it to edit/publish in
        the dashboard, or use registered manager slash commands.
      </noscript>
      <Card className="mb-5 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="max-w-2xl text-xs leading-relaxed">
          <h2 className="font-semibold">
            {enabled ? "Explicit publishing only" : "Off until you opt in"}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {poll
              ? "2–10 different answers, a 1–168 hour duration, and an ordinary server text channel. Published polls cannot be edited. Refresh or close your existing polls even while paused."
              : "One-time schedules only, 1 minute–30 days ahead. The worker checks every minute; after a 15-minute grace window a missed notice is not replayed. Pausing blocks new sends; cancel pending schedules before re-enabling if you no longer want them."}{" "}
            No mentions are allowed. At most 10 publications per server per
            hour.
          </p>
          {data.demo && (
            <p className="mt-2 font-medium text-blue-600 dark:text-blue-300">
              Simulation only. No Discord messages, votes, queues or background
              deliveries.
            </p>
          )}
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await saveConfig({
                ...data.guild.config,
                modules: {
                  ...data.guild.config.modules,
                  [moduleKey]: !enabled,
                },
              });
              toast.success(
                enabled
                  ? "Module paused. In-flight Discord requests cannot be recalled."
                  : "Module enabled. Drafts are never sent automatically."
              );
            })
          }
        >
          {enabled
            ? "Pause module"
            : `Enable ${poll ? "polls" : "announcements"}`}
        </Button>
      </Card>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-xs text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <div className="w-48">
          <Field label="Publication state">
            <Select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                void run(() => load(1, e.target.value));
              }}
              disabled={busy}
            >
              <option value="all">All states</option>
              {communityStates.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          Times shown in {zone}. Live content is eligible for deletion after 90
          inactive days (worker required). Demo records persist until deleted.
        </p>
      </div>
      <div className="space-y-4" aria-busy={busy}>
        {!page.items.length ? (
          <Card>
            <EmptyState
              icon={poll ? Vote : CalendarClock}
              title={
                filter === "all"
                  ? `No ${poll ? "polls" : "announcements"} yet`
                  : "No posts in this state"
              }
              description="Create an unsent draft, review its destination and content, then explicitly publish or schedule it. Saving a draft never contacts Discord."
            />
          </Card>
        ) : (
          page.items.map((post) => (
            <PostRecord
              key={post.id}
              post={post}
              enabled={enabled}
              busy={busy}
              onEdit={(post) => {
                remember();
                setError("");
                setEditor({ post, key: crypto.randomUUID() });
              }}
              onAction={confirmAction}
              onRefresh={(post) =>
                void run(async () => {
                  try {
                    await api(
                      `/community/${post.id}/actions`,
                      "POST",
                      { action: "refresh", version: post.version },
                      { "Idempotency-Key": crypto.randomUUID() }
                    );
                  } finally {
                    await load();
                  }
                })
              }
            />
          ))
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <p role="status">
          Page {page.page} of{" "}
          {Math.max(1, Math.ceil(page.total / page.pageSize))} · {page.total}{" "}
          stored records
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy || page.page === 1}
            onClick={() => void run(() => load(page.page - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={busy || page.page * page.pageSize >= page.total}
            onClick={() => void run(() => load(page.page + 1))}
          >
            Next
          </Button>
        </div>
      </div>
      {editor && (
        <PostEditor
          kind={kind}
          post={editor.post}
          requestKey={editor.key}
          restoreFocus={restoreFocus}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            setFilter("all");
            await load(1, "all");
          }}
        />
      )}
      <PostReview
        confirm={confirm}
        busy={busy}
        error={error}
        utc={utc}
        onUtcChange={setUtc}
        onClose={() => setConfirm(null)}
        onConfirm={() => void perform()}
        restoreFocus={restoreFocus}
      />
    </section>
  );
}
