"use client";
import { cn, number, relativeTime } from "@/lib/utils";

import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Command,
  Hash,
  HeartPulse,
  Orbit,
  Rss,
  Tags,
  TrendingUp,
  UsersRound,
} from "lucide-react";
import { useState } from "react";

import { ActivityChart } from "../../activity-chart";
import { PageHeader } from "../../page-header";
import { Button } from "../../ui/button";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Badge, Card } from "../../ui/primitives";

import { useWorkspace } from "../../workspace";
import { IdentityImage } from "../../identity/image";
import { OverviewToolkit } from "./toolkit";
import { ConnectionStatus } from "./connection-status";
import { OverviewPreferences } from "./preferences";
export function Overview() {
  const { data, navigate } = useWorkspace();
  const [range, setRange] = useState("Last 7 days");
  const config = data.guild.config;
  const gateway = data.health.find((health) => health.name === "Discord API");
  const online = gateway?.status === "healthy";
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
        "Recent moderation actions",
        "Bot connection",
      ];
  return (
    <>
      <PageHeader
        title="Server overview"
        description={`A little snapshot of life in ${data.guild.name}. The date range applies to the activity chart; other cards show current/recent state.`}
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
        <OverviewPreferences />
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
          {/*
            The loop lives on a dedicated wrapper: the SVG contains static blur
            and drop-shadow filters, and promoting the wrapper keeps that bitmap
            rasterized once instead of repainting the filters every frame. Only
            transform changes, so the animation stays on the compositor.
          */}
          <div className="orbit-float-wrap pointer-events-none absolute -right-9 -top-6 h-[222px] w-[482px] max-w-none sm:right-0 md:right-0 xl:right-9">
            <img
              src="/orbit-hero.svg"
              alt="A lavender planet with connected community satellites"
              width={500}
              height={230}
              decoding="async"
              className="size-full opacity-70 sm:opacity-100"
            />
          </div>
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
                        {data.demo ? (
                          <>
                            <TrendingUp size={10} className="mr-0.5" />
                            {m.change}
                          </>
                        ) : (
                          [
                            "Synced member count",
                            "Current account count",
                            "Recent 200 audit records",
                          ][i]
                        )}
                      </span>
                      <span className="ml-0.5 hidden sm:inline">
                        {data.demo ? "sample comparison" : ""}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        className={cn(
                          "size-1 rounded-full",
                          online ? "bg-emerald-400" : "bg-amber-400"
                        )}
                      />
                      <span>
                        {online
                          ? data.demo
                            ? "Sample gateway status"
                            : "Gateway connected"
                          : "Awaiting connection"}
                      </span>
                    </>
                  )}
                </p>
              </div>
              {i < 3 && data.demo && (
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
          <ConnectionStatus />
        </div>
      )}
      <OverviewToolkit />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <UpcomingDeliveries />
        <Card>
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
            <h2 className="text-xs font-semibold">Around the community</h2>
            <button
              onClick={() => navigate("audit")}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"
            >
              View audit log
              <ArrowUpRight size={11} />
            </button>
          </div>
          <div className="divide-y divide-border/50 px-5">
            {data.audit.slice(0, 4).map((a) => (
              <div className="flex items-center gap-3 py-3.5" key={a.id}>
                {a.actorName === "Orbit" ? (
                  <span className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-500 dark:bg-violet-500/10">
                    <Orbit size={14} />
                  </span>
                ) : (
                  <IdentityImage
                    id={a.actorId}
                    name={a.actorName}
                    src={a.actorAvatarUrl}
                    kind="user"
                    size={28}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px]">
                    <strong className="font-medium">{a.actorName}</strong>{" "}
                    <span className="text-muted-foreground">{a.action}</span>{" "}
                    {a.target}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {relativeTime(a.createdAt, data.presentation.referenceAt)}
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
        <h2 className="text-xs font-semibold">Coming up next</h2>
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
