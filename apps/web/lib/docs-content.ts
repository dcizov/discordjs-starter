/**
 * The in-app documentation is generated from the repository's own Markdown.
 *
 * `docs/*.md` and `README.md` stay the single source of truth: there is no
 * second hand-maintained copy of a setup page, a permission table or a command
 * list to drift out of sync. Pages are rendered at build time (see the
 * `force-static` route), so the runtime image does not need the `docs/` folder
 * and nothing is read from disk on a request.
 *
 * The content is trusted, repository-owned Markdown, never user input, but it
 * is still sanitized: a doc must not be able to inject a script, an iframe or
 * an inline event handler into the dashboard's origin.
 */
import { configuredSourceRef, sourceFileLink } from "@orbit/core/source-links";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export type DocsAudience = "user" | "developer";

export type DocEntry = {
  slug: string;
  file: string;
  title: string;
  group: string;
  audience: DocsAudience;
  summary: string;
};

/**
 * Curated order and grouping. A repository doc that is not listed here is
 * still readable in the repo; it just does not get a navigation entry, so an
 * implementation diary cannot silently masquerade as user help.
 */
export const DOC_INDEX: readonly DocEntry[] = [
  {
    slug: "start-here",
    file: "README.md",
    title: "Start here",
    group: "Getting started",
    audience: "user",
    summary:
      "What Orbit does, the invite, the first-run checklist and where each guide lives.",
  },
  {
    slug: "permissions",
    file: "docs/PERMISSIONS.md",
    title: "Permissions and hierarchy",
    group: "Getting started",
    audience: "user",
    summary:
      "Exact least-privilege bits, channel overrides, role hierarchy and what Orbit refuses to do.",
  },
  {
    slug: "dashboard",
    file: "docs/DASHBOARD-UX.md",
    title: "Dashboard guide",
    group: "Using Orbit",
    audience: "user",
    summary:
      "Navigation, states, identity, audit identity and the first-visit tour.",
  },
  {
    slug: "community",
    file: "docs/COMMUNITY.md",
    title: "Polls and announcements",
    group: "Using Orbit",
    audience: "user",
    summary:
      "Drafting, previews, publication safeguards, revisions and recovery.",
  },
  {
    slug: "where-to-use",
    file: "docs/CHANNELS-AND-PLACEMENT.md",
    title: "Where to use each module",
    group: "Using Orbit",
    audience: "user",
    summary:
      "Required channel types and permissions per command, with recommendations kept separate from requirements.",
  },
  {
    slug: "news",
    file: "docs/INTEGRATIONS.md",
    title: "News sources and webhooks",
    group: "Admin and setup",
    audience: "user",
    summary:
      "Steam app news, RSS/Atom, signed webhooks, routing, previews and delivery history.",
  },
  {
    slug: "deals",
    file: "docs/DEALS.md",
    title: "Deals and watchlists",
    group: "Admin and setup",
    audience: "user",
    summary:
      "IsThereAnyDeal setup, regions, historical lows and what Orbit refuses to claim.",
  },
  {
    slug: "channels",
    file: "docs/CHANNEL_EXPORT.md",
    title: "Channel and role export",
    group: "Admin and setup",
    audience: "developer",
    summary: "Read-only export tooling, formats and privacy.",
  },
  {
    slug: "music",
    file: "docs/MUSIC.md",
    title: "Music and voice",
    group: "Music",
    audience: "user",
    summary:
      "Lavalink, the listening room, DJ role, queue rules, seek and troubleshooting.",
  },
  {
    slug: "music-plugins",
    file: "docs/MUSIC-PLUGINS.md",
    title: "Music plugins and sources",
    group: "Music",
    audience: "developer",
    summary:
      "Installed plugins, source ownership, SFW boundaries and what is not supported.",
  },
  {
    slug: "workflows",
    file: "docs/WORKFLOWS.md",
    title: "Development workflows",
    group: "Development",
    audience: "developer",
    summary:
      "Choose between the host-Node workflow, full-stack Docker and the Dev Container, and where each guide lives.",
  },
  {
    slug: "development",
    file: "docs/DEVELOPMENT.md",
    title: "Development workflow",
    group: "Development",
    audience: "developer",
    summary: "Scripts, containers, checks and lifecycle.",
  },
  {
    slug: "devcontainer",
    file: "docs/DEVCONTAINER.md",
    title: "Dev container",
    group: "Development",
    audience: "developer",
    summary: "Container-based development, ports and data safety.",
  },
  {
    slug: "developer-navigation",
    file: "docs/DEVELOPER-NAVIGATION.md",
    title: "Developer navigation",
    group: "Development",
    audience: "developer",
    summary:
      "Where every runtime, domain service, job, screen and test lives, and where to start.",
  },
  {
    slug: "dashboard-workflows",
    file: "docs/DASHBOARD-WORKFLOWS.md",
    title: "Dashboard workflows",
    group: "Development",
    audience: "developer",
    summary:
      "Reference-dashboard workflows, the accepted slice, and the table foundation decisions.",
  },
  {
    slug: "deployment",
    file: "docs/DEPLOYMENT.md",
    title: "Deployment",
    group: "Deployment and operations",
    audience: "developer",
    summary: "Environment, containers, startup order and troubleshooting.",
  },
  {
    slug: "continuation",
    file: "docs/CONTINUATION.md",
    title: "Current status",
    group: "Deployment and operations",
    audience: "developer",
    summary:
      "What is verified, what is deferred and what still needs a live check.",
  },
  {
    slug: "architecture",
    file: "docs/ARCHITECTURE.md",
    title: "Architecture",
    group: "Architecture and reference",
    audience: "developer",
    summary:
      "Runtime responsibilities, data flow, serialization and the web/bot boundary.",
  },
  {
    slug: "integrations",
    file: "docs/INTEGRATION-ARCHITECTURE.md",
    title: "Integration architecture",
    group: "Architecture and reference",
    audience: "developer",
    summary:
      "Provider ownership, shared transport rules and how to add a provider.",
  },
  {
    slug: "security",
    file: "docs/SECURITY.md",
    title: "Security model",
    group: "Architecture and reference",
    audience: "developer",
    summary:
      "Trust boundaries, OAuth, SSRF, secrets, webhooks and failure handling.",
  },
  {
    slug: "commands",
    file: "docs/COMMANDS.md",
    title: "Command reference",
    group: "Architecture and reference",
    audience: "user",
    summary:
      "How the generated command catalog behaves and what it does not verify.",
  },
  {
    slug: "news-formatting",
    file: "docs/NEWS-FORMATTING.md",
    title: "News formatting contract",
    group: "Architecture and reference",
    audience: "user",
    summary: "How cards are rendered, attributed and truncated.",
  },
  {
    slug: "orpc",
    file: "docs/ORPC-DECISION.md",
    title: "oRPC decision",
    group: "Architecture and reference",
    audience: "developer",
    summary:
      "Why Orbit keeps its hand-written API contract, what was reduced instead, and the revisit triggers.",
  },
  {
    slug: "documentation",
    file: "docs/DOCUMENTATION.md",
    title: "Documentation platform",
    group: "Architecture and reference",
    audience: "developer",
    summary:
      "Framework research, hosting and visibility decisions, and how to add a page.",
  },
  {
    slug: "troubleshooting",
    file: "docs/TROUBLESHOOTING.md",
    title: "Troubleshooting",
    group: "Troubleshooting",
    audience: "user",
    summary:
      "Start from the symptom you see; every fix stays owned by the page that can verify it.",
  },
];

