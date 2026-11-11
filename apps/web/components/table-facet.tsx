"use client";
import { Check, ListFilter, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export type FacetOption = {
  value: string;
  label: string;
  /** Only when the count is actually known. Never estimated. */
  count?: number;
};

export type FacetFilter = {
  /** Stable id, used for the trigger's id and the reset test hook. */
  key: string;
  /** Accessible name, e.g. "Filter audit action". */
  label: string;
  /** Menu heading, e.g. "Action". */
  title: string;
  /** Value meaning "no restriction". */
  value: string;
  allValue: string;
  onChange: (value: string) => void;
  options: FacetOption[];
  /** Show the search box. Off for short, fixed lists. */
  searchable?: boolean;
};

/**
 * The options for one facet.
 *
 * Shared by the standalone trigger and by the combined Filters menu, so the
 * two cannot drift: there is one implementation of the checkmark, the count
 * and the accessible name, and one place to fix it.
 *
 * `onPick` is called after the value changes. The standalone trigger closes on
 * pick; the combined menu stays open, because setting two filters in one visit
 * is the common case and reopening the panel to reach the second is not.
 */
export function FacetList({
  facet,
  onPick,
}: {
  facet: FacetFilter;
  onPick?: () => void;
}) {
  return (
    <Command>
      {facet.searchable !== false && (
        <CommandInput placeholder={`${facet.title}…`} />
      )}
      <CommandList>
        <CommandEmpty>Nothing matches that search.</CommandEmpty>
        {facet.options.map((option) => (
          <CommandItem
            key={option.value}
            value={`${option.label} ${option.value}`}
            // The name states the option as a sentence, with the count in
            // words. Reading raw adjacent nodes would run them together
            // ("Needs setup2") and lose the meaning of the number.
            aria-label={
              typeof option.count === "number"
                ? `${option.label} (${option.count})`
                : option.label
            }
            onSelect={() => {
              facet.onChange(option.value);
              onPick?.();
            }}
          >
            <span
              className={cn(
                "flex size-3.5 shrink-0 items-center justify-center rounded-sm border",
                option.value === facet.value
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border opacity-60"
              )}
              aria-hidden
            >
              {option.value === facet.value && <Check size={10} />}
            </span>
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            {typeof option.count === "number" && (
              <span
                aria-hidden
                className="shrink-0 text-[10px] tabular-nums text-muted-foreground"
              >
                {option.count}
              </span>
            )}
          </CommandItem>
        ))}
      </CommandList>
    </Command>
  );
}

/**
 * Every facet behind one trigger.
 *
 * At phone width each standalone filter button was its own row: the toolbar
 * grew by one line per facet, and the table was pushed down a screen that was
 * already short. One trigger holds them all, so the toolbar is one row at any
 * width and at any number of facets.
 *
 * The count on the trigger is how many are set, which is the only thing you
 * need to know before opening it.
 */
export function FiltersMenu({
  filters,
  onResetAll,
}: {
  filters: FacetFilter[];
  onResetAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = filters.filter((f) => f.value !== f.allValue);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={
            active.length
              ? `Filters: ${active.length} of ${filters.length} set`
              : "Filters"
          }
          className={cn(
            "h-8 shrink-0 gap-1.5 rounded-lg px-2.5 text-[11.5px] font-normal",
            active.length && "border-solid bg-muted/60"
          )}
        >
          <ListFilter size={12} aria-hidden className="text-muted-foreground" />
          Filters
          {active.length > 0 && (
            <span className="rounded bg-background px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
              {active.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-0">
        <div className="max-h-[min(24rem,70vh)] overflow-y-auto">
          {filters.map((facet, index) => (
            <div
              key={facet.key}
              // Named by the facet's label, not its title: the title is a
              // column heading ("Channel type") and says nothing about what
              // the group does, so a reader who tabs into it hears
              // "Filter channel type" instead.
              role="group"
              aria-label={facet.label}
              className={cn(index > 0 && "border-t border-border/60")}
            >
              <p
                aria-hidden
                className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                {facet.title}
              </p>
              <FacetList facet={facet} />
            </div>
          ))}
        </div>
        {active.length > 0 && (
          <div className="border-t border-border/60 p-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-full justify-start px-2 text-[11.5px] text-muted-foreground"
              onClick={onResetAll}
            >
              Reset filters
              <X size={12} aria-hidden />
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A single-choice column filter, composed the way shadcn's faceted filter is:
 * an outline trigger, a searchable command list with a checkmark on the active
 * value, and a badge on the trigger naming the current selection.
 *
 * Orbit's history API filters by one value (`?filter=`), so the selection is
 * single-choice rather than the multi-select checkbox list shadcn's tasks
 * example uses for a client dataset. Counts appear only when the caller really
 * knows them — for server pages that number is not available, so it is omitted
 * instead of guessed.
 */
export function FacetFilterButton({ facet }: { facet: FacetFilter }) {
  const [open, setOpen] = useState(false);
  const active = facet.value !== facet.allValue;
  const selected = useMemo(
    () => facet.options.find((option) => option.value === facet.value),
    [facet.options, facet.value]
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          // The accessible name carries the descriptive label *and* the value
          // currently applied, so a screen-reader user hears the active filter
          // rather than only the column it belongs to.
          aria-label={
            active
              ? `${facet.label}: ${selected?.label ?? facet.value}`
              : facet.label
          }
          data-facet={facet.key}
          className={cn(
            "h-8 gap-1.5 rounded-lg border-dashed px-2.5 text-[11.5px] font-normal",
            active && "border-solid bg-muted/60"
          )}
        >
          {active ? (
            <X
              size={12}
              aria-hidden
              className="text-muted-foreground"
              // Clearing from the trigger is the fastest way out of a filter
              // that produced nothing; it stays a button-sized hit area.
              onClick={(event) => {
                event.stopPropagation();
                facet.onChange(facet.allValue);
              }}
            />
          ) : (
            <ListFilter
              size={12}
              aria-hidden
              className="text-muted-foreground"
            />
          )}
          {facet.title}
          {active && (
            <span className="ml-0.5 rounded bg-background px-1.5 py-0.5 text-[10px] font-medium">
              {selected?.label ?? facet.value}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <FacetList facet={facet} onPick={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
