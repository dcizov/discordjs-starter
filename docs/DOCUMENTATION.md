# Documentation: platform decision, visibility and contribution

This page records the research that led to Orbit's documentation setup, the
decision that was taken, and how to add or change a page. It is deliberately
separate from the user guides, which should stay free of implementation
history.

## What exists in this repository

- `README.md` — product overview and the first-run checklist.
- `docs/*.md` — setup, permissions, module guides, architecture, security,
  deployment, and the current status report (`CONTINUATION.md`).
- `/docs` in the dashboard — the same Markdown, rendered inside the product at
  stable `/docs/<slug>` URLs, with a grouped sidebar (and a dialog sheet on
  phones), an index filter, a per-page "On this page" list, per-section anchors,
  language-labelled code frames with copy buttons, and previous/next links.

There is **one content source of truth**: the Markdown files. The in-app pages
are generated from them at build time; there is no second copy of a permissions
table or a setup step to drift out of sync.

## Research: framework and hosting

The question was not "which docs site looks nicest", but "what fits an existing
Next.js 16 App Router product whose docs are already Markdown in the same
repository, deployed as static assets inside the existing container".

| Option                          | What it actually is                                                                      | Deploy implication                                                  | Fit here                                                                 |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `@next/mdx` (official Next.js)  | A plugin that compiles `.md`/`.mdx` files into routes or imports                         | Same Next.js build; no new host; needs `mdx-components.tsx`         | Good, but MDX pages would duplicate `docs/*.md` unless content moves     |
| Fumadocs                        | A React documentation **framework** (headless core + UI + MDX tooling) built for Next.js | Same app or its own; requires `fumadocs-core/ui` + MDX pipeline     | Capable, but a framework with its own routing/content layer for 20 pages |
| Nextra                          | Opinionated Next.js docs theme; v4 rewrote for the App Router                            | Same app; owns routing/layout                                       | Heavier than needed; also historically coupled to specific Next versions |
| Docusaurus                      | Standalone React docs site with its own build and versioning                             | **A second deployment** and a content location outside the product  | Rejected: extra service, duplicated content, no benefit for one app      |
| Starlight (Astro)               | Static docs site on Astro                                                                | New toolchain and host                                              | Rejected for the same reason                                             |
| GitHub Pages (static export)    | Host Markdown/MDX from `gh-pages` or Actions                                             | Second publishing pipeline, base-path links, no product integration | Rejected                                                                 |
| Render repo Markdown in the app | `marked` + `sanitize-html`, prerendered at build time                                    | Reuses the existing Next build and container; no new host           | **Chosen**                                                               |

Sources for the framework comparison (official sites where possible):

- Next.js MDX guide — `@next/mdx`, `pageExtensions`, `mdx-components.tsx`,
  `generateStaticParams` + `dynamicParams = false`:
  <https://nextjs.org/docs/app/guides/mdx>
- Fumadocs' own comparison with Nextra (feature table, static generation,
  search, MDX):
  <https://www.fumadocs.dev/docs/comparisons>
- Nextra documentation: <https://nextra.site/docs>
- Docusaurus documentation and versioning: <https://docusaurus.io/docs>,
  <https://docusaurus.io/docs/versioning>

Hosting evidence for **this repository**: there is no `gh-pages` branch, no
Pages workflow in `.github/workflows/` (only `ci.yml`), and no docs deployment
step in `Dockerfile` or Compose. Orbit is served by the Next.js container that
already exists, so GitHub Pages is **not** in use and adding it would create a
second, unauthenticated publishing path. Any claim that Orbit "has a docs site
elsewhere" would be unverified.

### Decision

1. **No new docs framework and no second deployment.** Keep `docs/*.md` as the
   source and render it inside the existing Next app.
2. **`marked` is the only added dependency.** It is a Markdown parser, not a
   documentation platform: no routing, no theme, no plugin system. Output is
   sanitized with the `sanitize-html` dependency Orbit already uses for feed
   content, so sanitization policy stays in one library.
3. **Prerender.** `apps/web/app/docs/**` is `force-static` with
   `generateStaticParams`, so the runtime image does not need the `docs/`
   folder and a request never touches the disk. A content change ships with the
   next build — normal for static documentation, and documented here so nobody
   expects a runtime edit to appear.
