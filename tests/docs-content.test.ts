import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOC_INDEX,
  DOC_GROUP_INFO,
  DOC_GROUPS,
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
      // GitHub removes the period too, so `integration-http.ts` ends in
      // "httpts" in both places. One anchor for one heading.
      id: "shared-responsibilities-integration-httpts",
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
    // Anchors match GitHub's own algorithm: an apostrophe is removed rather
    // than turned into a hyphen, and underscores survive.
    expect(slugifyHeading("How Orbit's API works today")).toBe(
      "how-orbits-api-works-today"
    );
    expect(slugifyHeading("Discord says `Invalid OAuth2 redirect_uri`")).toBe(
      "discord-says-invalid-oauth2-redirect_uri"
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
    // The block scrolls sideways, so it has to be reachable by keyboard.
    expect(rendered.body).toContain('<pre tabindex="0">');
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

  it("builds code controls itself instead of trusting author markup", () => {
    const forged = renderDoc(
      { ...DOC_INDEX[0], file: "inline" },
      [
        "# T",
        "",
        '<button data-docs-copy aria-label="Run this">Fake control</button>',
        "",
        '<button onclick="alert(1)">Inline handler</button>',
        "",
        '<a href="http://insecure.example">plain http</a>',
        '<a href="javascript:alert(1)">javascript</a>',
        '<a href="//evil.example">protocol relative</a>',
        "",
        "```sh",
        'npm run dev -- --flag "<script>"',
        "```",
        "",
        '<pre><code class="language-yaml">forged: frame</code></pre>',
        "",
        '<form action="/steal"><input name=x></form>',
        '<iframe src="https://evil.example"></iframe>',
        "<img src=x onerror=alert(1)>",
      ].join("\n")
    );
    // Two code blocks (one fenced, one raw) and therefore exactly two controls;
    // both are the renderer's, and the author's buttons are gone even though one
    // carried the real marker attribute.
    expect(forged.html.match(/<pre/g) ?? []).toHaveLength(2);
    expect(forged.html.match(/<button/g) ?? []).toHaveLength(2);
    expect(forged.html.match(/data-docs-copy/g) ?? []).toHaveLength(2);
    expect(forged.html).not.toContain("Fake control");
    expect(forged.html).not.toContain("onclick");
    expect(forged.html).not.toContain("onerror");
    expect(forged.html).not.toContain("<form");
    expect(forged.html).not.toContain("<input");
    expect(forged.html).not.toContain("<iframe");
    expect(forged.html).not.toContain("<img");
    expect(forged.html).not.toContain("javascript:");
    expect(forged.html).not.toContain("//evil.example");
    expect(forged.html).not.toContain("http://insecure.example");
    // The generated frames carry the language and the code verbatim.
    expect(forged.html).toContain('data-language="sh"');
    expect(forged.html).toContain("&lt;script&gt;");
    expect(forged.html).toContain('data-language="yaml"');
    // Every control is one this module built: type, class, label and marker.
    for (const button of forged.html.match(/<button[^>]*>/g) ?? []) {
      expect(button).toContain('type="button"');
      expect(button).toContain('class="docs-copy"');
      expect(button).toContain("data-docs-copy");
      expect(button).toContain('aria-label="Copy this code block"');
    }
  });

  it("keeps every navigation group non-empty, described and in reading order", () => {
    const nav = docsNavigation();
    expect(nav.map((section) => section.group)).toEqual([...DOC_GROUPS]);
    expect(new Set(nav.map((section) => section.group)).size).toBe(nav.length);
    for (const section of nav) {
      expect(section.entries.length).toBeGreaterThan(0);
      expect(DOC_GROUP_INFO[section.group]?.description.length).toBeGreaterThan(
        20
      );
      // A page belongs to exactly one group, and that group is its own.
      for (const entry of section.entries)
        expect(entry.group).toBe(section.group);
    }
    expect(Object.keys(DOC_GROUP_INFO).sort()).toEqual([...DOC_GROUPS].sort());
    // Production groups live where an operator looks for them, not in "using".
    for (const slug of ["deployment", "workflows", "troubleshooting", "music"])
      expect(DOC_INDEX.find((entry) => entry.slug === slug)?.group).not.toBe(
        "Using Orbit"
      );
    expect(DOC_INDEX.find((entry) => entry.slug === "deployment")?.group).toBe(
      "Deployment and operations"
    );
    expect(
      DOC_INDEX.find((entry) => entry.slug === "troubleshooting")?.group
    ).toBe("Troubleshooting");
  });

  it("resolves every relative documentation link and its anchor", () => {
    const root = docsRoot();
    // Heading ids come from the renderer, so the check uses the same ids a
    // reader can actually click instead of a second slug implementation.
    const ids = new Map<string, Set<string>>();
    for (const entry of DOC_INDEX) {
      const doc = renderDoc(entry, readDocFile(entry.file, root));
      ids.set(
        entry.file,
        new Set([...doc.html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]))
      );
    }
    const links = /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    const uncurated = new Set<string>();
    let checked = 0;
    for (const entry of DOC_INDEX) {
      const markdown = readDocFile(entry.file, root);
      for (const match of markdown.matchAll(links)) {
        const target = match[1];
        if (/^(?:https?:|mailto:|#|\/)/.test(target)) continue;
        const [relative, anchor] = target.split("#");
        if (!relative) continue;
        const resolved = path
          .relative(
            root,
            path.resolve(root, path.dirname(entry.file), relative)
          )
          .split(path.sep)
          .join("/");
        const where = `${entry.file} → ${target}`;
        expect(existsSync(path.resolve(root, resolved)), where).toBe(true);
        // A page that is not curated stays out of the navigation on purpose;
        // its link is rewritten to the source file instead of a relative href.
        if (resolved.endsWith(".md") && !ids.has(resolved))
          uncurated.add(resolved);
        if (anchor) {
          const targetIds = ids.get(resolved);
          // A non-curated target is reported by the assertion above; only check
          // anchors where the renderer produced ids.
          if (targetIds) expect(targetIds.has(anchor), where).toBe(true);
        }
        checked += 1;
      }
    }
    expect(uncurated.size).toBeGreaterThan(0);
    for (const entry of DOC_INDEX) {
      const html = renderDoc(entry, readDocFile(entry.file, root)).body;
      // Either an in-app `/docs/<slug>` or an absolute source URL — never a
      // relative path that only works in a checkout.
      expect(html, entry.file).not.toMatch(
        /href="(?!https?:|\/)[^"]*\.md(?:#|")/
      );
    }
    expect(checked).toBeGreaterThan(100);
  });

  it("refuses a path outside the documentation root", () => {
    expect(() => readDocFile("../package.json", docsRoot())).toThrow();
  });
});
