"use client";
import { useState } from "react";
import type { NewsRoutingPreview as Preview } from "@orbit/core/feed-routing";
import { useWorkspace } from "./workspace";
import { Card, Field, Input, Select, Textarea } from "./ui/primitives";
import { Button } from "./ui/button";
export function NewsRoutingPreview() {
  const { data, api } = useWorkspace(),
    sources = data.resources.filter((r) => r.kind === "source");
  const [sourceId, setSource] = useState(sources[0]?.id ?? ""),
    [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [tags, setTags] = useState("");
  const [result, setResult] = useState<Preview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const invalidate = () => {
    setResult(null);
    setError("");
  };
  return (
    <Card className="mb-5 p-5" data-testid="news-preview">
      <details>
        <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">
          Preview news routing — no fetch, no send
        </summary>
        <p className="mb-4 mt-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
          Runs sample text through the saved keywords, tags and routes with the
          same matcher delivery uses. No feed is fetched, nothing is sent, and
          nothing is stored. Saved metadata is not proof of live access.
        </p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setResult(null);
            void api<Preview>("/news-preview", "POST", {
              sourceId,
              title,
              summary,
              tags: tags
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
              .then(setResult)
              .catch((e) =>
                setError(e instanceof Error ? e.message : "Preview failed")
              )
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Preview source" required>
            <Select
              disabled={busy}
              required
              value={sourceId}
              onChange={(e) => {
                setSource(e.target.value);
                invalidate();
              }}
            >
              <option value="">Choose a source</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                  {source.enabled ? "" : " (disabled)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sample headline" required>
            <Input
              disabled={busy}
              required
              maxLength={300}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                invalidate();
              }}
            />
          </Field>
          <Field label="Sample summary">
            <Textarea
              disabled={busy}
              maxLength={1200}
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                invalidate();
              }}
            />
          </Field>
          <Field
            label="Sample tags"
            hint="Comma-separated, up to 20 tags of 40 characters each. Saved source tags are merged before matching."
          >
            <Input
              disabled={busy}
              maxLength={819}
              value={tags}
              onChange={(e) => {
                setTags(e.target.value);
                invalidate();
              }}
            />
          </Field>
          <div className="sm:col-span-2">
            <Button disabled={busy || !sources.length}>
              {busy ? "Matching…" : "Preview routing only"}
            </Button>
          </div>
        </form>
        {error && (
          <p
            role="alert"
            className="mt-4 text-xs text-red-700 dark:text-red-300"
          >
            {error}
          </p>
        )}
        {result && (
          <div
            className="mt-5 space-y-3 rounded-lg border border-border p-4"
            role="status"
          >
            <h3 className="text-xs font-semibold">
              Routing snapshot · {result.sourceName}
            </h3>
            <p className="text-xs">
              Source filter: {result.matched ? "matched" : "not matched"}. Fetch
              performed: no. Send performed: no. Delivery verified: no.
            </p>
            {result.blocked.map((reason, i) => (
              <p key={i} className="text-xs text-amber-800 dark:text-amber-300">
                {reason}
              </p>
            ))}
            <ul className="space-y-3">
              {result.destinations.map((destination) => (
                <li
                  key={destination.channelId}
                  className="rounded border border-border p-3 text-xs"
                >
                  <span className="font-medium">
                    #{destination.channelName}
                  </span>
                  <p className="mt-1">
                    Matched by: {destination.matchedBy.join(" → ")}. One
                    delivery destination after deduplication; last matching
                    route supplies the settings.
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Synced bot posting permissions: {destination.permissions}.{" "}
                    {destination.notificationRole
                      ? `Configured notification role: ${destination.notificationRole}; no ping was sent.`
                      : "No notification role configured."}
                  </p>
                </li>
              ))}
            </ul>
            {!result.destinations.length && (
              <p className="text-xs">No matching usable destination.</p>
            )}
          </div>
        )}
      </details>
    </Card>
  );
}
