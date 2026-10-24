"use client";
import { cn } from "@/lib/utils";
import * as Primitive from "@radix-ui/react-switch";
export function Switch({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof Primitive.Root>) {
  return (
    <Primitive.Root
      className={cn(
        "inline-flex h-[18px] w-[32px] shrink-0 cursor-pointer items-center rounded-full bg-slate-200 transition-colors data-[state=checked]:bg-primary dark:data-[state=unchecked]:bg-slate-700 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 disabled:opacity-50",
        className
      )}
      {...props}
    >
      <Primitive.Thumb className="block h-[14px] w-[14px] translate-x-[2px] rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-[16px]" />
    </Primitive.Root>
  );
}
