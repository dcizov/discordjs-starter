"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Semantic table shell shared by every data screen.
 *
 * The elements stay native (`table`/`thead`/`th`), because a div grid cannot
 * give a screen reader row and column relationships. Only the presentation is
 * shared, so column headers, sort buttons and cells line up across pages.
 */
export function TableWrap({
  className,
  children,
  label,
}: {
  className?: string;
  children: React.ReactNode;
  /** Accessible name for the scrollable region around the table. */
  label?: string;
}) {
  return (
    <div
      className={cn("relative w-full overflow-x-auto", className)}
      role="region"
      aria-label={label}
      tabIndex={label ? 0 : undefined}
    >
      {children}
    </div>
  );
}
export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        "w-full caption-bottom border-collapse text-left",
        className
      )}
      {...props}
    />
  );
}
export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}
export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
  );
}
export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-b border-border/60 transition-colors hover:bg-muted/40 data-[state=selected]:bg-violet-50 dark:data-[state=selected]:bg-violet-500/10",
        className
      )}
      {...props}
    />
  );
}
export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        // Readable at a glance: normal case, 11.5 px, medium weight. The old
        // 10 px uppercase tracking was both cramped and harder to scan.
        "h-9 whitespace-nowrap bg-muted/40 px-3 py-2 text-[11.5px] font-medium text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}
export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("px-3 py-2.5 align-middle text-xs", className)}
      {...props}
    />
  );
}
export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      className={cn("mt-3 text-[10px] text-muted-foreground", className)}
      {...props}
    />
  );
}
