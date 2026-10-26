import {
  DOC_INDEX,
  docsNavigation,
  loadDoc,
  type RenderedDoc,
} from "@/lib/docs-content";
import {
  configuredSourceRef,
  DEFAULT_SOURCE_REF,
  sourceFileLink,
} from "@orbit/core/source-links";
import { ArrowRight, ListTree } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

// Pre-rendered at build time: the production image does not contain docs/,
// and a request never reads from disk.
export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return DOC_INDEX.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = loadDoc(slug);
  if (!doc) return { title: "Documentation · Orbit" };
  return {
    title: `${doc.title} · Orbit documentation`,
    description: doc.summary,
  };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = loadDoc(slug);
  if (!doc) notFound();
  const flat = docsNavigation().flatMap((section) => section.entries);
  const index = flat.findIndex((entry) => entry.slug === slug);
  const previous = index > 0 ? flat[index - 1] : null;
  const next = index >= 0 && index < flat.length - 1 ? flat[index + 1] : null;
  return (
    <article className="docs-prose">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {doc.entry.group} ·{" "}
        {doc.entry.audience === "developer" ? "Developer" : "User"} guide
      </p>
      <div dangerouslySetInnerHTML={{ __html: doc.html }} />
      <DocFooter doc={doc} previous={previous} next={next} />
    </article>
  );
}

function DocFooter({
  doc,
  previous,
  next,
}: {
  doc: RenderedDoc;
  previous: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}) {
  // Resolved once per rendered page from build-time configuration.
  const ref = configuredSourceRef();
  return (
    <>
      {doc.toc.length > 2 && (
        <nav
          aria-label="On this page"
          className="mt-10 rounded-lg border bg-card p-4"
        >
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <ListTree size={14} aria-hidden="true" />
            On this page
          </h2>
          <ol className="mt-2 space-y-1 text-[12px]">
            {doc.toc.map((item) => (
              <li key={item.id} className={item.level === 3 ? "pl-4" : ""}>
                <a href={`#${item.id}`}>{item.text}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <nav
        aria-label="Documentation pages"
        className="mt-8 flex flex-wrap justify-between gap-3 border-t pt-5 text-[12px]"
      >
        {previous ? (
          <Link href={`/docs/${previous.slug}`} className="hover:underline">
            ← {previous.title}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={`/docs/${next.slug}`}
            className="flex items-center gap-1 hover:underline"
          >
            {next.title}
            <ArrowRight size={12} aria-hidden="true" />
          </Link>
        )}
      </nav>
      <p className="mt-6 text-[10px] text-muted-foreground">
        Generated from <code>{doc.entry.file}</code> in the Orbit repository.{" "}
        <a
          // Built from build-time configuration only, never from the request.
          href={sourceFileLink(doc.entry.file, { ref })}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2"
        >
          View the source of this page
        </a>{" "}
        {ref === DEFAULT_SOURCE_REF ? (
          <span>
            (links to the <code>{DEFAULT_SOURCE_REF}</code> branch, because this
            build did not set <code>ORBIT_SOURCE_REF</code>)
          </span>
        ) : (
          <span>
            (at <code>{ref.slice(0, 12)}</code>)
          </span>
        )}
        <span className="sr-only"> on GitHub (opens in a new tab)</span>.
      </p>
    </>
  );
}
