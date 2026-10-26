"use client";
import Link from "next/link";
import { useId, useState } from "react";

export type DocsSection = {
  group: string;
  entries: { slug: string; title: string; summary: string }[];
};

const groupId = (group: string) => group.toLowerCase().replace(/[^a-z]+/g, "-");

/**
 * Filters the documentation index by page title, summary or group.
 *
 * It is a filter over the pages already on the page — not a full-text search of
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
        `${section.group} ${entry.title} ${entry.summary}`
          .toLowerCase()
          .includes(term)
      ),
    }))
    .filter((section) => section.entries.length);
  const total = matches.reduce(
    (sum, section) => sum + section.entries.length,
    0
  );
  const describedBy = useId();
  return (
    <div className="not-prose mt-6">
      <label
        htmlFor={`${describedBy}-search`}
        className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        Find a page
      </label>
      <input
        id={`${describedBy}-search`}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Title, topic, or audience…"
        aria-describedby={describedBy}
        className="mt-2 w-full max-w-md rounded-md border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      />
      <p id={describedBy} className="mt-2 text-[11px] text-muted-foreground">
        Filters this page by title, summary and group; it does not search inside
        the guides.
      </p>
      <p aria-live="polite" className="sr-only">
        {term ? `${total} matching pages` : ""}
      </p>
      {term && !total ? (
        <p className="mt-6 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No page matches “{query.trim()}”. Clear the field to see all pages.
        </p>
      ) : null}
      <div className="mt-8 space-y-8">
        {matches.map((section) => (
          <section key={section.group}>
            <h2 id={groupId(section.group)}>{section.group}</h2>
            <ul>
              {section.entries.map((entry) => (
                <li key={entry.slug}>
                  <Link href={`/docs/${entry.slug}`}>{entry.title}</Link>
                  {" — "}
                  {entry.summary}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
