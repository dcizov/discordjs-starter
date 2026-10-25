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
  stable `/docs/<slug>` URLs, with grouped navigation, a per-page table of
  contents and previous/next links.

There is **one content source of truth**: the Markdown files. The in-app pages
are generated from them at build time; there is no second copy of a permissions
table or a setup step to drift out of sync.

## Research: framework and hosting

The question was not "which docs site looks nicest", but "what fits an existing
Next.js 16 App Router product whose docs are already Markdown in the same
repository, deployed as static assets inside the existing container".

| Option                          | What it actually is                                                                      | Deploy implication                                                  | Fit here                                                                  |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `@next/mdx` (official Next.js)  | A plugin that compiles `.md`/`.mdx` files into routes or imports                         | Same Next.js build; no new host; needs `mdx-components.tsx`         | Good, but MDX pages would duplicate `docs/*.md` unless content moves      |
| Fumadocs                        | A React documentation **framework** (headless core + UI + MDX tooling) built for Next.js | Same app or its own; requires `fumadocs-core/ui` + MDX pipeline     | Capable, but a framework with its own routing/content layer for ~18 pages |
| Nextra                          | Opinionated Next.js docs theme; v4 rewrote for the App Router                            | Same app; owns routing/layout                                       | Heavier than needed; also historically coupled to specific Next versions  |
| Docusaurus                      | Standalone React docs site with its own build and versioning                             | **A second deployment** and a content location outside the product  | Rejected: extra service, duplicated content, no benefit for one app       |
| Starlight (Astro)               | Static docs site on Astro                                                                | New toolchain and host                                              | Rejected for the same reason                                              |
| GitHub Pages (static export)    | Host Markdown/MDX from `gh-pages` or Actions                                             | Second publishing pipeline, base-path links, no product integration | Rejected                                                                  |
| Render repo Markdown in the app | `marked` + `sanitize-html`, prerendered at build time                                    | Reuses the existing Next build and container; no new host           | **Chosen**                                                                |

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
4. **Search: not justified yet.** With ~18 pages, grouped navigation plus the
   browser's own find is faster than a search index, and a client-side search
   would add JavaScript and a second index to keep correct. Revisit if the page
   count grows or versioned API references are added.
5. **Versioning: not applicable.** The docs describe the deployed code in the
   same commit; there is no released matrix of versions to pin.

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
   headings. Heading ids are generated from the text, so anchor links stay
   stable as long as the heading text does.
4. Link other docs by file name (`PERMISSIONS.md`, `docs/MUSIC.md#source-policy`);
   the renderer rewrites those to `/docs/<slug>#anchor`. Absolute `https://`
   links are kept and marked `rel="noopener noreferrer"`.
5. Run `npm test` — `tests/docs-content.test.ts` checks that every listed file
   exists, that slugs are unique, that headings get unique ids, that raw HTML is
   sanitized and that links are rewritten. Run `npm run build:web` to confirm
   every page still prerenders.
6. Keep product help and implementation history apart: `CONTINUATION.md`,
   `IMPLEMENTATION-REVIEW.md` and similar belong to the `Project` group, not to
   the user guides.

## Accessibility and mobile behaviour

- Semantic structure (`article`, `nav aria-label`, `main`, sequential
  headings), a visible-on-focus skip link, and a `<details>` disclosure for
  navigation on small screens instead of a JavaScript menu.
- Tables are horizontally scrollable containers, code blocks wrap, long URLs
  break, and tap targets are full-width list rows.
- No colour-only state, no automatic motion, and no content that requires
  JavaScript. The whole documentation surface is server-rendered.
- Contextual links: every module's setup banner links to that module's guide,
  and the dashboard help dialog links to the setup, permission, dashboard,
  music, news and deals pages.
