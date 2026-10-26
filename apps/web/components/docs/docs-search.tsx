"use client";
import { useId, useState } from "react";
import Link from "next/link";

export type DocsSection = {
  group: string;
  entries: {
    slug: string;
    title: string;
    summary: string;
    audience: "user" | "developer";
  }[];
};

const groupId = (group: string) =>
  `index-${group.toLowerCase().replace(/[^a-z]+/g, "-")}`;

/**
 * Filters the documentation index by page title, summary or group.
 *
 * It is a filter over the pages already on this page — not a full-text search of
 * the Markdown bodies, and it says so, because inventing "results" from text this
 * page never loaded would be worse than no search at all. Every page stays in the
 * server-rendered HTML, so the index is usable without JavaScript.
 */
export function DocsSearch({ sections }: { sections: DocsSection[] }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const matches = sections
    .map((section) => ({
      ...section,
      entries: section.entries.filter((entry) =>
        `${section.group} ${entry.title} ${entry.summary} ${entry.audience}`
          .toLowerCase()
          .includes(term)
      ),
    }))
    .filter((section) => section.entries.length);
  const total = matches.reduce(
    (sum, section) => sum + section.entries.length,
    0
  );
  const all = sections.reduce(
    (sum, section) => sum + section.entries.length,
    0
  );
  const describedBy = useId();
  return (
    <div className="mt-8">
      <div className="rounded-xl border bg-card p-4 shadow-panel">
        <label
          htmlFor={`${describedBy}-search`}
          className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          Find a page
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            id={`${describedBy}-search`}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, topic, or audience…"
            aria-describedby={describedBy}
            className="h-9 w-full max-w-md rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          />
          {term ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="rounded-md border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              Clear filter
            </button>
          ) : null}
        </div>
        <p id={describedBy} className="mt-2 text-[11px] text-muted-foreground">
          Filters this page by title, summary, group and audience; it does not
          search inside the guides. Each guide keeps its own{" "}
          <strong>On this page</strong> links for jumping around.
        </p>
        <p aria-live="polite" className="sr-only">
          {term ? `${total} matching pages` : ""}
        </p>
        {term ? (
          <p className="mt-1 text-[11px] font-medium">
            Showing {total} of {all} pages
          </p>
        ) : null}
      </div>
      {term && !total ? (
        <p className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No page matches “{query.trim()}”. Clear the filter to see all pages;
          the guides themselves are not searched by this field.
        </p>
      ) : null}
      <div className="mt-8 space-y-8">
        {matches.map((section) => (
          <section key={section.group} aria-labelledby={groupId(section.group)}>
            <h2
              id={groupId(section.group)}
              className="flex items-center gap-2 text-sm"
            >
              {section.group}
              <span className="text-[10px] font-normal text-muted-foreground">
                {section.entries.length}
              </span>
            </h2>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {section.entries.map((entry) => (
                <li
                  key={entry.slug}
                  className="group relative flex flex-col gap-1 rounded-xl border bg-card p-4 transition-colors hover:border-violet-300 focus-within:border-violet-400 dark:hover:border-violet-500/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/docs/${entry.slug}`}
                      className="text-sm font-medium text-foreground no-underline after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-violet-400"
                    >
                      {entry.title}
                    </Link>
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {entry.audience === "developer" ? "Developer" : "User"}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted-foreground">
                    {entry.summary}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