/**
 * Sidebar groups, in reading order. The manifest above is the single place that
 * decides both order and membership: a page belongs to exactly one group and a
 * group exists because it has pages, so the navigation cannot drift from the
 * index. These descriptions are used on `/docs` only — a guide page states its
 * own audience instead of restating its group.
 */
export const DOC_GROUP_INFO: Record<string, { description: string }> = {
  "Getting started": {
    description:
      "Invite Orbit, grant only what it needs, and see what it refuses to do.",
  },
  "Using Orbit": {
    description:
      "The dashboard and the community modules a member or moderator works in.",
  },
  "Admin and setup": {
    description:
      "Connect news sources, deals and channel exports for a server.",
  },
  Music: {
    description:
      "The optional Lavalink backend, the listening room, and the source boundaries.",
  },
  Development: {
    description:
      "Choose a workflow, run the same checks CI runs, and find the code.",
  },
  "Deployment and operations": {
    description:
      "Run the same images without hot reload, and read the current verified status.",
  },
  "Architecture and reference": {
    description:
      "How Orbit is put together, what it guarantees, and the contracts it keeps.",
  },
  Troubleshooting: {
    description:
      "Start from the symptom; each fix stays owned by the page that can verify it.",
  },
};

export const DOC_GROUPS = [
  "Getting started",
  "Using Orbit",
  "Admin and setup",
  "Music",
  "Development",
  "Deployment and operations",
  "Architecture and reference",
  "Troubleshooting",
] as const;

