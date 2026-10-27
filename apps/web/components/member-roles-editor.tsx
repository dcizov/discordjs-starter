"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/primitives";
import { RoleBadge } from "@/components/role-badge";
import { useWorkspace } from "@/components/workspace";
import type { Member } from "@orbit/core/types";

/**
 * Editing one member's roles.
 *
 * The list of roles offered here comes from the bot, which is the only thing
 * that knows the live hierarchy — both the operator's and Orbit's own — and
 * can therefore say what is genuinely assignable. The browser's idea of what
 * is allowed is only ever a starting point: the server re-derives the whole
 * decision and can still refuse individual roles, which is why the result is
 * reported per role rather than as one success or one failure.
 */

type EditableRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  managed: boolean;
  permissions: string;
};

type ApplyResult = {
  added?: string[];
  removed?: string[];
  denied?: { roleId: string; reason: string }[];
  failed?: {
    roleId: string;
    operation: string;
    applied: boolean;
    error?: string;
  }[];
  roles?: string[];
};

export function MemberRolesEditor({
  member,
  onClose,
  onChanged,
}: {
  member: Member | null;
  onClose: () => void;
  /** Called after a change so the roster and any role filter refresh. */
  onChanged: () => void;
}) {
  const { api } = useWorkspace();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [offer, setOffer] = useState<EditableRole[]>([]);
  const [reason, setReason] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ApplyResult | null>(null);

  const guildRoles = useWorkspace().data.guild.roles;
  const nameOf = useCallback(
    (id: string) =>
      guildRoles.find((r) => r.id === id)?.name ??
      "a role this server no longer has",
    [guildRoles]
  );

  // Ask the bot what may be offered. This is a live question: the answer
  // depends on the hierarchy right now, not on the last sync.
  useEffect(() => {
    if (!member) return;
    let active = true;
    setLoading(true);
    setError("");
    setResult(null);
    setSearch("");
    setConfirming(false);
    api<any>(`/members/${member.userId}/roles`, "POST", { mode: "offer" })
      .then((res) => {
        if (!active) return;
        // A live job resolves to `{ result }`; demo mode answers directly.
        const payload = res?.result ?? res ?? {};
        setOffer(Array.isArray(payload.roles) ? payload.roles : []);
        setReason(typeof payload.reason === "string" ? payload.reason : null);
        // Start from what the member already holds, restricted to what can
        // actually be changed. Roles outside the offer are left alone
        // entirely rather than being silently dropped.
        const offerable = new Set(
          (Array.isArray(payload.roles) ? payload.roles : []).map(
            (r: EditableRole) => r.id
          )
        );
        setSelected(
          new Set((member.roles ?? []).filter((id) => offerable.has(id)))
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member?.userId, api]);

  const current = useMemo(() => new Set(member?.roles ?? []), [member]);
  const adding = useMemo(
    () => [...selected].filter((id) => !current.has(id)),
    [selected, current]
  );
  // Only roles that could actually be offered count as removals. A role the
  // member holds but that is out of reach is not "being removed" — it is
  // simply not ours to touch, and pretending otherwise would look like a
  // change that is not going to happen.
  const offerable = useMemo(() => new Set(offer.map((r) => r.id)), [offer]);
  const removing = useMemo(
    () => [...current].filter((id) => offerable.has(id) && !selected.has(id)),
    [current, selected, offerable]
  );
  const changeCount = adding.length + removing.length;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = term
      ? offer.filter((r) => r.name.toLowerCase().includes(term))
      : offer;
    return rows;
  }, [offer, search]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const apply = async () => {
    if (!member) return;
    setSaving(true);
    setError("");
    try {
      const res = await api<any>(`/members/${member.userId}/roles`, "POST", {
        mode: "apply",
        roleIds: [...selected],
      });
      const payload: ApplyResult = res?.result ?? res ?? {};
      setResult(payload);
      setConfirming(false);
      // The roster the page shows next is re-read from Discord by the bot, so
      // refresh rather than patching the row from what we hoped happened.
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={!!member}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit roles</DialogTitle>
          <DialogDescription>
            {member
              ? `Change the roles ${member.displayName} holds.`
              : "Change the roles this member holds."}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 size={13} className="animate-spin" aria-hidden />
            Checking what can be changed…
          </div>
        ) : error ? (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[11px] text-destructive">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : reason ? (
          <p className="rounded-lg border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            {reason}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search
                size={13}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search roles…"
                aria-label="Search assignable roles"
                className="h-8 w-full rounded-md border bg-card pl-8 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {visible.length ? (
                <ul className="divide-y">
                  {visible.map((role) => (
                    <li key={role.id}>
                      <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-muted/40">
                        <Checkbox
                          checked={selected.has(role.id)}
                          onCheckedChange={() => toggle(role.id)}
                          aria-label={`Assign ${role.name}`}
                        />
                        <RoleBadge role={role} />
                      </label>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-6 text-center text-[11px] text-muted-foreground">
                  {search
                    ? "No assignable role matches that."
                    : "There are no roles to assign here."}
                </p>
              )}
            </div>

            {changeCount > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-[11px] font-semibold">
                  {changeCount} pending{" "}
                  {changeCount === 1 ? "change" : "changes"}
                </p>
                <ul className="mt-1.5 space-y-1">
                  {adding.map((id) => (
                    <li key={`a-${id}`} className="text-[11px]">
                      <Badge tone="green" className="text-[9px]">
                        Add
                      </Badge>{" "}
                      {nameOf(id)}
                    </li>
                  ))}
                  {removing.map((id) => (
                    <li key={`r-${id}`} className="text-[11px]">
                      <Badge tone="amber" className="text-[9px]">
                        Remove
                      </Badge>{" "}
                      {nameOf(id)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result && (
              <div className="space-y-1.5 rounded-lg border p-3">
                {!!result.added?.length && (
                  <p className="flex items-center gap-1.5 text-[11px]">
                    <Check size={12} className="text-emerald-500" aria-hidden />
                    Added {result.added.map(nameOf).join(", ")}
                  </p>
                )}
                {!!result.removed?.length && (
                  <p className="text-[11px] text-muted-foreground">
                    Removed {result.removed.map(nameOf).join(", ")}
                  </p>
                )}
                {!!result.denied?.length && (
                  <div className="text-[11px] text-amber-600 dark:text-amber-400">
                    <p className="font-semibold">Not allowed:</p>
                    <ul className="mt-1 space-y-0.5">
                      {result.denied.map((d) => (
                        <li key={d.roleId}>
                          {nameOf(d.roleId)} — {d.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {!!result.failed?.length && (
                  <div className="text-[11px] text-destructive">
                    <p className="font-semibold">Discord refused:</p>
                    <ul className="mt-1 space-y-0.5">
                      {result.failed.map((f) => (
                        <li key={`${f.operation}-${f.roleId}`}>
                          {f.operation} {nameOf(f.roleId)}
                          {f.error ? ` — ${f.error}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                Close
              </Button>
              {changeCount > 1 && !confirming ? (
                // More than one role is a bigger change than a slip of the
                // mouse should make, so it asks first.
                <Button size="sm" onClick={() => setConfirming(true)}>
                  Review {changeCount} changes
                </Button>
              ) : (
                <Button
                  size="sm"
                  disabled={saving || changeCount === 0}
                  onClick={apply}
                >
                  {saving ? (
                    <Loader2 size={13} className="animate-spin" aria-hidden />
                  ) : (
                    <Check size={13} aria-hidden />
                  )}
                  {changeCount > 1 ? `Confirm ${changeCount} changes` : "Save"}
                </Button>
              )}
            </div>
          </>
        )}

        {(reason || error) && (
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X size={13} aria-hidden />
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
