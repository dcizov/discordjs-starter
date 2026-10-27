"use client";
import { waitForBotAction } from "@orbit/core/bot-actions";
import { request } from "@/lib/utils";
import type { DashboardData, GuildConfig } from "@orbit/core";
import { ArrowUpRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommunityPage } from "./features/community/community-page";
import { CommandsPage } from "./commands-page";
import { EconomyPage } from "./economy-page";
import { LevelingPage } from "./leveling-page";
import { MusicPage } from "./music-page";
import { Overview } from "./features/overview/overview";
import { MembersPage } from "./members-page";
import { TemplatesPage } from "./templates-page";
import { ResourcesPage } from "./resources-page";
import { AuditPage, ChannelsPage, SettingsPage } from "./server-pages";
import { WorkspaceContext } from "./workspace";
import { Sidebar } from "./layout/sidebar";
import { DashboardHeader } from "./layout/header";
import { DemoNotice } from "./layout/demo-notice";
import { InstallPrompt } from "./layout/install-prompt";
import { HelpDialog, ModeInfoDialog } from "./layout/guidance";
import { FirstVisitTour } from "./layout/first-visit-tour";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
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
  const [tourReplay, setTourReplay] = useState(0);
  const [demoInfo, setDemoInfo] = useState(false);
  const router = useRouter();
  useEffect(() => {
    setData(initial);
  }, [initial]);
  const api = useCallback(
    async <T = any,>(
      path: string,
      method = "GET",
      body?: unknown,
      headers?: Record<string, string>,
      options?: { signal?: AbortSignal; awaitJob?: boolean }
    ): Promise<T> => {
      const base = `/api/guilds/${data.guild.id}`;
      const result = await request<any>(
        `${base}${path}`,
        method,
        body,
        headers,
        options?.signal
      );
      // Most actions are short and their callers want confirmation, so waiting
      // stays the default. Long-running work (a template capture or apply) opts
      // out with `awaitJob: false` and follows the worker's own progress
      // instead: blocking here for up to 30s only to throw "still processing"
      // hid those jobs behind an error while the backend carried on without
      // the UI.
      if (result?.jobId && method === "POST" && options?.awaitJob !== false) {
        const job = await waitForBotAction(result.jobId, () =>
          request(`${base}/actions/${encodeURIComponent(result.jobId)}`)
        );
        return { ...result, completed: true, result: job.result };
      }
      return result;
    },
    [data.guild.id]
  );
  // Only the newest snapshot may replace what the visitor sees. A slow GET
  // that resolves after a newer one (a burst of music controls, a tab that
  // regains focus) must not roll the UI back to older queue state.
  const refreshSeq = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const d = await api<DashboardData>(
      section === "polls"
        ? "?community=poll"
        : section === "announcements"
          ? "?community=announcement"
          : section === "economy"
            ? "?ownLedger=true"
            : ""
    );
    if (d.user.id !== data.user.id || d.guild.id !== data.guild.id) {
      router.refresh();
      return;
    }
    if (seq !== refreshSeq.current) return;
    setData(d);
  }, [api, section, data.user.id, data.guild.id, router]);
  const navigate = useCallback(
    (s: string, query?: Record<string, string>) => {
      const search = query
        ? `?${new URLSearchParams(
            Object.entries(query).filter(([, v]) => v)
          ).toString()}`
        : "";
      router.push(`/dashboard/${data.guild.id}/${s}${search}`);
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
  // A background tab throttles timers, so reconcile as soon as it is visible
  // again instead of animating an old snapshot for another interval.
  useEffect(() => {
    if (!data.guild.installed) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, data.guild.installed]);

  const sidebar = (
    <Sidebar
      section={section}
      onNavigate={() => setMobile(false)}
      onHelp={() => setHelp(true)}
      onModeInfo={() => setDemoInfo(true)}
    />
  );
  return (
    <WorkspaceContext.Provider
      value={{ data, setData, api, refresh, saveConfig, navigate }}
    >
      <div className="min-h-screen" data-hydrated={hydrated}>
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[224px] flex-col overflow-y-auto border-r border-border bg-card px-4 pb-5 pt-7 lg:flex">
          {sidebar}
        </aside>
        {/*
          The mobile navigation is a modal dialog, not a hand-rolled overlay: it
          traps focus, closes on Escape, locks background scroll and returns
          focus to the "Open navigation" button. The desktop sidebar above is the
          same component, so the two can never list different pages.
        */}
        <Dialog open={mobile} onOpenChange={setMobile}>
          <DialogContent className="left-0 top-0 h-dvh w-[264px] max-w-[80vw] translate-x-0 translate-y-0 overflow-y-auto rounded-none rounded-r-2xl p-5">
            <DialogHeader className="sr-only mb-0 pr-0">
              <DialogTitle>Workspace navigation</DialogTitle>
              <DialogDescription>
                Every page in this community workspace.
              </DialogDescription>
            </DialogHeader>
            {sidebar}
          </DialogContent>
        </Dialog>
        <div className="lg:ml-[224px]">
          <DashboardHeader
            section={section}
            onOpenNavigation={() => setMobile(true)}
            onModeInfo={() => setDemoInfo(true)}
          />
          <main className="mx-auto max-w-[1600px] px-5 pb-8 pt-6 md:px-8 md:pt-6 xl:px-9">
            <DemoNotice onModeInfo={() => setDemoInfo(true)} />
            {!data.guild.installed ? (
              <InstallPrompt />
            ) : (
              <div className="page-enter" key={section}>
                {section === "overview" ? (
                  <Overview />
                ) : section === "members" ? (
                  <MembersPage />
                ) : section === "economy" ? (
                  <EconomyPage />
                ) : section === "xp" ? (
                  <LevelingPage />
                ) : section === "music" ? (
                  <MusicPage />
                ) : section === "polls" || section === "announcements" ? (
                  <CommunityPage
                    kind={section === "polls" ? "poll" : "announcement"}
                  />
                ) : section === "commands" ? (
                  <CommandsPage />
                ) : section === "channels" ? (
                  <ChannelsPage />
                ) : section === "templates" ? (
                  <TemplatesPage />
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
            <footer className="mt-8 flex items-center justify-between border-t border-border/80 pt-5 text-[10px] text-muted-foreground">
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
        <ModeInfoDialog open={demoInfo} onOpenChange={setDemoInfo} />
        <HelpDialog
          open={help}
          onOpenChange={setHelp}
          onReplayTour={() => {
            setHelp(false);
            setTourReplay((n) => n + 1);
          }}
        />
        {hydrated && data.guild.installed && (
          <FirstVisitTour replay={tourReplay} />
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}
