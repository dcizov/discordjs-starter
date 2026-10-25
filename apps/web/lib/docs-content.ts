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
    slug: "deployment",
    file: "docs/DEPLOYMENT.md",
    title: "Deployment",
    group: "Getting started",
    audience: "developer",
    summary: "Environment, containers, startup order and troubleshooting.",
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
    slug: "news",
    file: "docs/INTEGRATIONS.md",
    title: "News sources and webhooks",
    group: "Using Orbit",
    audience: "user",
    summary:
      "Steam app news, RSS/Atom, signed webhooks, routing, previews and delivery history.",
  },
  {
    slug: "news-formatting",
    file: "docs/NEWS-FORMATTING.md",
    title: "News formatting contract",
    group: "Using Orbit",
    audience: "user",
    summary: "How cards are rendered, attributed and truncated.",
  },
  {
    slug: "deals",
    file: "docs/DEALS.md",
    title: "Deals and watchlists",
    group: "Using Orbit",
    audience: "user",
    summary:
      "IsThereAnyDeal setup, regions, historical lows and what Orbit refuses to claim.",
  },
  {
    slug: "music",
    file: "docs/MUSIC.md",
    title: "Music and voice",
    group: "Using Orbit",
    audience: "user",
    summary:
      "Lavalink, the listening room, DJ role, queue rules, seek and troubleshooting.",
  },
  {
    slug: "music-plugins",
    file: "docs/MUSIC-PLUGINS.md",
    title: "Music plugins and sources",
    group: "Using Orbit",
    audience: "developer",
    summary:
      "Installed plugins, source ownership, SFW boundaries and what is not supported.",
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
    slug: "commands",
    file: "docs/COMMANDS.md",
    title: "Command reference",
    group: "Using Orbit",
    audience: "user",
    summary:
      "How the generated command catalog behaves and what it does not verify.",
  },
  {
    slug: "channels",
    file: "docs/CHANNEL_EXPORT.md",
    title: "Channel and role export",
    group: "Using Orbit",
    audience: "developer",
    summary: "Read-only export tooling, formats and privacy.",
  },
  {
    slug: "architecture",
    file: "docs/ARCHITECTURE.md",
    title: "Architecture",
    group: "Building on Orbit",
    audience: "developer",
    summary:
      "Runtime responsibilities, data flow, serialization and the web/bot boundary.",
  },
  {
    slug: "integrations",
    file: "docs/INTEGRATION-ARCHITECTURE.md",
    title: "Integration architecture",
    group: "Building on Orbit",
    audience: "developer",
    summary:
      "Provider ownership, shared transport rules and how to add a provider.",
  },
  {
    slug: "security",
    file: "docs/SECURITY.md",
    title: "Security model",
    group: "Building on Orbit",
    audience: "developer",
    summary:
      "Trust boundaries, OAuth, SSRF, secrets, webhooks and failure handling.",
  },
  {
    slug: "development",
    file: "docs/DEVELOPMENT.md",
    title: "Development workflow",
    group: "Building on Orbit",
    audience: "developer",
    summary: "Scripts, containers, checks and lifecycle.",
  },
  {
    slug: "devcontainer",
    file: "docs/DEVCONTAINER.md",
    title: "Dev container",
    group: "Building on Orbit",
    audience: "developer",
    summary: "Container-based development, ports and data safety.",
  },
  {
    slug: "documentation",
    file: "docs/DOCUMENTATION.md",
    title: "Documentation platform",
    group: "Project",
    audience: "developer",
    summary:
      "Framework research, hosting and visibility decisions, and how to add a page.",
  },
  {
    slug: "continuation",
    file: "docs/CONTINUATION.md",
    title: "Current status",
    group: "Project",
    audience: "developer",
    summary:
      "What is verified, what is deferred and what still needs a live check.",
  },
];

export const DOC_GROUPS = [
  "Getting started",
  "Using Orbit",
  "Building on Orbit",
  "Project",
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
export function rewriteDocLinks(html: string, entries = DOC_INDEX) {
  const byFile = new Map(entries.map((entry) => [entry.file, entry.slug]));
  const byBase = new Map(
    entries.map((entry) => [path.basename(entry.file), entry.slug])
  );
  return html.replace(/href="([^"]+)"/g, (whole, href: string) => {
    if (/^(https?:|mailto:|#)/i.test(href)) return whole;
    const [target, hash] = href.split("#");
    const normalized = target.replace(/^\.\//, "").replace(/^\.\.\//, "");
    const candidates = [
      normalized,
      normalized.replace(/^\.\//, ""),
      path.posix.normalize(normalized),
      path.basename(normalized),
    ];
    for (const candidate of candidates) {
      const slug =
        byFile.get(candidate) ?? byBase.get(path.basename(candidate));
      if (slug) return `href="/docs/${slug}${hash ? `#${hash}` : ""}"`;
    }
    if (/\.md$/i.test(target)) return `href="${escapeHtml(href)}"`;
    return whole;
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
    a: ["href", "id", "title", "rel"],
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    code: ["class"],
    span: ["class"],
    div: ["class"],
    th: ["align"],
    td: ["align"],
  },
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
  html: string;
  toc: { id: string; text: string; level: number }[];
};

export function slugifyHeading(text: string) {
  return plain(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/**
 * Render one repository doc to sanitized HTML with stable heading anchors and
 * a table of contents built from the same heading ids.
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
    return `<h${depth} id="${escapeHtml(id)}">${escapeHtml(text)}</h${depth}>`;
  };
  renderer.link = ({ href, tokens }) => {
    const text = renderer.parser.parseInline(tokens);
    return `<a href="${escapeHtml(href)}">${text}</a>`;
  };
  const raw = marked.parse(markdown, { async: false, renderer }) as string;
  const html = sanitizeHtml(rewriteDocLinks(raw), SANITIZE);
  return {
    entry,
    title: titleOf(markdown) || entry.title,
    summary: summaryOf(markdown) || entry.summary,
    html,
    toc,
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
