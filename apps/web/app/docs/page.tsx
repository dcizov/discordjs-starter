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
  return (
    <article className="docs-prose">
      <h1>Orbit documentation</h1>
      <p>
        These pages are generated from the repository&rsquo;s own Markdown, so a
        guide here is the same file a developer reviews in a pull request. There
        is no second copy to drift out of sync.
      </p>
      <p>
        <strong>User guides</strong> cover installing Orbit, permissions and
        hierarchy, the dashboard, and each module.{" "}
        <strong>Developer guides</strong> cover architecture, integrations,
        security, deployment and the current verified status. Developer pages
        are not secret: they describe code that is already in the repository and
        contain no credentials.
      </p>
      {docsNavigation().map((section) => (
        <section key={section.group}>
          <h2 id={section.group.toLowerCase().replace(/[^a-z]+/g, "-")}>
            {section.group}
          </h2>
          <ul>
            {section.entries.map((entry) => (
              <li key={entry.slug}>
                <Link href={`/docs/${entry.slug}`}>{entry.title}</Link>
                {entry.slug === "start-here" ? (
                  <>
                    {" — "}
                    {entry.summary}
                  </>
                ) : (
                  <> — {entry.summary}</>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-[11px] text-muted-foreground">
        {DOC_INDEX.length} pages. Content updates ship with a build; there is no
        runtime file access and no external documentation service.
      </p>
    </article>
  );
}
