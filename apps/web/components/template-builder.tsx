"use client";

import {
  ASSIGNABLE_PERMISSIONS,
  STARTER_BLUEPRINTS,
  blankChannel,
  blankOverwrite,
  blankRole,
  buildBlankTemplate,
  buildFromBlueprint,
  canMoveDown,
  canMoveUp,
  moveItem,
  nextTemplateKey,
  permissionBitfield,
  permissionNames,
  splitPermissions,
  validateTemplateDocument,
  type TemplateIssue,
} from "@orbit/core/template-builder";
import {
  TEMPLATE_LIMITS,
  templateChannelTypes,
  type ServerTemplateDocument,
  type TemplateChannel,
  type TemplateRole,
} from "@orbit/core/templates";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Info,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "./workspace";
import { Button } from "./ui/button";
import {
  Badge,
  Card,
  Field,
  Input,
  NativeSelect,
  SectionHeader,
  Textarea,
} from "./ui/primitives";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { ConfirmDialog } from "./ui/confirm-dialog";

/** `./ui/dialog` has no footer primitive, so the action row is defined here. */
function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t pt-4">
      {children}
    </div>
  );
}

/**
 * A template row as the dashboard receives it.
 *
 * Exported so the templates page and this builder agree on one shape; the
 * `data` field is the parsed document, which is what makes editing possible.
 */
export type StoredTemplate = {
  id: string;
  sourceGuildId: string;
  name: string;
  description: string;
  kind: string;
  version: number;
  data: ServerTemplateDocument;
  createdBy: string;
  createdAt: string;
};

const CHANNEL_TYPE_LABELS: Record<TemplateChannel["type"], string> = {
  text: "Text",
  voice: "Voice",
  category: "Category",
  forum: "Forum",
  stage: "Stage",
  media: "Media",
};

/** Compact checkbox grid, so permissions are never shown as a raw bitfield. */
function PermissionGrid({
  value,
  onChange,
  idPrefix,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  idPrefix: string;
  label: string;
}) {
  const selected = new Set(permissionNames(value));
  const refused = splitPermissions(value).refused;
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="grid max-h-40 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-lg border p-2.5 sm:grid-cols-3">
        {ASSIGNABLE_PERMISSIONS.map((name) => (
          <label
            key={name}
            className="flex cursor-pointer items-center gap-1.5 text-[10px] leading-tight"
          >
            <Checkbox
              id={`${idPrefix}-${name}`}
              checked={selected.has(name)}
              onCheckedChange={(next) => {
                const set = new Set(selected);
                if (next) set.add(name);
                else set.delete(name);
                onChange(permissionBitfield([...set]));
              }}
            />
            <span className="truncate" title={name}>
              {name.replace(/([A-Z])/g, " $1").trim()}
            </span>
          </label>
        ))}
      </div>
      {refused.length > 0 && (
        <p className="text-[10px] text-amber-700 dark:text-amber-300">
          Removed on save: {refused.join(", ")}. A template never grants those.
        </p>
      )}
    </div>
  );
}

