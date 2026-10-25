"use client";
import { useEffect, useState, useRef } from "react";
import { toast } from "sonner";
import { Plus, RefreshCw, CalendarClock, Vote } from "lucide-react";
import {
  communityDate,
  isCommunityChannel,
  newerCommunityPage,
  communityModule,
  communityStates,
  type CommunityKind,
  type CommunityPage as PostPage,
  type CommunityPost,
} from "@orbit/core/community";
import { useWorkspace } from "./workspace";
import { PageHeader } from "./page-header";
import { ModuleSetupBanner } from "./module-setup";
import { Button } from "./ui/button";
import {
  Badge,
  Card,
  Field,
  Input,
  Select,
  Textarea,
  EmptyState,
} from "./ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

type Action =
  "publish" | "refresh" | "close" | "cancel" | "schedule" | "delete";
const editable = (post: CommunityPost) =>
  ["draft", "failed", "cancelled", "missed"].includes(post.state);
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
  const [confirm, setConfirm] = useState<{
    post: CommunityPost;
    action: Action;
    key: string;
  } | null>(null);
  const [utc, setUtc] = useState("");
  const zone = data.guild.config.timezone;
  const lastAction = useRef<HTMLElement | null>(null),
    refreshButton = useRef<HTMLButtonElement>(null);
  function remember() {
    lastAction.current = document.activeElement as HTMLElement | null;
  }
  function confirmAction(post: CommunityPost, action: Action) {
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
            <Card
              key={post.id}
              className="p-5"
              role="article"
              aria-label={post.title}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="break-words text-sm font-semibold">
                    {post.title}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    #
                    {data.guild.channels.find((c) => c.id === post.channelId)
                      ?.name ?? "deleted or unsynced channel"}{" "}
                    · Updated {communityDate(post.updatedAt, zone)}
                  </p>
                </div>
                <Badge
                  tone={
                    post.state === "unconfirmed" ||
                    post.state === "failed" ||
                    post.state === "missed"
                      ? "amber"
                      : "neutral"
                  }
                >
                  {data.demo ? "Simulation · " : ""}
                  {post.state}
                </Badge>
              </div>
              <div className="my-4 rounded-lg border border-border bg-muted/30 p-4">
                <p className="whitespace-pre-wrap break-words text-sm font-medium">
                  {post.poll?.question ?? post.title}
                </p>
                {post.poll ? (
                  <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
                    {post.poll.answers.map((answer, i) => (
                      <li key={i}>
                        {i + 1}. {answer}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {post.body}
                  </p>
                )}
                {post.poll && (
                  <p className="mt-3 text-xs text-muted-foreground">
                    {post.poll.durationHours} hours ·{" "}
                    {post.poll.allowMultiselect
                      ? "Multiple answers allowed"
                      : "One answer per voter"}
                  </p>
                )}
              </div>
              {post.scheduledFor && (
                <p className="mb-3 text-xs">
                  Scheduled: {communityDate(post.scheduledFor, zone)} ({zone}) ·{" "}
                  <span className="break-all">UTC {post.scheduledFor}</span>
                  {data.demo && " · not delivered by demo workers"}
                </p>
              )}
              {post.lastError && (
                <p className="mb-3 break-words rounded-lg border border-amber-500/30 p-3 text-xs text-amber-800 dark:text-amber-300">
                  {post.lastError}
                </p>
              )}
              {post.state === "unconfirmed" && (
                <p className="mb-3 text-xs font-medium">
                  Do not resend. Inspect the Discord channel first. Orbit cannot
                  safely infer whether Discord accepted this message.
                </p>
              )}
              {post.result && (
                <div className="mb-4">
                  <h3 className="mb-2 text-xs font-semibold">
                    {data.demo
                      ? "Simulated snapshot — no live votes"
                      : post.result.finalized
                        ? "Finalized Discord results"
                        : "Results not finalized — available counts are approximate"}
                  </h3>
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">
                      Aggregate poll results; unknown is not zero
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col" className="py-2">
                          Answer
                        </th>
                        <th scope="col">Votes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {post.result.answers.map((answer) => (
                        <tr key={answer.id} className="border-t border-border">
                          <th
                            scope="row"
                            className="break-words py-2 font-normal"
                          >
                            {answer.text}
                          </th>
                          <td>
                            {answer.votes === null ? "Unknown" : answer.votes}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Checked {communityDate(post.result.checkedAt, zone)}.{" "}
                    {post.result.expiresAt
                      ? `Ends ${communityDate(post.result.expiresAt, zone)}.`
                      : "End time unavailable."}{" "}
                    Counts are per answer, not unique voters.
                  </p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {editable(post) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!enabled || busy}
                    onClick={() => {
                      remember();
                      setError("");
                      setEditor({ post, key: crypto.randomUUID() });
                    }}
                  >
                    Edit draft
                  </Button>
                )}
                {["draft", "failed"].includes(post.state) && (
                  <Button
                    size="sm"
                    disabled={!enabled || busy}
                    onClick={() => {
                      confirmAction(post, "publish");
                    }}
                  >
                    Review & publish
                  </Button>
                )}
                {!poll && editable(post) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!enabled || busy}
                    onClick={() => {
                      setUtc("");
                      confirmAction(post, "schedule");
                    }}
                  >
                    Schedule
                  </Button>
                )}
                {["draft", "scheduled", "failed", "missed"].includes(
                  post.state
                ) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      confirmAction(post, "cancel");
                    }}
                  >
                    Cancel {post.state === "scheduled" ? "schedule" : "draft"}
                  </Button>
                )}
                {poll && ["published", "closed"].includes(post.state) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
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
                  >
                    Refresh results
                  </Button>
                )}
                {poll && post.state === "published" && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      confirmAction(post, "close");
                    }}
                  >
                    End poll
                  </Button>
                )}
                {post.messageId && !data.demo && (
                  <Button asChild variant="outline" size="sm">
                    <a
                      href={`https://discord.com/channels/${post.guildId}/${post.channelId}/${post.messageId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in Discord<span className="sr-only"> (new tab)</span>
                    </a>
                  </Button>
                )}
                {!["scheduled", "sending"].includes(post.state) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      confirmAction(post, "delete");
                    }}
                  >
                    Delete stored record
                  </Button>
                )}
              </div>
            </Card>
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
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirm(null);
        }}
      >
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>
              {confirm?.action === "publish"
                ? data.demo
                  ? "Simulate publication"
                  : "Publish to Discord?"
                : confirm?.action === "schedule"
                  ? "Schedule once in UTC"
                  : confirm?.action === "delete"
                    ? "Delete the stored record?"
                    : confirm?.action === "close"
                      ? "End this native poll?"
                      : "Cancel this unsent post?"}
            </DialogTitle>
            <DialogDescription>
              {confirm?.action === "delete"
                ? "This deletes Orbit's saved content and aggregates, not the Discord message. Audit metadata is retained. An unconfirmed publication must never be blindly resent."
                : confirm?.action === "schedule"
                  ? "Delivery is not guaranteed. The approving manager must still belong to the server and have Manage Server when the job runs. Expired jobs are not replayed."
                  : confirm?.action === "close"
                    ? "Members will no longer be able to vote. Discord may need time to finalize the aggregate tally. This action cannot reopen a native poll."
                    : confirm?.action === "cancel"
                      ? "The stored revision will change so an old queued job cannot publish it. In-flight/already published messages cannot be recalled."
                      : "Review the content and destination below. All mentions are suppressed. Published polls are immutable; ambiguous responses block automatic resend."}
            </DialogDescription>
          </DialogHeader>
          {data.demo && (
            <Badge tone="blue">Demo simulation — no Discord I/O</Badge>
          )}
          <p className="my-3 break-words text-sm font-medium">
            {confirm?.post.title}
          </p>
          <p className="mb-4 text-xs text-muted-foreground">
            #
            {data.guild.channels.find((c) => c.id === confirm?.post.channelId)
              ?.name ?? "unavailable destination"}
          </p>
          {confirm?.action === "publish" && (
            <div className="mb-4 whitespace-pre-wrap break-words rounded-lg border border-border p-3 text-xs">
              {confirm.post.poll
                ? `${confirm.post.poll.question}\n\n${confirm.post.poll.answers.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n\nDuration: ${confirm.post.poll.durationHours}h`
                : confirm.post.body}
            </div>
          )}
          {confirm?.action === "schedule" && (
            <Field
              label="Send at (UTC)"
              hint={`At least 1 minute and at most 30 days ahead. Server timezone: ${zone}.`}
            >
              <Input
                type="datetime-local"
                required
                value={utc}
                onChange={(e) => setUtc(e.target.value)}
              />
              {utc && Number.isFinite(Date.parse(`${utc}Z`)) && (
                <p className="text-xs">
                  Server time:{" "}
                  {communityDate(new Date(`${utc}Z`).toISOString(), zone)} (
                  {zone})
                </p>
              )}
            </Field>
          )}
          {error && (
            <p
              role="alert"
              className="mt-3 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Keep unchanged
            </Button>
            <Button
              variant={confirm?.action === "delete" ? "destructive" : "default"}
              disabled={
                busy ||
                (confirm?.action === "schedule" &&
                  !Number.isFinite(Date.parse(`${utc}Z`)))
              }
              onClick={() => void perform()}
            >
              {busy
                ? "Working…"
                : confirm?.action === "publish"
                  ? data.demo
                    ? "Simulate publish"
                    : "Publish now"
                  : confirm?.action === "schedule"
                    ? "Save schedule"
                    : confirm?.action === "delete"
                      ? "Delete record"
                      : confirm?.action === "close"
                        ? "End voting"
                        : "Confirm cancellation"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function PostEditor({
  kind,
  post,
  requestKey,
  onClose,
  onSaved,
  restoreFocus,
}: {
  kind: CommunityKind;
  post: CommunityPost | null;
  requestKey: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  restoreFocus: (event: Event) => void;
}) {
  const { data, api } = useWorkspace(),
    poll = kind === "poll";
  const channels = data.guild.channels.filter((c) =>
    isCommunityChannel(c, data.demo)
  );
  const [title, setTitle] = useState(post?.title ?? ""),
    [channelId, setChannel] = useState(
      post?.channelId ?? channels[0]?.id ?? ""
    );
  const [body, setBody] = useState(post?.body ?? ""),
    [question, setQuestion] = useState(post?.poll?.question ?? "");
  const [answers, setAnswers] = useState(post?.poll?.answers.join("\n") ?? ""),
    [hours, setHours] = useState(post?.poll?.durationHours ?? 24),
    [multi, setMulti] = useState(post?.poll?.allowMultiselect ?? false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const input = {
      kind,
      title,
      channelId,
      body: poll ? "" : body,
      poll: poll
        ? {
            question,
            answers: answers
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean),
            durationHours: hours,
            allowMultiselect: multi,
          }
        : null,
    };
    try {
      if (post)
        await api(`/community/${post.id}`, "PATCH", {
          version: post.version,
          input,
        });
      else
        await api("/community", "POST", input, {
          "Idempotency-Key": requestKey,
        });
      toast.success("Unsent draft saved. Discord was not contacted.");
      await onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save draft");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>
            {post
              ? "Edit draft"
              : `New ${poll ? "poll" : "announcement"} draft`}
          </DialogTitle>
          <DialogDescription>
            Saving never publishes. Plain text only; mentions are suppressed. Do
            not include secrets or sensitive personal information. Content is
            visible to server managers. Live content is eligible for deletion
            after 90 inactive days while the worker runs; demo records persist
            until deleted.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field
            label="Draft name"
            required
            hint={
              poll
                ? "Private manager label. The question below is what Discord displays."
                : "This title is displayed on the announcement."
            }
          >
            <Input
              autoFocus
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field
            label="Destination channel"
            required
            hint="Ordinary server text channels only in this release. Bot sync must identify supported poll destinations."
          >
            <Select
              required
              value={channelId}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">Choose a channel</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </Select>
          </Field>
          {poll ? (
            <>
              <Field label="Poll question" required>
                <Input
                  required
                  maxLength={300}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </Field>
              <Field
                label="Answers"
                required
                hint="One answer per line. 2–10 distinct answers, up to 55 characters each."
              >
                <Textarea
                  required
                  maxLength={569}
                  value={answers}
                  onChange={(e) => setAnswers(e.target.value)}
                />
              </Field>
              <Field label="Duration (hours)" required>
                <Input
                  required
                  type="number"
                  min={1}
                  max={168}
                  step={1}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </Field>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-xs">
                <input
                  className="size-4 accent-violet-600"
                  type="checkbox"
                  checked={multi}
                  onChange={(e) => setMulti(e.target.checked)}
                />
                Allow multiple answers
              </label>
            </>
          ) : (
            <Field
              label="Announcement message"
              required
              hint="Up to 1,800 characters. No automatic crosspost or role/everyone pings."
            >
              <Textarea
                required
                maxLength={1800}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </Field>
          )}
          {error && (
            <p
              role="alert"
              className="break-words text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={busy}
            >
              Discard changes
            </Button>
            <Button type="submit" disabled={busy || !channels.length}>
              {busy ? "Saving…" : "Save unsent draft"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
