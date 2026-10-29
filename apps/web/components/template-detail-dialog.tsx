"use client";

import { Copy, Pencil, ScanSearch, Trash2 } from "lucide-react";
import type { StoredTemplate } from "@orbit/db";
import { Badge } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Everything inside one template, without applying it.
 *
 * The template list used to be the only place a template was described, and it
 * could afford to show three counts and a description: the row's job was to be
 * picked, and the right-hand card did the rest. That left no way to answer the
 * question an operator actually asks before applying anything — *what is in
 * this?* — short of previewing it against a target and reading a plan, which
 * only works if the target is already chosen and only describes the difference.
 *
 * So the row opens this. It is a read-only account of the document: the roles
 * it would create, the channels it would create, and the Orbit settings it
 * carries. The actions that already existed are collected here too, because a
 * reader who has just asked "what is in this" is exactly the reader who may
 * want to edit, copy or delete it.
 *
 * Deleting is offered only where deleting is allowed: a template can be removed
 * solely from the server that captured it, and the dialog says so rather than
 * offering a button the API would refuse.
 */

/** A permission bitfield as a decimal string, summarised rather than dumped. */
function permissionSummary(bits: string): string {
  const value = BigInt(bits || "0");
  if (value === 0n) return "no permissions";
  // Administrator is the one bit that makes every other bit moot, and it is the
  // one thing a reader must never have to infer from a number.
  if ((value & 8n) === 8n) return "Administrator";
  const names = [
    "Manage Roles",
    "Manage Channels",
    "Moderate Members",
    "Send Messages",
    "Manage Messages",
    "Connect",
    "Speak",
  ];
  const flags = [
    268435456n,
    16n,
    1099511627776n,
    2048n,
    8192n,
    1048576n,
    2097152n,
  ];
  const held = names.filter((_, index) => (value & flags[index]) !== 0n);
  // Three is enough to tell one role from another here; the rest are visible
  // in the editor, and a full permission dump is not what this dialog is for.
  return held.length ? held.slice(0, 3).join(", ") : "custom permissions";
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function TemplateDetailDialog({
  template,
  open,
  onOpenChange,
  sourceName,
  onEdit,
  onDuplicate,
  onDelete,
  onPreview,
  duplicating,
  planning,
  canDelete,
}: {
  template: StoredTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The server the template was captured from, already resolved. */
  sourceName: string;
  onEdit: (template: StoredTemplate) => void;
  onDuplicate: (template: StoredTemplate) => void;
  onDelete: (template: StoredTemplate) => void;
  onPreview: () => void;
  duplicating: boolean;
  planning: boolean;
  /** A template is removable only from the server that captured it. */
  canDelete: boolean;
}) {
  const roles = template?.data.structure?.roles ?? [];
  const channels = template?.data.structure?.channels ?? [];
  const config = template?.data.config;
  const modules = config?.modules
    ? Object.entries(config.modules)
        .filter(([, on]) => on)
        .map(([key]) => key)
    : [];
  const parentNames = new Map(
    channels.map((channel) => [channel.key, channel.name])
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        {template && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6 text-sm">
                {template.name}
              </DialogTitle>
              <DialogDescription className="text-[11px]">
                {/*
                  Stated in the dialog rather than left to the row: a template
                  carries documents, not a server.
                */}
                Captured from {sourceName} · {template.data.kind}
                {template.data.omitted.length
                  ? ` · ${template.data.omitted.length} kinds of data deliberately not included`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {template.description || "No description."}
            </p>

            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold">
                Roles
                <Badge tone="neutral" className="text-[9px]">
                  {roles.length}
                </Badge>
              </h3>
              {roles.length ? (
                <ul className="space-y-1">
                  {roles.map((role) => (
                    <li
                      key={role.key}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/25 dark:ring-white/30"
                        style={{ backgroundColor: role.color ?? "#99a1af" }}
                      />
                      <span className="font-medium">{role.name}</span>
                      <span className="truncate text-muted-foreground">
                        {permissionSummary(role.permissions)}
                        {role.hoist ? " · shown separately" : ""}
                        {role.mentionable ? " · mentionable" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This template carries no roles.
                </p>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold">
                Channels
                <Badge tone="neutral" className="text-[9px]">
                  {channels.length}
                </Badge>
              </h3>
              {channels.length ? (
                <ul className="space-y-1">
                  {channels.map((channel) => (
                    <li key={channel.key} className="text-[11px]">
                      <span className="font-medium">{channel.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {channel.type}
                        {channel.parentKey
                          ? ` · in ${parentNames.get(channel.parentKey) ?? channel.parentKey}`
                          : ""}
                        {channel.overwrites.length
                          ? ` · ${channel.overwrites.length} permission override${channel.overwrites.length === 1 ? "" : "s"}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  This template carries no channels.
                </p>
              )}
            </section>

            <section className="space-y-1.5">
              <h3 className="text-[11px] font-semibold">Orbit settings</h3>
              {config ? (
                <dl className="divide-y text-[11px]">
                  {modules.length ? (
                    <ConfigRow label="Modules on" value={modules.join(", ")} />
                  ) : null}
                  {config.economy ? (
                    <ConfigRow
                      label="Currency"
                      value={`${config.economy.symbol ?? ""} ${config.economy.currency ?? ""} · ${config.economy.dailyAmount ?? 0}/day`}
                    />
                  ) : null}
                  {config.music ? (
                    <ConfigRow
                      label="Music"
                      value={`volume ${config.music.defaultVolume ?? 100} · queue ${config.music.maxQueue ?? 50}`}
                    />
                  ) : null}
                  {config.moderation ? (
                    <ConfigRow
                      label="Moderation"
                      value={`${config.moderation.escalationThreshold ?? "—"} in ${config.moderation.escalationMinutes ?? "—"} min`}
                    />
                  ) : null}
                  {config.bindings ? (
                    <ConfigRow
                      label="Bound to"
                      value={
                        [
                          config.bindings.auditChannelKey,
                          config.bindings.notificationRoleKey,
                        ]
                          .filter(Boolean)
                          .join(", ") || "nothing"
                      }
                    />
                  ) : null}
                </dl>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Structure only. No Orbit settings are carried.
                </p>
              )}
            </section>

            {/*
              All four actions, in one place. The destructive one is last and
              is only present where the API would accept it.
            */}
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(template)}
              >
                <Pencil size={12} aria-hidden /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={duplicating}
                onClick={() => onDuplicate(template)}
              >
                <Copy size={12} aria-hidden />
                {duplicating ? "Duplicating…" : "Duplicate"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={planning}
                onClick={onPreview}
              >
                <ScanSearch size={12} aria-hidden />
                {planning ? "Previewing…" : "Preview"}
              </Button>
              {canDelete && (
                <Button
                  variant="outline"
                  size="sm"
                  className={cn("text-red-700 dark:text-red-400")}
                  onClick={() => onDelete(template)}
                >
                  <Trash2 size={12} aria-hidden /> Delete
                </Button>
              )}
            </div>
            {!canDelete && (
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Only {sourceName} — the server this was captured from — can
                delete it.
              </p>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