function OverwriteEditor({
  channel,
  index,
  roleKeys,
  onChange,
  onRemove,
}: {
  channel: TemplateChannel;
  index: number;
  roleKeys: string[];
  onChange: (next: TemplateChannel["overwrites"][number]) => void;
  onRemove: () => void;
}) {
  const overwrite = channel.overwrites[index]!;
  const [open, setOpen] = useState(false);
  const allow = permissionNames(overwrite.allow);
  const deny = permissionNames(overwrite.deny);
  return (
    <div className="rounded-lg border bg-muted/30">
      <div className="flex items-center gap-2 p-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 text-muted-foreground"
        >
          {open ? (
            <ChevronDown size={13} aria-hidden />
          ) : (
            <ChevronRight size={13} aria-hidden />
          )}
          <span className="sr-only">
            {open ? "Collapse" : "Expand"} permission override
          </span>
        </button>
        <NativeSelect
          aria-label="Role for this override"
          className="h-7 flex-1 text-[11px]"
          value={overwrite.roleKey}
          onChange={(e) => onChange({ ...overwrite, roleKey: e.target.value })}
        >
          <option value="role:everyone">@everyone</option>
          {roleKeys.map((key) => (
            <option key={key} value={key}>
              {key.replace(/^role:/, "")}
            </option>
          ))}
        </NativeSelect>
        <span className="max-w-[7rem] truncate text-[10px] text-muted-foreground">
          {allow.length ? `+${allow.length}` : ""}
          {allow.length && deny.length ? " / " : ""}
          {deny.length ? `−${deny.length}` : ""}
          {!allow.length && !deny.length ? "no changes" : ""}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove permission override for ${overwrite.roleKey}`}
        >
          <Trash2 size={12} aria-hidden />
        </Button>
      </div>
      {open && (
        <div className="grid gap-3 border-t p-2.5 sm:grid-cols-2">
          <PermissionGrid
            idPrefix={`allow-${channel.key}-${index}`}
            label="Allow"
            value={overwrite.allow}
            onChange={(next) => onChange({ ...overwrite, allow: next })}
          />
          <PermissionGrid
            idPrefix={`deny-${channel.key}-${index}`}
            label="Deny"
            value={overwrite.deny}
            onChange={(next) => onChange({ ...overwrite, deny: next })}
          />
        </div>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  index,
  total,
  roles,
  channels,
  onChange,
  onMove,
  onRemove,
}: {
  channel: TemplateChannel;
  index: number;
  total: number;
  roles: TemplateRole[];
  channels: TemplateChannel[];
  onChange: (next: TemplateChannel) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const categories = channels.filter((c) => c.type === "category");
  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveUp(index)}
            onClick={() => onMove(index - 1)}
            aria-label={`Move ${channel.name} up`}
          >
            <ArrowUp size={12} aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveDown(index, total)}
            onClick={() => onMove(index + 1)}
            aria-label={`Move ${channel.name} down`}
          >
            <ArrowDown size={12} aria-hidden />
          </Button>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="Channel name">
            <Input
              value={channel.name}
              maxLength={TEMPLATE_LIMITS.nameLength}
              onChange={(e) => onChange({ ...channel, name: e.target.value })}
            />
          </Field>
          <Field label="Type">
            <NativeSelect
              aria-label="Channel type"
              value={channel.type}
              onChange={(e) =>
                onChange({
                  ...channel,
                  type: e.target.value as TemplateChannel["type"],
                })
              }
            >
              {templateChannelTypes.map((type) => (
                <option key={type} value={type}>
                  {CHANNEL_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field
            label="Category"
            hint="Only category channels can be a parent."
          >
            <NativeSelect
              aria-label="Parent category"
              value={channel.parentKey ?? ""}
              onChange={(e) =>
                onChange({ ...channel, parentKey: e.target.value || null })
              }
            >
              <option value="">No category (top level)</option>
              {categories
                .filter((c) => c.key !== channel.key)
                .map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
            </NativeSelect>
          </Field>
          <Field label="Topic">
            <Input
              value={channel.topic ?? ""}
              maxLength={TEMPLATE_LIMITS.topicLength}
              onChange={(e) => onChange({ ...channel, topic: e.target.value })}
            />
          </Field>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove channel ${channel.name}`}
        >
          <Trash2 size={12} aria-hidden />
        </Button>
      </div>

      <div className="mt-3 space-y-2 border-t pt-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium">Permission overrides</p>
          <Button
            size="sm"
            variant="outline"
            disabled={
              channel.overwrites.length >= TEMPLATE_LIMITS.overwritesPerChannel
            }
            onClick={() =>
              onChange({
                ...channel,
                overwrites: [
                  ...channel.overwrites,
                  blankOverwrite("role:everyone"),
                ],
              })
            }
          >
            <Plus size={12} aria-hidden /> Add override
          </Button>
        </div>
        {channel.overwrites.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">
            None. This channel uses the server defaults.
          </p>
        ) : (
          channel.overwrites.map((_, i) => (
            <OverwriteEditor
              key={i}
              channel={channel}
              index={i}
              roleKeys={roles.map((r) => r.key)}
              onChange={(next) =>
                onChange({
                  ...channel,
                  overwrites: channel.overwrites.map((o, j) =>
                    j === i ? next : o
                  ),
                })
              }
              onRemove={() =>
                onChange({
                  ...channel,
                  overwrites: channel.overwrites.filter((_, j) => j !== i),
                })
              }
            />
          ))
        )}
      </div>
    </Card>
  );
}

