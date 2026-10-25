"use client";
import { cn } from "@/lib/utils";
import * as Primitive from "@radix-ui/react-dropdown-menu";
import * as React from "react";
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
/** Non-interactive heading inside a menu; not a focusable item. */
export const DropdownMenuLabel = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Label>) => (
  <Primitive.Label
    className={cn(
      "px-3 pb-1 pt-1.5 text-[10px] font-medium text-muted-foreground",
      className
    )}
    {...props}
  />
);
export const DropdownMenuSeparator = () => (
  <Primitive.Separator className="my-1.5 h-px bg-border" />
);
export function DropdownMenuContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align="end"
        sideOffset={7}
        className={cn(
          "z-50 min-w-44 overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-xl animate-in",
          className
        )}
        {...props}
      />
    </Primitive.Portal>
  );
}
export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2 rounded-md px-3 py-2 text-xs outline-none focus:bg-muted data-[disabled]:opacity-50 [&_svg]:size-4",
        className
      )}
      {...props}
    />
  );
}
