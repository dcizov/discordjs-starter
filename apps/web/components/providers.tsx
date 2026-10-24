"use client";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      {children}
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
