"use client";
import { cn } from "@/lib/utils";
import type { Resource, ResourceKind } from "@orbit/core";
import { roleAssignmentIssue } from "@orbit/core/permissions";
import { DEAL_QUALITY_DEFAULTS } from "@orbit/core/deal-policy";
import {
  AlertCircle,
  Check,
  Info,
  Plus,
  Save,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
  Checkbox,
  Field,
  Input,
  FormSelect,
  Spinner,
  Textarea,
} from "./ui/primitives";
import { Combobox } from "./ui/combobox";
import { Switch } from "./ui/switch";
import { RoleDot } from "./role-badge";
import { useWorkspace } from "./workspace";
export const kindNames: Record<ResourceKind, string> = {
  panel: "role panel",
  rule: "automod rule",
  shop: "shop item",
  deal: "deal subscription",
  source: "news source",
  route: "routing rule",
  case: "moderation case",
};
export function ResourceEditor({
  kind,
  resource,
  onClose,
  onSaved,
}: {
  kind: ResourceKind;
  resource?: Resource | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { data, api, refresh } = useWorkspace();
  const channels = data.guild.channels.filter((c) => c.type === "text");
  const roles = data.guild.roles;
  const safeRoles = roles.filter(
    (role) =>
      !roleAssignmentIssue(role, data.guild.botRolePosition, data.guild.id)
  );
  const defaults: Record<string, Record<string, any>> = {
    panel: {
      description: "Choose your roles. Find your people.",
      channelId:
        channels.find((c) => c.name === "pick-your-roles")?.id ??
        channels[0]?.id ??
        "",
      roleIds: [],
      mode: "buttons",
      selection: "multi",
      maxRoles: 5,
      prerequisiteIds: [],
      exclusiveRoleIds: [],
      emojis: [],
    },
    rule: {
      type: "spam",
      threshold: 5,
      windowSeconds: 10,
      action: "warn",
      durationMinutes: 10,
      terms: [],
      exemptRoleIds: [],
      exemptChannelIds: [],
    },
    shop: {
      description: "",
      type: "role",
      roleId: "",
      price: 1000,
      stock: -1,
      emoji: "✨",
    },
    deal: {
      ...DEAL_QUALITY_DEFAULTS,
      gameId: "",
      channelId:
        channels.find((c) => c.name === "game-deals")?.id ??
        channels[0]?.id ??
        "",
      region: "DE",
      currency: "EUR",
      minDiscount: 50,
      maxPrice: 30,
      historicalLow: false,
      stores: [],
      notificationRoleId: "",
      intervalMinutes: 60,
    },
    source: {
      adapter: "rss",
      url: "",
      channelId:
        channels.find((c) => c.name === "gaming-news")?.id ??
        channels[0]?.id ??
        "",
      keywords: [],
      tags: [],
      intervalMinutes: 30,
      notificationRoleId: "",
      embedColor: "#8b5cf6",
      includeSummary: true,
      officialOnly: false,
      health: "setup_required",
    },
    route: {
      sourceIds: [],
      channelId: channels[0]?.id ?? "",
      keywords: [],
      tags: [],
      notificationRoleId: "",
      embedColor: "#8b5cf6",
      includeSummary: true,
    },
  };
  const [name, setName] = useState(resource?.name ?? "");
  const [enabled, setEnabled] = useState(resource?.enabled ?? true);
  const [values, setValues] = useState<Record<string, any>>({
    ...(defaults[kind] ?? {}),
    ...resource?.data,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const set = (key: string, value: any) =>
    setValues((v) => ({ ...v, [key]: value }));
  const channelSelect = (
    <Field
      label="Destination channel"
      required
      hint="Orbit needs View Channel, Send Messages, and Embed Links permissions."
    >
      <Combobox
        value={values.channelId ?? ""}
        onValueChange={(next) => set("channelId", next)}
        placeholder="Choose a channel"
        searchPlaceholder="Search channels…"
        options={[
          { value: "", label: "Choose a channel" },
          ...channels.map((c) => ({
            value: c.id,
            label: `# ${c.name}`,
            hint: c.canSend ? undefined : "missing permissions",
          })),
        ]}
      />
    </Field>
  );
  const notificationSelect = (
    <Field
      label="Notification role"
      hint="Optional. Only this role will be mentioned; @everyone and @here are blocked."
    >
      <Combobox
        value={values.notificationRoleId ?? ""}
        onValueChange={(next) => set("notificationRoleId", next)}
        placeholder="No role notification"
        searchPlaceholder="Search roles…"
        options={[
          { value: "", label: "No role notification" },
          ...roles
            .filter((r) => !r.managed && r.id !== data.guild.id)
            .map((r) => ({ value: r.id, label: `@${r.name}` })),
        ]}
      />
    </Field>
  );
  const listField = (key: string, label: string, hint?: string) => (
    <Field label={label} hint={hint}>
      <ArrayInput
        value={values[key] ?? []}
        onChange={(v) => set(key, v)}
        placeholder="Separate with commas"
      />
    </Field>
  );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name,
        enabled,
        data: {
          ...values,
          ...(kind === "panel" && values.selection === "single"
            ? { maxRoles: 1 }
            : {}),
        },
      };
      await api(
        `/resources/${kind}${resource ? `/${resource.id}` : ""}`,
        resource ? "PATCH" : "POST",
        payload
      );
      await refresh();
      toast.success(`${resource ? "Updated" : "Created"} ${kindNames[kind]}`);
      onSaved?.();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="max-w-[580px]">
        <DialogHeader>
          <DialogTitle>
            {resource ? "Edit" : "Create"} {kindNames[kind]}
          </DialogTitle>
          <DialogDescription>
            {kind === "source"
              ? "Connect a supported source. Preview it before you publish."
              : kind === "panel"
                ? "A simple way for your members to make this space their own."
                : "A few thoughtful details go a long way."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-5">
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
              maxLength={80}
              placeholder={
                kind === "panel"
                  ? "e.g. Find your people"
                  : kind === "source"
                    ? "e.g. The weekly update"
                    : "Give it a friendly name"
              }
              autoFocus
            />
          </Field>
          {(kind === "panel" || kind === "shop") && (
            <Field label="Description">
              <Textarea
                maxLength={kind === "panel" ? 1000 : 500}
                value={values.description ?? ""}
                onChange={(e) => set("description", e.target.value)}
                placeholder="A little context for your community…"
              />
            </Field>
          )}
          {kind === "panel" && (
            <>
              {channelSelect}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Panel style">
                  <FormSelect
                    value={values.mode}
                    onValueChange={(next) => set("mode", next)}
                    options={[
                      { value: "buttons", label: "Buttons" },
                      { value: "select", label: "Select menu" },
                      { value: "reaction", label: "Reaction roles" },
                    ]}
                  />
                </Field>
                <Field label="Selection">
                  <FormSelect
                    value={values.selection}
                    onValueChange={(next) => {
                      set("selection", next);
                      if (next === "single") set("maxRoles", 1);
                    }}
                    options={[
                      { value: "multi", label: "Multiple roles" },
                      { value: "single", label: "One role at a time" },
                    ]}
                  />
                </Field>
              </div>
              <Field
                label="Available roles"
                required
                hint="Only unprivileged, non-integration roles below Orbit are available."
              >
                <RolePicker
                  roles={safeRoles}
                  value={values.roleIds}
                  onChange={(v) => set("roleIds", v)}
                />
              </Field>
              {values.selection === "multi" && (
                <Field label="Maximum roles per member">
                  <Input
                    type="number"
                    min="1"
                    max="25"
                    value={values.maxRoles}
                    onChange={(e) => set("maxRoles", Number(e.target.value))}
                  />
                </Field>
              )}
              {values.mode === "reaction" &&
                listField(
                  "emojis",
                  "Reaction emojis",
                  "One emoji per role, in the same order. Separate with commas."
                )}
              <button
                type="button"
                className="text-[11px] font-medium text-primary"
                onClick={() => setAdvanced((v) => !v)}
              >
                {advanced ? "− Hide" : "+ Show"} prerequisites & exclusive
                groups
              </button>
              {advanced && (
                <div className="space-y-5 rounded-xl border bg-muted/20 p-4">
                  <Field
                    label="Prerequisite roles"
                    hint="Members must already have every selected role."
                  >
                    <RolePicker
                      roles={roles.filter((r) => !r.managed)}
                      value={values.prerequisiteIds}
                      onChange={(v) => set("prerequisiteIds", v)}
                    />
                  </Field>
                  <Field
                    label="Mutually exclusive roles"
                    hint="Only one of these roles may be selected at once."
                  >
                    <RolePicker
                      roles={safeRoles}
                      value={values.exclusiveRoleIds}
                      onChange={(v) => set("exclusiveRoleIds", v)}
                    />
                  </Field>
                </div>
              )}
              <div className="flex gap-2 rounded-lg bg-emerald-50 p-3 text-[11px] leading-relaxed text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                <ShieldCheck size={15} className="shrink-0" />
                Role hierarchy and permissions are re-checked on every
                assignment.
              </div>
            </>
          )}
          {kind === "rule" && (
            <>
              <Field label="What should Orbit watch for?">
                <FormSelect
                  value={values.type}
                  onValueChange={(next) => set("type", next)}
                  options={[
                    { value: "spam", label: "Message spam" },
                    { value: "repeated", label: "Repeated messages" },
                    { value: "mentions", label: "Excessive mentions" },
                    { value: "blocked_terms", label: "Blocked terms" },
                  ]}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label={
                    values.type === "mentions"
                      ? "Mention limit"
                      : "Message threshold"
                  }
                >
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={values.threshold}
                    onChange={(e) => set("threshold", Number(e.target.value))}
                  />
                </Field>
                <Field label="Time window (seconds)">
                  <Input
                    type="number"
                    min="2"
                    max="300"
                    value={values.windowSeconds}
                    onChange={(e) =>
                      set("windowSeconds", Number(e.target.value))
                    }
                  />
                </Field>
              </div>
              {values.type === "blocked_terms" && (
                <Field
                  label="Blocked terms"
                  hint="Case-insensitive literal phrases. One per line."
                >
                  <ArrayInput
                    value={values.terms ?? []}
                    onChange={(v) => set("terms", v)}
                    multiline
                  />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="When triggered">
                  <FormSelect
                    value={values.action}
                    onValueChange={(next) => set("action", next)}
                    options={[
                      { value: "delete", label: "Delete message" },
                      { value: "warn", label: "Delete & warn" },
                      { value: "timeout", label: "Delete & timeout" },
                    ]}
                  />
                </Field>
                <Field label="Timeout duration (minutes)">
                  <Input
                    type="number"
                    min="1"
                    max="40320"
                    value={values.durationMinutes}
                    onChange={(e) =>
                      set("durationMinutes", Number(e.target.value))
                    }
                    disabled={values.action !== "timeout"}
                  />
                </Field>
              </div>
              <Field label="Exempt roles">
                <RolePicker
                  roles={roles.filter((r) => !r.managed)}
                  value={values.exemptRoleIds ?? []}
                  onChange={(v) => set("exemptRoleIds", v)}
                />
              </Field>
              <Field label="Exempt channels">
                <div className="flex max-h-28 flex-wrap gap-2 overflow-auto rounded-lg border p-3">
                  {channels.map((c) => (
                    <label
                      className="flex items-center gap-1.5 text-[11px]"
                      key={c.id}
                    >
                      <Checkbox
                        checked={(values.exemptChannelIds ?? []).includes(c.id)}
                        onChange={(e) =>
                          set(
                            "exemptChannelIds",
                            e.target.checked
                              ? [...(values.exemptChannelIds ?? []), c.id]
                              : (values.exemptChannelIds ?? []).filter(
                                  (id: string) => id !== c.id
                                )
                          )
                        }
                      />
                      #{c.name}
                    </label>
                  ))}
                </div>
              </Field>
            </>
          )}
          {kind === "shop" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Item type">
                  <FormSelect
                    value={values.type}
                    onValueChange={(next) => set("type", next)}
                    options={[
                      { value: "role", label: "Discord role" },
                      { value: "item", label: "Virtual item / perk" },
                    ]}
                  />
                </Field>
                <Field label="Item emoji">
                  <Input
                    value={values.emoji}
                    maxLength={8}
                    onChange={(e) => set("emoji", e.target.value)}
                  />
                </Field>
              </div>
              {values.type === "role" && (
                <Field label="Role to unlock" required>
                  <Combobox
                    value={values.roleId ?? ""}
                    onValueChange={(next) => set("roleId", next)}
                    placeholder="Choose a safe role"
                    searchPlaceholder="Search roles…"
                    options={[
                      { value: "", label: "Choose a safe role" },
                      ...safeRoles.map((r) => ({
                        value: r.id,
                        label: `@${r.name}`,
                      })),
                    ]}
                  />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label={`Price (${data.guild.config.economy.currency})`}>
                  <Input
                    type="number"
                    required
                    min="1"
                    max="100000000"
                    value={values.price}
                    onChange={(e) => set("price", Number(e.target.value))}
                  />
                </Field>
                <Field label="Stock" hint="Use −1 for unlimited stock.">
                  <Input
                    type="number"
                    min="-1"
                    max="100000"
                    value={values.stock}
                    onChange={(e) => set("stock", Number(e.target.value))}
                  />
                </Field>
              </div>
              <p className="rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                Virtual community currency only. Item purchases create a
                persistent entitlement. Role rewards can be reclaimed with /shop
                claim if Discord delivery fails.
              </p>
            </>
          )}
          {kind === "deal" && (
            <>
              <GameSearch
                onSelect={(g) => {
                  set("gameId", g.id);
                  if (!name) setName(g.title);
                }}
                selected={values.gameId}
              />
              {!values.gameId && (
                <div className="space-y-3 rounded-lg border border-violet-200/60 bg-violet-50/40 p-4 dark:border-violet-500/20 dark:bg-violet-500/5">
                  <p className="text-[12px] font-medium">
                    Automatic posts · familiar games only
                  </p>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Require ITAD top-list membership AND real Steam review
                    evidence. DLC, mature/unknown games and missing ratings are
                    excluded. Popular indie games can qualify; random 100%-off
                    listings cannot.
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <Field
                      label="Top ITAD popularity position"
                      hint="Waitlists + collections, not live player rank."
                    >
                      <Input
                        type="number"
                        min="1"
                        max="500"
                        value={values.maxPopularityRank}
                        onChange={(e) =>
                          set("maxPopularityRank", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Minimum Steam reviews">
                      <Input
                        type="number"
                        min="1000"
                        max="10000000"
                        value={values.minReviews}
                        onChange={(e) =>
                          set("minReviews", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Minimum Steam positive (%)">
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={values.minScore}
                        onChange={(e) =>
                          set("minScore", Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field
                      label="Minimum recent Steam players"
                      hint="ITAD snapshot. Zero disables this extra floor."
                    >
                      <Input
                        type="number"
                        min="0"
                        max="10000000"
                        value={values.minPlayers}
                        onChange={(e) =>
                          set("minPlayers", Number(e.target.value))
                        }
                      />
                    </Field>
                  </div>
                </div>
              )}
              {channelSelect}
              <Field
                label="Maximum new posts per check"
                hint="Already delivered offers do not count. Unchanged prices are deduplicated."
              >
                <Input
                  type="number"
                  min="1"
                  max="5"
                  value={values.maxPostsPerCheck}
                  onChange={(e) =>
                    set("maxPostsPerCheck", Number(e.target.value))
                  }
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Region">
                  <FormSelect
                    value={values.region}
                    onValueChange={(next) => set("region", next)}
                    options={[
                      ["DE", "Germany"],
                      ["US", "United States"],
                      ["GB", "United Kingdom"],
                      ["FR", "France"],
                      ["CA", "Canada"],
                      ["AU", "Australia"],
                      ["NL", "Netherlands"],
                    ].map(([value, label]) => ({ value, label }))}
                  />
                </Field>
                <Field label="Currency">
                  <FormSelect
                    value={values.currency}
                    onValueChange={(next) => set("currency", next)}
                    options={["EUR", "USD", "GBP", "CAD", "AUD"].map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Minimum discount (%)">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={values.minDiscount}
                    onChange={(e) => set("minDiscount", Number(e.target.value))}
                  />
                </Field>
                <Field label="Maximum price">
                  <Input
                    type="number"
                    min="0"
                    max="10000"
                    step="0.01"
                    value={values.maxPrice}
                    onChange={(e) => set("maxPrice", Number(e.target.value))}
                  />
                </Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-[12px] font-medium">
                    Historical lows only
                  </p>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Requires historical-low data from the API.
                  </p>
                </div>
                <Switch
                  checked={values.historicalLow}
                  onCheckedChange={(v) => set("historicalLow", v)}
                  aria-label="Historical lows only"
                />
              </div>
              <Field
                label="Store IDs"
                hint="Optional comma-separated IsThereAnyDeal shop IDs. Empty includes all supported stores."
              >
                <ArrayInput
                  value={(values.stores ?? []).map(String)}
                  onChange={(v) =>
                    set(
                      "stores",
                      v.map(Number).filter((n) => Number.isInteger(n) && n > 0)
                    )
                  }
                  placeholder="All supported stores"
                />
              </Field>
              {notificationSelect}
              <Field label="Check every (minutes)">
                <Input
                  type="number"
                  min="15"
                  max="1440"
                  value={values.intervalMinutes}
                  onChange={(e) =>
                    set("intervalMinutes", Number(e.target.value))
                  }
                />
              </Field>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Prices and currencies are provided by IsThereAnyDeal. Orbit
                doesn’t convert prices; subscriptions only match the currency
                the API returns for your region.
              </p>
            </>
          )}
          {kind === "source" && (
            <>
              <Field label="Source adapter">
                <FormSelect
                  value={values.adapter}
                  onValueChange={(next) => {
                    set("adapter", next);
                    set("health", "setup_required");
                  }}
                  options={[
                    { value: "rss", label: "RSS / Atom feed" },
                    { value: "steam", label: "Steam · official app news API" },
                    { value: "webhook", label: "Signed incoming webhook" },
                  ]}
                />
              </Field>
              {values.adapter === "steam" ? (
                <Field
                  label="Steam application ID"
                  required
                  hint="Example: 570 for Dota 2. Uses Steam’s official ISteamNews API."
                >
                  <Input
                    type="number"
                    required
                    min="1"
                    value={values.appId ?? ""}
                    onChange={(e) => set("appId", Number(e.target.value))}
                  />
                </Field>
              ) : values.adapter === "webhook" ? (
                <div className="rounded-lg border border-violet-100 bg-violet-50 p-3 text-[11px] leading-relaxed text-violet-600 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
                  Save this source, then choose “Webhook credentials” from its
                  menu. Requests require a timestamp and HMAC-SHA256 signature.
                  Secrets are shown only once.
                </div>
              ) : (
                <Field
                  label="Verified RSS / Atom URL"
                  hint="HTTPS only. Private networks, redirects to internal hosts, and oversized responses are blocked."
                >
                  <Input
                    type="url"
                    value={values.url ?? ""}
                    onChange={(e) => set("url", e.target.value)}
                    placeholder="https://your-publisher.example/feed.xml"
                  />
                  <span className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
                    <Info size={13} className="mt-0.5 shrink-0" />
                    No default feed is assumed. Supply a publisher-supported
                    URL, or choose a signed webhook. Scraping is never enabled.
                  </span>
                </Field>
              )}
              {channelSelect}
              <div className="grid grid-cols-2 gap-4">
                {listField(
                  "keywords",
                  "Include keywords",
                  "Match any keyword; leave empty for all updates."
                )}
                {listField(
                  "tags",
                  "Source tags",
                  "Labels used by routing rules."
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Check every (minutes)">
                  <Input
                    type="number"
                    min="5"
                    max="1440"
                    value={values.intervalMinutes}
                    disabled={values.adapter === "webhook"}
                    onChange={(e) =>
                      set("intervalMinutes", Number(e.target.value))
                    }
                  />
                </Field>
                <Field label="Embed accent color">
                  <div className="flex h-10 items-center gap-2 rounded-lg border px-3">
                    <input
                      type="color"
                      value={values.embedColor}
                      onChange={(e) => set("embedColor", e.target.value)}
                      className="size-5 cursor-pointer border-0 bg-transparent p-0"
                    />
                    <span className="text-xs text-muted-foreground">
                      {values.embedColor}
                    </span>
                  </div>
                </Field>
              </div>
              {notificationSelect}
              <div className="flex items-center justify-between">
                <span className="text-xs">Include a short summary</span>
                <Switch
                  checked={values.includeSummary}
                  onCheckedChange={(v) => set("includeSummary", v)}
                  aria-label="Include a short summary"
                />
              </div>
              {values.adapter === "steam" && (
                <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                  <span className="text-xs leading-relaxed">
                    Official announcements only
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Uses Steam's app announcement feed only, so posts from
                      other publishers are not requested. Steam has no "first
                      party" field — the feed is the signal, nothing more.
                    </span>
                  </span>
                  <Switch
                    checked={!!values.officialOnly}
                    onCheckedChange={(v) => set("officialOnly", v)}
                    aria-label="Official announcements only"
                  />
                </div>
              )}
            </>
          )}
          {kind === "route" && (
            <>
              <Field label="Sources" required>
                <div className="space-y-2 rounded-lg border p-3">
                  {data.resources
                    .filter((r) => r.kind === "source")
                    .map((s) => (
                      <label
                        key={s.id}
                        className="flex items-center gap-2 text-xs"
                      >
                        <Checkbox
                          checked={(values.sourceIds ?? []).includes(s.id)}
                          onChange={(e) =>
                            set(
                              "sourceIds",
                              e.target.checked
                                ? [...(values.sourceIds ?? []), s.id]
                                : (values.sourceIds ?? []).filter(
                                    (id: string) => id !== s.id
                                  )
                            )
                          }
                        />
                        {s.name}
                      </label>
                    ))}
                </div>
              </Field>
              {channelSelect}
              {listField(
                "keywords",
                "Only matching keywords",
                "Match any keyword in the title or summary."
              )}
              {listField(
                "tags",
                "Only matching tags",
                "Match any item tag. Empty includes all tags."
              )}
              {notificationSelect}
              <Field label="Embed accent">
                <Input
                  pattern="#[0-9a-fA-F]{6}"
                  value={values.embedColor}
                  onChange={(e) => set("embedColor", e.target.value)}
                />
              </Field>
            </>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-[12px] leading-relaxed text-red-600 dark:border-red-500/20 dark:bg-red-500/10"
            >
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-t pt-5">
            <label className="flex items-center gap-2 text-[12px]">
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                aria-label="Enable configuration"
              />
              {enabled ? "Enabled" : "Paused"}
            </label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? (
                  <Spinner />
                ) : resource ? (
                  <Save size={14} />
                ) : (
                  <Plus size={14} />
                )}
                {resource ? "Save changes" : `Create ${kindNames[kind]}`}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: { id: string; name: string; color: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="flex max-h-36 flex-wrap gap-2 overflow-y-auto rounded-lg border bg-muted/10 p-3">
      {roles.map((r) => (
        <label
          className={cn(
            "flex cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2 py-1.5 text-[11px] transition",
            value.includes(r.id)
              ? "border-violet-300 bg-violet-50/70 dark:border-violet-500/50 dark:bg-violet-500/10"
              : "hover:border-violet-200"
          )}
          key={r.id}
        >
          <Checkbox
            checked={value.includes(r.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, r.id]
                  : value.filter((id) => id !== r.id)
              )
            }
          />
          <RoleDot role={r} />
          {r.name}
        </label>
      ))}
      {!roles.length && (
        <span className="text-[11px] text-muted-foreground">
          No assignable roles. Check the bot’s role hierarchy.
        </span>
      )}
    </div>
  );
}
function GameSearch({
  onSelect,
  selected,
}: {
  onSelect: (g: { id: string; title: string }) => void;
  selected: string;
}) {
  const { api } = useWorkspace();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  async function search() {
    setLoading(true);
    try {
      setResults(await api(`/game-search?q=${encodeURIComponent(q)}`));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <Field
      label="Watch a specific game"
      hint="Leave unselected for automatic popular-game discovery. Selecting a specific game is a deliberate watch, not popularity-filtered discovery. IsThereAnyDeal powers live search."
    >
      <div className="flex gap-2">
        <Input
          placeholder="Search for your next favorite game…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={search}
          disabled={q.length < 2 || loading}
        >
          {loading ? <Spinner /> : <Search size={15} />}
        </Button>
      </div>
      {selected && (
        <Badge tone="green">
          <Check size={10} />
          Game watchlist selected
          <button
            type="button"
            aria-label="Remove selected game"
            onClick={() => onSelect({ id: "", title: "" })}
          >
            <X size={11} />
          </button>
        </Badge>
      )}
      {results.length > 0 && (
        <div className="max-h-36 overflow-y-auto rounded-lg border bg-card">
          {results.map((r) => (
            <button
              className="flex w-full items-center justify-between p-3 text-left text-xs hover:bg-muted"
              type="button"
              key={r.id}
              onClick={() => {
                onSelect(r);
                setQ(r.title);
                setResults([]);
              }}
            >
              {r.title}
              <Plus size={12} />
            </button>
          ))}
        </div>
      )}
    </Field>
  );
}

function ArrayInput({
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const [text, setText] = useState(value.join(multiline ? "\n" : ", "));
  const update = (s: string) => {
    setText(s);
    onChange(
      s
        .split(multiline ? "\n" : ",")
        .map((v) => v.trim())
        .filter(Boolean)
    );
  };
  return multiline ? (
    <Textarea
      value={text}
      onChange={(e) => update(e.target.value)}
      placeholder={placeholder}
      maxLength={10000}
    />
  ) : (
    <Input
      value={text}
      onChange={(e) => update(e.target.value)}
      placeholder={placeholder}
    />
  );
}
