"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Shared client providers.
 *
 * `TooltipProvider` lives here rather than around individual triggers for two
 * reasons: Radix requires a provider somewhere above every `Tooltip.Root`, and
 * one provider is what makes `delayDuration` a single setting instead of
 * whatever each call site thinks is nice. It ships with no default delay, so
 * without this the tooltip would also appear instantly on hover.
 */
const TOOLTIP_DELAY_MS = 200;

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>
        {children}
      </TooltipProvider>
      <Toaster
        position="bottom-right"
        closeButton
        richColors
        toastOptions={{
          style: {
            fontFamily: "inherit",
            fontSize: "12px",
            borderRadius: "12px",
          },
        }}
      />
    </ThemeProvider>
  );
}
