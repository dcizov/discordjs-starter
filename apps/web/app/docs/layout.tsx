import { DocsMobileNav } from "@/components/docs/docs-mobile-nav";
import { DocsNav, type DocsNavSection } from "@/components/docs/docs-nav";
import { docsNavigation } from "@/lib/docs-content";
import { SOURCE_REPOSITORY } from "@orbit/core/source-links";
import { ArrowLeft, BookOpen, Github } from "lucide-react";
import Link from "next/link";

/**
 * Documentation shell.
 *
 * The layout is server-rendered; only the navigation is a client component, and
 * only because it marks the current page. Every page is a stable `/docs/<slug>`
 * URL that can be linked from the dashboard, a GitHub issue or a support reply,
 * and the guides are the repository's own Markdown rendered at build time.
 */
export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const sections: DocsNavSection[] = docsNavigation().map((section) => ({
    group: section.group,
    entries: section.entries.map((entry) => ({
      slug: entry.slug,
      title: entry.title,
      audience: entry.audience,
    })),
  }));
  return (
    <div className="min-h-screen bg-background">
      <a
        href="#docs-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <ArrowLeft size={15} aria-hidden="true" />
            Orbit
          </Link>
          <span className="text-muted-foreground/40" aria-hidden="true">
            /
          </span>
          <Link
            href="/docs"
            aria-label="Documentation"
            className="flex items-center gap-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <BookOpen size={15} aria-hidden="true" />
            {/* The label is dropped on phones so the bar never scrolls sideways;
                the link keeps its accessible name. */}
            <span className="hidden sm:inline" aria-hidden="true">
              Documentation
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <a
              href={SOURCE_REPOSITORY}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 lg:flex"
            >
              <Github size={13} aria-hidden="true" />
              Source
              <span className="sr-only"> repository (opens in a new tab)</span>
            </a>
            <div className="lg:hidden">
              <DocsMobileNav sections={sections} />
            </div>
          </div>
        </div>
      </header>
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[230px_minmax(0,1fr)]">
        <div className="hidden lg:sticky lg:top-[4.25rem] lg:block lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-2">
          <DocsNav sections={sections} />
        </div>
        <main id="docs-content" className="min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
