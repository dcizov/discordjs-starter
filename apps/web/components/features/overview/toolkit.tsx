"use client";
import { useState } from "react";
import type { ModuleKey } from "@orbit/core";
import { moduleSetup } from "@orbit/core/module-setup";
import {
  ArrowUpRight,
  Music2,
  Rss,
  ShieldCheck,
  Sparkles,
  Tags,
  UsersRound,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { cn, number } from "@/lib/utils";
import { useWorkspace } from "../../workspace";
import { Badge, Card, FormSelect } from "../../ui/primitives";
import { Switch } from "../../ui/switch";
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
    color: "text-violet-600 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-500/10",
  },
  {
    key: "moderation",
    name: "Moderation",
    description: "A safer space, a lighter workload.",
    icon: ShieldCheck,
    color: "text-orange-700 dark:text-orange-300",
    bg: "bg-[#fcf1e8] dark:bg-orange-500/10",
  },
  {
    key: "economy",
    name: "Economy",
    description: "Give a little. Grow a lot.",
    icon: Wallet,
    color: "text-amber-700 dark:text-amber-300",
    bg: "bg-[#fbf5df] dark:bg-amber-500/10",
  },
  {
    key: "music",
    name: "Music",
    description: "The soundtrack to your community.",
    icon: Music2,
    color: "text-rose-700 dark:text-rose-300",
    bg: "bg-[#fceef2] dark:bg-pink-500/10",
  },
  {
    key: "deals",
    name: "Game deals",
    description: "Good games. Even better prices.",
    icon: Tags,
    color: "text-teal-700 dark:text-teal-300",
    bg: "bg-[#eaf6f2] dark:bg-emerald-500/10",
  },
  {
    key: "news",
    name: "News & feeds",
    description: "Keep your corner in the know.",
    icon: Rss,
    color: "text-sky-700 dark:text-sky-300",
    bg: "bg-[#edf3fc] dark:bg-blue-500/10",
  },
  {
    key: "polls",
    name: "Native polls",
    description: "A clear question, native Discord votes.",
    icon: UsersRound,
    color: "text-violet-600 dark:text-violet-300",
    bg: "bg-violet-50 dark:bg-violet-500/10",
  },
  {
    key: "announcements",
    name: "Announcements",
    description: "One notice, deliberately scheduled.",
    icon: Rss,
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-500/10",
  },
  {
    key: "xp",
    name: "Leveling",
    description: "XP and levels, kept apart from currency.",
    icon: Sparkles,
    color: "text-amber-600 dark:text-amber-300",
    bg: "bg-amber-50 dark:bg-amber-500/10",
  },
];
export function OverviewToolkit() {
  const { data, navigate, saveConfig } = useWorkspace();
  const [moduleFilter, setModuleFilter] = useState("all");
  const [toggling, setToggling] = useState<ModuleKey | null>(null);
  const config = data.guild.config;
  const setups = Object.fromEntries(
    modules.map((item) => [item.key, moduleSetup(data, item.key)])
  ) as Record<ModuleKey, ReturnType<typeof moduleSetup>>;
  const visibleModules = modules.filter(
    (item) =>
      moduleFilter === "all" ||
      (moduleFilter === "enabled"
        ? config.modules[item.key]
        : setups[item.key].state === moduleFilter)
  );
  const counts = {
    polls: "Native votes stay on Discord",
    announcements: "One-time notices, explicit approval",
    roles: `${data.resources.filter((r) => r.kind === "panel" && r.enabled).length} active panels`,
    moderation: `${data.resources.filter((r) => r.kind === "rule" && r.enabled).length} rules keeping watch`,
    economy: `${number(data.stats?.circulation ?? data.accounts.reduce((n, a) => n + a.balance, 0))} ${config.economy.currency.toLowerCase()} in circulation`,
    music: data.music.current
      ? "Something good is playing"
      : setups.music.state === "configured"
        ? "Configured · live audio not verified"
        : setups.music.label,
    deals: `${data.resources.filter((r) => r.kind === "deal" && r.enabled).length} active subscriptions`,
    news: `${data.resources.filter((r) => r.kind === "source").length} sources, one home for updates`,
    tickets: config.tickets.enabled
      ? "Private support, one channel per person"
      : "Private support, switched off",
    xp: config.xp.rewards.length
      ? `${config.xp.rewards.length} level ${config.xp.rewards.length === 1 ? "reward" : "rewards"} configured`
      : "Levels earned, no rewards set yet",
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Module update failed");
    } finally {
      setToggling(null);
    }
  }

  if (!config.dashboard.showToolkit) return null;
  return (
    <section className="mb-7">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Your community toolkit</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {modules.filter((item) => config.modules[item.key]).length} enabled
            ·{" "}
            {
              modules.filter((item) => setups[item.key].state === "needs-setup")
                .length
            }{" "}
            need setup. Configuration is not proof of live service health.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <FormSelect
            aria-label="Filter module setup"
            value={moduleFilter}
            onValueChange={setModuleFilter}
            className="h-8 w-36 text-[10px]"
            options={[
              { value: "all", label: "All modules" },
              { value: "enabled", label: "Enabled" },
              { value: "needs-setup", label: "Needs setup" },
              { value: "not-verified", label: "Not verified" },
              { value: "paused", label: "Paused" },
            ]}
          />
          <button
            onClick={() => navigate("settings")}
            className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground hover:text-primary"
          >
            Manage modules
            <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {visibleModules.map((m) => (
          <Card
            className={cn(
              "group px-4 py-4 transition hover:border-violet-200 dark:hover:border-violet-500/30",
              // A paused module keeps full contrast: dimming the whole card made
              // its own status text fail 4.5:1 and said "disabled" with opacity
              // alone.
              !config.modules[m.key] && "border-dashed bg-muted/30"
            )}
            key={m.key}
            data-module-card={m.key}
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
                <span className="text-[10px] font-medium text-muted-foreground">
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
              <h3 className="flex items-center justify-between text-xs font-semibold">
                {m.name}
                <ArrowUpRight
                  size={13}
                  className="text-muted-foreground transition group-hover:text-primary"
                />
              </h3>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {m.description}
              </p>
              <div className="mt-3">
                <Badge
                  tone={
                    setups[m.key].state === "needs-setup"
                      ? "amber"
                      : setups[m.key].state === "configured"
                        ? "green"
                        : "neutral"
                  }
                >
                  {setups[m.key].label}
                </Badge>
              </div>
              <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
                {setups[m.key].detail}
              </p>
              <p className="mt-3 flex items-center gap-1.5 text-[9px] text-muted-foreground">
                <span
                  className={cn(
                    "size-1 rounded-full",
                    config.modules[m.key] ? "bg-emerald-400" : "bg-slate-300"
                  )}
                />
                {counts[m.key]}
              </p>
            </button>
          </Card>
        ))}
      </div>
      {!visibleModules.length && (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
          No modules match this setup filter.
        </p>
      )}
    </section>
  );
}
