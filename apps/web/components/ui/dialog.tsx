"use client";
import { cn } from "@/lib/utils";
import * as Primitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-[3px] animate-in" />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl max-h-[88vh] overflow-y-auto focus:outline-none",
          className
        )}
        {...props}
      >
        {children}
        <Primitive.Close
          className="absolute right-4 top-4 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
          aria-label="Close dialog"
        >
          <X size={17} />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
export function DialogHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 pr-6 [&_h2]:text-lg [&_h2]:font-semibold [&_p]:mt-1.5 [&_p]:text-xs [&_p]:leading-relaxed [&_p]:text-muted-foreground">
      {children}
    </div>
  );
}
