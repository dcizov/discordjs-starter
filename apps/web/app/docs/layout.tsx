import { docsNavigation } from "@/lib/docs-content";
import { ArrowLeft, BookOpen } from "lucide-react";
import Link from "next/link";

/**
 * Documentation shell.
 *
 * Server-rendered, no client JavaScript required: the navigation is a plain
 * list on wide screens and a `<details>` disclosure on small ones, so keyboard
 * and screen-reader users get the same content without a menu script. Every
 * page is a stable `/docs/<slug>` URL that can be linked from the dashboard,
 * a GitHub issue or a support reply.
 */
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sections = docsNavigation();
  const nav = (
    <nav aria-label="Documentation" className="space-y-6">
      {sections.map((section) => (
        <div key={section.group}>
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {section.group}
          </h2>
          <ul className="space-y-1">
            {section.entries.map((entry) => (
              <li key={entry.slug}>
                <Link
                  href={`/docs/${entry.slug}`}
                  className="block rounded-md px-2 py-1.5 text-[12px] leading-snug text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {entry.title}
                  <span className="mt-0.5 block text-[10px] text-muted-foreground/80">
                    {entry.audience === "developer" ? "Developer" : "User"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="border-b">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Orbit
          </Link>
          <span className="text-muted-foreground/40" aria-hidden="true">
            /
          </span>
          <Link
            href="/docs"
            className="flex items-center gap-1.5 text-sm font-medium"
          >
            <BookOpen size={15} aria-hidden="true" />
            Documentation
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-6 lg:self-start">
          <details className="rounded-lg border p-3 lg:hidden">
            <summary className="cursor-pointer text-xs font-semibold">
              Browse documentation
            </summary>
            <div className="mt-4">{nav}</div>
          </details>
          <div className="hidden lg:block">{nav}</div>
        </div>
        <main id="docs-content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
