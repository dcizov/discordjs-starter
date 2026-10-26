"use client";
import * as Primitive from "@radix-ui/react-tooltip";
import * as React from "react";
import { cn } from "@/lib/utils";
export const TooltipProvider = Primitive.Provider;
export const Tooltip = Primitive.Root;
export const TooltipTrigger = Primitive.Trigger;
export function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-64 rounded-md bg-foreground px-2 py-1 text-[11px] leading-snug text-background shadow-md",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
