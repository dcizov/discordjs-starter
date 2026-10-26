"use client";
import Link from "next/link";
import {
  Check,
  ChevronsUpDown,
  ShieldCheck,
  Plus,
  Orbit,
  LifeBuoy,
  ArrowUpRight,
  ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspace } from "../workspace";
import { IdentityImage } from "../identity/image";
import { Badge } from "../ui/primitives";
import { navigation } from "./navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
export function Sidebar({
  section,
  onNavigate,
  onHelp,
  onModeInfo,
}: {
  section: string;
  onNavigate: () => void;
  onHelp: () => void;
  onModeInfo: () => void;
}) {
  const { data } = useWorkspace();
  const enabledRuleCount = data.resources.filter(
    (resource) => resource.kind === "rule" && resource.enabled
  ).length;
  const guildHref = (id: string) => `/dashboard/${id}/overview`;
  return (
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
          <button
            aria-label={`Switch server, current: ${data.guild.name}`}
            className="mb-7 flex w-full items-center gap-2.5 rounded-xl border border-border bg-card p-2.5 text-left transition hover:bg-muted"
          >
            <IdentityImage
              id={data.guild.id}
              name={data.guild.name}
              src={data.guild.iconUrl}
              kind="guild"
              size={33}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold">
                {data.guild.name}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                {data.guild.installed ? "Orbit installed" : "Not connected"}
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
                <IdentityImage
                  id={g.id}
                  name={g.name}
                  src={g.iconUrl}
                  kind="guild"
                  size={28}
                />
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
          <DropdownMenuItem onSelect={() => onHelp()}>
            <ShieldCheck />
            Only servers you can manage
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <nav aria-label="Workspace navigation" className="flex-1 space-y-6">
        {["workspace", "server"].map((group) => (
          <div key={group}>
            <p className="mb-2.5 px-3 text-[10px] font-semibold uppercase tracking-[1.4px] text-muted-foreground">
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
                    onClick={() => onNavigate()}
                    aria-current={section === n.id ? "page" : undefined}
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
                    {n.id === "moderation" && enabledRuleCount > 0 && (
                      <span
                        aria-label={`${enabledRuleCount} enabled rule configurations; moderation ${data.guild.config.modules.moderation ? "enabled" : "paused"}`}
                        className={cn(
                          "flex size-[17px] items-center justify-center rounded text-[10px]",
                          section === n.id
                            ? "bg-violet-100 text-violet-700"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {enabledRuleCount}
                      </span>
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
          onClick={() => onHelp()}
        >
          <div className="mb-2 flex items-center justify-between">
            <LifeBuoy size={17} className="text-primary" />
            <ArrowUpRight size={13} className="text-muted-foreground" />
          </div>
          <p className="text-xs font-semibold">A little guidance?</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Good things start with a little help.
          </p>
          <span className="mt-3 inline-flex items-center gap-1 text-[11px] font-medium text-primary">
            Explore the guide <ArrowRight size={11} />
          </span>
        </button>
        <div className="flex items-center justify-between border-t px-1 pt-4">
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Orbit v1.0
          </span>
          {data.demo ? (
            <button onClick={() => onModeInfo()}>
              <Badge tone="purple" className="px-1.5 py-1 text-[9px]">
                DEMO
              </Badge>
            </button>
          ) : (
            <Badge tone="neutral" className="text-[9px]">
              LIVE
            </Badge>
          )}
        </div>
      </div>
    </>
  );
}
