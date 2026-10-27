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
import { IdentityCell } from "./identity/identity-cell";
import { personFields } from "@/lib/person";
import { ActorAvatar } from "./identity/actor-avatar";
import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditActionTone,
} from "@orbit/core/audit-actions";
import { DataTable } from "./data-table";
import { HistoryTable } from "./history-table";
import { PageHeader } from "./page-header";
import { RolePicker } from "./resource-editor";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { TabBar } from "./ui/tabs";
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
  FormSelect,
  Input,
  NativeSelect,
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
  // Built once instead of scanning every resource for every channel row.
  const channelUsage = new Map<string, number>();
  for (const resource of data.resources) {
    const id = resource.data.channelId;
    if (typeof id === "string")
      channelUsage.set(id, (channelUsage.get(id) ?? 0) + 1);
  }
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
              Orbit never needs Administrator: keep its role above the roles it
              manages. Channel and role changes happen in Discord and are synced
              here.
            </p>
          </div>
        </div>
      </div>
      <TabBar
        id="server"
        label="Server sections"
        controls={false}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setQ("");
          setFilter("all");
        }}
        tabs={[
          {
            id: "channels",
            label: "Channels",
            badge: data.guild.channels.length,
          },
          { id: "roles", label: "Roles", badge: data.guild.roles.length },
          { id: "permissions", label: "Permissions" },
        ]}
      />
      {tab !== "permissions" ? (
        <>
          <Card>
            {tab === "channels" ? (
              <DataTable
                label="Channels"
                rows={channels}
                search={{
                  value: q,
                  onChange: setQ,
                  placeholder: "Search channels…",
                  label: "Search channels",
                }}
                filters={[
                  {
                    key: "channel-type",
                    label: "Filter channel type",
                    title: "Channel type",
                    value: filter,
                    allValue: "all",
                    onChange: setFilter,
                    searchable: false,
                    options: [
                      { value: "all", label: "All channels" },
                      { value: "text", label: "Text" },
                      { value: "voice", label: "Voice" },
                      { value: "category", label: "Categories" },
                      { value: "stage", label: "Stage (unsupported)" },
                      { value: "forum", label: "Forums" },
                    ],
                  },
                ]}
                columns={[
                  {
                    key: "name",
                    label: "Channel",
                    sortValue: (r) => r.name,
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
                    sortValue: (r) => r.type,
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
                    sortValue: (r) => channelUsage.get(r.id) ?? 0,
                    render: (r) => (
                      <span className="text-muted-foreground">
                        {channelUsage.get(r.id) ?? 0} configurations
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
              // A sorted copy: sorting the prop array in place mutated data
              // shared with the rest of the dashboard.
              <DataTable
                label="Roles"
                rows={[...roles].sort((a, b) => b.position - a.position)}
                search={{
                  value: q,
                  onChange: setQ,
                  placeholder: "Search roles…",
                  label: "Search roles",
                }}
                columns={[
                  {
                    key: "name",
                    label: "Role",
                    sortValue: (r) => r.name,
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
  // The canonical verbs, plus anything this page actually returned, so a filter
  // can never offer a value the log does not contain — and never hide one it
  // does because it happened to be on a later page.
  const actions = [
    ...new Set([...AUDIT_ACTIONS, ...data.audit.map((a) => a.action)]),
  ];
  return (
    <>
      <PageHeader
        title="The story behind the settings."
        description="A clear, lasting record of the changes that shape your community."
        badge="Append-only"
      />
      <p className="mb-4 text-[11px] leading-relaxed text-muted-foreground">
        Names and avatars here are the ones recorded when the action happened
        and are never refreshed, so an entry shows who acted then. Where this
        server’s roster currently knows that person, their present profile is
        shown separately in the detail view and labelled as current.
      </p>
      <Card>
        <HistoryTable<AuditEntry>
          kind="audit"
          query={q}
          filter={filter}
          onQueryChange={setQ}
          onFilterChange={setFilter}
          searchLabel="Search the audit log"
          searchPlaceholder="Search people, changes, and settings…"
          facetLabel="Filter audit action"
          facetTitle="Action"
          facetOptions={[
            { value: "all", label: "All actions" },
            ...actions.map((a) => ({ value: a, label: auditActionLabel(a) })),
          ]}
          columns={[
            {
              key: "person",
              label: "Who",
              sortKey: "actorName",
              canHide: false,
              // The avatar recorded with the action, not the actor's current
              // picture: audit rows are evidence, so they are never refreshed.
              render: (r) => (
                <IdentityCell
                  id={r.actorId}
                  name={r.actorName}
                  src={r.actorAvatarUrl}
                  detail={r.actorAvatarUrl ? undefined : "no avatar recorded"}
                />
              ),
            },
            {
              key: "action",
              label: "What changed",
              sortKey: "action",
              render: (r) => (
                <Badge tone={auditActionTone(r.action)}>
                  {auditActionLabel(r.action)}
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
                // Clamped for scanning, with the full text on hover and in the
                // row's detail dialog.
                <span
                  className="line-clamp-2 max-w-xs text-muted-foreground"
                  title={r.detail}
                >
                  {r.detail}
                </span>
              ),
            },
            {
              key: "time",
              label: "When",
              sortKey: "createdAt",
              render: (r) => (
                <span className="whitespace-nowrap text-muted-foreground">
                  {relativeTime(r.createdAt, data.presentation.referenceAt)}
                </span>
              ),
            },
            {
              // A trailing action column, not a data column: it has no header
              // text, so it must stay out of the Columns menu instead of
              // appearing there as a nameless checkbox.
              key: "open",
              label: "",
              canHide: false,
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
                text={detail.details ?? detail.detail}
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
              // The stored token stays visible next to the human word so the
              // detail view still shows exactly what was recorded.
              [
                "Action",
                detail?.action
                  ? `${auditActionLabel(detail.action)} (${detail.action})`
                  : null,
              ],
              ["Target", detail?.target],
              ["Summary", detail?.detail],
              // Older rows have no separate diagnostic; the summary stands in.
              ...(detail?.details
                ? ([["Diagnostic details", detail.details]] as const)
                : []),
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
                    (k === "Diagnostic details" || k === "Summary") &&
                      "font-mono text-[11px]"
                  )}
                >
                  {k === "Actor" && detail ? (
                    <span className="flex items-center gap-2">
                      {/* Same historical identity as the row that opened this
                          dialog; no fresh lookup when the dialog appears. */}
                      <ActorAvatar
                        id={detail.actorId}
                        name={detail.actorName}
                        src={detail.actorAvatarUrl}
                        size={24}
                      />
                      <span>{v}</span>
                    </span>
                  ) : (
                    v
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {detail && (
            <CurrentIdentity
              actorId={detail.actorId}
              recordedName={detail.actorName}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The actor as this server sees them *now*, next to the identity recorded with
 * the action.
 *
 * The two are deliberately separate blocks with their own headings: a rename
 * should never make an old audit row look like it was written under the new name,
 * and a reader should never have to guess which one is evidence. The current
 * profile comes from the roster the bot synchronized — no Discord request.
 */
function CurrentIdentity({
  actorId,
  recordedName,
}: {
  actorId: string;
  recordedName: string;
}) {
  const { data } = useWorkspace();
  const account = data.accounts.find((a) => a.userId === actorId);
  if (!account) return null;
  const current = personFields(account, account.name).name;
  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Current profile in this server
      </p>
      <div className="mt-2 flex items-center gap-2 text-xs">
        <IdentityCell
          id={account.userId}
          name={account.name}
          src={account.avatarUrl}
          person={account}
        />
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {current.toLowerCase() === recordedName.toLowerCase()
          ? "The name matches what was recorded with this action."
          : `Recorded then as “${recordedName}”. This is their name and picture today, not a change to the record.`}{" "}
        Their roles and membership are not part of an audit entry.
      </p>
    </div>
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
              <FormSelect
                value={v.locale}
                onValueChange={(next) => setV({ ...v, locale: next })}
                options={[
                  { value: "en", label: "English" },
                  { value: "de", label: "Deutsch" },
                  { value: "fr", label: "Français" },
                  { value: "es", label: "Español" },
                ]}
              />
            </Field>
            <Field
              label="Timezone"
              hint="Used for display. Polling intervals are elapsed time, not wall-clock schedules."
            >
              {/*
                Deliberately native: the full IANA list is 400+ entries, and the
                browser's own select gives OS type-ahead and list rendering that a
                menu of 400 Radix items would not. `Location` keeps the display
                order and label the settings page has always used.
              */}
              <NativeSelect
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
              </NativeSelect>
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
              <Combobox
                value={v.auditChannelId}
                onValueChange={(next) => setV({ ...v, auditChannelId: next })}
                placeholder="No audit channel"
                searchPlaceholder="Search channels…"
                options={[
                  { value: "", label: "No audit channel" },
                  ...textChannels.map((c) => ({
                    value: c.id,
                    label: `#${c.name}`,
                  })),
                ]}
              />
            </Field>
            <Field
              label="Default notification role"
              hint="Optional. Sources can override this role. @everyone is never allowed."
            >
              <Combobox
                value={v.notificationRoleId}
                onValueChange={(next) =>
                  setV({ ...v, notificationRoleId: next })
                }
                placeholder="No default notification"
                searchPlaceholder="Search roles…"
                options={[
                  { value: "", label: "No default notification" },
                  ...data.guild.roles
                    .filter((r) => !r.managed && r.id !== data.guild.id)
                    .map((r) => ({ value: r.id, label: `@${r.name}` })),
                ]}
              />
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
                id: "polls",
                name: "Native polls",
                desc: "Opt-in native Discord votes; no voter identities stored.",
                icon: UsersRound,
              },
              {
                id: "announcements",
                name: "Announcements",
                desc: "Opt-in one-time notices, never recurring spam.",
                icon: Rss,
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
