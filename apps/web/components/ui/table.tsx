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

/**
 * Where there is more content than the reader can currently see.
 *
 * `ahead` — the container is at its left edge; scrolling right reveals more.
 * `behind` — the container is at its right edge; columns are hidden to the left.
 * `both`  — mid-scroll.
 * `none`  — the table fits; no affordance is shown.
 */
export type OverflowEdges = "none" | "ahead" | "behind" | "both";

/**
 * The narrow-screen rule, defined once.
 *
 * A table wider than its surface scrolls sideways inside its own container
 * rather than widening the page. The container fades the edge that has more
 * content behind it, and the first column stays pinned so a row keeps its
 * identity while the rest of its cells move.
 *
 * Chosen over a card layout under a breakpoint because it is one DOM for every
 * width: the row and column relationships a screen reader reports at 1280px
 * are the ones it reports at 390px, and there is no second rendering path to
 * keep in step. shadcn's own data-table guidance argues against a single
 * all-purpose table component — "It doesn't make sense to combine all of these
 * variations into a single component. If we do that, we'll lose the flexibility
 * that headless UI provides" — which is about *behaviour*, not about this:
 * the responsive rule is presentation, and presentation is what belongs here.
 *
 * Two things about `position: sticky` inside a table are silent when they go
 * wrong, so they are settled here rather than per page:
 *
 * - `border-collapse: collapse` paints borders as part of the table grid at the
 *   cell's *original* position, so a border on a cell that sticky has offset is
 *   left behind and appears to vanish. Collapsed borders and sticky cells
 *   cannot both be correct, so this table uses `border-separate` and every cell
 *   draws its own rule.
 * - A cell paints above its row, so a *translucent* sticky cell lets the
 *   columns scrolled underneath it show through. Every row state is therefore
 *   opaque, and the pinned cell takes its colour from the row with `inherit`,
 *   which keeps rest, hover and selection in step without copying each colour.
 */
function useOverflowEdges() {
  const ref = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState<OverflowEdges>("none");
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      // Sub-pixel column widths leave `max` at 0 or 1 for a table that fits.
      if (max <= 1) {
        setEdges("none");
        return;
      }
      const atStart = el.scrollLeft <= 1;
      const atEnd = el.scrollLeft >= max - 1;
      setEdges(atStart ? "ahead" : atEnd ? "behind" : "both");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // jsdom has no ResizeObserver, and a table that changes columns or a page
    // that changes width both need the affordance recomputed.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  return { ref, edges };
}

/**
 * The scroll container. It owns the sideways scroll, reports which edges have
 * content behind them, and is focusable so a keyboard user can scroll it; the
 * labelled region belongs to the table component that owns the toolbar and
 * footer, so this div does not add a second, unnamed landmark.
 *
 * The fade is a `mask-image` rather than a gradient overlay, so it dissolves
 * the content itself and needs no colour of its own — the same reason shadcn's
 * `scroll-fade` utility is a mask. It is driven by a scroll listener rather
 * than by `animation-timeline: scroll()`, which Firefox only enabled by
 * default in 159 (October 2026); the static-fade fallback for older Firefox
 * would dim the first and last column permanently, which is worse than an
 * affordance that simply tracks the scroll position.
 */
export function TableWrap({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { ref, edges } = useOverflowEdges();
  return (
    <div
      ref={ref}
      data-overflow={edges}
      className={cn(
        "group/wrap relative w-full overflow-x-auto overscroll-x-contain bg-inherit",
        "data-[overflow=ahead]:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]",
        "data-[overflow=both]:[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]",
        className
      )}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

/**
 * A pinned column. The shadow is what says "there are columns hidden behind
 * this one" — a border would shift the layout by a pixel the moment it
 * appeared, and an inset border would be clipped by the container's mask.
 *
 * No background: the cell this is applied to already has the right one (a `th`
 * is `bg-muted`, a `td` is `bg-inherit`), and setting a second colour here
 * would race with it in the generated stylesheet.
 */
const pinned =
  "sticky left-0 group-data-[overflow=behind]/wrap:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.35)] group-data-[overflow=both]/wrap:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.35)] dark:group-data-[overflow=behind]/wrap:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.7)] dark:group-data-[overflow=both]/wrap:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.7)]";

export function Table({
  className,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <table
      className={cn(
        // `border-separate` because collapsed borders and sticky cells cannot
        // both be right; `border-spacing-0` keeps the single-rule look.
        "w-full caption-bottom border-separate border-spacing-0 text-left",
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
  return (
    <thead
      className={cn("bg-inherit [&_tr>th]:border-b", className)}
      {...props}
    />
  );
}
export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tbody
      className={cn("bg-inherit [&_tr:last-child>td]:border-0", className)}
      {...props}
    />
  );
}
export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        // Opaque in every state: a translucent row would show through the
        // pinned cell once the columns are scrolled underneath it.
        "group/row bg-inherit transition-colors hover:bg-muted data-[state=selected]:bg-violet-50 dark:data-[state=selected]:bg-violet-950",
        className
      )}
      {...props}
    />
  );
}
export function TableHead({
  className,
  sticky,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        // Readable at a glance: normal case, 11.5 px, medium weight. The old
        // 10 px uppercase tracking was both cramped and harder to scan.
        "h-9 whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-[11.5px] font-medium text-muted-foreground",
        sticky && cn(pinned, "z-20"),
        className
      )}
      {...props}
    />
  );
}
export function TableCell({
  className,
  sticky,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { sticky?: boolean }) {
  return (
    <td
      className={cn(
        "border-b border-border/60 bg-inherit px-3 py-2.5 align-middle text-xs",
        sticky && cn(pinned, "z-10"),
        className
      )}
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
