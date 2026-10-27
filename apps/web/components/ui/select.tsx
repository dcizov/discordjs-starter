"use client";
import * as Primitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = Primitive.Root;
export const SelectGroup = Primitive.Group;
export const SelectValue = Primitive.Value;

/**
 * Radix `Select` in Orbit's tokens.
 *
 * Native `<select>` remains in the tree where the browser's own list is the
 * better control (the 400-entry timezone picker); every fixed, short list uses
 * this one so the trigger height, border, focus ring and chevron match the
 * other controls. The trigger is a real button, so it keeps the WAI-ARIA
 * combobox behaviour (`aria-expanded`, type-ahead, arrow keys) Radix provides.
 */
export function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Trigger>) {
  return (
    <Primitive.Trigger
      className={cn(
        "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 text-xs outline-none transition placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-violet-400/40 disabled:cursor-not-allowed disabled:opacity-60 data-[placeholder]:text-muted-foreground [&>span]:truncate",
        className
      )}
      {...props}
    >
      {children}
      <Primitive.Icon asChild>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
      </Primitive.Icon>
    </Primitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        position={position}
        className={cn(
          "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-border bg-card text-xs shadow-lg",
          "data-[state=open]:animate-in",
          className
        )}
        {...props}
      >
        <Primitive.ScrollUpButton className="flex h-6 items-center justify-center text-muted-foreground">
          <ChevronUp size={13} />
        </Primitive.ScrollUpButton>
        <Primitive.Viewport className="p-1">{children}</Primitive.Viewport>
        <Primitive.ScrollDownButton className="flex h-6 items-center justify-center text-muted-foreground">
          <ChevronDown size={13} />
        </Primitive.ScrollDownButton>
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn(
        "px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground",
        className
      )}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-7 pr-2 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-3.5 items-center justify-center">
        <Primitive.ItemIndicator>
          <Check size={13} className="text-primary" />
        </Primitive.ItemIndicator>
      </span>
      <Primitive.ItemText>{children}</Primitive.ItemText>
    </Primitive.Item>
  );
}

export function SelectSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Separator>) {
  return (
    <Primitive.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
