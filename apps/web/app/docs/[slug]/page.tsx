import { DocsEnhance } from "@/components/docs/docs-enhance";
import {
  DOC_INDEX,
  docNeighbors,
  loadDoc,
  type RenderedDoc,
} from "@/lib/docs-content";
import {
  configuredSourceRef,
  DEFAULT_SOURCE_REF,
  sourceFileLink,
} from "@orbit/core/source-links";
import { ArrowLeft, ArrowRight, ExternalLink, ListTree } from "lucide-react";
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
  const { previous, next } = docNeighbors(slug);
  const related = DOC_INDEX.filter(
    (entry) => entry.group === doc.entry.group && entry.slug !== slug
  ).slice(0, 4);
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_190px] xl:items-start">
      <header className="xl:col-span-2">
        <nav
          aria-label="Breadcrumb"
          className="text-[11px] text-muted-foreground"
        >
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link
                href="/docs"
                className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                Documentation
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>{doc.entry.group}</li>
          </ol>
        </nav>
        <h1
          id={doc.titleId}
          className="mt-3 scroll-mt-24 text-2xl font-semibold tracking-tight"
        >
          {doc.title}
          <a
            className="ml-1.5 align-middle text-sm font-normal text-muted-foreground opacity-60 hover:opacity-100 focus-visible:opacity-100"
            href={`#${doc.titleId}`}
            data-docs-anchor
            aria-label={`Link to “${doc.title}”`}
          >
            #
          </a>
        </h1>
        <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
          {doc.summary}
        </p>
        <p className="mt-3 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
          <span className="rounded-md bg-muted px-1.5 py-0.5">
            {doc.entry.audience === "developer"
              ? "Developer guide"
              : "User guide"}
          </span>
          <span>From {doc.entry.file}</span>
        </p>
        <hr className="mt-5" />
      </header>

      {doc.toc.length > 2 && (
        <nav
          aria-label="On this page"
          className="rounded-xl border bg-card p-4 xl:col-start-2 xl:row-start-2 xl:sticky xl:top-[4.5rem]"
        >
          <h2 className="flex items-center gap-2 text-xs font-semibold">
            <ListTree size={14} aria-hidden="true" />
            On this page
          </h2>
          <ol className="mt-2 space-y-1 text-[12px]">
            {doc.toc.map((item) => (
              <li
                key={item.id}
                className={
                  item.level === 3
                    ? "hidden pl-3 leading-snug xl:block"
                    : "leading-snug"
                }
              >
                <a
                  href={`#${item.id}`}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                >
                  {item.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <article
        id="docs-article"
        className="docs-prose min-w-0 xl:col-start-1 xl:row-start-2"
      >
        <div dangerouslySetInnerHTML={{ __html: doc.body }} />
      </article>

      <footer className="xl:col-span-2">
        {related.length > 0 && (
          <section aria-labelledby="related-pages" className="mt-10">
            <h2 id="related-pages" className="text-xs font-semibold">
              {`More in ${doc.entry.group}`}
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {related.map((entry) => (
                <li key={entry.slug}>
                  <Link
                    href={`/docs/${entry.slug}`}
                    className="inline-flex rounded-md border bg-card px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    {entry.title}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <DocFooter doc={doc} previous={previous} next={next} />
      </footer>
      <DocsEnhance />
    </div>
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
      <nav
        aria-label="Documentation pages"
        className="mt-8 grid gap-3 border-t pt-5 sm:grid-cols-2"
      >
        {previous ? (
          <Link
            href={`/docs/${previous.slug}`}
            className="group flex flex-col rounded-xl border bg-card p-3 text-[12px] hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <ArrowLeft size={12} aria-hidden="true" />
              Previous
            </span>
            <span className="mt-0.5 font-medium">{previous.title}</span>
          </Link>
        ) : (
          <span className="hidden sm:block" />
        )}
        {next && (
          <Link
            href={`/docs/${next.slug}`}
            className="flex flex-col rounded-xl border bg-card p-3 text-[12px] hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:col-start-2 sm:text-right"
          >
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground sm:justify-end">
              Next
              <ArrowRight size={12} aria-hidden="true" />
            </span>
            <span className="mt-0.5 font-medium">{next.title}</span>
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
          className="inline-flex items-center gap-1 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          View the source of this page
          <ExternalLink size={10} aria-hidden="true" />
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
