"use client";
import { waitForBotAction } from "@orbit/core/bot-actions";
import { request } from "@/lib/utils";
import type { DashboardData, GuildConfig } from "@orbit/core";
import { ArrowUpRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CommunityPage } from "./features/community/community-page";
import { CommandsPage } from "./commands-page";
import { EconomyPage } from "./economy-page";
import { MusicPage } from "./music-page";
import { Overview } from "./features/overview/overview";
import { ResourcesPage } from "./resources-page";
import { AuditPage, ChannelsPage, SettingsPage } from "./server-pages";
import { WorkspaceContext } from "./workspace";
import { Sidebar } from "./layout/sidebar";
import { DashboardHeader } from "./layout/header";
import { DemoNotice } from "./layout/demo-notice";
import { InstallPrompt } from "./layout/install-prompt";
import { HelpDialog, ModeInfoDialog } from "./layout/guidance";
import { FirstVisitTour } from "./layout/first-visit-tour";
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
    setData(d);
  }, [api, section, data.user.id, data.guild.id, router]);
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
                ) : section === "economy" ? (
                  <EconomyPage />
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
