"use client";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Serializable slice of a doc entry. The layout is a server component; sending
 * only what the navigation renders keeps the page payload free of summaries and
 * file paths the sidebar never shows.
 */
export type DocsNavSection = {
  group: string;
  entries: { slug: string; title: string; audience: "user" | "developer" }[];
};

/**
 * Grouped documentation navigation.
 *
 * Groups are native `<details>` disclosures: they collapse, expand, are keyboard
 * operable and announced without a client library. The current page is marked
 * with `aria-current="page"` and a visible rail, so the active page is not
 * carried by colour alone.
 */
export function DocsNav({
  sections,
  onNavigate,
  className,
}: {
  sections: DocsNavSection[];
  /** Closes the mobile sheet after a page is chosen. */
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label="Documentation" className={cn("space-y-5", className)}>
      {sections.map((section) => (
        <details key={section.group} open className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            <ChevronRight
              size={12}
              aria-hidden="true"
              className="transition-transform group-open:rotate-90"
            />
            {section.group}
          </summary>
          <ul className="mt-1.5 space-y-0.5 border-l pl-2">
            {section.entries.map((entry) => {
              const href = `/docs/${entry.slug}`;
              const active = pathname === href;
              return (
                <li key={entry.slug}>
                  <Link
                    href={href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-2 py-1.5 text-[12px] leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                      active
                        ? "bg-violet-50 font-medium text-violet-700 dark:bg-violet-500/10 dark:text-violet-300"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {entry.title}
                    <span className="sr-only">
                      {entry.audience === "developer"
                        ? " (developer guide)"
                        : " (user guide)"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </details>
      ))}
    </nav>
  );
}
