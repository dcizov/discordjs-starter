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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
