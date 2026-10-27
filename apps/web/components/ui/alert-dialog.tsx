"use client";
import * as Primitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./button";

/**
 * Confirmation for an irreversible or broadcast action.
 *
 * Unlike `Dialog`, an alert dialog cannot be dismissed by clicking outside and
 * puts initial focus on the cancel action, so a destructive choice is never the
 * accidental default. `confirm-dialog.tsx` layers the app's wording on top.
 */
export const AlertDialog = Primitive.Root;
export const AlertDialogTrigger = Primitive.Trigger;

export function AlertDialogContent({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
      <Primitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in",
          className
        )}
        {...props}
      >
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

export function AlertDialogHeader({ children }: { children: React.ReactNode }) {
  return <div className="space-y-2 pr-2">{children}</div>;
}

export function AlertDialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      {children}
    </div>
  );
}

export const AlertDialogTitle = React.forwardRef<
  React.ComponentRef<typeof Primitive.Title>,
  React.ComponentPropsWithoutRef<typeof Primitive.Title>
>(({ className, ...props }, ref) => (
  <Primitive.Title
    ref={ref}
    className={cn("text-base font-semibold", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

export const AlertDialogDescription = React.forwardRef<
  React.ComponentRef<typeof Primitive.Description>,
  React.ComponentPropsWithoutRef<typeof Primitive.Description>
>(({ className, ...props }, ref) => (
  <Primitive.Description
    ref={ref}
    className={cn("text-xs leading-relaxed text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

export const AlertDialogAction = React.forwardRef<
  React.ComponentRef<typeof Primitive.Action>,
  React.ComponentPropsWithoutRef<typeof Primitive.Action>
>(({ className, ...props }, ref) => (
  <Primitive.Action
    ref={ref}
    className={cn(
      buttonVariants({ variant: "destructive", size: "sm" }),
      className
    )}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";

export const AlertDialogCancel = React.forwardRef<
  React.ComponentRef<typeof Primitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof Primitive.Cancel>
>(({ className, ...props }, ref) => (
  <Primitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline", size: "sm" }),
      className
    )}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";
