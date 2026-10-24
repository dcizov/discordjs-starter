"use client";
import { waitForBotAction } from "@orbit/core/bot-actions";
import { cn, relativeTime, request } from "@/lib/utils";
import type { DashboardData, GuildConfig } from "@orbit/core";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Command,
  FlaskConical,
  LifeBuoy,
  LogOut,
  Menu,
  Moon,
  Orbit,
  Plus,
  Search,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CommandsPage } from "./commands-page";
import { EconomyPage } from "./economy-page";
import { MusicPage } from "./music-page";
import { navigation } from "./navigation";
import { Overview } from "./overview";
import { ResourcesPage } from "./resources-page";
import { AuditPage, ChannelsPage, SettingsPage } from "./server-pages";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Badge, Input } from "./ui/primitives";
import { WorkspaceContext } from "./workspace";
export function Dashboard({
  initial,
  section,
}: {
  initial: DashboardData;
  section: string;
}) {
  const [data, setData] = useState(initial);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [mobile, setMobile] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [notifications, setNotifications] = useState(false);
  const [demoInfo, setDemoInfo] = useState(false);
  const [banner, setBanner] = useState(true);
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const current = navigation.find((n) => n.id === section) ?? navigation[0];
  useEffect(() => {
    setData(initial);
  }, [initial]);
  const api = useCallback(
    async <T = any,>(
      path: string,
      method = "GET",
      body?: unknown,
      headers?: Record<string, string>
    ): Promise<T> => {
      const base = `/api/guilds/${data.guild.id}`;
      const result = await request<any>(
        `${base}${path}`,
        method,
        body,
        headers
      );
      if (result?.jobId && method === "POST") {
        const job = await waitForBotAction(result.jobId, () =>
          request(`${base}/actions/${encodeURIComponent(result.jobId)}`)
        );
        return { ...result, completed: true, result: job.result };
      }
      return result;
    },
    [data.guild.id]
  );
  const refresh = useCallback(async () => {
    const d = await api<DashboardData>("");
    setData(d);
  }, [api]);
  const navigate = useCallback(
    (s: string) => {
      router.push(`/dashboard/${data.guild.id}/${s}`);
      setMobile(false);
    },
    [router, data.guild.id]
  );
  const saveConfig = useCallback(
    async (config: GuildConfig, optimistic = true) => {
      const before = data.guild.config;
      if (optimistic) setData((d) => ({ ...d, guild: { ...d.guild, config } }));
      try {
        await api("/config", "PATCH", config);
        if (!optimistic) await refresh();
      } catch (e) {
        setData((d) => ({ ...d, guild: { ...d.guild, config: before } }));
        throw e;
      }
    },
    [api, data.guild.config, refresh]
  );
  useEffect(() => {
    if (!data.guild.installed) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh, data.guild.installed]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearch((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const guildHref = (id: string) => `/dashboard/${id}/overview`;
  const sidebar = (
    <>
      <Link
        prefetch={false}
        href="/"
        className="mb-8 ml-3 flex w-fit items-center gap-2.5"
        aria-label="Orbit home"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-primary text-white shadow-sm shadow-violet-300/40">
          <Orbit size={23} strokeWidth={1.7} />
        </span>
        <span className="text-[26px] font-semibold tracking-[-1.5px]">
          orbit<span className="text-primary">.</span>
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="mb-7 flex w-full items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition hover:bg-muted">
            <ServerIcon name={data.guild.name} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-semibold">
                {data.guild.name}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                {data.guild.installed ? "Community server" : "Not connected"}
              </span>
            </span>
            <ChevronsUpDown size={13} className="text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <p className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Your communities
          </p>
          {data.guilds.map((g) => (
            <DropdownMenuItem key={g.id} asChild>
              <Link prefetch={false} href={guildHref(g.id)}>
                <ServerIcon name={g.name} small />
                <span className="flex-1">
                  {g.name}
                  {!g.installed && (
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      Invite Orbit to get started
                    </span>
                  )}
                </span>
                {g.id === data.guild.id ? (
                  <Check size={14} className="text-primary" />
                ) : !g.installed ? (
                  <Plus size={14} />
                ) : null}
              </Link>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setHelp(true)}>
            <ShieldCheck />
            Only servers you can manage
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <nav className="flex-1 space-y-6">
        {["workspace", "server"].map((group) => (
          <div key={group}>
            <p className="mb-2.5 px-3 text-[10px] font-semibold uppercase tracking-[1.4px] text-muted-foreground/70">
              {group === "workspace" ? "Workspace" : "Server management"}
            </p>
            <div className="space-y-1">
              {navigation
                .filter((n) => n.group === group)
                .map((n) => (
                  <Link
                    prefetch={false}
                    key={n.id}
                    href={`/dashboard/${data.guild.id}/${n.id}`}
                    onClick={() => setMobile(false)}
                    className={cn(
                      "group relative flex h-[38px] items-center gap-3 rounded-lg px-3 text-[12px] font-medium transition-colors",
                      section === n.id
                        ? "bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <n.icon
                      size={16}
                      strokeWidth={1.7}
                      className={
                        section === n.id
                          ? "text-violet-500"
                          : "text-muted-foreground/85"
                      }
                    />
                    <span className="flex-1">{n.label}</span>
                    {n.id === "moderation" &&
                      data.resources.filter(
                        (r) => r.kind === "rule" && r.enabled
                      ).length > 0 && (
                        <span
                          className={cn(
                            "flex size-[17px] items-center justify-center rounded text-[10px]",
                            section === n.id
                              ? "bg-violet-100 text-violet-500"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {
                            data.resources.filter(
                              (r) => r.kind === "rule" && r.enabled
                            ).length
                          }
                        </span>
                      )}
                    {n.id === "news" && (
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                    )}
                  </Link>
                ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-8 space-y-4">
        <button
          className="w-full rounded-xl border border-border bg-gradient-to-br from-violet-50/80 to-card p-3.5 text-left dark:from-violet-500/5"
          onClick={() => setHelp(true)}
        >
          <div className="mb-2 flex items-center justify-between">
            <LifeBuoy size={17} className="text-primary" />
            <ArrowUpRight size={13} className="text-muted-foreground" />
          </div>
          <p className="text-[12px] font-semibold">A little guidance?</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Good things start with a little help.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            Explore the guide <ArrowRight size={11} />
          </span>
        </button>
        <div className="flex items-center justify-between border-t px-1 pt-4">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-400" />
            Orbit v1.0
          </span>
          {data.demo ? (
            <button onClick={() => setDemoInfo(true)}>
              <Badge tone="purple" className="px-1.5 py-1 text-[9px]">
                DEMO
              </Badge>
            </button>
          ) : (
            <Badge tone="green" className="text-[9px]">
              LIVE
            </Badge>
          )}
        </div>
      </div>
    </>
  );
  return (
    <WorkspaceContext.Provider
      value={{ data, setData, api, refresh, saveConfig, navigate }}
    >
      <div className="min-h-screen" inert={!hydrated} data-hydrated={hydrated}>
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col overflow-y-auto border-r border-border bg-card px-4 pb-5 pt-7 lg:flex">
          {sidebar}
        </aside>
        {mobile && (
          <div
            className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
            onClick={() => setMobile(false)}
          >
            <aside
              className="absolute inset-y-0 left-0 flex w-[250px] flex-col overflow-y-auto bg-card px-4 pb-5 pt-7"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="absolute right-4 top-5 p-2 text-muted-foreground"
                aria-label="Close navigation"
                onClick={() => setMobile(false)}
              >
                <X size={18} />
              </button>
              {sidebar}
            </aside>
          </div>
        )}
        <div className="lg:ml-[224px]">
          <header className="sticky top-0 z-20 flex h-[65px] items-center justify-between border-b border-border bg-card/95 px-5 backdrop-blur-lg md:px-8">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={20} />
              </Button>
              <span className="hidden text-[12px] text-muted-foreground sm:block">
                Workspace
              </span>
              <ChevronRight
                size={12}
                className="hidden text-muted-foreground/60 sm:block"
              />
              <span className="text-[12px] font-medium">{current.label}</span>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <span className="mr-3 hidden items-center gap-1.5 text-[11px] text-muted-foreground xl:flex">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    data.health.length > 0 &&
                      data.health.every((h) => h.status === "healthy")
                      ? "bg-emerald-400"
                      : "bg-amber-400"
                  )}
                />
                {data.health.length > 0 &&
                data.health.every((h) => h.status === "healthy")
                  ? "All systems operational"
                  : data.health.length
                    ? "Some services need attention"
                    : "Status not reported"}
              </span>
              <button
                aria-label="Search dashboard"
                onClick={() => setSearch(true)}
                className="hidden items-center gap-6 rounded-md border px-2.5 py-1.5 text-muted-foreground md:flex"
              >
                <Search size={13} />
                <span className="flex items-center gap-0.5 text-[10px]">
                  <Command size={10} />K
                </span>
              </button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Toggle color theme"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                <Sun className="dark:hidden" size={16} />
                <Moon className="hidden dark:block" size={16} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Notifications"
                className="relative"
                onClick={() => setNotifications(true)}
              >
                <Bell size={16} />
                {data.audit.length > 0 && (
                  <span className="absolute right-2 top-1.5 size-1 rounded-full bg-primary ring-2 ring-card" />
                )}
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex items-center gap-2.5"
                    aria-label="Account menu"
                  >
                    <span className="flex size-[30px] items-center justify-center rounded-full border border-[#e6d5bb] bg-[#f3e7d4] text-[10px] font-semibold text-[#927552]">
                      {data.user.name
                        .split(" ")
                        .map((s) => s[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <ChevronDown
                      size={12}
                      className="hidden text-muted-foreground sm:block"
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <div className="px-3 py-2">
                    <p className="text-xs font-semibold">{data.user.name}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {data.demo ? "Demo administrator" : "Discord account"}
                    </p>
                  </div>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDemoInfo(true)}>
                    <ShieldCheck />
                    Privacy & permissions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={async () => {
                      try {
                        await request("/api/auth/logout", "POST", {});
                        router.push("/login");
                      } catch (e: any) {
                        toast.error(e.message);
                      }
                    }}
                  >
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="mx-auto max-w-[1600px] px-5 pb-8 pt-6 md:px-8 md:pt-6 xl:px-9">
            {data.demo && banner && (
              <div className="mb-6 flex min-h-[34px] items-center justify-between gap-3 rounded-lg border border-violet-200/40 bg-[#f1edfc] px-3.5 py-2 dark:border-violet-500/20 dark:bg-violet-500/10">
                <span className="flex items-center gap-2 text-[11px] text-[#8b75b3] dark:text-violet-300">
                  <FlaskConical size={13} className="text-violet-500" />
                  <span>
                    <strong className="font-medium text-violet-600 dark:text-violet-300">
                      A little space to explore.
                    </strong>
                    <span className="hidden sm:inline">
                      {" "}
                      You’re in a demo workspace. Your changes are saved, not
                      sent.
                    </span>
                  </span>
                </span>
                <div className="flex shrink-0 items-center gap-4">
                  <button
                    className="text-[10px] font-medium text-violet-500 hover:underline"
                    onClick={() => setDemoInfo(true)}
                  >
                    About demo mode{" "}
                    <ArrowUpRight className="ml-0.5 inline" size={10} />
                  </button>
                  <button
                    aria-label="Dismiss demo notice"
                    onClick={() => setBanner(false)}
                    className="text-violet-400"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )}
            {!data.guild.installed ? (
              <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
                <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-violet-100 text-violet-500">
                  <Orbit size={42} />
                </div>
                <Badge tone="purple">A new orbit awaits</Badge>
                <h1 className="mt-4 text-3xl font-semibold">
                  Let’s connect {data.guild.name}.
                </h1>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  Invite Orbit to give your community a little more structure, a
                  lot more possibilities, and a home for all the details.
                </p>
                <Button
                  className="mt-7"
                  onClick={async () => {
                    if (data.demo) {
                      toast.info(
                        "Invites are disabled in demo mode. Choose The Cozy Corner to explore."
                      );
                      return;
                    }
                    try {
                      const r = await api("/invite");
                      if (r.url) window.location.href = r.url;
                      else
                        toast.error(
                          "The Discord application ID is not configured."
                        );
                    } catch (e: any) {
                      toast.error(e.message);
                    }
                  }}
                >
                  <Plus />
                  Invite Orbit to your server
                  <ArrowUpRight />
                </Button>
                <p className="mt-4 text-[11px] text-muted-foreground">
                  No Administrator permission requested. You choose what Orbit
                  can do.
                </p>
              </div>
            ) : (
              <div className="page-enter" key={section}>
                {section === "overview" ? (
                  <Overview />
                ) : section === "economy" ? (
                  <EconomyPage />
                ) : section === "music" ? (
                  <MusicPage />
                ) : section === "commands" ? (
                  <CommandsPage />
                ) : section === "channels" ? (
                  <ChannelsPage />
                ) : section === "audit" ? (
                  <AuditPage />
                ) : section === "settings" ? (
                  <SettingsPage />
                ) : ["roles", "moderation", "deals", "news"].includes(
                    section
                  ) ? (
                  <ResourcesPage
                    section={
                      section as "roles" | "moderation" | "deals" | "news"
                    }
                  />
                ) : (
                  <Overview />
                )}
              </div>
            )}
            <footer className="mt-8 flex items-center justify-between border-t border-border/80 pt-5 text-[10px] text-muted-foreground/75">
              <span>Made for the people who bring people together.</span>
              <button
                className="flex items-center gap-1.5 hover:text-primary"
                onClick={() => setHelp(true)}
              >
                A little help? <ArrowUpRight size={11} />
              </button>
            </footer>
          </main>
        </div>
        <Dialog open={search} onOpenChange={setSearch}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Find your way around</DialogTitle>
              <DialogDescription>
                Your community, one shortcut away.
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search
                className="absolute left-3 top-3 text-muted-foreground"
                size={16}
              />
              <Input
                autoFocus
                placeholder="Search pages and configuration…"
                className="pl-10"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div className="mt-3 space-y-1">
              {navigation
                .filter((n) =>
                  n.label.toLowerCase().includes(searchTerm.toLowerCase())
                )
                .map((n) => (
                  <button
                    key={n.id}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      navigate(n.id);
                      setSearch(false);
                      setSearchTerm("");
                    }}
                  >
                    <n.icon size={16} className="text-primary" />
                    {n.label}
                    <ArrowRight
                      size={13}
                      className="ml-auto text-muted-foreground"
                    />
                  </button>
                ))}
              {!navigation.some((n) =>
                n.label.toLowerCase().includes(searchTerm.toLowerCase())
              ) && (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No pages found. Try “roles” or “news”.
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={notifications} onOpenChange={setNotifications}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Around your community</DialogTitle>
              <DialogDescription>
                The little things that keep everything moving.
              </DialogDescription>
            </DialogHeader>
            <div className="divide-y">
              {data.audit.slice(0, 6).map((a) => (
                <div key={a.id} className="flex gap-3 py-4">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-primary/60" />
                  <div>
                    <p className="text-xs">
                      <span className="font-medium">{a.actorName}</span>{" "}
                      {a.action} {a.target}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {a.detail}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      {relativeTime(a.createdAt, data.presentation.referenceAt)}
                    </p>
                  </div>
                </div>
              ))}
              {!data.audit.length && (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  All quiet for now. New activity will show up here.
                </p>
              )}
            </div>
            <Button
              variant="outline"
              className="mt-4 w-full"
              onClick={() => {
                navigate("audit");
                setNotifications(false);
              }}
            >
              View audit log
              <ArrowRight size={13} />
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog open={demoInfo} onOpenChange={setDemoInfo}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {data.demo
                  ? "A real feel. A safe little sandbox."
                  : "Your community. Your control."}
              </DialogTitle>
              <DialogDescription>
                {data.demo
                  ? "Everything you need to explore Orbit, without connecting your Discord account."
                  : "Orbit uses Discord OAuth2 to verify who can manage each server."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 text-xs leading-relaxed text-muted-foreground">
              {data.demo ? (
                <>
                  <p>
                    <strong className="text-foreground">
                      Your changes are real.
                    </strong>{" "}
                    Panels, rules, sources, settings, and the demo economy are
                    saved to this environment’s local store.
                  </p>
                  <p>
                    <strong className="text-foreground">
                      Your messages aren’t.
                    </strong>{" "}
                    No Discord messages, moderation actions, external feed
                    requests, or audio playback happen in demo mode. Health and
                    activity metrics are clearly simulated.
                  </p>
                  <p>
                    To go live, configure the environment variables in the
                    repository’s <code>.env.example</code>, start PostgreSQL and
                    Redis, and follow the deployment guide.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    Every configuration change is authorized on the server. Only
                    users with <strong>Manage Server</strong> or{" "}
                    <strong>Administrator</strong> permission can use this
                    workspace.
                  </p>
                  <p>
                    Tokens and integration credentials never leave the server.
                    Configuration changes are recorded in your audit log.
                  </p>
                </>
              )}
            </div>
            <Button className="mt-6 w-full" onClick={() => setDemoInfo(false)}>
              Got it. Let’s explore <ArrowRight />
            </Button>
          </DialogContent>
        </Dialog>
        <Dialog open={help} onOpenChange={setHelp}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>A little help getting into orbit.</DialogTitle>
              <DialogDescription>
                Start small. Make it yours. We’ll handle the busywork.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {[
                {
                  title: "1. Put your roles in order",
                  text: "Move the Orbit role above any roles you want it to assign. Privileged and integration roles are always protected.",
                  page: "roles",
                },
                {
                  title: "2. Choose what comes through",
                  text: "Connect verified RSS/Atom feeds, Steam app news, or signed webhooks. Test a source before turning on deliveries.",
                  page: "news",
                },
                {
                  title: "3. Make the rules feel like home",
                  text: "Set moderation rules, choose your audit channel, and give your moderators the right permissions.",
                  page: "moderation",
                },
              ].map((h) => (
                <button
                  key={h.title}
                  className="w-full rounded-xl border p-4 text-left transition hover:bg-muted"
                  onClick={() => {
                    navigate(h.page);
                    setHelp(false);
                  }}
                >
                  <h3 className="flex items-center justify-between text-xs font-semibold">
                    {h.title}
                    <ArrowUpRight size={13} className="text-primary" />
                  </h3>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                    {h.text}
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <BookOpen size={14} />
              Installation, deployment, API, and music setup guides are included
              in the repository.
            </p>
          </DialogContent>
        </Dialog>
      </div>
    </WorkspaceContext.Provider>
  );
}
export function ServerIcon({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-violet-200/60 bg-[#ece6fb] text-violet-500",
        small ? "size-7" : "size-[33px]"
      )}
    >
      <span className="absolute -bottom-2 -right-1 size-6 rounded-full bg-violet-300/20" />
      <span
        className={cn(
          "relative font-semibold",
          small ? "text-[12px]" : "text-[13px]"
        )}
      >
        {name
          .split(" ")
          .filter((s) => s.toLowerCase() !== "the")
          .slice(0, 2)
          .map((s) => s[0])
          .join("")}
      </span>
    </span>
  );
}
