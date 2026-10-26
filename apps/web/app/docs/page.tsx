import { DOC_INDEX, docsNavigation } from "@/lib/docs-content";
import type { Metadata } from "next";
import { DocsSearch } from "@/components/docs-search";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Orbit documentation",
  description:
    "Setup, permissions, dashboard and developer guides for the Orbit community bot.",
};

export default function DocsIndex() {
  return (
    <article className="docs-prose">
      <h1>Orbit documentation</h1>
      <p>
        Every page here is the repository&rsquo;s own Markdown, rendered at
        build time — one source, no second copy to drift.
      </p>
      <p>
        <strong>User guides</strong> cover installing Orbit, permissions and
        hierarchy, the dashboard, and each module.{" "}
        <strong>Developer guides</strong> cover architecture, integrations,
        security, deployment and the current verified status. Developer pages
        are not secret: they describe code that is already in the repository and
        contain no credentials.
      </p>
      <DocsSearch
        sections={docsNavigation().map((section) => ({
          group: section.group,
          entries: section.entries.map((entry) => ({
            slug: entry.slug,
            title: entry.title,
            summary: entry.summary,
          })),
        }))}
      />
      <p className="text-[11px] text-muted-foreground">
        {DOC_INDEX.length} pages. Content updates ship with a build; there is no
        runtime file access and no external documentation service.
      </p>
    </article>
  );
}
