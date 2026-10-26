"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  isCommunityChannel,
  type CommunityKind,
  type CommunityPost,
} from "@orbit/core/community";
import { useWorkspace } from "../../workspace";
import { Button } from "../../ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "../../ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
export function PostEditor({
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
            not include secrets or personal information — server managers can
            read this. Live drafts are removed after 90 inactive days; demo
            records stay until deleted.
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
                <Checkbox
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
