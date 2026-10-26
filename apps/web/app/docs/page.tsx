import { DocsSearch } from "@/components/docs/docs-search";
import { DOC_INDEX, docsNavigation } from "@/lib/docs-content";
import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Orbit documentation",
  description:
    "Setup, permissions, dashboard and developer guides for the Orbit community bot.",
};

export default function DocsIndex() {
  const nav = docsNavigation();
  const devCount = DOC_INDEX.filter(
    (entry) => entry.audience === "developer"
  ).length;
  return (
    <article className="docs-prose">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        User and developer guides
      </p>
      <h1>Orbit documentation</h1>
      <p>
        These pages are the repository&rsquo;s own Markdown, rendered at build
        time — one source, no second copy to drift. User guides cover installing
        Orbit, permissions and hierarchy, the dashboard and each module.
        Developer guides cover architecture, integrations, security, deployment
        and the current verified status.
      </p>
      <p>
        Developer pages are not secret: they describe code that is already in
        the repository and contain no credentials. If a guide and the code
        disagree, the code wins and the guide is the bug —{" "}
        <Link href="/docs/documentation">how this site is built</Link> explains
        the pipeline and how to fix a page.
      </p>
      <p className="text-[11px] text-muted-foreground">
        {DOC_INDEX.length} pages · {DOC_INDEX.length - devCount} user guides ·{" "}
        {devCount} developer guides. Content updates ship with a build; there is
        no runtime file access, no external documentation service and no hosted
        search index.
      </p>
      <DocsSearch
        sections={nav.map((section) => ({
          group: section.group,
          entries: section.entries.map((entry) => ({
            slug: entry.slug,
            title: entry.title,
            summary: entry.summary,
            audience: entry.audience,
          })),
        }))}
      />
    </article>
  );
}
