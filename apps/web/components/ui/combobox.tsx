"use client";
import { Check, ChevronsUpDown } from "lucide-react";
import { useContext, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { ActorAvatar } from "../identity/actor-avatar";
import { FieldContext } from "./field-context";

/**
 * Searchable single choice (shadcn's Combobox pattern: Popover + Command).
 *
 * Use this when the list is long enough that scanning it is work — guild
 * members, channels, roles, sources. Short fixed lists use `FormSelect`, because
 * a search box over five options is friction rather than help.
 */
export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "Nothing matches.",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: {
    value: string;
    label: string;
    hint?: string;
    /**
     * People are pictures and names. A member list built from the dashboard's
     * own account data passes the same identity the leaderboard shows, so the
     * picker does not fall back to a generic initial when an avatar exists.
     */
    person?: { id: string; name: string; src?: string | null };
  }[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const field = useContext(FieldContext);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          id={id ?? field?.id}
          // A Radix button is not a form control, so the field's label is passed
          // as its accessible name rather than relying on `htmlFor`.
          aria-label={ariaLabel ?? field?.label}
          aria-describedby={ariaDescribedBy ?? field?.hintId}
          aria-expanded={open}
          role="combobox"
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between px-3 font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown size={14} className="shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-56 p-0">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={`${option.label} ${option.value}`}
                onSelect={() => {
                  onValueChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  size={13}
                  aria-hidden
                  className={cn(
                    "shrink-0 text-primary",
                    option.value === value ? "opacity-100" : "opacity-0"
                  )}
                />
                {option.person && (
                  <ActorAvatar
                    id={option.person.id}
                    name={option.person.name}
                    src={option.person.src}
                    size={24}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.hint && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {option.hint}
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
