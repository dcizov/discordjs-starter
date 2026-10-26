"use client";
import { useContext, useId } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, Inbox, Loader2, RefreshCw, Search } from "lucide-react";
import { Button } from "./button";
import { FieldContext } from "./field-context";
import {
  Select as RadixSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
export function Card({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card shadow-panel",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "green" | "purple" | "amber" | "red" | "blue" | "neutral";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium leading-none",
        {
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400":
            tone === "green",
          "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300":
            tone === "purple",
          "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-400":
            tone === "amber",
          "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400":
            tone === "red",
          "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400":
            tone === "blue",
          "bg-muted text-slate-600 dark:text-muted-foreground":
            tone === "neutral",
        },
        className
      )}
    >
      {children}
    </span>
  );
}
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const field = useContext(FieldContext);
  return (
    <input
      id={field?.id}
      aria-label={field?.label}
      aria-describedby={field?.hintId}
      className={cn(
        "flex h-10 w-full rounded-lg border border-border bg-card px-3 text-xs transition placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-violet-400/40 disabled:opacity-60",
        className
      )}
      {...props}
    />
  );
}
/**
 * Native `<select>`, kept for the two cases where the platform control is
 * genuinely better: the ~400-entry IANA timezone list (browser/OS type-ahead
 * and list rendering) and any future list too long to render as menu items.
 * Everything else uses `FormSelect` so triggers, focus rings and menus match.
 */
export function NativeSelect({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const field = useContext(FieldContext);
  return (
    <select
      id={field?.id}
      aria-label={field?.label}
      aria-describedby={field?.hintId}
      className={cn(
        "h-10 w-full rounded-lg border border-border bg-card px-3 pr-7 text-xs outline-none focus:ring-2 focus:ring-violet-400/40",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

/**
 * Radix `Select` for a fixed single-choice list.
 *
 * It reads `Field` from context, so every call site gets the same label,
 * `aria-describedby` hint wiring and control height without repeating them. An
 * empty-string value is how Orbit spells "none / server default"; Radix reserves
 * `""` for "no value", so it is mapped to a private sentinel at this boundary
 * and mapped back before the caller sees it.
 */
const EMPTY_OPTION = "__orbit-empty__";
export function FormSelect({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const field = useContext(FieldContext);
  const hasEmpty = options.some((option) => option.value === "");
  return (
    <RadixSelect
      value={value === "" ? (hasEmpty ? EMPTY_OPTION : undefined) : value}
      onValueChange={(next) => onValueChange(next === EMPTY_OPTION ? "" : next)}
      disabled={disabled}
    >
      <SelectTrigger
        id={id ?? field?.id}
        aria-label={ariaLabel ?? field?.label}
        aria-describedby={ariaDescribedBy ?? field?.hintId}
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value || EMPTY_OPTION}
            value={option.value === "" ? EMPTY_OPTION : option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </RadixSelect>
  );
}
export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useContext(FieldContext);
  return (
    <textarea
      id={field?.id}
      aria-label={field?.label}
      aria-describedby={field?.hintId}
      className={cn(
        "min-h-24 w-full resize-y rounded-lg border border-border bg-card p-3 text-xs outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-violet-400/40",
        className
      )}
      {...props}
    />
  );
}
export function Field({
  label,
  hint,
  children,
  required,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  const id = useId();
  return (
    <FieldContext.Provider
      value={{ label, id, hintId: hint ? `${id}-hint` : undefined }}
    >
      <div className="block space-y-2">
        <label htmlFor={id} className="text-xs font-medium">
          {label}
          {required && (
            <span className="ml-1 text-primary" aria-hidden="true">
              *
            </span>
          )}
        </label>
        {children}
        {hint && (
          <span
            id={`${id}-hint`}
            className="block text-[11px] leading-relaxed text-muted-foreground"
          >
            {hint}
          </span>
        )}
      </div>
    </FieldContext.Provider>
  );
}
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  icon?: React.ElementType;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-violet-100 bg-violet-50 text-violet-500 dark:border-violet-500/20 dark:bg-violet-500/10">
        <Icon size={22} />
      </div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
export function Spinner() {
  return <Loader2 size={15} className="animate-spin" />;
}
export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative max-w-xs flex-1">
      <Search
        className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        size={14}
      />
      <Input
        className="h-9 pl-9"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-muted", className)} />;
}

/**
 * Native checkbox with the dashboard's single accent treatment.
 *
 * Four call sites previously picked their own size and accent (`size-3`,
 * `size-4 accent-violet-600`, or no class at all). A native input is kept
 * because the browser's own keyboard and screen-reader behaviour is exactly what
 * is wanted here; only the presentation is shared. Always render it inside a
 * `<label>` so the text is part of the hit target.
 */
export function Checkbox({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="checkbox"
      className={cn(
        "size-4 shrink-0 cursor-pointer accent-violet-600",
        className
      )}
      {...props}
    />
  );
}

/**
 * Header row for a card whose body is a list or table.
 *
 * Three cards had the same band — icon, title, optional count, optional action —
 * with slightly different heading sizes and one using a `<span>` where the others
 * used `<h2>`. Sharing it keeps the heading level and the count placement the
 * same everywhere; `aside` is for the one trailing control a card may own.
 */
export function SectionHeader({
  icon: Icon,
  title,
  badge,
  aside,
  className,
}: {
  icon?: React.ElementType;
  title: React.ReactNode;
  /** Count or short state shown next to the title, inside the heading. */
  badge?: React.ReactNode;
  /** Trailing control (button, status badge) for this section. */
  aside?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b px-5 py-4",
        className
      )}
    >
      <h2 className="flex min-w-0 items-center gap-2 text-xs font-semibold">
        {Icon ? (
          <Icon size={15} className="shrink-0 text-primary" aria-hidden />
        ) : null}
        <span className="truncate">{title}</span>
        {badge}
      </h2>
      {aside ? (
        <div className="flex shrink-0 items-center gap-2">{aside}</div>
      ) : null}
    </div>
  );
}

/**
 * Block-level failure with an optional retry.
 *
 * Page- and panel-level failures were drawn four different ways (amber icon with
 * two paragraphs, a bare red paragraph, a red card, a bordered red box) for the
 * same meaning: "this surface could not load". Field-level validation stays
 * inline next to its input; this is for the case where nothing loaded.
 */
export function ErrorState({
  title = "This section couldn’t load.",
  detail,
  onRetry,
  className,
}: {
  title?: string;
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-10 text-center",
        className
      )}
    >
      <AlertCircle size={22} className="text-amber-500" aria-hidden />
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          {detail}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          <RefreshCw size={12} aria-hidden />
          Try again
        </Button>
      ) : null}
    </div>
  );
}
