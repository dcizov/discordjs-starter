"use client";
import { communityDate, type CommunityPost } from "@orbit/core/community";
import { useWorkspace } from "../../workspace";
import { Button } from "../../ui/button";
import { Badge, Field, Input } from "../../ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
export type PostAction = "publish" | "close" | "cancel" | "schedule" | "delete";
export type PostIntent = {
  post: CommunityPost;
  action: PostAction;
  key: string;
};
function confirmationCopy(
  action: PostAction,
  demo: boolean
): { title: string; description: string; submit: string } {
  switch (action) {
    case "publish":
      return {
        title: demo ? "Simulate publication" : "Publish to Discord?",
        description:
          "Review the content and destination below. All mentions are suppressed. Published polls are immutable; ambiguous responses block automatic resend.",
        submit: demo ? "Simulate publish" : "Publish now",
      };
    case "schedule":
      return {
        title: "Schedule once in UTC",
        description:
          "Delivery is not guaranteed. The approving manager must still belong to the server and have Manage Server when the job runs. Expired jobs are not replayed.",
        submit: "Save schedule",
      };
    case "delete":
      return {
        title: "Delete the stored record?",
        description:
          "This deletes Orbit's saved content and aggregates, not the Discord message. Audit metadata is retained. An unconfirmed publication must never be blindly resent.",
        submit: "Delete record",
      };
    case "close":
      return {
        title: "End this native poll?",
        description:
          "Members will no longer be able to vote. Discord may need time to finalize the aggregate tally. This action cannot reopen a native poll.",
        submit: "End voting",
      };
    case "cancel":
      return {
        title: "Cancel this unsent post?",
        description:
          "The stored revision will change so an old queued job cannot publish it. In-flight/already published messages cannot be recalled.",
        submit: "Confirm cancellation",
      };
  }
}
/** Controlled intent/revision/error/focus remain with the page's mutation boundary. */
export function PostReview({
  confirm,
  busy,
  error,
  utc,
  onUtcChange,
  onClose,
  onConfirm,
  restoreFocus,
}: {
  confirm: PostIntent | null;
  busy: boolean;
  error: string;
  utc: string;
  onUtcChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  restoreFocus: (event: Event) => void;
}) {
  const { data } = useWorkspace();
  const zone = data.guild.config.timezone;
  const copy = confirm ? confirmationCopy(confirm.action, data.demo) : null;
  return (
    <Dialog
      open={!!confirm}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent onCloseAutoFocus={restoreFocus}>
        <DialogHeader>
          <DialogTitle>{copy?.title}</DialogTitle>
          <DialogDescription>{copy?.description}</DialogDescription>
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
              onChange={(e) => onUtcChange(e.target.value)}
            />
            {utc && Number.isFinite(Date.parse(`${utc}Z`)) && (
              <p className="text-xs">
                Server time:{" "}
                {communityDate(new Date(`${utc}Z`).toISOString(), zone)} ({zone}
                )
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
          <Button variant="outline" disabled={busy} onClick={() => onClose()}>
            Keep unchanged
          </Button>
          <Button
            variant={confirm?.action === "delete" ? "destructive" : "default"}
            disabled={
              busy ||
              (confirm?.action === "schedule" &&
                !Number.isFinite(Date.parse(`${utc}Z`)))
            }
            onClick={onConfirm}
          >
            {busy ? "Working…" : copy?.submit}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
