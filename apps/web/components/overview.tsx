"use client";
import { cn, number, relativeTime } from "@/lib/utils";
import type { ModuleKey } from "@orbit/core";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Command,
  Database,
  Hash,
  HeartPulse,
  Music2,
  Orbit,
  Radio,
  Rss,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TrendingUp,
  UsersRound,
  Wallet,
  Workflow,
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Badge, Card, Select } from "./ui/primitives";
import { Switch } from "./ui/switch";
import { useWorkspace } from "./workspace";
const modules: {
  key: ModuleKey;
  name: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bg: string;
}[] = [
  {
    key: "roles",
    name: "Self roles",
    description: "Let your members find their people.",
    icon: UsersRound,
    color: "text-violet-500",
    bg: "bg-violet-50 dark:bg-violet-500/10",
  },
  {
    key: "moderation",
    name: "Moderation",
    description: "A safer space, a lighter workload.",
    icon: ShieldCheck,
    color: "text-[#d49a66]",
    bg: "bg-[#fcf1e8] dark:bg-orange-500/10",
  },
  {
    key: "economy",
    name: "Economy",
    description: "Give a little. Grow a lot.",
    icon: Wallet,
    color: "text-[#c5a150]",
    bg: "bg-[#fbf5df] dark:bg-amber-500/10",
  },
  {
    key: "music",
    name: "Music",
    description: "The soundtrack to your community.",
    icon: Music2,
    color: "text-[#d88b9c]",
    bg: "bg-[#fceef2] dark:bg-pink-500/10",
  },
  {
    key: "deals",
    name: "Game deals",
    description: "Good games. Even better prices.",
    icon: Tags,
    color: "text-[#6bada0]",
    bg: "bg-[#eaf6f2] dark:bg-emerald-500/10",
  },
  {
    key: "news",
    name: "News & feeds",
    description: "Keep your corner in the know.",
    icon: Rss,
    color: "text-[#7c9dce]",
    bg: "bg-[#edf3fc] dark:bg-blue-500/10",
  },
];
export function Overview() {
  const { data, navigate, saveConfig } = useWorkspace();
  const [range, setRange] = useState("Last 7 days");
  const [customize, setCustomize] = useState(false);
  const [customizeBusy, setCustomizeBusy] = useState(false);
  const [status, setStatus] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const config = data.guild.config;
  const online =
    data.health.find((h) => h.name === "Discord API")?.status === "healthy";
  const counts = {
    roles: `${data.resources.filter((r) => r.kind === "panel" && r.enabled).length} active panels`,
    moderation: `${data.resources.filter((r) => r.kind === "rule" && r.enabled).length} rules keeping watch`,
    economy: `${number(data.stats?.circulation ?? data.accounts.reduce((n, a) => n + a.balance, 0))} ${config.economy.currency.toLowerCase()} in circulation`,
    music: data.music.current
      ? "Something good is playing"
      : "Ready for your next request",
    deals: `${data.resources.filter((r) => r.kind === "deal" && r.enabled).length} active subscriptions`,
    news: `${data.resources.filter((r) => r.kind === "source").length} sources, one home for updates`,
  };
  async function toggleModule(key: ModuleKey, value: boolean) {
    setToggling(key);
    try {
      await saveConfig({
        ...config,
        modules: { ...config.modules, [key]: value },
      });
      toast.success(
        `${modules.find((m) => m.key === key)?.name} ${value ? "enabled" : "paused"}`
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setToggling(null);
    }
  }
  const metricValues = data.demo
    ? [number(data.guild.memberCount), "684", "1,293", "99.98%"]
    : [
        number(data.guild.memberCount),
        number(data.stats?.accountCount ?? data.accounts.length),
        number(data.audit.filter((a) => a.action === "moderated").length),
        online ? "Online" : "Offline",
      ];
  const metricLabels = data.demo
    ? ["Total members", "Active today", "Commands used", "Bot uptime"]
    : [
        "Total members",
        "Economy members",
        "Moderation actions",
        "Bot connection",
      ];
  return (
    <>
      <PageHeader
        title="Server overview"
        description={`A little snapshot of life in ${data.guild.name}.`}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-[34px] text-[11px]">
              <CalendarDays size={13} />
              {range}
              <ChevronDown size={12} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {["Last 7 days", "Last 14 days", "Last 30 days"].map((r) => (
              <DropdownMenuItem key={r} onSelect={() => setRange(r)}>
                {r}
                {r === range && <Check className="ml-auto text-primary" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          className="h-[34px] text-[11px]"
          onClick={() => setCustomize(true)}
        >
          <SlidersHorizontal size={13} />
          Customize
        </Button>
      </PageHeader>
      {config.dashboard.showHero && (
        <div className="relative mb-5 flex h-[167px] overflow-hidden rounded-xl border border-[#e6def2] bg-gradient-to-r from-[#f0eafa] via-[#f0ebf8] to-[#f3edf9] dark:border-violet-500/20 dark:from-violet-500/10 dark:to-violet-500/5">
          <div className="relative z-10 flex flex-col justify-center py-5 pl-6 md:pl-7">
            <span className="mb-2.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[1.5px] text-[#866d9f]">
              <span className="size-1 rounded-full bg-[#b39ad2]" />A good place
              to grow
            </span>
            <h2 className="text-[24px] font-semibold leading-[1.2] tracking-[-.8px] text-[#574475] dark:text-violet-200">
              A little less managing.
              <br />A lot more community.
            </h2>
            <p className="mt-2 text-[11px] text-[#82718f] dark:text-violet-300/70">
              Your people. Your passions. All in good orbit.
            </p>
            <button
              onClick={() => navigate("settings")}
              className="mt-3.5 flex w-fit items-center gap-2 text-[10px] font-semibold text-[#8661b7] hover:gap-3 dark:text-violet-300"
            >
              Make yourself at home <ArrowRight size={12} />
            </button>
          </div>
          <img
            src="/orbit-hero.svg"
            alt="A lavender planet with connected community satellites"
            className="orbit-float pointer-events-none absolute -right-9 -top-6 h-[222px] w-[482px] max-w-none opacity-70 sm:right-0 sm:opacity-100 md:right-0 xl:right-9"
          />
          <div className="absolute bottom-0 right-0 h-full w-1/2 bg-gradient-to-r from-[#f0ebf8] to-transparent opacity-50 sm:hidden" />
        </div>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3.5 xl:grid-cols-4">
        {[
          {
            icon: UsersRound,
            bg: "bg-violet-50 dark:bg-violet-500/10",
            color: "text-violet-400",
            change: "+8.2%",
            spark: [11, 16, 12, 22, 18, 25, 23, 32],
          },
          {
            icon: Activity,
            bg: "bg-blue-50 dark:bg-blue-500/10",
            color: "text-blue-400",
            change: "+12.4%",
            spark: [10, 12, 21, 17, 26, 22, 29, 32],
          },
          {
            icon: Command,
            bg: "bg-[#fdf3e7] dark:bg-amber-500/10",
            color: "text-[#d8ad6c]",
            change: "+18.6%",
            spark: [14, 17, 12, 25, 21, 26, 29, 33],
          },
          {
            icon: HeartPulse,
            bg: "bg-[#edf6f0] dark:bg-emerald-500/10",
            color: "text-[#7bb69a]",
            change: "All systems go",
            spark: [],
          },
        ].map((m, i) => (
          <Card className="relative overflow-hidden p-4" key={i}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">
                {metricLabels[i]}
              </span>
              <span
                className={cn(
                  "flex size-7 items-center justify-center rounded-lg",
                  m.bg,
                  m.color
                )}
              >
                <m.icon size={14} strokeWidth={1.7} />
              </span>
            </div>
            <div className="mt-1 flex items-end justify-between gap-1">
              <div>
                <p className="text-[26px] font-semibold tracking-[-1px] tabular-nums">
                  {metricValues[i]}
                </p>
                <p className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground">
                  {i < 3 ? (
                    <>
                      <span className="flex items-center text-[#6aa68a]">
                        <TrendingUp size={10} className="mr-0.5" />
                        {data.demo ? m.change : "—"}
                      </span>
                      <span className="ml-0.5 hidden sm:inline">
                        {data.demo ? "vs. previous period" : "this workspace"}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="size-1 rounded-full bg-emerald-400" />
                      <span>
                        {online
                          ? "All systems operational"
                          : "Awaiting connection"}
                      </span>
                    </>
                  )}
                </p>
              </div>
              {i < 3 && (
                <Sparkline
                  values={m.spark}
                  color={i === 0 ? "#ab94df" : i === 1 ? "#a0b8e1" : "#e1bc88"}
                />
              )}
            </div>
          </Card>
        ))}
      </div>
      {config.dashboard.showActivity && (
        <div className="mb-7 grid gap-5 xl:grid-cols-[minmax(0,1fr)_285px]">
          <ActivityChart range={range} />
          <Card className="flex flex-col">
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
              <h2 className="text-[12px] font-semibold">Bot status</h2>
              <Badge tone={online ? "green" : "amber"}>
                <span
                  className={cn(
                    "size-1 rounded-full",
                    online ? "bg-emerald-500" : "bg-amber-500"
                  )}
                />
                {online ? "Online" : "Connecting"}
              </Badge>
            </div>
            <div className="flex items-center gap-3.5 px-5 pb-4 pt-5">
              <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-primary dark:border-violet-500/20 dark:bg-violet-500/10">
                <Orbit size={25} strokeWidth={1.4} />
                <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card bg-emerald-400" />
              </div>
              <div>
                <p className="text-[12px] font-semibold">
                  {online
                    ? "Orbit is in good spirits."
                    : "Orbit is getting connected."}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {data.demo
                    ? "Simulated services. Real possibilities."
                    : "Keeping things running smoothly."}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x border-y border-border/70 px-5 py-3">
              <div>
                <p className="text-[9px] text-muted-foreground">
                  Gateway latency
                </p>
                <p className="mt-1 text-[14px] font-semibold">
                  {data.health.find((h) => h.name === "Discord API")?.latency ??
                    0}
                  <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">
                    ms
                  </span>
                </p>
              </div>
              <div className="pl-5">
                <p className="text-[9px] text-muted-foreground">
                  Last heartbeat
                </p>
                <p className="mt-1 text-[14px] font-semibold">
                  {online ? "Just now" : "Unavailable"}
                </p>
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              {data.health.slice(0, 3).map((h, i) => {
                const Icon = [Radio, Database, Workflow][i];
                return (
                  <div
                    className="flex items-center justify-between text-[10px]"
                    key={h.name}
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Icon size={12} />
                      {h.name}
                    </span>
                    <span
                      className={cn(
                        "flex items-center gap-1.5",
                        h.status === "healthy"
                          ? "text-[#77a68e]"
                          : "text-amber-500"
                      )}
                    >
                      <span
                        className={cn(
                          "size-1 rounded-full",
                          h.status === "healthy"
                            ? "bg-[#8abd9f]"
                            : "bg-amber-400"
                        )}
                      />
                      {h.status === "healthy"
                        ? "Connected"
                        : h.status === "degraded"
                          ? "Degraded"
                          : "Offline"}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setStatus(true)}
              className="mt-auto flex items-center justify-center gap-2 border-t bg-muted/20 px-5 py-3 text-[10px] font-medium text-muted-foreground transition hover:text-primary"
            >
              View connection details <ArrowUpRight size={11} />
            </button>
          </Card>
        </div>
      )}
      {config.dashboard.showToolkit && (
        <section className="mb-7">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">
                Your community toolkit
              </h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                A little structure. A lot more possibility.
              </p>
            </div>
            <button
              onClick={() => navigate("settings")}
              className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-primary"
            >
              Manage modules
              <ArrowUpRight size={12} />
            </button>
          </div>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {modules.map((m) => (
              <Card
                className={cn(
                  "group px-4 py-4 transition hover:border-violet-200 dark:hover:border-violet-500/30",
                  !config.modules[m.key] && "opacity-70"
                )}
                key={m.key}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "flex size-[33px] items-center justify-center rounded-[10px]",
                      m.bg,
                      m.color
                    )}
                  >
                    <m.icon size={17} strokeWidth={1.6} />
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] text-muted-foreground">
                      {config.modules[m.key] ? "Enabled" : "Paused"}
                    </span>
                    <Switch
                      aria-label={`${config.modules[m.key] ? "Disable" : "Enable"} ${m.name}`}
                      checked={config.modules[m.key]}
                      disabled={toggling === m.key}
                      onCheckedChange={(v) => toggleModule(m.key, v)}
                    />
                  </div>
                </div>
                <button
                  className="mt-3.5 w-full text-left"
                  onClick={() => navigate(m.key)}
                >
                  <h3 className="flex items-center justify-between text-[12px] font-semibold">
                    {m.name}
                    <ArrowUpRight
                      size={13}
                      className="text-muted-foreground/60 transition group-hover:text-primary"
                    />
                  </h3>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {m.description}
                  </p>
                  <p className="mt-3 flex items-center gap-1.5 text-[9px] text-muted-foreground/85">
                    <span
                      className={cn(
                        "size-1 rounded-full",
                        config.modules[m.key]
                          ? "bg-emerald-400"
                          : "bg-slate-300"
                      )}
                    />
                    {counts[m.key]}
                  </p>
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <UpcomingDeliveries />
        <Card>
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
            <h2 className="text-[12px] font-semibold">Around the community</h2>
            <button
              onClick={() => navigate("audit")}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
            >
              View audit log
              <ArrowUpRight size={11} />
            </button>
          </div>
          <div className="divide-y divide-border/50 px-5">
            {data.audit.slice(0, 4).map((a, i) => (
              <div className="flex items-center gap-3 py-3.5" key={a.id}>
                <span
                  className={cn(
                    "flex size-[28px] shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                    [
                      "bg-[#f4e7db] text-[#b18d6c]",
                      "bg-violet-50 text-violet-500",
                      "bg-[#e9efdf] text-[#94a176]",
                      "bg-[#e9eff7] text-[#819bbc]",
                    ][i]
                  )}
                >
                  {a.actorName === "Orbit" ? (
                    <Orbit size={14} />
                  ) : (
                    a.actorName.slice(0, 1)
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px]">
                    <strong className="font-medium">{a.actorName}</strong>{" "}
                    <span className="text-muted-foreground">{a.action}</span>{" "}
                    {a.target}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {relativeTime(a.createdAt)}
                  </p>
                </div>
                <span className="size-1.5 rounded-full bg-violet-200 dark:bg-violet-400/30" />
              </div>
            ))}
            {!data.audit.length && (
              <p className="py-12 text-center text-xs text-muted-foreground">
                Your community’s story starts here.
              </p>
            )}
          </div>
        </Card>
      </div>
      <Dialog
        open={customize}
        onOpenChange={(open) => {
          if (!customizeBusy) setCustomize(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your overview, your way.</DialogTitle>
            <DialogDescription>
              Choose what welcomes you when you open your workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {[
              {
                key: "showHero",
                title: "A little welcome",
                text: "A calm moment before the details.",
              },
              {
                key: "showActivity",
                title: "Community activity & bot health",
                text: "The pulse of your community, at a glance.",
              },
              {
                key: "showToolkit",
                title: "Your community toolkit",
                text: "Quick access to the things that keep you connected.",
              },
            ].map((c) => (
              <div
                className="flex items-center justify-between gap-4"
                key={c.key}
              >
                <div>
                  <h3 className="text-xs font-medium">{c.title}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {c.text}
                  </p>
                </div>
                <Switch
                  aria-label={c.title}
                  disabled={customizeBusy}
                  checked={
                    config.dashboard[c.key as keyof typeof config.dashboard]
                  }
                  onCheckedChange={async (v) => {
                    setCustomizeBusy(true);
                    try {
                      await saveConfig({
                        ...config,
                        dashboard: { ...config.dashboard, [c.key]: v },
                      });
                      toast.success("Overview updated");
                    } catch (e: any) {
                      toast.error(e.message);
                    } finally {
                      setCustomizeBusy(false);
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <Button
            className="mt-7 w-full"
            disabled={customizeBusy}
            onClick={() => setCustomize(false)}
          >
            Looks like home
            <Check />
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog open={status} onOpenChange={setStatus}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Everything in its orbit</DialogTitle>
            <DialogDescription>
              {data.demo
                ? "These are simulated health checks. No live connections are made."
                : "Live service heartbeats. A service is marked offline after 2 minutes without an update."}
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {data.health.map((h) => (
              <div key={h.name} className="py-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{h.name}</span>
                  <Badge
                    tone={
                      h.status === "healthy"
                        ? "green"
                        : h.status === "offline"
                          ? "red"
                          : "amber"
                    }
                  >
                    {h.status}
                  </Badge>
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {h.detail} · {h.latency}ms · {relativeTime(h.updatedAt)}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function Sparkline({ values, color }: { values: number[]; color: string }) {
  return (
    <svg
      width="72"
      height="38"
      viewBox="0 0 72 38"
      className="mb-1 hidden shrink-0 sm:block"
      aria-hidden="true"
    >
      <path
        d={values
          .map((v, i) => `${i ? "L" : "M"}${i * 10 + 1},${40 - v}`)
          .join(" ")}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d={`${values.map((v, i) => `${i ? "L" : "M"}${i * 10 + 1},${40 - v}`).join(" ")} L71,38 L1,38Z`}
        fill={color}
        opacity=".07"
      />
    </svg>
  );
}
function curve(points: [number, number][]) {
  return points
    .map(([x, y], i) => {
      if (!i) return `M${x},${y}`;
      const prev = points[i - 1],
        before = points[i - 2] ?? prev,
        next = points[i + 1] ?? [x, y];
      return `C${prev[0] + (x - before[0]) / 6},${prev[1] + (y - before[1]) / 6} ${x - (next[0] - prev[0]) / 6},${y - (next[1] - prev[1]) / 6} ${x},${y}`;
    })
    .join(" ");
}
function ActivityChart({ range }: { range: string }) {
  const { data } = useWorkspace();
  const [metric, setMetric] = useState("Members");
  const [hover, setHover] = useState<number | null>(null);
  const factor =
    range === "Last 30 days" ? 1.35 : range === "Last 14 days" ? 1.15 : 1;
  const values = data.demo
    ? (metric === "Members"
        ? [320, 465, 390, 590, 475, 715, 640]
        : [180, 320, 240, 410, 310, 545, 460]
      ).map((v) => Math.floor(v * factor))
    : Array.from(
        { length: 7 },
        (_, i) =>
          data.ledger.filter(
            (l) =>
              l.type === "activity" &&
              new Date(l.createdAt).toDateString() ===
                new Date(Date.now() - (6 - i) * 86400000).toDateString()
          ).length
      );
  const max = data.demo ? 1000 : Math.max(10, ...values) * 1.2;
  const points = values.map((v, i): [number, number] => [
    48 + i * 88,
    180 - (v / max) * 150,
  ]);
  const line = curve(points);
  const previous = curve(
    points.map(([x, y], i) => [x, Math.min(181, y + 22 + (i % 2 ? 18 : 7))])
  );
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <div>
          <h2 className="text-[12px] font-semibold">Community activity</h2>
          <p className="mt-1 text-[10px] text-muted-foreground">
            {data.demo
              ? "A happy little corner of the internet."
              : "Rewarded activity in the past seven days."}
          </p>
        </div>
        <Select
          aria-label="Chart metric"
          value={metric}
          onChange={(e) => setMetric(e.target.value)}
          className="h-7 w-24 rounded-md px-2 text-[10px]"
        >
          <option>Members</option>
          <option>Commands</option>
        </Select>
      </div>
      <div className="ml-5 mt-2 flex gap-4 text-[9px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#a58ad7]" />
          This period
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[#d4c5ea]" />
          Previous period
        </span>
        {data.demo && (
          <span className="ml-auto mr-5 text-[7px] uppercase tracking-wider text-muted-foreground/60">
            Sample activity
          </span>
        )}
      </div>
      <div className="relative px-1 pb-0.5">
        <svg
          viewBox="0 0 640 214"
          className="block w-full"
          role="img"
          aria-label={`${metric} activity chart`}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#b197e4" stopOpacity=".19" />
              <stop offset="1" stopColor="#b197e4" stopOpacity=".015" />
            </linearGradient>
          </defs>
          {[0, 250, 500, 750, 1000].map((n, i) => (
            <g key={n}>
              <line
                x1="48"
                x2="598"
                y1={180 - i * 37.5}
                y2={180 - i * 37.5}
                stroke="currentColor"
                className="text-border"
                strokeDasharray={i === 0 ? "0" : "3 4"}
                strokeWidth=".7"
              />
              <text
                x="30"
                y={183 - i * 37.5}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize="8"
              >
                {Math.round((n / 1000) * max)}
              </text>
            </g>
          ))}
          <path d={`${line} L576,180 L48,180Z`} fill="url(#activityFill)" />
          <path
            d={previous}
            fill="none"
            stroke="#d3c6e7"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          <path d={line} fill="none" stroke="#a48ad5" strokeWidth="2" />
          {points.map(([x, y], i) => (
            <g key={i}>
              <text
                x={x}
                y="204"
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="8"
              >
                {new Date(Date.now() - (6 - i) * 86400000).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric" }
                )}
              </text>
              <rect
                x={x - 40}
                y="10"
                width="80"
                height="174"
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
              {hover === i && (
                <>
                  <line
                    x1={x}
                    y1="21"
                    x2={x}
                    y2="180"
                    stroke="#a48ad5"
                    strokeDasharray="3 3"
                    opacity=".4"
                  />
                  <circle
                    cx={x}
                    cy={y}
                    r="4"
                    fill="#a48ad5"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <g
                    transform={`translate(${Math.max(45, Math.min(x - 29, 545))},${Math.max(2, y - 29)})`}
                  >
                    <rect width="58" height="21" rx="5" fill="#65517f" />
                    <text
                      x="29"
                      y="14"
                      textAnchor="middle"
                      fill="white"
                      fontSize="9"
                    >
                      {number(values[i])}
                    </text>
                  </g>
                </>
              )}
            </g>
          ))}
        </svg>
      </div>
    </Card>
  );
}
function UpcomingDeliveries() {
  const { data, navigate } = useWorkspace();
  const rows = data.resources
    .filter(
      (r) =>
        ((r.kind === "source" && r.data.health === "healthy") ||
          r.kind === "deal") &&
        r.enabled
    )
    .slice(0, 3);
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
        <h2 className="text-[12px] font-semibold">Coming up next</h2>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <Clock3 size={11} />
          Scheduled deliveries
        </span>
      </div>
      <div className="px-5">
        <div className="grid grid-cols-[1fr_110px_66px] border-b border-border/60 py-3 text-[9px] text-muted-foreground">
          <span>Source</span>
          <span>Destination</span>
          <span className="text-right">Next check</span>
        </div>
        {rows.map((r, i) => (
          <button
            key={r.id}
            onClick={() => navigate(r.kind === "deal" ? "deals" : "news")}
            className="grid w-full grid-cols-[1fr_110px_66px] items-center border-b border-border/50 py-3.5 text-left last:border-0"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-lg",
                  r.kind === "deal"
                    ? "bg-[#eaf6f2] text-[#7eaa9d]"
                    : "bg-[#edf2fa] text-[#7f9bc3]"
                )}
              >
                {r.kind === "deal" ? <Tags size={13} /> : <Rss size={13} />}
              </span>
              <span className="truncate text-[11px] font-medium">{r.name}</span>
            </span>
            <span className="flex items-center gap-1 truncate text-[10px] text-muted-foreground">
              <Hash size={10} />
              {data.guild.channels.find((c) => c.id === r.data.channelId)
                ?.name ?? "Not set"}
            </span>
            <span className="text-right">
              <Badge
                tone={i === 0 ? "purple" : "neutral"}
                className="text-[9px]"
              >
                {data.demo
                  ? `In ${12 + i * 15} min`
                  : `${r.data.intervalMinutes} min`}
              </Badge>
            </span>
          </button>
        ))}
        {!rows.length && (
          <div className="py-12 text-center text-xs text-muted-foreground">
            Your next update starts with a source.
            <button
              onClick={() => navigate("news")}
              className="mt-3 block w-full text-primary"
            >
              Add a news source →
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}
