import { describe, expect, it } from "vitest";
import {
  DOC_INDEX,
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

  it("refuses a path outside the documentation root", () => {
    expect(() => readDocFile("../package.json", docsRoot())).toThrow();
  });
});