function RoleRow({
  role,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  role: TemplateRole;
  index: number;
  total: number;
  onChange: (next: TemplateRole) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const [openPerms, setOpenPerms] = useState(false);
  return (
    <Card className="p-3.5">
      <div className="flex items-start gap-2">
        <div className="flex flex-col gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveUp(index)}
            onClick={() => onMove(index - 1)}
            aria-label={`Move ${role.name} up`}
          >
            <ArrowUp size={12} aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canMoveDown(index, total)}
            onClick={() => onMove(index + 1)}
            aria-label={`Move ${role.name} down`}
          >
            <ArrowDown size={12} aria-hidden />
          </Button>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Field label="Role name">
            <Input
              value={role.name}
              maxLength={TEMPLATE_LIMITS.nameLength}
              onChange={(e) => onChange({ ...role, name: e.target.value })}
            />
          </Field>
          <Field label="Colour" hint="Optional; left unset means no colour.">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`Colour for ${role.name}`}
                className="h-8 w-12 cursor-pointer rounded border bg-background"
                value={role.color ?? "#99aab5"}
                onChange={(e) => onChange({ ...role, color: e.target.value })}
              />
              <Button
                size="sm"
                variant="ghost"
                disabled={!role.color}
                onClick={() => onChange({ ...role, color: null })}
              >
                Clear
              </Button>
            </div>
          </Field>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          aria-label={`Remove role ${role.name}`}
        >
          <Trash2 size={12} aria-hidden />
        </Button>
      </div>

      <div className="mt-3 space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              id={`hoist-${role.key}`}
              checked={role.hoist}
              onCheckedChange={(v) => onChange({ ...role, hoist: !!v })}
            />
            Show members separately
          </label>
          <label className="flex items-center gap-1.5 text-[11px]">
            <Checkbox
              id={`mention-${role.key}`}
              checked={role.mentionable}
              onCheckedChange={(v) => onChange({ ...role, mentionable: !!v })}
            />
            Anyone may @mention
          </label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpenPerms((v) => !v)}
            aria-expanded={openPerms}
          >
            {openPerms ? (
              <ChevronDown size={12} aria-hidden />
            ) : (
              <ChevronRight size={12} aria-hidden />
            )}
            Permissions ({permissionNames(role.permissions).length})
          </Button>
        </div>
        {openPerms && (
          <PermissionGrid
            idPrefix={`role-${role.key}`}
            label="Role permissions"
            value={role.permissions}
            onChange={(next) => onChange({ ...role, permissions: next })}
          />
        )}
      </div>
    </Card>
  );
}

/**
 * The editable template builder.
 *
 * Edits are held in local state and only reach the server on Save, so a
 * background list refresh (or a completed capture) cannot overwrite what the
 * operator is typing. Validation runs continuously for display and again on the
 * server before anything is stored.
 */
