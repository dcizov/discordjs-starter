"use client";
import { cn, number, relativeTime } from "@/lib/utils";
import type { Resource, ResourceKind, Delivery } from "@orbit/core";
import {
  ArrowRight,
  Blocks,
  Check,
  Clock3,
  Copy,
  Flame,
  FlaskConical,
  Gamepad2,
  Hash,
  Info,
  LayoutList,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Radio,
  Rss,
  Send,
  ShieldCheck,
  Snowflake,
  Tags,
  Trash2,
  UsersRound,
  Webhook,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DataTable } from "./data-table";
import { HistoryTable } from "./history-table";
import { PageHeader } from "./page-header";
import { ResourceEditor, kindNames } from "./resource-editor";
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
import {
  Badge,
  Card,
  EmptyState,
  SearchInput,
  Select,
  Spinner,
} from "./ui/primitives";
import { Switch } from "./ui/switch";
import { useWorkspace } from "./workspace";
const settings = {
  roles: {
    title: "Self roles",
    description:
      "A place for everyone. Let your members choose how they belong.",
    kind: "panel" as ResourceKind,
    action: "Create role panel",
    icon: UsersRound,
  },
  moderation: {
    title: "A safer space, together.",
    description:
      "Thoughtful boundaries. Less busywork. More room for good conversations.",
    kind: "rule" as ResourceKind,
    action: "Create automod rule",
    icon: ShieldCheck,
  },
  deals: {
    title: "Good games. Better prices.",
    description: "Keep an eye on the wishlist. We’ll keep an eye on the price.",
    kind: "deal" as ResourceKind,
    action: "Add subscription",
    icon: Tags,
  },
  news: {
    title: "Keep your corner in the know.",
    description: "The updates that matter, right where your community gathers.",
    kind: "source" as ResourceKind,
    action: "Add news source",
    icon: Rss,
  },
};
export function ResourcesPage({
  section,
}: {
  section: "roles" | "moderation" | "deals" | "news";
}) {
  const { data, api, refresh, saveConfig, navigate } = useWorkspace();
  const s = settings[section];
  const [tab, setTab] = useState("main");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [editor, setEditor] = useState<{
    kind: ResourceKind;
    resource?: Resource;
  } | null>(null);
  const [deleting, setDeleting] = useState<Resource | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [preview, setPreview] = useState<Resource | null>(null);
  const [test, setTest] = useState<any>(null);
  const [testBusy, setTestBusy] = useState<string | null>(null);
  const [webhook, setWebhook] = useState<any>(null);
  const kind = tab === "cases" ? "case" : tab === "routes" ? "route" : s.kind;
  const resources = data.resources.filter((r) => r.kind === kind);
  const rows = resources.filter(
    (r) =>
      (r.name + " " + JSON.stringify(r.data))
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" || r.enabled === (filter === "enabled"))
  );
  async function toggle(r: Resource, v: boolean) {
    try {
      await api(`/resources/${r.kind}/${r.id}`, "PATCH", {
        name: r.name,
        enabled: v,
        data: r.data,
      });
      await refresh();
      toast.success(`${r.name} ${v ? "enabled" : "paused"}`);
    } catch (e: any) {
      toast.error(e.message);
    }
  }
  async function action(r: Resource, type: string) {
    setTestBusy(r.id);
    try {
      const result = await api(
        `/resources/${r.kind}/${r.id}/${type}`,
        "POST",
        {}
      );
      if (type === "test") setTest({ name: r.name, ...result });
      else if (type === "webhook") setWebhook({ name: r.name, ...result });
      else
        toast.success(
          data.demo
            ? type === "publish"
              ? "Panel publication simulated — nothing sent to Discord."
              : "Test delivery simulated — nothing sent to Discord."
            : type === "publish"
              ? "Panel publication queued"
              : "Test delivery queued"
        );
      await refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTestBusy(null);
    }
  }
  function actions(r: Resource) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={`Actions for ${r.name}`}
          >
            {testBusy === r.id ? <Spinner /> : <MoreHorizontal size={16} />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onSelect={() => setEditor({ kind: r.kind, resource: r })}
          >
            <Pencil />
            Edit {kindNames[r.kind]}
          </DropdownMenuItem>
          {r.kind === "panel" && (
            <>
              <DropdownMenuItem onSelect={() => setPreview(r)}>
                <LayoutList />
                Preview panel
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action(r, "publish")}>
                <Send />
                {data.demo ? "Simulate publication" : "Publish to Discord"}
              </DropdownMenuItem>
            </>
          )}
          {r.kind === "source" && (
            <>
              <DropdownMenuItem onSelect={() => action(r, "test")}>
                <FlaskConical />
                Test source
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action(r, "send-test")}>
                <Send />
                Send test message
              </DropdownMenuItem>
              {r.data.adapter === "webhook" && (
                <DropdownMenuItem onSelect={() => action(r, "webhook")}>
                  <Webhook />
                  Webhook credentials
                </DropdownMenuItem>
              )}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-red-500 focus:bg-red-50 dark:focus:bg-red-500/10"
            onSelect={() => setDeleting(r)}
          >
            <Trash2 />
            Delete {kindNames[r.kind]}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <>
      <PageHeader title={s.title} description={s.description}>
        <Button
          onClick={() =>
            setEditor({ kind: tab === "routes" ? "route" : s.kind })
          }
        >
          <Plus size={15} />
          {tab === "routes" ? "Create routing rule" : s.action}
        </Button>
      </PageHeader>
      {!data.guild.config.modules[section] && (
        <div className="mb-5 flex items-center justify-between gap-4 rounded-xl border border-amber-200/60 bg-amber-50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <span className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
            <Info size={15} />
            This module is paused. Your configuration is safe, but no actions
            will run.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await saveConfig({
                  ...data.guild.config,
                  modules: { ...data.guild.config.modules, [section]: true },
                });
                toast.success("Module enabled");
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            Enable module
          </Button>
        </div>
      )}
      {(section === "moderation" || section === "news") && (
        <>
          <div className="mb-5 grid gap-3.5 sm:grid-cols-3">
            {(section === "moderation"
              ? [
                  {
                    label: "Active guardrails",
                    value: data.resources.filter(
                      (r) => r.kind === "rule" && r.enabled
                    ).length,
                    detail: "Looking out for your community",
                    icon: ShieldCheck,
                    color: "text-[#d3a170] bg-[#fcf2e8]",
                  },
                  {
                    label: "Moderation cases",
                    value: data.resources.filter((r) => r.kind === "case")
                      .length,
                    detail: "A transparent record of every action",
                    icon: MessageSquare,
                    color: "text-[#9d89cb] bg-violet-50",
                  },
                  {
                    label: "Members protected",
                    value: number(data.guild.memberCount),
                    detail: "Good conversations start with safety",
                    icon: UsersRound,
                    color: "text-[#7aa794] bg-emerald-50",
                  },
                ]
              : [
                  {
                    label: "Connected sources",
                    value: data.resources.filter(
                      (r) =>
                        r.kind === "source" &&
                        r.enabled &&
                        r.data.health === "healthy"
                    ).length,
                    detail: "Bringing the outside in",
                    icon: Rss,
                    color: "text-[#8f7bc4] bg-violet-50",
                  },
                  {
                    label: "Updates delivered",
                    value: data.deliveries.filter(
                      (d) => d.status === "delivered"
                    ).length,
                    detail: data.demo
                      ? "Simulated delivery history"
                      : "Most recent 200 delivery records",
                    icon: Send,
                    color: "text-[#7aa794] bg-emerald-50",
                  },
                  {
                    label: "Needs a little attention",
                    value: data.resources.filter(
                      (r) => r.kind === "source" && r.data.health !== "healthy"
                    ).length,
                    detail: "A quick setup goes a long way",
                    icon: FlaskConical,
                    color: "text-[#d3a170] bg-[#fcf2e8]",
                  },
                ]
            ).map((stat) => (
              <Card
                key={stat.label}
                className="flex items-center gap-4 px-5 py-4"
              >
                <span
                  className={cn(
                    "flex size-10 items-center justify-center rounded-xl dark:bg-muted",
                    stat.color
                  )}
                >
                  <stat.icon size={19} strokeWidth={1.5} />
                </span>
                <div>
                  <p className="text-[11px] text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="mt-1 text-[23px] font-semibold tracking-tight">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {stat.detail}
                  </p>
                </div>
              </Card>
            ))}
          </div>
          <div className="mb-5 flex gap-6 border-b">
            {(section === "news"
              ? [
                  { id: "main", label: "Sources" },
                  { id: "routes", label: "Routing rules" },
                  { id: "history", label: "Delivery history" },
                ]
              : [
                  { id: "main", label: "Auto moderation" },
                  { id: "cases", label: "Case history" },
                ]
            ).map((t) => (
              <button
                className={cn(
                  "relative -mb-px border-b-2 px-0.5 pb-3 pt-1 text-[12px] font-medium transition",
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
                key={t.id}
                onClick={() => {
                  setTab(t.id);
                  setQuery("");
                  setFilter("all");
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}
      {section === "deals" && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-5 py-4">
          <span className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eaf6f2] text-[#7ba99c]">
              <Tags size={18} />
            </span>
            <span>
              <p className="text-[12px] font-medium">
                Powered by IsThereAnyDeal
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Verified stores. Regional prices. No scraping, no guesswork.
              </p>
            </span>
          </span>
          <Badge
            tone={
              data.demo ? "purple" : data.integrations?.itad ? "green" : "amber"
            }
          >
            {data.demo
              ? "Demo deal subscriptions"
              : data.integrations?.itad
                ? "IsThereAnyDeal connected"
                : "API key required for live checks"}
          </Badge>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={
            tab === "history"
              ? "Search delivery history…"
              : `Search ${kindNames[kind]}s…`
          }
        />
        <Select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 w-32 text-[11px]"
        >
          <option value="all">All statuses</option>
          <option value="enabled">Enabled</option>
          <option value="paused">Paused</option>
        </Select>
      </div>
      {tab === "history" ? (
        <Card>
          <DeliveryTable query={query} filter={filter} />
        </Card>
      ) : tab === "cases" ? (
        <Card>
          <HistoryTable<Resource>
            kind="cases"
            query={query}
            filter={filter}
            columns={[
              {
                key: "name",
                label: "Case",
                render: (r) => <span className="font-medium">{r.name}</span>,
              },
              {
                key: "member",
                label: "Member",
                render: (r) => (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {r.data.targetId}
                  </span>
                ),
              },
              {
                key: "type",
                label: "Action",
                render: (r) => (
                  <Badge
                    tone={
                      r.data.type === "timeout"
                        ? "amber"
                        : r.data.type === "ban"
                          ? "red"
                          : "purple"
                    }
                  >
                    {r.data.type}
                  </Badge>
                ),
              },
              {
                key: "reason",
                label: "Reason",
                render: (r) => (
                  <span className="line-clamp-2 max-w-xs leading-relaxed">
                    {r.data.reason}
                  </span>
                ),
              },
              {
                key: "when",
                label: "Created",
                render: (r) => (
                  <span className="whitespace-nowrap text-muted-foreground">
                    {relativeTime(r.createdAt)}
                  </span>
                ),
              },
            ]}
            emptyTitle="A quiet, happy corner"
            emptyDescription="Moderation actions taken with slash commands or automod will appear here. Cases are append-only for a trustworthy audit trail."
          />
        </Card>
      ) : !rows.length ? (
        <Card>
          <EmptyState
            icon={s.icon}
            title={
              query
                ? "Nothing quite matches."
                : `Your first ${kindNames[kind]} starts here.`
            }
            description={
              query
                ? "Try a different search or filter. A fresh perspective can help."
                : section === "roles"
                  ? "Give your members a simple way to choose their interests, notifications, and little corners of the community."
                  : "A few thoughtful settings are all it takes. Let’s get something good going."
            }
            action={
              <Button onClick={() => setEditor({ kind })}>
                <Plus />
                Create {kindNames[kind]}
              </Button>
            }
          />
        </Card>
      ) : section === "roles" ? (
        <div className="grid gap-5 md:grid-cols-2">
          {rows.map((r) => (
            <Card key={r.id} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-violet-50 text-violet-400 dark:bg-violet-500/10">
                    <UsersRound size={16} />
                  </span>
                  <div>
                    <h2 className="text-xs font-semibold">{r.name}</h2>
                    <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Hash size={10} />
                      {data.guild.channels.find(
                        (c) => c.id === r.data.channelId
                      )?.name ?? "No destination"}
                    </p>
                  </div>
                </div>
                {actions(r)}
              </div>
              <div className="mx-5 mb-3 mt-5 rounded-lg border bg-muted/20 p-4">
                <div className="flex gap-2">
                  <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Radio size={13} />
                  </div>
                  <div>
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold">
                      Orbit{" "}
                      <span className="rounded bg-violet-400 px-1 py-0.5 text-[6px] font-normal text-white">
                        APP
                      </span>
                    </p>
                    <div className="mt-2 border-l-[3px] border-violet-300 pl-3">
                      <p className="text-[12px] font-semibold">{r.name}</p>
                      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {r.data.description}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(r.data.roleIds as string[]).map((id, i) => {
                        const role = data.guild.roles.find(
                          (role) => role.id === id
                        );
                        return (
                          <span
                            key={id}
                            className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[10px] text-muted-foreground"
                          >
                            {r.data.emojis?.[i] ?? (
                              <span
                                className="size-1.5 rounded-full"
                                style={{ background: role?.color ?? "#aaa" }}
                              />
                            )}
                            {role?.name ?? "Deleted role"}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between px-5 pb-4">
                <span className="flex items-center gap-2 text-[9px] text-muted-foreground">
                  <Badge tone="purple" className="text-[9px]">
                    {r.data.mode === "select"
                      ? "Select menu"
                      : r.data.mode === "reaction"
                        ? "Reactions"
                        : "Buttons"}
                  </Badge>
                  {r.data.selection === "single"
                    ? "Single select"
                    : `Up to ${r.data.maxRoles} roles`}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground">
                    {r.enabled ? "Active" : "Paused"}
                  </span>
                  <Switch
                    aria-label={`Toggle ${r.name}`}
                    checked={r.enabled}
                    onCheckedChange={(v) => toggle(r, v)}
                  />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : section === "news" && tab === "main" ? (
        <div className="grid gap-5 md:grid-cols-2">
          {rows.map((r) => {
            const Icon =
              r.data.adapter === "steam"
                ? Gamepad2
                : r.data.adapter === "blizzard"
                  ? Snowflake
                  : r.data.adapter === "wowhead"
                    ? Flame
                    : r.data.adapter === "mojang"
                      ? Blocks
                      : r.data.adapter === "webhook"
                        ? Webhook
                        : Rss;
            const healthy = r.data.health === "healthy";
            return (
              <Card key={r.id} className="p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        "flex size-11 items-center justify-center rounded-xl",
                        r.data.adapter === "mojang"
                          ? "bg-[#ecf3e8] text-[#89a47c]"
                          : r.data.adapter === "wowhead"
                            ? "bg-[#fcf0df] text-[#cba666]"
                            : r.data.adapter === "blizzard"
                              ? "bg-[#eaf3fc] text-[#7ba6ca]"
                              : "bg-[#eef0f7] text-[#8090ac]"
                      )}
                    >
                      <Icon size={23} strokeWidth={1.5} />
                    </span>
                    <div>
                      <h2 className="text-[13px] font-semibold">{r.name}</h2>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {r.data.adapter === "steam"
                          ? "Official Steam app news"
                          : r.data.adapter === "webhook"
                            ? "Signed incoming webhook"
                            : r.data.adapter === "rss"
                              ? "RSS / Atom feed"
                              : "Custom publisher feed"}
                      </p>
                    </div>
                  </div>
                  {actions(r)}
                </div>
                <div className="mt-5 flex items-center gap-2">
                  <Badge tone={healthy ? "green" : "amber"}>
                    <span
                      className={cn(
                        "size-1 rounded-full",
                        healthy ? "bg-emerald-500" : "bg-amber-500"
                      )}
                    />
                    {healthy
                      ? "Healthy"
                      : r.data.health === "degraded"
                        ? "Needs attention"
                        : "Setup required"}
                  </Badge>
                  {!r.enabled && <Badge>Paused</Badge>}
                </div>
                <p className="mt-3 line-clamp-2 min-h-[31px] text-[11px] leading-relaxed text-muted-foreground">
                  {healthy
                    ? r.data.adapter === "steam"
                      ? `App #${r.data.appId} updates, straight from the source. Kept tidy and delivered to your community.`
                      : r.data.adapter === "webhook"
                        ? "Your own integration, routed safely into Discord."
                        : r.data.url
                    : (r.data.lastError ??
                      "Add a verified RSS/Atom URL or configure a signed webhook to get started.")}
                </p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {(r.data.tags ?? []).map((tag: string) => (
                    <Badge key={tag} className="text-[9px]">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between border-t pt-3.5">
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Hash size={11} />
                    {data.guild.channels.find((c) => c.id === r.data.channelId)
                      ?.name ?? "Not routed"}
                    <span className="mx-1 text-border">·</span>
                    <Clock3 size={10} />
                    Every {r.data.intervalMinutes}m
                  </span>
                  <Switch
                    aria-label={`Toggle ${r.name}`}
                    checked={r.enabled}
                    onCheckedChange={(v) => toggle(r, v)}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-[10px]"
                    onClick={() => action(r, "test")}
                    disabled={testBusy === r.id}
                  >
                    {testBusy === r.id ? (
                      <Spinner />
                    ) : (
                      <FlaskConical size={12} />
                    )}
                    Test source
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-[10px]"
                    onClick={() =>
                      healthy
                        ? action(r, "send-test")
                        : setEditor({ kind: "source", resource: r })
                    }
                  >
                    {healthy ? (
                      <>
                        <Send size={12} />
                        Send test
                      </>
                    ) : (
                      <>
                        Finish setup
                        <ArrowRight size={12} />
                      </>
                    )}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <DataTable
            rows={rows}
            columns={
              kind === "rule"
                ? [
                    {
                      key: "name",
                      label: "Rule",
                      render: (r) => (
                        <div className="flex items-center gap-3">
                          <span className="flex size-8 items-center justify-center rounded-lg bg-[#fbf0e5] text-[#cba276]">
                            <ShieldCheck size={15} />
                          </span>
                          <div>
                            <p className="font-medium">{r.name}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {r.data.type.replace("_", " ")} ·{" "}
                              {r.data.threshold} in {r.data.windowSeconds}s
                            </p>
                          </div>
                        </div>
                      ),
                    },
                    {
                      key: "action",
                      label: "On trigger",
                      render: (r) => (
                        <Badge
                          tone={
                            r.data.action === "timeout" ? "amber" : "purple"
                          }
                        >
                          {r.data.action === "warn"
                            ? "Delete & warn"
                            : r.data.action === "timeout"
                              ? `Timeout ${r.data.durationMinutes}m`
                              : "Delete message"}
                        </Badge>
                      ),
                    },
                    {
                      key: "exempt",
                      label: "Exemptions",
                      render: (r) => (
                        <span className="text-muted-foreground">
                          {r.data.exemptRoleIds?.length ?? 0} roles ·{" "}
                          {r.data.exemptChannelIds?.length ?? 0} channels
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      label: "Active",
                      render: (r) => (
                        <Switch
                          aria-label={`Toggle ${r.name}`}
                          checked={r.enabled}
                          onCheckedChange={(v) => toggle(r, v)}
                        />
                      ),
                    },
                    {
                      key: "actions",
                      label: "",
                      render: actions,
                      className: "w-12",
                    },
                  ]
                : kind === "deal"
                  ? [
                      {
                        key: "name",
                        label: "Subscription",
                        render: (r) => (
                          <div>
                            <p className="font-medium">{r.name}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {r.data.gameId
                                ? "Game watchlist"
                                : "Curated deal feed"}{" "}
                              · {r.data.region} / {r.data.currency}
                            </p>
                          </div>
                        ),
                      },
                      {
                        key: "filters",
                        label: "Price filters",
                        render: (r) => (
                          <div className="flex flex-wrap gap-1.5">
                            <Badge tone="green">
                              ≥{r.data.minDiscount}% off
                            </Badge>
                            <Badge>
                              ≤{r.data.maxPrice} {r.data.currency}
                            </Badge>
                            {r.data.historicalLow && (
                              <Badge tone="purple">Historical low</Badge>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: "channel",
                        label: "Destination",
                        render: (r) => (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Hash size={11} />
                            {data.guild.channels.find(
                              (c) => c.id === r.data.channelId
                            )?.name ?? "Not set"}
                          </span>
                        ),
                      },
                      {
                        key: "active",
                        label: "Active",
                        render: (r) => (
                          <Switch
                            checked={r.enabled}
                            onCheckedChange={(v) => toggle(r, v)}
                            aria-label={`Toggle ${r.name}`}
                          />
                        ),
                      },
                      { key: "actions", label: "", render: actions },
                    ]
                  : [
                      {
                        key: "name",
                        label: "Routing rule",
                        render: (r) => (
                          <span className="font-medium">{r.name}</span>
                        ),
                      },
                      {
                        key: "sources",
                        label: "Sources",
                        render: (r) => (
                          <span className="text-muted-foreground">
                            {(r.data.sourceIds ?? [])
                              .map(
                                (id: string) =>
                                  data.resources.find((s) => s.id === id)
                                    ?.name ?? "Deleted source"
                              )
                              .join(", ")}
                          </span>
                        ),
                      },
                      {
                        key: "channel",
                        label: "Destination",
                        render: (r) => (
                          <span className="text-muted-foreground">
                            #
                            {data.guild.channels.find(
                              (c) => c.id === r.data.channelId
                            )?.name ?? "Not set"}
                          </span>
                        ),
                      },
                      {
                        key: "active",
                        label: "Active",
                        render: (r) => (
                          <Switch
                            checked={r.enabled}
                            onCheckedChange={(v) => toggle(r, v)}
                            aria-label={`Toggle ${r.name}`}
                          />
                        ),
                      },
                      { key: "actions", label: "", render: actions },
                    ]
            }
          />
        </Card>
      )}
      {section === "moderation" && (
        <div className="mt-5 flex items-start gap-2.5 rounded-lg border bg-card/60 px-4 py-3">
          <Info size={14} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Use <code>/warn</code>, <code>/timeout</code>, <code>/kick</code>,{" "}
            <code>/ban</code>, and <code>/purge</code> in Discord. Permissions
            and role hierarchy are always checked. Repeated warnings escalate
            according to your{" "}
            <button
              className="text-primary underline-offset-2 hover:underline"
              onClick={() => navigate("settings")}
            >
              server settings
            </button>
            .
          </p>
        </div>
      )}
      {editor && (
        <ResourceEditor
          kind={editor.kind}
          resource={editor.resource}
          onClose={() => setEditor(null)}
        />
      )}
      <Dialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o && !deleteBusy) setDeleting(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>A little less in your orbit?</DialogTitle>
            <DialogDescription>
              Delete “{deleting?.name}”? This can’t be undone. Previously
              delivered messages and audit records will stay intact.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              disabled={deleteBusy}
            >
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={deleteBusy}
              onClick={async () => {
                if (!deleting) return;
                setDeleteBusy(true);
                try {
                  await api(
                    `/resources/${deleting.kind}/${deleting.id}`,
                    "DELETE"
                  );
                  await refresh();
                  toast.success("Configuration deleted");
                  setDeleting(null);
                } catch (e: any) {
                  toast.error(e.message);
                } finally {
                  setDeleteBusy(false);
                }
              }}
            >
              {deleteBusy ? <Spinner /> : <Trash2 size={14} />}Delete
              configuration
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!test}
        onOpenChange={(o) => {
          if (!o) setTest(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{test?.name} · test flight</DialogTitle>
            <DialogDescription>
              {test?.demo
                ? "A simulated preview. No external source was fetched and nothing was sent."
                : `Source reached successfully. Found ${test?.count} recent items. Nothing has been sent to Discord.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {test?.items?.map((item: any, i: number) => (
              <div
                key={i}
                className="rounded-xl border-l-4 border-l-primary bg-muted/40 p-4"
              >
                <h3 className="text-xs font-semibold">{item.title}</h3>
                <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                  {item.summary}
                </p>
              </div>
            ))}
            {!test?.items?.length && (
              <p className="rounded-lg bg-muted p-4 text-xs text-muted-foreground">
                The source is reachable but has no recent items. Incoming
                webhooks wait for your integration to send an event.
              </p>
            )}
          </div>
          <Button className="mt-5 w-full" onClick={() => setTest(null)}>
            Looks good
            <Check size={14} />
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!webhook}
        onOpenChange={(o) => {
          if (!o) setWebhook(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Keep this little secret safe.</DialogTitle>
            <DialogDescription>
              Webhook credentials for {webhook?.name}. The secret is shown only
              now. Generating again rotates and invalidates it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-medium">Webhook endpoint</p>
              <code className="block break-all rounded-lg border bg-muted p-3 text-[12px]">
                {webhook?.url}
              </code>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium">Signing secret</p>
              <code className="block break-all rounded-lg border bg-muted p-3 text-[12px]">
                {webhook?.secret}
              </code>
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Sign <code>timestamp.rawBody</code> with HMAC-SHA256. Set{" "}
              <code>X-Orbit-Timestamp</code> and <code>X-Orbit-Signature</code>.
              Events must include a unique ID, title, URL, and optional summary.
              See docs/INTEGRATIONS.md.
            </p>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(webhook, null, 2)
                  );
                  toast.success("Credentials copied");
                } catch {
                  toast.error(
                    "Clipboard unavailable. Select and copy the secret manually."
                  );
                }
              }}
            >
              <Copy size={14} />
              Copy credentials
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {preview && (
        <PanelPreview resource={preview} onClose={() => setPreview(null)} />
      )}
    </>
  );
}
function DeliveryTable({ query, filter }: { query: string; filter: string }) {
  const { data } = useWorkspace();
  return (
    <HistoryTable<Delivery>
      kind="deliveries"
      query={query}
      filter={filter}
      columns={[
        {
          key: "title",
          label: "Update",
          render: (r) => (
            <span className="block max-w-xs truncate font-medium">
              {r.title}
            </span>
          ),
        },
        {
          key: "source",
          label: "Source",
          render: (r) => (
            <span className="text-muted-foreground">
              {data.resources.find((s) => s.id === r.sourceId)?.name ??
                "Deleted source"}
            </span>
          ),
        },
        {
          key: "channel",
          label: "Destination",
          render: (r) => (
            <span className="text-muted-foreground">
              #
              {data.guild.channels.find((c) => c.id === r.channelId)?.name ??
                "unknown"}
            </span>
          ),
        },
        {
          key: "status",
          label: "Status",
          render: (r) => (
            <div>
              <Badge
                tone={
                  r.status === "delivered"
                    ? "green"
                    : r.status === "failed"
                      ? "red"
                      : "amber"
                }
              >
                {r.status}
              </Badge>
              {r.error && (
                <p
                  className="mt-1 max-w-xs text-[10px] text-red-500"
                  title={r.error}
                >
                  {r.error.slice(0, 90)}
                </p>
              )}
            </div>
          ),
        },
        {
          key: "time",
          label: "When",
          render: (r) => (
            <span className="whitespace-nowrap text-muted-foreground">
              {relativeTime(r.createdAt)}
            </span>
          ),
        },
      ]}
      emptyTitle="The next update is on its way"
      emptyDescription="Successful deliveries, retries, and any delivery errors will appear here. Events are deduplicated per source and destination."
    />
  );
}
function PanelPreview({
  resource: r,
  onClose,
}: {
  resource: Resource;
  onClose: () => void;
}) {
  const { data } = useWorkspace();
  const [selected, setSelected] = useState<string[]>([]);
  function toggle(id: string) {
    if (selected.includes(id)) setSelected((v) => v.filter((r) => r !== id));
    else if (r.data.selection === "single") setSelected([id]);
    else if (selected.length >= r.data.maxRoles)
      toast.error(`Choose up to ${r.data.maxRoles} roles`);
    else if (
      r.data.exclusiveRoleIds?.includes(id) &&
      selected.some((s) => r.data.exclusiveRoleIds.includes(s))
    )
      toast.error("These roles are mutually exclusive");
    else setSelected((v) => [...v, id]);
  }
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A little preview of belonging.</DialogTitle>
          <DialogDescription>
            Try your panel below. This preview doesn’t assign real Discord
            roles.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-xl bg-[#313338] p-5 text-white">
          <div className="border-l-4 border-violet-400 bg-[#2b2d31] p-4">
            <h3 className="text-sm font-semibold">{r.name}</h3>
            <p className="mt-2 text-xs leading-relaxed text-[#b5bac1]">
              {r.data.description}
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {r.data.roleIds.map((id: string, i: number) => (
              <button
                className={cn(
                  "flex items-center gap-2 rounded px-3 py-2 text-[12px] transition",
                  selected.includes(id)
                    ? "bg-[#7e63c7]"
                    : "bg-[#4e5058] hover:bg-[#5c5e66]"
                )}
                key={id}
                onClick={() => toggle(id)}
              >
                {selected.includes(id) ? (
                  <Check size={12} />
                ) : (
                  (r.data.emojis?.[i] ?? "✦")
                )}
                {data.guild.roles.find((role) => role.id === id)?.name ??
                  "Unknown role"}
              </button>
            ))}
          </div>
        </div>
        <p className="mt-4 text-[11px] text-muted-foreground">
          {selected.length
            ? `${selected.length} role${selected.length === 1 ? "" : "s"} selected. Looking good!`
            : "Choose a role to see how it feels."}
        </p>
      </DialogContent>
    </Dialog>
  );
}
