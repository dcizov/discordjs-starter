"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Menu } from "lucide-react";
import { useState } from "react";
import { DocsNav, type DocsNavSection } from "./docs-nav";

/**
 * Documentation navigation on small screens.
 *
 * The dashboard already ships an accessible Radix dialog, so the mobile menu is
 * that dialog anchored to the left edge rather than a third navigation pattern:
 * it traps focus, closes on Escape and restores focus to the trigger. Selecting
 * a page closes it, because the link is the last thing the user wants to do.
 */
export function DocsMobileNav({ sections }: { sections: DocsNavSection[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Menu aria-hidden="true" />
          Browse documentation
        </Button>
      </DialogTrigger>
      <DialogContent className="left-0 top-0 h-dvh w-[86%] max-w-xs translate-x-0 translate-y-0 rounded-none rounded-r-2xl p-5">
        <DialogHeader>
          <DialogTitle>Browse documentation</DialogTitle>
          <DialogDescription className="sr-only">
            Every guide in the Orbit documentation, grouped by audience.
          </DialogDescription>
        </DialogHeader>
        <DocsNav sections={sections} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
