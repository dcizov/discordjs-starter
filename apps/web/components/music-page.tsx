"use client";
import { cn, duration } from "@/lib/utils";
import {
  AudioLines,
  Check,
  Headphones,
  Info,
  ListMusic,
  Music2,
  Pause,
  Play,
  Plus,
  Repeat,
  Settings2,
  Shuffle,
  SkipForward,
  Square,
  Trash2,
  Volume2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "./page-header";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  Spinner,
} from "./ui/primitives";
import { useWorkspace } from "./workspace";
export function MusicPage() {
  const { data, api, refresh, saveConfig } = useWorkspace();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  const [config, setConfig] = useState(data.guild.config.music);
  const [stop, setStop] = useState(false);
  const [volume, setVolume] = useState<number | null>(null);
  const m = data.music;
  async function action(action: string, extra: Record<string, any> = {}) {
    setBusy(action);
    try {
      await api("/music", "POST", { action, ...extra });
      await refresh();
      if (action === "play") {
        setQuery("");
        toast.success(
          data.demo
            ? "Added to the preview queue. No audio is played."
            : "Playback request queued for the bot."
        );
      } else if (!data.demo) toast.success("Music command queued");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      <PageHeader
        title="A soundtrack for your space."
        description="Good conversations sound even better with a little music."
      >
        <Button variant="outline" onClick={() => setSettings(true)}>
          <Settings2 size={14} />
          Music settings
        </Button>
      </PageHeader>
      <div
        className={cn(
          "mb-5 flex items-center gap-2 rounded-lg border px-4 py-3 text-[11px]",
          data.demo
            ? "border-violet-200/50 bg-violet-50/70 text-violet-500 dark:border-violet-500/20 dark:bg-violet-500/10"
            : "bg-card text-muted-foreground"
        )}
      >
        <Info size={14} className="shrink-0" />
        {data.demo
          ? "A little listening-room preview. Queue controls work, but no audio is played or sent to Discord."
          : "Music plays in Discord, not this browser. Join a voice channel before requesting a track. A configured Lavalink backend is required."}
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <span className="flex items-center gap-2 text-xs font-semibold">
              <AudioLines size={15} className="text-primary" />
              The listening room
            </span>
            <Badge tone={m.current ? "green" : "neutral"}>
              <span
                className={cn(
                  "size-1 rounded-full",
                  m.current ? "bg-emerald-500" : "bg-slate-400"
                )}
              />
              {m.current
                ? m.paused
                  ? "Taking a breath"
                  : "Now playing"
                : "Ready when you are"}
            </Badge>
          </div>
          <div className="relative flex min-h-[285px] flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#f2edf9] to-card px-6 py-8 dark:from-violet-500/10 dark:to-card">
            <div className="absolute -top-14 size-64 rounded-full border border-violet-200/30" />
            <div className="absolute -top-28 size-96 rounded-full border border-violet-200/20" />
            <div className="relative flex size-36 items-center justify-center rounded-full bg-gradient-to-br from-[#ba9bdd] via-[#9d7ac6] to-[#7c5ea4] shadow-xl shadow-violet-200/30">
              <div className="absolute inset-3 rounded-full border border-white/10" />
              <div className="absolute inset-5 rounded-full border border-white/10" />
              <div className="absolute inset-7 rounded-full border border-white/10" />
              <div className="absolute inset-9 rounded-full border border-white/10" />
              <div className="flex size-12 items-center justify-center rounded-full border-[7px] border-[#e8d5db] bg-[#f4e9de]">
                <span className="size-2 rounded-full bg-[#9675b3]" />
              </div>
            </div>
            <h2 className="relative mt-6 text-lg font-semibold">
              {m.current?.title ?? "A little quiet, for now."}
            </h2>
            <p className="relative mt-1.5 text-[12px] text-muted-foreground">
              {m.current?.author ?? "Add a track and set the mood."}
            </p>
            {m.current && (
              <span className="relative mt-3 text-[10px] text-muted-foreground">
                Requested by {m.current.requestedBy}
              </span>
            )}
          </div>
          <div className="px-7 pb-6">
            <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/60"
                style={{
                  width: `${m.current ? Math.min(100, (m.position / m.current.duration) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[9px] tabular-nums text-muted-foreground">
              <span>{duration(m.position)}</span>
              <span>{duration(m.current?.duration ?? 0)}</span>
            </div>
            <div className="mt-4 flex items-center justify-center gap-6">
              <Button
                variant="ghost"
                size="icon"
                disabled={!!busy || !m.tracks.length}
                onClick={() => action("shuffle")}
                aria-label="Shuffle queue"
              >
                <Shuffle size={17} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!!busy || !m.current}
                onClick={() => setStop(true)}
                aria-label="Stop playback"
              >
                <Square size={15} />
              </Button>
              <Button
                className="size-11 rounded-full"
                size="icon"
                disabled={!!busy || !m.current}
                aria-label={m.paused ? "Resume playback" : "Pause playback"}
                onClick={() => action(m.paused ? "resume" : "pause")}
              >
                {busy === "pause" || busy === "resume" ? (
                  <Spinner />
                ) : m.paused ? (
                  <Play size={18} className="ml-0.5 fill-current" />
                ) : (
                  <Pause size={18} className="fill-current" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                disabled={!!busy || !m.current}
                onClick={() => action("skip")}
                aria-label="Skip track"
              >
                <SkipForward size={18} />
              </Button>
              <Button
                className={m.repeat !== "off" ? "text-primary" : ""}
                variant="ghost"
                size="icon"
                disabled={!!busy}
                onClick={() =>
                  action("repeat", {
                    repeat:
                      m.repeat === "off"
                        ? "track"
                        : m.repeat === "track"
                          ? "queue"
                          : "off",
                  })
                }
                aria-label={`Repeat ${m.repeat}. Click to cycle.`}
              >
                <span className="relative">
                  <Repeat size={17} />
                  {m.repeat === "track" && (
                    <span className="absolute -right-1 -top-2 text-[7px]">
                      1
                    </span>
                  )}
                </span>
              </Button>
            </div>
            <div className="mx-auto mt-5 flex max-w-48 items-center gap-2.5">
              <Volume2 size={13} className="text-muted-foreground" />
              <input
                type="range"
                min="0"
                max="100"
                value={volume ?? m.volume}
                aria-label="Playback volume"
                className="h-1 w-full"
                onChange={(e) => setVolume(Number(e.target.value))}
                onPointerUp={(e) => {
                  action("volume", {
                    volume: Number(e.currentTarget.value),
                  }).then(() => setVolume(null));
                }}
                onKeyUp={(e) => {
                  if (e.key.startsWith("Arrow"))
                    action("volume", {
                      volume: Number(e.currentTarget.value),
                    }).then(() => setVolume(null));
                }}
              />
              <span className="w-6 text-[10px] tabular-nums text-muted-foreground">
                {volume ?? m.volume}%
              </span>
            </div>
          </div>
        </Card>
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-xs font-semibold">
              <Plus size={15} className="text-primary" />A little request?
            </h2>
            <p className="mb-4 mt-2 text-[11px] leading-relaxed text-muted-foreground">
              A track title or a supported source URL. We’ll take it from there.
            </p>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                action("play", { query });
              }}
            >
              <Input
                placeholder="Set the mood…"
                minLength={2}
                maxLength={200}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                required
              />
              <Button
                className="w-full"
                disabled={!!busy || !data.guild.config.modules.music}
              >
                {busy === "play" ? <Spinner /> : <Plus size={13} />}Add to the
                queue
              </Button>
            </form>
          </Card>
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-xs font-semibold">
              <Headphones size={15} className="text-[#c895a7]" />
              Room for everyone’s favorites.
            </h2>
            <div className="mt-5 space-y-4 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Who’s on the decks
                </span>
                <span>
                  {data.guild.config.music.djRoleId
                    ? (data.guild.roles.find(
                        (r) => r.id === data.guild.config.music.djRoleId
                      )?.name ?? "DJ role")
                    : "Everyone"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Repeat mode</span>
                <Badge tone="purple">{m.repeat}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Queue capacity</span>
                <span>
                  {m.tracks.length} / {data.guild.config.music.maxQueue}
                </span>
              </div>
            </div>
            <p className="mt-5 border-t pt-4 text-[10px] leading-relaxed text-muted-foreground">
              Playback depends on your configured Lavalink sources. YouTube,
              Spotify, and other providers aren’t guaranteed. See the music
              setup guide for supported sources and terms.
            </p>
          </Card>
        </div>
      </div>
      <Card className="mt-5">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <ListMusic size={15} className="text-primary" />A little further
            down the queue <Badge>{m.tracks.length} tracks</Badge>
          </h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => action("shuffle")}
            disabled={!!busy || m.tracks.length < 2}
          >
            <Shuffle size={12} />
            Shuffle
          </Button>
        </div>
        {m.tracks.length ? (
          <div className="divide-y">
            {m.tracks.map((t, i) => (
              <div className="flex items-center gap-3 px-5 py-3.5" key={t.id}>
                <span className="w-4 text-center text-[11px] text-muted-foreground">
                  {i + 1}
                </span>
                <div className="flex size-9 items-center justify-center rounded-lg bg-violet-50 text-violet-300 dark:bg-violet-500/10">
                  <Music2 size={15} />
                </div>
                <div className="flex-1">
                  <p className="text-[12px] font-medium">{t.title}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {t.author}
                  </p>
                </div>
                <span className="hidden text-[10px] text-muted-foreground sm:block">
                  Added by {t.requestedBy}
                </span>
                <span className="ml-4 text-[11px] tabular-nums text-muted-foreground">
                  {duration(t.duration)}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="ml-2 size-7"
                  disabled={!!busy}
                  aria-label={`Remove ${t.title}`}
                  onClick={() => action("remove", { trackId: t.id })}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Music2}
            title="Room for a little music."
            description="Add a request above, or use /play in your Discord voice channel."
          />
        )}
      </Card>
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>A few notes for your listening room.</DialogTitle>
            <DialogDescription>
              Set the volume. Choose the DJs. Let the good times play.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy("settings");
              try {
                await saveConfig({ ...data.guild.config, music: config });
                toast.success("Music settings saved");
                setSettings(false);
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setBusy(null);
              }
            }}
          >
            <Field
              label="DJ role"
              hint="Members with Manage Server can always control playback."
            >
              <Select
                value={config.djRoleId}
                onChange={(e) =>
                  setConfig({ ...config, djRoleId: e.target.value })
                }
              >
                <option value="">Everyone in the voice channel</option>
                {data.guild.roles
                  .filter((r) => !r.managed)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Default volume (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={config.defaultVolume}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      defaultVolume: Number(e.target.value),
                    })
                  }
                />
              </Field>
              <Field label="Maximum queue size">
                <Input
                  type="number"
                  min="1"
                  max="200"
                  value={config.maxQueue}
                  onChange={(e) =>
                    setConfig({ ...config, maxQueue: Number(e.target.value) })
                  }
                />
              </Field>
            </div>
            <p className="rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
              Lavalink connection settings and search-source prefixes are
              configured server-side. They never appear in the browser.
            </p>
            <Button className="w-full" disabled={!!busy}>
              {busy === "settings" ? <Spinner /> : <Check size={14} />}Save
              music settings
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={stop} onOpenChange={setStop}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>A little quiet time?</DialogTitle>
            <DialogDescription>
              This stops playback, clears the queue, and disconnects Orbit from
              voice. Everyone can add new favorites afterward.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStop(false)}>
              Keep playing
            </Button>
            <Button
              onClick={() => {
                action("stop");
                setStop(false);
              }}
            >
              <Square size={12} />
              Stop & clear queue
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
