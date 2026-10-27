"use client";
import * as Primitive from "@radix-ui/react-popover";
import * as React from "react";
import { cn } from "@/lib/utils";
export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;
export function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-xl border border-border bg-card p-0 text-xs shadow-lg outline-none data-[state=open]:animate-in",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
