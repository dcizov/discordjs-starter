"use client";
import { communityDate, type CommunityPost } from "@orbit/core/community";
import { useWorkspace } from "../../workspace";
import { Button } from "../../ui/button";
import { Badge, Card } from "../../ui/primitives";
import type { PostAction } from "./post-review";
const editable = (post: CommunityPost) =>
  ["draft", "failed", "cancelled", "missed"].includes(post.state);
export function PostRecord({
  post,
  enabled,
  busy,
  onEdit,
  onAction,
  onRefresh,
}: {
  post: CommunityPost;
  enabled: boolean;
  busy: boolean;
  onEdit: (post: CommunityPost) => void;
  onAction: (post: CommunityPost, action: PostAction) => void;
  onRefresh: (post: CommunityPost) => void;
}) {
  const { data } = useWorkspace();
  const zone = data.guild.config.timezone;
  const poll = post.kind === "poll";
  return (
    <Card className="p-5" role="article" aria-label={post.title}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-sm font-semibold">{post.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            #
            {data.guild.channels.find((c) => c.id === post.channelId)?.name ??
              "deleted or unsynced channel"}{" "}
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
          Do not resend. Inspect the Discord channel first. Orbit cannot safely
          infer whether Discord accepted this message.
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
                  <th scope="row" className="break-words py-2 font-normal">
                    {answer.text}
                  </th>
                  <td>{answer.votes === null ? "Unknown" : answer.votes}</td>
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
            onClick={() => onEdit(post)}
          >
            Edit draft
          </Button>
        )}
        {["draft", "failed"].includes(post.state) && (
          <Button
            size="sm"
            disabled={!enabled || busy}
            onClick={() => {
              onAction(post, "publish");
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
              onAction(post, "schedule");
            }}
          >
            Schedule
          </Button>
        )}
        {["draft", "scheduled", "failed", "missed"].includes(post.state) && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              onAction(post, "cancel");
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
            onClick={() => onRefresh(post)}
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
              onAction(post, "close");
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
              onAction(post, "delete");
            }}
          >
            Delete stored record
          </Button>
        )}
      </div>
    </Card>
  );
}
