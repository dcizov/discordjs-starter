"use client";

import { Bot } from "lucide-react";
import * as React from "react";
import {
  describeRoles,
  roleSwatch,
  sortRolesByHierarchy,
  splitRolesForDisplay,
  type PresentableRole,
} from "@orbit/core/roles";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * The one way a role is drawn.
 *
 * Roles appear in the members table, member detail, the roles view, pickers,
 * channel overwrites and moderation context, and every surface used to invent
 * its own — some showed a colour dot, some showed nothing but a name, some
 * truncated arbitrarily. This replaces all of them so a role looks the same
 * wherever it appears and the rules live in one place.
 *
 * Three rules it always obeys:
 *
 * - The name is always visible. Colour is decoration, never the only signal.
 * - Roles are ordered by hierarchy, so the role that wins a permission
 *   conflict is the first one you see.
 * - Managed roles are marked, because you cannot change or assign them and
 *   the UI should say so before an operator tries.
 */

/** A single role, drawn as a colour dot plus its name. */
export function RoleBadge({
  role,
  className,
  onSelect,
}: {
  role: PresentableRole;
  className?: string;
  /**
   * Makes the badge a button. Passed when the surface can act on the role —
   * for example jumping to the members who hold it. Without it the badge stays
   * a plain span, so a badge in a table cell is not a focus stop.
   */
  onSelect?: (role: PresentableRole) => void;
}) {
  const swatch = roleSwatch(role.color);
  const label = role.managed
    ? `${role.name}, managed by an integration`
    : role.name;
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md bg-muted px-2 py-1 text-[11px] font-medium leading-none text-slate-700 dark:text-muted-foreground",
        onSelect && "transition hover:bg-muted-foreground/20",
        className
      )}
      {...(onSelect
        ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-label": label,
            onClick: () => onSelect(role),
            onKeyDown: (event: React.KeyboardEvent) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelect(role);
              }
            },
          }
        : {})}
    >
      {/*
        The dot carries the colour. The inset ring is what keeps a near-white
        role visible on a light background and a near-black one visible on a
        dark background, so the swatch never disappears in either theme.
      */}
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full ring-1 ring-inset ring-black/25 dark:ring-white/30"
        style={{ backgroundColor: swatch.css }}
      />
      <span className="truncate">{role.name}</span>
      {role.managed && (
        <Bot size={11} aria-hidden className="shrink-0 opacity-70" />
      )}
    </span>
  );
}

/**
 * Roles in hierarchy order, collapsing the tail into a "+N" control.
 *
 * The collapsed roles are never dropped: "+N" opens a popover that lists them
 * as real badges, and carries their names in its accessible label, so the full
 * list is reachable by mouse, by keyboard and by screen reader without the row
 * growing without bound. It used to be a tooltip, which showed the names but
 * did nothing when clicked -- a control that looks like a button and behaves
 * like a label.
 *
 * Inside the popover a badge acts only where the surface acts: with
 * `onRoleSelect` it filters the directory to that role and closes, otherwise it
 * stays a plain span, because a badge that navigates from a read-only cell
 * would be a promise the surface cannot keep.
 */
export function RoleList({
  roles,
  max = 3,
  emptyLabel = "No roles",
  className,
  onRoleSelect,
}: {
  roles: readonly PresentableRole[];
  /** How many roles to draw before collapsing the rest. */
  max?: number;
  emptyLabel?: string;
  className?: string;
  onRoleSelect?: (role: PresentableRole) => void;
}) {
  const [overflowOpen, setOverflowOpen] = React.useState(false);

  if (!roles.length)
    return (
      <span className="text-[11px] text-muted-foreground">{emptyLabel}</span>
    );

  const ordered = sortRolesByHierarchy(roles);
  const { visible, overflow } = splitRolesForDisplay(ordered, max);
  const overflowLabel = `${overflow.length} more ${
    overflow.length === 1 ? "role" : "roles"
  }`;

  return (
    <span className={cn("flex flex-wrap items-center gap-1", className)}>
      {visible.map((role) => (
        <RoleBadge key={role.id} role={role} onSelect={onRoleSelect} />
      ))}
      {overflow.length > 0 && (
        <Popover open={overflowOpen} onOpenChange={setOverflowOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              /* The names travel with the control, so a screen reader gets the
                 whole list without opening anything. */
              aria-label={`${overflowLabel}: ${describeRoles(overflow)}`}
              aria-expanded={overflowOpen}
              className="inline-flex items-center whitespace-nowrap rounded-md bg-muted px-2 py-1 text-[11px] font-medium leading-none text-slate-700 transition hover:bg-muted-foreground/20 dark:text-muted-foreground"
            >
              +{overflow.length}
            </button>
          </PopoverTrigger>
          {/* Escape and an outside click both dismiss it: Radix does that, and
              it is what makes the control safe to open inside a table. */}
          <PopoverContent
            className="w-auto max-w-xs p-2"
            aria-label={overflowLabel}
          >
            <ul className="flex flex-wrap gap-1">
              {overflow.map((role) => (
                <li key={role.id}>
                  <RoleBadge
                    role={role}
                    onSelect={
                      onRoleSelect &&
                      ((selected) => {
                        onRoleSelect(selected);
                        setOverflowOpen(false);
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </span>
  );
}

/**
 * A compact dot row, for dense places like a table cell that already has a
 * roles column and only needs an at-a-glance signal.
 */
export function RoleDots({
  roles,
  className,
}: {
  roles: readonly PresentableRole[];
  className?: string;
}) {
  if (!roles.length) return null;
  const ordered = sortRolesByHierarchy(roles);
  return (
    <span
      className={cn("inline-flex items-center gap-1", className)}
      aria-hidden
    >
      {ordered.slice(0, 4).map((role) => (
        <span
          key={role.id}
          className="size-2 rounded-full ring-1 ring-inset ring-black/25 dark:ring-white/30"
          style={{ backgroundColor: roleSwatch(role.color).css }}
        />
      ))}
    </span>
  );
}

/**
 * Just the colour dot.
 *
 * Pickers and checkbox rows already render their own label and control, so
 * they need the swatch and nothing else — but it must be the same swatch, with
 * the same neutral fallback and the same visibility ring, or a role would
 * change appearance depending on which surface drew it.
 */
export function RoleDot({
  role,
  className,
}: {
  role: Pick<PresentableRole, "color">;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full ring-1 ring-inset ring-black/25 dark:ring-white/30",
        className
      )}
      style={{ backgroundColor: roleSwatch(role.color).css }}
    />
  );
}