4. **Search: a page filter, not full-text search.** The index has one filter
   field. It matches **title, summary, group and audience** of the pages the
   index already renders, and it says so in its own help text. It never claims
   to search inside a guide, because the page bodies are not loaded into that
   component and a fake "result" would be worse than no search. A real search
   index (FlexSearch, Pagefind, Algolia, Orama…) would either ship a second copy
   of every page to the browser or add a hosted service with its own privacy and
   availability surface — not justified for a few dozen pages. Revisit if the
   page count grows or versioned API references are added.
5. **Versioning: not applicable.** The docs describe the deployed code in the
   same commit; there is no released matrix of versions to pin.

## Interface decisions (documentation site)

The documentation site reuses the dashboard's own primitives. It introduces **no
second design system and no new dependency**.

| Need                    | What Orbit uses                                                                                                | Why not a new dependency                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grouped navigation      | `<details>` + `<a>` in a small client component that reads `usePathname` for the active page                   | Native disclosures are keyboard operable and announced without JavaScript. `@radix-ui/react-collapsible` would add a dependency for behaviour the platform already has.                                                    |
| Mobile navigation       | The existing Radix `ui/dialog.tsx`, anchored to the left edge as a sheet                                       | Focus trap, Escape, focus restore and `aria-modal` already shipped for the dashboard dialogs.                                                                                                                              |
| Filter field            | A labelled `<input type="search">` inside a card                                                               | A command palette (`cmdk`) would present the same filter as a second, keyboard-only surface for no additional data.                                                                                                        |
| Code blocks and anchors | Server-rendered `<figure>`/`<figcaption>` frames plus a small enhancer that adds copy handlers after hydration | Highlighting libraries (Shiki, Prism) are heavy for shell/config snippets and need a theme per colour scheme; line numbers and animation add noise.                                                                        |
| Tabs                    | Rejected for setup instructions                                                                                | Tabs hide commands and split deep links. The three workflows are a comparison table plus one section each, so every command is visible, printable and linkable (`/docs/workflows#full-stack-development-with-hot-reload`). |

Rendering stays build-time and happens in three explicit stages:

1. `renderDoc` turns Markdown into headings, minimal `<pre><code>` blocks,
   tone-aware quotes and tables. No interactive element is produced from
   content, at all.
2. `sanitizeHtml` runs with an allowed-tag list that has **no** interactive
   element (`button`, `input`, `select`, `textarea`, `form` are stripped
   together with their text), no inline handlers, no `javascript:` URLs and no
   protocol-relative URLs.
3. `enhanceCodeBlocks` runs **after** sanitization and wraps each surviving
   `<pre>` in the `figure.docs-code` frame with its language label and copy
   button.

The consequence is the point: a copy button's provenance is the function that
built it, not an attribute in the content. An author-supplied `<button>` cannot
pass, and a forged `data-docs-copy` attribute has nothing to attach to. Copy
buttons are still hidden until their handler is attached, so a reader without
JavaScript never sees a dead control.

### Reading behaviour and states

- Desktop: grouped sidebar, active page marked with `aria-current="page"` and a
  visible rail. Phones: the same navigation in a dialog sheet.
- A page has a title, a one-sentence intro derived from its first paragraph, a
  "On this page" list, "More in {group}" chips and previous/next cards.
- Long tables scroll inside a focusable frame; long commands scroll inside
  their code frame; body prose is capped at a comfortable measure.
- There is no loading or error state because every page is prerendered and a
  missing slug is a 404; the index filter has a visible empty state and a
  live-region result count instead of a spinner over static content.
- Light and dark both come from the existing design tokens; `color-scheme` is
  declared for the two themes so native widgets follow them.

## Visibility: who can read the docs

The proposal considered was: _developer documentation visible only to
logged-in users who hold a "developer" role in a connected Discord server_.

**Decision: keep user and developer guides public.** Reasons:

- The developer guides describe code that is already public in this
  repository. Hiding the prose while the source is readable protects nothing.
- Gate-keeping requires new authorization state: which guild is trusted, which
  role IDs count, how revocation propagates, how a cached page or a shared link
  avoids leaking, and how a member with no installed guild gets access.
  Role **names** must never be trusted, only configured IDs in an explicit
  guild. That is real complexity and a new failure mode.
- Static docs plus role gating is a trap: a prerendered page is either in the
  bundle for everyone or missing for everyone. Per-user gating would force
  dynamic rendering, per-request authorization and cache-key discipline just to
  hide non-secret text.
- Secrets are never in documentation. If a page needs a credential to make
  sense, it names the environment variable, not the value.

If a future page genuinely must not be public (for example an incident write-up
containing exploit detail before a fix ships), the correct control is to keep
it out of `docs/` and out of the build entirely, not to fake protection with a
role check.

