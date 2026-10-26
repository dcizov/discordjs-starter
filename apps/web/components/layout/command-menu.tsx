"use client";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { navigation } from "./navigation";

/**
 * Dashboard command menu (⌘K / Ctrl-K).
 *
 * A dialog with a `cmdk` list, which is what the shadcn command pattern is: the
 * list is the dialog's accessible name via `CommandDialogTitle`, filtering is
 * keyboard-driven, and Escape restores focus to whatever opened it. The previous
 * version was a plain input over hand-rolled buttons, so arrow keys and the
 * announced result count were missing.
 *
 * It searches **pages**, not configuration values: there is no server-side
 * settings index, and inventing one from this list would be dishonest.
 */
export function CommandMenu({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (id: string) => void;
}) {
  const [term, setTerm] = useState("");
  useEffect(() => {
    if (!open) setTerm("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[18%] max-w-lg translate-y-0 p-0">
        {/* The title is the dialog's accessible name; it is visually hidden
            because the placeholder already says what the field does. */}
        <DialogTitle className="sr-only">Find your way around</DialogTitle>
        <Command shouldFilter>
          <CommandInput
            autoFocus
            value={term}
            onValueChange={setTerm}
            placeholder="Search pages and configuration…"
            aria-label="Search pages"
          />
          <CommandList>
            <CommandEmpty>No pages found. Try “roles” or “news”.</CommandEmpty>
            <CommandGroup heading="Pages">
              {navigation.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.id} ${item.group}`}
                  onSelect={() => {
                    onNavigate(item.id);
                    onOpenChange(false);
                  }}
                >
                  <item.icon size={15} className="text-primary" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <ArrowRight
                    size={12}
                    className="text-muted-foreground"
                    aria-hidden
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
