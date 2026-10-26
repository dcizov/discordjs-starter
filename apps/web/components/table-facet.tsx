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
                  setOpen(false);
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
      </PopoverContent>
    </Popover>
  );
}