## Adding or changing a page

1. Edit or add a Markdown file under `docs/` (or `README.md`).
2. Add an entry to `DOC_INDEX` in `apps/web/lib/docs-content.ts`: `slug`,
   `file`, `title`, `group`, `audience` and a one-sentence `summary`. An
   unlisted file is still readable in the repository but gets no navigation
   entry — implementation diaries must not pose as user help.
3. Keep the first `#` heading as the page title; give sections `##`/`###`
   headings. Heading ids are generated with **GitHub's own algorithm** — lower
   case, punctuation removed (an apostrophe disappears, it does not become a
   hyphen), underscores kept, spaces become hyphens — so one `PAGE.md#section`
   link resolves the same way on GitHub and in the dashboard. The page renders
   that title itself (with breadcrumb and intro), so do not repeat it in the
   body.
4. Label a fenced code block (`sh`, `dotenv`, `text`, …): the label is shown in
   the frame header. Write `> **Warning:** …`, `> **Prerequisite:** …` or
   `> **Note:** …` for a callout — the tone is read from that lead-in, and an
   unrecognised quote stays a plain quote rather than being mislabelled.
5. Link other docs relative to the file you are editing (`PERMISSIONS.md`,
   `../README.md#run-live`, `MUSIC.md#source-policy`); the renderer resolves
   that path and rewrites it to `/docs/<slug>#anchor`. A link to a Markdown file
   that is **not** curated becomes an absolute link to the file's source at the
   configured ref, marked `rel="noopener noreferrer"`, because a relative `.md`
   href would 404 inside the docs. Absolute `https://` links are kept as they
   are.
6. Run `npm test` — `tests/docs-content.test.ts` checks that every listed file
   exists, that slugs are unique, that every group has pages and a description,
   that headings get unique ids, that raw HTML is sanitized, that code controls
   are the renderer's own, and that **every relative link and its anchor
   resolves** in the curated set. Run `npm run build:web` to confirm every page
   still prerenders.
7. Keep product help and implementation history apart. `IMPLEMENTATION-REVIEW.md`,
   `STRUCTURE-REFACTOR.md`, `FEATURE-RESEARCH.md`, `COMMUNITY-REVIEW.md` and
   `DASHBOARD-MAINTENANCE.md` are **not** curated: they stay repository notes,
   and links to them point at the source file. `CONTINUATION.md` is the one
   status report that is curated, under **Deployment and operations**, because an
   operator needs to know what was verified.

### Groups and order

`DOC_INDEX` in `apps/web/lib/docs-content.ts` is the single maintained manifest:
it decides membership, order and the group a page belongs to, and `DOC_GROUPS`
decides the order of the groups themselves. `DOC_GROUP_INFO` holds the one-line
description shown on `/docs`. Adding a group means adding it to both lists; a
group with no pages is dropped from the navigation by `docsNavigation()`.

| Group                      | What belongs there                                                   |
| -------------------------- | -------------------------------------------------------------------- |
| Getting started            | Invite, first run, least privilege, what Orbit refuses to do         |
| Using Orbit                | The dashboard and the community modules people work in               |
| Admin and setup            | News sources, deals, channel/role export                             |
| Music                      | The optional backend, the listening room, sources and plugins        |
| Development                | Which workflow to use, the commands, the code map                    |
| Deployment and operations  | Runtime images, updates, health, the current status report           |
| Architecture and reference | Architecture, integrations, security, commands, formatting contracts |
| Troubleshooting            | A router from symptom to the page that owns the fix                  |

`/docs/<slug>` is the URL contract. The slug lives in the manifest, not in the
file name, so a page can be renamed or moved on disk without breaking a link
someone bookmarked — and no redirect table is needed for a reorganisation that
does not change slugs.

## Accessibility and mobile behaviour

- Semantic structure (`article`, `nav aria-label`, `main`, sequential
  headings), a visible-on-focus skip link, and a focus-trapping dialog sheet for
  navigation on small screens. The desktop sidebar stays server-rendered.
- Tables and code scroll inside their own focusable frames, long URLs break, and
  tap targets are full-width rows.
- No colour-only state (the active page also carries `aria-current="page"`), no
  automatic motion, and no content that requires JavaScript. The whole
  documentation surface is server-rendered; copy buttons are the only
  enhancement, and they appear only after they work.
- Contextual links: every module's setup banner links to that module's guide,
  and the dashboard help dialog links to the setup, permission, dashboard,
  music, news and deals pages.
