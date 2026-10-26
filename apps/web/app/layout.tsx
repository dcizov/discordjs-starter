import { Providers } from "@/components/providers";
import "@fontsource-variable/inter";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Orbit — A better space for your community",
  description:
    "Your Discord community, in good hands. Roles, moderation, music, deals, and news in one thoughtful dashboard.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/*
          Opt out of Dark Reader's automatic restyling for this origin.
          https://github.com/darkreader/darkreader/blob/main/CONTRIBUTING.md

          Orbit ships its own light and dark themes and a `color-scheme`
          declaration, so a forced restyle only fights them; Dark Reader also
          rewrites `style` attributes and injects `data-darkreader-*` attributes,
          which React reports as hydration differences. This is a *request*: a
          user who has disabled the "respect site" setting, or whose extension
          re-applies itself, still gets Dark Reader, and nothing here changes
          their preference. React 19 hoists the tag into <head> during SSR.
        */}
        <meta name="darkreader-lock" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
