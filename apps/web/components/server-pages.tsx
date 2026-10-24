"use client";
import { copyText } from "@/lib/clipboard";
import { cn, relativeTime } from "@/lib/utils";
import { roleAssignmentIssue } from "@orbit/core/permissions";
import { PermissionSetup } from "./permission-setup";
import type { AuditEntry, GuildConfig } from "@orbit/core";
import {
  Check,
  Copy,
  Download,
  Eye,
  Globe,
  Hash,
  Layers,
  Lock,
  Music2,
  Radio,
  RotateCcw,
  Rss,
  Save,
  Settings2,
  ShieldCheck,
  Tags,
  UsersRound,
  Volume2,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CopyButton } from "./copy-button";
import { DataTable } from "./data-table";
import { HistoryTable } from "./history-table";
import { PageHeader } from "./page-header";
import { RolePicker } from "./resource-editor";
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
  Field,
  Input,
  SearchInput,
  Select,
  Spinner,
} from "./ui/primitives";
import { Switch } from "./ui/switch";
import { useWorkspace } from "./workspace";
export function ChannelsPage() {
  const { data } = useWorkspace();
  const [tab, setTab] = useState("channels");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const channels = data.guild.channels.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) &&
      (filter === "all" || c.type === filter)
  );
  const roles = data.guild.roles.filter((r) =>
    r.name.toLowerCase().includes(q.toLowerCase())
  );
  async function copy(id: string) {
    try {
      await copyText(id);
      toast.success("Discord ID copied");
    } catch {
      toast.info(`Discord ID: ${id}`);
    }
  }
  return (
    <>
      <PageHeader
        title="A place for everything."
        description="Channels, roles, and the permissions that keep your community running smoothly."
      />
      <div className="mb-5 rounded-xl border border-emerald-200/50 bg-emerald-50/50 p-4 dark:border-emerald-500/20 dark:bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="mt-0.5 text-emerald-500" />
          <div>
            <p className="text-xs font-medium">
              A little power, thoughtfully given.
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              Orbit never needs Administrator. Keep its role above the roles it
              manages, and give it access only to the channels it needs. Channel
              and role changes are managed in Discord and synced here.
            </p>
          </div>
        </div>
      </div>
      <div className="mb-5 flex gap-6 border-b">
        {["channels", "roles", "permissions"].map((t) => (
          <button
            key={t}
            className={cn(
              "-mb-px border-b-2 pb-3 pt-1 text-[12px] font-medium capitalize",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground"
            )}
            onClick={() => {
              setTab(t);
              setQ("");
              setFilter("all");
            }}
          >
            {t}
            {t !== "permissions" && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
                {t === "roles"
                  ? data.guild.roles.length
                  : data.guild.channels.length}
              </span>
            )}
          </button>
        ))}
      </div>
      {tab !== "permissions" ? (
        <>
          <div className="mb-4 flex justify-between gap-3">
            <SearchInput
              value={q}
              onChange={setQ}
              placeholder={`Search ${tab}…`}
            />
            {tab === "channels" && (
              <Select
                className="h-9 w-32 text-[11px]"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Channel type"
              >
                <option value="all">All channels</option>
                <option value="text">Text</option>
                <option value="voice">Voice</option>
                <option value="category">Categories</option>
                <option value="stage">Stage (unsupported)</option>
                <option value="forum">Forums</option>
              </Select>
            )}
          </div>
          <Card>
            {tab === "channels" ? (
              <DataTable
                rows={channels}
                columns={[
                  {
                    key: "name",
                    label: "Channel",
                    render: (r) => (
                      <span className="flex items-center gap-2.5 font-medium">
                        {r.type === "voice" ? (
                          <Volume2
                            size={14}
                            className="text-muted-foreground"
                          />
                        ) : r.type === "category" ? (
                          <Layers size={14} className="text-muted-foreground" />
                        ) : (
                          <Hash size={14} className="text-muted-foreground" />
                        )}
                        {r.name}
                      </span>
                    ),
                  },
                  {
                    key: "type",
                    label: "Type",
                    render: (r) => <Badge>{r.type}</Badge>,
                  },
                  {
                    key: "status",
                    label: "Bot access",
                    render: (r) => (
                      <Badge
                        tone={
                          !r.permissionBits
                            ? "neutral"
                            : r.canSend
                              ? "green"
                              : "amber"
                        }
                      >
                        {r.canSend ? <Check size={10} /> : <Lock size={10} />}
                        {r.type === "stage"
                          ? "Unsupported Stage"
                          : !["text", "voice"].includes(r.type)
                            ? "Not a destination"
                            : !r.permissionBits
                              ? "Not verified"
                              : r.canSend
                                ? "Synced access"
                                : "Missing permissions"}
                      </Badge>
                    ),
                  },
                  {
                    key: "route",
                    label: "Used by",
                    render: (r) => (
                      <span className="text-muted-foreground">
                        {
                          data.resources.filter(
                            (s) => s.data.channelId === r.id
                          ).length
                        }{" "}
                        configurations
                      </span>
                    ),
                  },
                  {
                    key: "id",
                    label: "Discord ID",
                    render: (r) => (
                      <button
                        className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground hover:text-primary"
                        onClick={() => copy(r.id)}
                      >
                        {r.id}
                        <Copy size={11} />
                      </button>
                    ),
                  },
                ]}
                emptyTitle="No channels found"
                emptyDescription="Try a different filter. In live mode, Orbit syncs channels from Discord."
              />
            ) : (
              <DataTable
                rows={roles.sort((a, b) => b.position - a.position)}
                columns={[
                  {
                    key: "name",
                    label: "Role",
                    render: (r) => (
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="size-2 rounded-full"
                          style={{ background: r.color || "#aaa" }}
                        />
                        {r.name}
                      </span>
                    ),
                  },
                  {
                    key: "position",
                    label: "Position",
                    render: (r) => (
                      <span className="text-muted-foreground">
                        {r.position}
                      </span>
                    ),
                  },
                  {
                    key: "managed",
                    label: "Type",
                    render: (r) => (
                      <Badge
                        tone={
                          r.managed
                            ? "blue"
                            : roleAssignmentIssue(
                                  r,
                                  data.guild.botRolePosition,
                                  data.guild.id
                                )
                              ? "amber"
                              : "neutral"
                        }
                      >
                        {r.managed
                          ? "Integration"
                          : roleAssignmentIssue(
                                r,
                                data.guild.botRolePosition,
                                data.guild.id
                              )
                            ? "Protected role"
                            : "Community role"}
                      </Badge>
                    ),
                  },
                  {
                    key: "safe",
                    label: "Self-role safety",
                    render: (r) => (
                      <Badge
                        tone={
                          !roleAssignmentIssue(
                            r,
                            data.guild.botRolePosition,
                            data.guild.id
                          )
                            ? "green"
                            : "neutral"
                        }
                      >
                        {!roleAssignmentIssue(
                          r,
                          data.guild.botRolePosition,
                          data.guild.id
                        ) ? (
                          <>
                            <Check size={10} />
                            Assignable
                          </>
                        ) : (
                          <>
                            <Lock size={10} />
                            Protected
                          </>
                        )}
                      </Badge>
                    ),
                  },
                  {
                    key: "id",
                    label: "Discord ID",
                    render: (r) => (
                      <button
                        className="flex items-center gap-2 font-mono text-[9px] text-muted-foreground hover:text-primary"
                        onClick={() => copy(r.id)}
                      >
                        {r.id}
                        <Copy size={11} />
                      </button>
                    ),
                  },
                ]}
                emptyTitle="No roles found"
                emptyDescription="Roles are synced from your Discord server. Try another search."
              />
            )}
          </Card>
        </>
      ) : (
        <PermissionSetup />
      )}
    </>
  );
}
export function AuditPage() {
  const { data } = useWorkspace();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<AuditEntry | null>(null);
  const actions = [...new Set(data.audit.map((a) => a.action))];
  return (
    <>
      <PageHeader
        title="The story behind the settings."
        description="A clear, lasting record of the changes that shape your community."
        badge="Append-only"
      />
      <div className="mb-4 flex justify-between gap-3">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Search people, changes, and settings…"
        />
        <Select
          aria-label="Filter audit action"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-9 w-36 text-[11px]"
        >
          <option value="all">All actions</option>
          {actions.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </Select>
      </div>
      <Card>
        <HistoryTable<AuditEntry>
          kind="audit"
          query={q}
          filter={filter}
          columns={[
            {
              key: "person",
              label: "Who",
              render: (r) => (
                <span className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-full bg-violet-50 text-violet-400 dark:bg-violet-500/10">
                    {r.actorName.slice(0, 1)}
                  </span>
                  <span className="font-medium">{r.actorName}</span>
                </span>
              ),
            },
            {
              key: "action",
              label: "What changed",
              render: (r) => (
                <Badge
                  tone={
                    r.action === "deleted"
                      ? "red"
                      : r.action === "created"
                        ? "green"
                        : r.action === "moderated"
                          ? "amber"
                          : "purple"
                  }
                >
                  {r.action}
                </Badge>
              ),
            },
            {
              key: "target",
              label: "Configuration",
              render: (r) => <span className="font-medium">{r.target}</span>,
            },
            {
              key: "detail",
              label: "Details",
              render: (r) => (
                <span className="line-clamp-2 max-w-xs text-muted-foreground">
                  {r.detail}
                </span>
              ),
            },
            {
              key: "time",
              label: "When",
              render: (r) => (
                <span className="whitespace-nowrap text-muted-foreground">
                  {relativeTime(r.createdAt, data.presentation.referenceAt)}
                </span>
              ),
            },
            {
              key: "open",
              label: "",
              render: (r) => (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="View audit event"
                  className="size-7"
                  onClick={() => setDetail(r)}
                >
                  <Eye size={13} />
                </Button>
              ),
            },
          ]}
          emptyTitle="A fresh page in your community’s story"
          emptyDescription="Configuration updates, moderation actions, deliveries, and important changes will appear here. Audit records can’t be edited or removed through the dashboard."
        />
      </Card>
      <p className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
        <ShieldCheck size={13} />
        All events are searchable and paginated. Records are retained in your
        database and never editable through the dashboard.
      </p>
      <Dialog
        open={!!detail}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>A closer look at this change.</DialogTitle>
            <DialogDescription>
              Audit events are immutable through Orbit.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="mb-5 flex flex-wrap gap-2 border-b pb-4">
              <CopyButton
                key={detail.id}
                text={detail.detail}
                label={
                  detail.action === "failed" ? "Copy error" : "Copy details"
                }
              />
              <CopyButton
                text={JSON.stringify(detail, null, 2)}
                label="Copy full event"
                success="Full audit event copied as JSON"
              />
            </div>
          )}
          <dl className="space-y-4 text-xs">
            {[
              ["Event ID", detail?.id],
              ["Actor", `${detail?.actorName} (${detail?.actorId})`],
              ["Action", detail?.action],
              ["Target", detail?.target],
              ["Details", detail?.detail],
              [
                "Timestamp",
                detail?.createdAt
                  ? new Date(detail.createdAt).toLocaleString("en", {
                      timeZone: data.guild.config.timezone,
                    })
                  : null,
              ],
            ].map(([k, v]) => (
              <div key={k} className="grid grid-cols-[90px_1fr] gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd
                  className={cn(
                    "min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed",
                    k === "Details" && "font-mono text-[11px]"
                  )}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </DialogContent>
      </Dialog>
    </>
  );
}
export function SettingsPage() {
  const { data, saveConfig } = useWorkspace();
  const [v, setV] = useState<GuildConfig>(structuredClone(data.guild.config));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = JSON.stringify(v) !== JSON.stringify(data.guild.config);
  const textChannels = data.guild.channels.filter((c) => c.type === "text");
  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      await saveConfig(v, false);
      toast.success("A few thoughtful changes. All saved.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function exportConfig() {
    const file = new Blob(
      [
        JSON.stringify(
          {
            guildId: data.guild.id,
            name: data.guild.name,
            config: data.guild.config,
            resources: data.resources.filter((r) => r.kind !== "case"),
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `orbit-${data.guild.id}-config.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Configuration exported. No credentials included.");
  }
  return (
    <>
      <PageHeader
        title="Make this space your own."
        description="A few thoughtful settings for the way your community comes together."
      >
        {dirty && <Badge tone="amber">Unsaved changes</Badge>}
        <Button variant="outline" onClick={exportConfig}>
          <Download size={14} />
          Export config
        </Button>
        <Button disabled={busy || !dirty} onClick={() => save()}>
          {busy ? <Spinner /> : <Save size={14} />}Save changes
        </Button>
      </PageHeader>
      <form onSubmit={save} className="space-y-5">
        <Card className="overflow-hidden">
          <SettingsHeader
            title="The little details"
            description="The basics that make your workspace feel like home."
            icon={Globe}
          />
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <Field
              label="Community name"
              hint="Synced from Discord. Rename your server there to update it here."
            >
              <Input value={data.guild.name} disabled />
            </Field>
            <Field
              label="Preferred locale"
              hint="Saved server preference. Dashboard and command copy currently use English."
            >
              <Select
                value={v.locale}
                onChange={(e) => setV({ ...v, locale: e.target.value })}
              >
                <option value="en">English</option>
                <option value="de">Deutsch</option>
                <option value="fr">Français</option>
                <option value="es">Español</option>
              </Select>
            </Field>
            <Field
              label="Timezone"
              hint="Used for display. Polling intervals are elapsed time, not wall-clock schedules."
            >
              <Select
                value={v.timezone}
                onChange={(e) => setV({ ...v, timezone: e.target.value })}
              >
                {[
                  "Europe/Berlin",
                  "Europe/London",
                  "Europe/Paris",
                  "America/New_York",
                  "America/Los_Angeles",
                  "Asia/Tokyo",
                  "Australia/Sydney",
                  "UTC",
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Server ID">
              <div className="flex h-10 items-center rounded-lg border bg-muted/30 px-3 font-mono text-[12px] text-muted-foreground">
                {data.guild.id}
              </div>
            </Field>
          </div>
        </Card>
        <Card>
          <SettingsHeader
            title="Keep the right people in the loop"
            description="Choose where Orbit shares important updates and moderation actions."
            icon={Radio}
          />
          <div className="grid gap-5 p-6 sm:grid-cols-2">
            <Field
              label="Moderation audit channel"
              hint="Warnings, timeouts, and other moderation cases are logged here."
            >
              <Select
                value={v.auditChannelId}
                onChange={(e) => setV({ ...v, auditChannelId: e.target.value })}
              >
                <option value="">No audit channel</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    #{c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Default notification role"
              hint="Optional. Sources can override this role. @everyone is never allowed."
            >
              <Select
                value={v.notificationRoleId}
                onChange={(e) =>
                  setV({ ...v, notificationRoleId: e.target.value })
                }
              >
                <option value="">No default notification</option>
                {data.guild.roles
                  .filter((r) => !r.managed && r.id !== data.guild.id)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      @{r.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        </Card>
        <Card>
          <SettingsHeader
            title="Your community, your toolkit"
            description="Switch on what brings people together. Pause what you don’t need just yet."
            icon={Settings2}
          />
          <div className="grid gap-x-8 gap-y-0 px-6 py-2 sm:grid-cols-2">
            {[
              {
                id: "roles",
                name: "Self roles",
                desc: "Give everyone a place to belong.",
                icon: UsersRound,
              },
              {
                id: "moderation",
                name: "Moderation",
                desc: "Keep your conversations kind.",
                icon: ShieldCheck,
              },
              {
                id: "economy",
                name: "Economy",
                desc: "Reward a little participation.",
                icon: Wallet,
              },
              {
                id: "music",
                name: "Music",
                desc: "Set the mood for your space.",
                icon: Music2,
              },
              {
                id: "deals",
                name: "Game deals",
                desc: "Great games, good prices.",
                icon: Tags,
              },
              {
                id: "news",
                name: "News & feeds",
                desc: "Stay in the know, together.",
                icon: Rss,
              },
            ].map((m) => (
              <div
                className="flex items-center gap-3 border-b border-border/60 py-5 last:border-0"
                key={m.id}
              >
                <m.icon size={17} className="text-primary/70" />
                <div className="flex-1">
                  <h3 className="text-[12px] font-medium">{m.name}</h3>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {m.desc}
                  </p>
                </div>
                <Switch
                  checked={v.modules[m.id as keyof typeof v.modules]}
                  onCheckedChange={(b) =>
                    setV({ ...v, modules: { ...v.modules, [m.id]: b } })
                  }
                  aria-label={`Enable ${m.name}`}
                />
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <SettingsHeader
            title="Thoughtful boundaries"
            description="A consistent approach to exemptions and repeated warnings."
            icon={ShieldCheck}
          />
          <div className="space-y-5 p-6">
            <Field
              label="Roles exempt from automoderation"
              hint="Administrators, the server owner, bots, and members Orbit cannot moderate are always exempt."
            >
              <RolePicker
                roles={data.guild.roles.filter((r) => !r.managed)}
                value={v.moderation.exemptRoleIds}
                onChange={(ids) =>
                  setV({
                    ...v,
                    moderation: { ...v.moderation, exemptRoleIds: ids },
                  })
                }
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Escalate after this many warnings"
                hint="Counts warning cases from the past 24 hours."
              >
                <Input
                  type="number"
                  min="1"
                  max="20"
                  value={v.moderation.escalationThreshold}
                  onChange={(e) =>
                    setV({
                      ...v,
                      moderation: {
                        ...v.moderation,
                        escalationThreshold: Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
              <Field
                label="Escalation timeout (minutes)"
                hint="Applied only when Orbit can safely timeout the member."
              >
                <Input
                  type="number"
                  min="1"
                  max="40320"
                  value={v.moderation.escalationMinutes}
                  onChange={(e) =>
                    setV({
                      ...v,
                      moderation: {
                        ...v.moderation,
                        escalationMinutes: Number(e.target.value),
                      },
                    })
                  }
                />
              </Field>
            </div>
          </div>
        </Card>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-600"
          >
            {error}
          </div>
        )}
        <div className="flex items-center justify-between rounded-xl border bg-card px-6 py-4">
          <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <ShieldCheck size={13} className="text-emerald-500" />
            Changes take effect without restarting the bot.
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              disabled={!dirty || busy}
              onClick={() => {
                setV(structuredClone(data.guild.config));
                setError("");
              }}
            >
              <RotateCcw size={12} />
              Discard
            </Button>
            <Button type="submit" disabled={!dirty || busy}>
              {busy ? <Spinner /> : <Check size={14} />}Save changes
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
function SettingsHeader({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 border-b px-6 py-5">
      <span className="flex size-9 items-center justify-center rounded-xl bg-violet-50 text-primary dark:bg-violet-500/10">
        <Icon size={17} />
      </span>
      <div>
        <h2 className="text-xs font-semibold">{title}</h2>
        <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