/** Resolve the repository root without depending on the process cwd alone. */
export function docsRoot(cwd = process.cwd()) {
  for (const candidate of [
    path.resolve(cwd, "docs"),
    path.resolve(cwd, "../../docs"),
  ])
    if (existsSync(candidate)) return path.resolve(candidate, "..");
  return cwd;
}

export function readDocFile(file: string, root = docsRoot()) {
  const full = path.resolve(root, file);
  if (!full.startsWith(path.resolve(root)))
    throw new Error(`Documentation path escapes the repository: ${file}`);
  return readFileSync(full, "utf8");
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Inline Markdown in a summary/title only ever produces escaped text: the
 * navigation is not a place to render arbitrary HTML.
 */
/**
 * Inline Markdown is rendered to HTML (inline code becomes `<code>`), so a
 * heading id or a label must strip those tags instead of leaking the word
 * "code" into the anchor or showing literal `&lt;code&gt;` text.
 */
function textFromHtml(html: string) {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function plain(value: string) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleOf(markdown: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? plain(match[1]) : "";
}

export function summaryOf(markdown: string) {
  const body = markdown.replace(/^#\s+.+$/m, "");
  const paragraph = body
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block &&
        !block.startsWith("#") &&
        !block.startsWith("```") &&
        !block.startsWith("|") &&
        !block.startsWith(">") &&
        !block.startsWith("-") &&
        !/^[0-9]+\./.test(block)
    );
  return paragraph
    ? (plain(paragraph)
        .split(/(?<=\.)\s/)[0]
        ?.slice(0, 200) ?? "")
    : "";
}

/** `docs/MUSIC.md#x` and `MUSIC.md` both point at the in-app page. */
export function rewriteDocLinks(
  html: string,
  entries = DOC_INDEX,
  context: {
    /** The Markdown file being rendered, so `../README.md` resolves. */
    file?: string;
    /** Where a repository-only page lives, when it is not a docs page. */
    sourceUrl?: (file: string) => string;
  } = {}
) {
  const byFile = new Map(entries.map((entry) => [entry.file, entry.slug]));
  const byBase = new Map(
    entries.map((entry) => [path.basename(entry.file), entry.slug])
  );
  const resolve = (target: string) =>
    context.file
      ? path.posix
          .normalize(path.posix.join(path.posix.dirname(context.file), target))
          .replace(/^\.\//, "")
      : "";
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    if (/^(https?:|mailto:|#)/i.test(href)) return whole;
    const [target, hash] = href.split("#");
    const normalized = target.replace(/^\.\//, "").replace(/^\.\.\//, "");
    const fromFile = context.file ? resolve(target) : "";
    const candidates = [
      fromFile,
      normalized,
      normalized.replace(/^\.\//, ""),
      path.posix.normalize(normalized),
      path.basename(normalized),
    ].filter(Boolean);
    for (const candidate of candidates) {
      const slug =
        byFile.get(candidate) ?? byBase.get(path.basename(candidate));
      if (slug) return `href="/docs/${slug}${hash ? `#${hash}` : ""}"`;
    }
    if (!/\.md$/i.test(target)) return whole;
    // A curated page is a page; anything else really lives in the repository.
    // Sending the reader to the file's source is honest, and it keeps a working
    // link instead of an in-app URL that would 404.
    if (context.sourceUrl && fromFile)
      return [
        `href="${escapeHtml(context.sourceUrl(fromFile))}${hash ? `#${escapeHtml(hash)}` : ""}"`,
        'target="_blank"',
        'rel="noreferrer noopener"',
      ].join(" ");
    return `href="${escapeHtml(href)}"`;
  });
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "a",
    "ul",
    "ol",
    "li",
    "blockquote",
    "code",
    "pre",
    "strong",
    "em",
    "del",
    "hr",
    "br",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "span",
    "div",
  ],
  allowedAttributes: {
    a: [
      "href",
      "id",
      "title",
      "rel",
      "class",
      "aria-label",
      "data-docs-anchor",
    ],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    code: ["class"],
    span: ["class"],
    div: ["class", "role", "tabindex", "aria-label", "data-tone"],
    blockquote: ["data-tone"],
    th: ["align", "scope"],
    td: ["align"],
  },
  /**
   * No interactive element survives sanitization. The only control on a guide
   * page — the code-block copy button — is inserted afterwards by
   * `enhanceCodeBlocks`, which reads the sanitized markup and builds the button
   * itself. An author-supplied `<button>`, and even a forged
   * `data-docs-copy` attribute, therefore has nothing to attach to.
   */
  exclusiveFilter: (frame) =>
    ["button", "input", "select", "textarea", "form"].includes(frame.tag),
  // Control text is content, not prose: dropping the tag but leaving "Save"
  // behind would read as an instruction that no longer exists.
  nonTextTags: [
    "script",
    "style",
    "textarea",
    "option",
    "button",
    "select",
    "form",
    "iframe",
    "noscript",
  ],
  // Documentation links are absolute, in-app or anchors; images are not part
  // of the docs set, so a remote image cannot beacon from the dashboard.
  allowedSchemes: ["https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    // Keep external links explicit and non-credential-leaking.
    a: (tagName: string, attribs: Record<string, string>) => ({
      tagName,
      attribs: {
        ...attribs,
        ...(/^https?:/i.test(attribs.href ?? "")
          ? { rel: "noopener noreferrer" }
          : {}),
      },
    }),
  },
};

export type RenderedDoc = {
  entry: DocEntry;
  title: string;
  summary: string;
  /** Full rendered page, including the Markdown `# Title` heading. */
  html: string;
  /** The same content without that heading, for a page that renders its own. */
  body: string;
  /** Heading id of the Markdown title, so `#<title>` deep links keep working. */
  titleId: string;
  toc: { id: string; text: string; level: number }[];
};

/**
 * Heading id in the same shape GitHub uses for its own anchors: punctuation is
 * dropped (an apostrophe becomes nothing, not a hyphen), spaces become single
 * hyphens and underscores survive. A guide written to be read on GitHub and in
 * the dashboard then has one anchor, not two, which is what lets a
 * `docs/PAGE.md#section` link work in both places.
 */
export function slugifyHeading(text: string) {
  return plain(text)
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]+/gu, "")
    .trim()
    .replace(/\s/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Wrap every sanitized `<pre>` in a documentation code frame with a copy control.
 *
 * This runs **after** sanitization and constructs the caption and button from
 * the sanitized string itself, so the control's identity is never derived from
 * content. Consequences worth stating: a fenced block and a raw `<pre>` in a
 * guide are treated the same way (both are code the reader may want to copy —
 * no capability is gained by writing one), while `<button>`, `data-docs-copy`
 * and every other interactive attribute have already been removed.
 */
export function enhanceCodeBlocks(html: string) {
  return html.replace(/<pre>([\s\S]*?)<\/pre>/g, (_whole, inner: string) => {
    const language =
      inner.match(/class="language-([A-Za-z0-9_+#.-]{1,24})"/)?.[1] ?? "";
    const label = language ? escapeHtml(language) : "code";
    return [
      `<figure class="docs-code"${language ? ` data-language="${label}"` : ""}>`,
      "<figcaption>",
      `<span class="docs-code-lang">${label}</span>`,
      '<button type="button" class="docs-copy" data-docs-copy aria-label="Copy this code block">Copy</button>',
      "</figcaption>",
      `<pre>${inner}</pre>`,
      "</figure>",
    ].join("");
  });
}

/**
 * Callout tone from the first words of a quote.
 *
 * The docs already write `> **Warning:** …` / `> **Note:** …`; the tone is read
 * from that lead-in instead of asking authors to learn a new directive. An
 * unrecognised quote stays a plain quote, so nothing is mislabelled as a warning.
 */
function calloutTone(text: string): string {
  const lead = text.trim().toLowerCase();
  if (/^(?:\*\*)?(?:warning|caution|danger)/.test(lead)) return "warning";
  if (
    /^(?:\*\*)?(?:requirement|prerequisite|important|before you start)/.test(
      lead
    )
  )
    return "requirement";
  if (/^(?:\*\*)?(?:note|hint|tip)/.test(lead)) return "note";
  return "quote";
}

/**
 * Render one repository doc to sanitized HTML with stable heading anchors, a
 * table of contents built from the same heading ids, language-labelled code
 * frames and tone-aware quotes.
 */
export function renderDoc(entry: DocEntry, markdown: string): RenderedDoc {
  const toc: RenderedDoc["toc"] = [];
  const seen = new Map<string, number>();
  const renderer = new marked.Renderer();
  renderer.heading = ({ tokens, depth }) => {
    const text = plain(textFromHtml(renderer.parser.parseInline(tokens)));
    const base = slugifyHeading(text) || `section-${depth}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    const id = count ? `${base}-${count}` : base;
    if (depth === 2 || depth === 3) toc.push({ id, text, level: depth });
    // A real link, not a script: middle-click, "copy link address" and a JS-less
    // reader all get the same stable per-section URL.
    return `<h${depth} id="${escapeHtml(id)}">${escapeHtml(text)}<a class="docs-anchor" href="#${escapeHtml(id)}" data-docs-anchor aria-label="Link to “${escapeHtml(text)}”">#</a></h${depth}>`;
  };
  renderer.link = ({ href, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    return `<a href="${escapeHtml(href)}">${text}</a>`;
  };
  renderer.code = ({ text, lang }) => {
    // Deliberately minimal: only the code and its language class. The frame and
    // its copy control are added after sanitization (see `enhanceCodeBlocks`),
    // so no interactive markup is ever produced from content.
    const language = (lang ?? "").trim().split(/\s+/)[0]?.slice(0, 24) ?? "";
    return `<pre><code${language ? ` class="language-${escapeHtml(language)}"` : ""}>${escapeHtml(text)}</code></pre>`;
  };
  renderer.blockquote = ({ tokens }) => {
    const inner = renderer.parser.parse(tokens);
    const text = textFromHtml(inner);
    return `<blockquote data-tone="${calloutTone(text)}">${inner}</blockquote>`;
  };
  const raw = marked.parse(markdown, { async: false, renderer }) as string;
  const linked = rewriteDocLinks(raw, DOC_INDEX, {
    file: entry.file,
    sourceUrl: (file) => sourceFileLink(file, { ref: configuredSourceRef() }),
  })
    // Wide tables scroll inside their own frame instead of pushing the whole
    // page sideways; `tabindex` keeps that scroll reachable from the keyboard.
    // Tables cannot nest, so the wrapper stays balanced.
    .replace(
      /<table>/g,
      '<div class="docs-table" role="region" aria-label="Table, scrollable" tabindex="0"><table>'
    )
    .replace(/<\/table>/g, "</table></div>");
  const html = enhanceCodeBlocks(sanitizeHtml(linked, SANITIZE));
  // The page renders the title itself (with breadcrumb, audience and intro), so
  // the Markdown heading is detached from the body instead of appearing twice.
  const heading = html.match(/^<h1([^>]*)>([\s\S]*?)<\/h1>/);
  const titleId = heading?.[1].match(/id="([^"]+)"/)?.[1] ?? "top";
  return {
    entry,
    title: titleOf(markdown) || entry.title,
    summary: summaryOf(markdown) || entry.summary,
    html,
    body: heading ? html.slice(heading[0].length) : html,
    titleId,
    toc,
  };
}

/** Previous/next page inside the curated navigation order. */
export function docNeighbors(
  slug: string,
  entries: readonly DocEntry[] = DOC_INDEX
) {
  const index = entries.findIndex((entry) => entry.slug === slug);
  if (index < 0) return { previous: null, next: null };
  return {
    previous: index > 0 ? entries[index - 1] : null,
    next: index < entries.length - 1 ? entries[index + 1] : null,
  };
}

export function loadDoc(slug: string, root = docsRoot()): RenderedDoc | null {
  const entry = DOC_INDEX.find((item) => item.slug === slug);
  if (!entry) return null;
  return renderDoc(entry, readDocFile(entry.file, root));
}

export function docsNavigation() {
  return DOC_GROUPS.map((group) => ({
    group,
    entries: DOC_INDEX.filter((entry) => entry.group === group),
  })).filter((section) => section.entries.length > 0);
}
