import { describe, expect, it } from "vitest";
import {
  DOC_INDEX,
  docNeighbors,
  docsNavigation,
  docsRoot,
  loadDoc,
  readDocFile,
  renderDoc,
  rewriteDocLinks,
  slugifyHeading,
  summaryOf,
  titleOf,
} from "../apps/web/lib/docs-content";

describe("in-app documentation is generated from the repository", () => {
  it("lists every curated doc with a unique slug, a group and an audience", () => {
    expect(new Set(DOC_INDEX.map((doc) => doc.slug)).size).toBe(
      DOC_INDEX.length
    );
    expect(new Set(DOC_INDEX.map((doc) => doc.file)).size).toBe(
      DOC_INDEX.length
    );
    expect(docsNavigation().flatMap((section) => section.entries)).toHaveLength(
      DOC_INDEX.length
    );
    for (const doc of DOC_INDEX) {
      expect(doc.summary.length).toBeGreaterThan(10);
      expect(readDocFile(doc.file, docsRoot()).length).toBeGreaterThan(200);
    }
  });

  it("renders real repository docs with anchored headings and a table of contents", () => {
    const doc = loadDoc("music");
    expect(doc).not.toBeNull();
    expect(doc!.html).toContain("<h1");
    expect(doc!.html).toContain('id="');
    expect(doc!.toc.length).toBeGreaterThan(2);
    expect(
      doc!.toc.every((item) => doc!.html.includes(`id="${item.id}"`))
    ).toBe(true);
    // Tables and fenced code survive; raw HTML from a doc is sanitized away.
    const rendered = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      "# Title\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```sh\nnpm run dev\n```\n\n<script>alert(1)</script>\n\n[Guide](../MUSIC.md#start)"
    );
    expect(rendered.html).toContain("<table>");
    expect(rendered.html).toContain("npm run dev");
    expect(rendered.html).not.toContain("<script");
    expect(rendered.html).toContain('href="/docs/music#start"');
  });

  it("renders inline code in headings instead of leaking markup", () => {
    const rendered = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      "# T\n\n## Shared responsibilities (`integration-http.ts`)\n\nbody"
    );
    expect(rendered.html).not.toContain("&lt;code");
    expect(rendered.html).not.toMatch(/id="[^"]*\bcode\b/);
    expect(rendered.html).toContain("integration-http.ts");
    expect(rendered.toc[0]).toMatchObject({
      text: "Shared responsibilities (integration-http.ts)",
      id: "shared-responsibilities-integration-http-ts",
    });
  });

  it("keeps external and in-app links distinct and blocks off-site beacons", () => {
    const html = rewriteDocLinks(
      '<a href="https://example.com/x">x</a><a href="SECURITY.md">s</a><a href="NOTES.md">n</a>'
    );
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain('href="/docs/security"');
    expect(html).toContain('href="NOTES.md"');
  });

  it("derives titles, summaries and stable heading ids", () => {
    expect(titleOf("# The listening room: Lavalink v4\n\nbody")).toContain(
      "Lavalink"
    );
    expect(summaryOf("# T\n\nFirst sentence. Second sentence.")).toBe(
      "First sentence."
    );
    expect(slugifyHeading("What Orbit never does (by design)")).toBe(
      "what-orbit-never-does-by-design"
    );
  });

  it("separates the page title from the rendered body exactly once", () => {
    const doc = loadDoc("workflows");
    expect(doc).not.toBeNull();
    // The page component renders the title (with breadcrumb and intro), so the
    // body must not repeat the heading.
    expect(doc!.html.match(/<h1\b/g)).toHaveLength(1);
    expect(doc!.body).not.toContain("<h1");
    expect(doc!.body).toContain(`id="${doc!.toc[0].id}"`);
    expect(doc!.titleId).toBe(slugifyHeading(doc!.title));
    expect(doc!.html).toContain(`id="${doc!.titleId}"`);
  });

  it("frames fenced code with a language and a copy control only it may add", () => {
    const rendered = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      "# T\n\n```sh\nnpm ci\n```\n\n```\nplain\n```"
    );
    expect(rendered.body).toContain(
      '<figure class="docs-code" data-language="sh">'
    );
    expect(rendered.body).toContain('<span class="docs-code-lang">sh</span>');
    expect(rendered.body).toContain('class="language-sh">npm ci</code>');
    expect(rendered.body).toContain("data-docs-copy");
    // Without a language the frame still renders, labelled "code".
    expect(rendered.body).toContain('<span class="docs-code-lang">code</span>');
    // A button written in the Markdown is not a documentation control.
    const hostile = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      '# T\n\n<button onclick="alert(1)">Delete everything</button>'
    );
    expect(hostile.body).not.toContain("<button");
  });

  it("only labels a quote as a callout when its own text says so", () => {
    const rendered = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      "# T\n\n> **Warning:** never run two bots on one token.\n\n> **Prerequisite:** Docker Compose v2.24+.\n\n> **Note:** docs are generated.\n\n> A plain quotation."
    );
    expect(rendered.body).toContain('data-tone="warning"');
    expect(rendered.body).toContain('data-tone="requirement"');
    expect(rendered.body).toContain('data-tone="note"');
    expect(rendered.body).toContain('data-tone="quote"');
  });

  it("gives a wide table its own focusable scroll frame", () => {
    const rendered = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      "# T\n\n| a | b |\n| - | - |\n| 1 | 2 |"
    );
    expect(rendered.body).toContain(
      '<div class="docs-table" role="region" aria-label="Table, scrollable" tabindex="0">'
    );
    expect(rendered.body).toContain("</table></div>");
  });

  it("walks the curated order for previous/next links and stops at the ends", () => {
    const first = docNeighbors(DOC_INDEX[0].slug);
    expect(first.previous).toBeNull();
    expect(first.next?.slug).toBe(DOC_INDEX[1].slug);
    const last = docNeighbors(DOC_INDEX[DOC_INDEX.length - 1].slug);
    expect(last.next).toBeNull();
    expect(last.previous?.slug).toBe(DOC_INDEX[DOC_INDEX.length - 2].slug);
    expect(docNeighbors("not-a-doc")).toEqual({ previous: null, next: null });
    // The three-workflow router is reachable from the navigation.
    expect(
      docsNavigation()
        .flatMap((section) => section.entries)
        .some(
          (entry) =>
            entry.slug === "workflows" && entry.file === "docs/WORKFLOWS.md"
        )
    ).toBe(true);
  });

  it("refuses a path outside the documentation root", () => {
    expect(() => readDocFile("../package.json", docsRoot())).toThrow();
  });
});