export function TemplateBuilderDialog({
  open,
  onOpenChange,
  template,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: StoredTemplate | null;
  onSaved: () => void;
}) {
  const { api } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [doc, setDoc] = useState<ServerTemplateDocument | null>(null);
  const [baseline, setBaseline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  // Load the document when the dialog opens, per template.
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name);
      setDescription(template.description);
      setDoc(structuredClone(template.data));
      setBaseline(JSON.stringify(template.data) + template.name);
    } else {
      setName("");
      setDescription("");
      setDoc(null);
      setBaseline("");
    }
    setError("");
  }, [open, template]);

  const dirty =
    !!doc && JSON.stringify(doc) + name !== baseline
      ? true
      : !!doc && !template;

  // A reload or a navigation away would silently discard the draft.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const { issues, errors } = useMemo(() => {
    if (!doc)
      return { issues: [] as TemplateIssue[], errors: [] as TemplateIssue[] };
    const result = validateTemplateDocument({ ...doc, name: name || doc.name });
    return {
      issues: result.issues,
      errors: result.issues.filter((i) => i.severity === "error"),
    };
  }, [doc, name]);

  const attemptClose = useCallback(() => {
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(false);
  }, [dirty, onOpenChange]);

  const start = (mode: {
    blueprint?: string;
    blank?: "structure" | "configuration" | "both";
  }) => {
    const built = mode.blueprint
      ? buildFromBlueprint(mode.blueprint, {
          name: name || undefined,
          description: description || undefined,
        })
      : buildBlankTemplate({
          name: name || "New template",
          description,
          kind: mode.blank ?? "both",
        });
    if (!built) return;
    setDoc(built);
    setName(built.name);
  };

  const patch = (next: Partial<ServerTemplateDocument>) =>
    setDoc((current) => (current ? { ...current, ...next } : current));

  const roles = doc?.structure?.roles ?? [];
  const channels = doc?.structure?.channels ?? [];

  const setRoles = (next: TemplateRole[]) =>
    patch({ structure: { roles: next, channels } });
  const setChannels = (next: TemplateChannel[]) =>
    patch({ structure: { roles, channels: next } });

  async function save() {
    if (!doc) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        ...doc,
        name: name.trim(),
        description: description.trim(),
      };
      const saved = template
        ? await api(`/templates/${template.id}`, "PATCH", {
            name: payload.name,
            document: payload,
          })
        : await api("/templates", "POST", {
            name: payload.name,
            document: payload,
          });
      setBaseline(JSON.stringify(payload) + payload.name);
      onSaved();
      onOpenChange(false);
      return saved;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The template could not be saved."
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) attemptClose();
          else onOpenChange(true);
        }}
      >
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {template ? `Edit “${template.name}”` : "New template"}
            </DialogTitle>
            <DialogDescription>
              A template stores roles and channels as portable keys, not Discord
              ids, so it can be applied to any server you manage. Nothing is
              created until you preview and apply it.
            </DialogDescription>
          </DialogHeader>

          {!doc ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Template name" required>
                  <Input
                    value={name}
                    maxLength={TEMPLATE_LIMITS.nameLength}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Starter community"
                  />
                </Field>
                <Field label="Description">
                  <Textarea
                    rows={2}
                    value={description}
                    maxLength={TEMPLATE_LIMITS.descriptionLength}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this layout is for"
                  />
                </Field>
              </div>

              <div>
                <SectionHeader title="Start from a researched starter" />
                <div className="mt-2 grid gap-2.5">
                  {STARTER_BLUEPRINTS.map((blueprint) => (
                    <button
                      key={blueprint.id}
                      type="button"
                      disabled={!name.trim()}
                      onClick={() => start({ blueprint: blueprint.id })}
                      className="rounded-xl border p-3 text-left hover:bg-muted/50 disabled:opacity-50"
                    >
                      <p className="text-xs font-semibold">{blueprint.name}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {blueprint.summary}
                      </p>
                      <p className="mt-1 text-[10px] italic text-muted-foreground">
                        {blueprint.bestFor}
                      </p>
                    </button>
                  ))}
                </div>
                {!name.trim() && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Name the template first to enable the starters.
                  </p>
                )}
              </div>

              <div>
                <SectionHeader title="Or start empty" />
                <div className="mt-2 flex flex-wrap gap-2">
                  {(
                    [
                      ["both", "Roles, channels and Orbit settings"],
                      ["structure", "Roles and channels only"],
                      ["configuration", "Orbit settings only"],
                    ] as const
                  ).map(([kind, label]) => (
                    <Button
                      key={kind}
                      size="sm"
                      variant="outline"
                      disabled={!name.trim()}
                      onClick={() => start({ blank: kind })}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                <Field label="Template name" required>
                  <Input
                    value={name}
                    maxLength={TEMPLATE_LIMITS.nameLength}
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="Description">
                  <Input
                    value={description}
                    maxLength={TEMPLATE_LIMITS.descriptionLength}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </Field>
                <div className="flex items-end">
                  <Badge tone={dirty ? "amber" : "green"}>
                    {dirty ? "Unsaved changes" : "Saved"}
                  </Badge>
                </div>
              </div>

              {issues.length > 0 && (
                <div className="space-y-1.5">
                  {issues.map((issue, i) => (
                    <p
                      key={`${issue.path}-${i}`}
                      className={
                        issue.severity === "error"
                          ? "flex items-start gap-1.5 rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300"
                          : "flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                      }
                    >
                      {issue.severity === "error" ? (
                        <AlertTriangle
                          size={13}
                          className="mt-0.5 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <Info
                          size={13}
                          className="mt-0.5 shrink-0"
                          aria-hidden
                        />
                      )}
                      <span>
                        <span className="font-medium">{issue.path}: </span>
                        {issue.message}
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {doc.structure && (
                <>
                  <div>
                    <div className="flex items-center justify-between">
                      <SectionHeader title={`Roles (${roles.length})`} />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={roles.length >= TEMPLATE_LIMITS.roles}
                        onClick={() =>
                          setRoles([
                            ...roles,
                            blankRole({
                              key: nextTemplateKey(
                                "role",
                                roles.map((r) => r.key)
                              ),
                              position: roles.length,
                            }),
                          ])
                        }
                      >
                        <Plus size={12} aria-hidden /> Add role
                      </Button>
                    </div>
                    <div className="mt-2 space-y-2.5">
                      {roles.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          No roles yet.
                        </p>
                      )}
                      {roles.map((role, index) => (
                        <RoleRow
                          key={role.key}
                          role={role}
                          index={index}
                          total={roles.length}
                          onChange={(next) =>
                            setRoles(
                              roles.map((r, i) => (i === index ? next : r))
                            )
                          }
                          onMove={(to) => setRoles(moveItem(roles, index, to))}
                          onRemove={() =>
                            setRoles(roles.filter((_, i) => i !== index))
                          }
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <SectionHeader title={`Channels (${channels.length})`} />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={channels.length >= TEMPLATE_LIMITS.channels}
                        onClick={() =>
                          setChannels([
                            ...channels,
                            blankChannel({
                              key: nextTemplateKey(
                                "channel",
                                channels.map((c) => c.key)
                              ),
                              position: channels.length,
                            }),
                          ])
                        }
                      >
                        <Plus size={12} aria-hidden /> Add channel
                      </Button>
                    </div>
                    <div className="mt-2 space-y-2.5">
                      {channels.length === 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          No channels yet.
                        </p>
                      )}
                      {channels.map((channel, index) => (
                        <ChannelRow
                          key={channel.key}
                          channel={channel}
                          index={index}
                          total={channels.length}
                          roles={roles}
                          channels={channels}
                          onChange={(next) =>
                            setChannels(
                              channels.map((c, i) => (i === index ? next : c))
                            )
                          }
                          onMove={(to) =>
                            setChannels(moveItem(channels, index, to))
                          }
                          onRemove={() =>
                            setChannels(channels.filter((_, i) => i !== index))
                          }
                        />
                      ))}
                    </div>
                  </div>
                </>
              )}

              {error && (
                <p className="rounded-lg bg-red-50 p-2.5 text-[11px] text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {error}
                </p>
              )}

              <DialogFooter>
                <span
                  aria-live="polite"
                  className="mr-auto text-[11px] text-muted-foreground"
                >
                  {errors.length
                    ? `${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed before saving.`
                    : dirty
                      ? "Ready to save."
                      : "No changes yet."}
                </span>
                <Button variant="outline" onClick={attemptClose}>
                  {dirty ? "Discard" : "Close"}
                </Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving || errors.length > 0 || !name.trim()}
                >
                  <Save size={12} aria-hidden />
                  {saving ? "Saving…" : "Save template"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard unsaved changes?"
        description="This template has edits that have not been saved. Discarding them cannot be undone."
        confirmLabel="Discard changes"
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
