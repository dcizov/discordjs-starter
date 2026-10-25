# Dashboard workflows taken from the reference

Source reviewed: `https://dashboard.grallemole.com/preview/` (public preview, no
login) plus the event-feed screenshot supplied with the brief. Only _workflows_
were considered — Orbit keeps its own visual language and Radix primitives.

## What the reference actually does

- **Status inventory** — one list of every plugin with `Enabled` / `Configured`
  / `Needs setup` counts above it, a per-row status and a "last updated" time,
  plus a sort control (name, status, configured first, recently updated).
- **Preview that never writes** — "Public dashboard preview … Demo settings stay
  in your browser and are not applied to a Discord server", i.e. a safe way to
  see the product before connecting anything.
- **Event feed** (the screenshot) — provider cover art, a badge (`Free To Play`),
  `POSTED` date and `TYPE` line, reaction counts (`Rate Up`), `Discuss`, `Share`,
  and a **"More events from <game>"** row of dated cards with `View All`.

## Matrix

| Workflow                                               | Orbit today                                              | Gap                                                                          | Value                                   | Scope  | Complexity / permissions / retention                                                                                                   | Acceptance                                                                             | Decision                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status inventory with counts + sort                    | Module setup banner per module; overview cards           | No single sortable inventory with counts and freshness                       | High: answers "what still needs setup?" | Medium | Read-only dashboard view; needs per-module setup state (exists in `module-setup.ts`) and no new permissions; no retention implications | One screen lists every module with state, count summary and a sort control             | **Deferred** (next dashboard pass) — the state and counts already exist, so this is presentation only and must not become a second readiness system |
| Preview without writing                                | `DEMO_MODE=true` + `/demo`, plus "Test source" previews  | None for the dashboard itself; feature previews exist only for news          | Medium                                  | Small  | Demo store is separate from live DB; no permissions                                                                                    | A visitor can exercise the dashboard with no credentials                               | **Already implemented** (demo mode, test flight)                                                                                                    |
| Event feed with cover art, badge, posted/type metadata | News preview shows cards; Steam items often had no image | No cover art, no scannable date/type line, no list of the other polled items | High                                    | Small  | Provider artwork is app artwork, not article art; one cached app lookup; no new permissions; previews persist nothing                  | Newest item as a feature card with labelled artwork, then "More updates from <source>" | **Implemented** (`apps/web/components/news-preview-feed.tsx`, `apps/web/lib/news-feed.ts`)                                                          |
| Reactions / Rate Up / Discuss counts                   | Orbit posts Discord embeds; reactions belong to Discord  | Not portable: Steam supplies no reaction data for news items                 | Low                                     | —      | Would require inventing numbers or scraping Steam                                                                                      | —                                                                                      | **Rejected** — no fabricated counts, no scraping                                                                                                    |
| `Share`                                                | `CopyButton` exists on several dashboard surfaces        | News card has no copy-link action                                            | Low                                     | Tiny   | Client-side only                                                                                                                       | —                                                                                      | **Deferred** — the provider link is already visible and clickable                                                                                   |
| "More events from <game>" + `View All`                 | Same poll exposes only the latest items                  | No pagination of provider history                                            | Medium                                  | Medium | `View All` would need a provider-side history endpoint per adapter; Steam has no documented one for news                               | A dated list of the remaining polled items                                             | **Implemented without `View All`** — the list comes from the same poll, so no second request and no invented deep links                             |
| Faceted filters with counts                            | History tables: search + one filter + server sorting     | No per-facet counts, no multi-column sort                                    | Medium                                  | Medium | Facet counts are extra aggregate queries per dataset; must stay server-side                                                            | Counts shown next to each filter value, still paginated                                | **Deferred** — counts need per-kind aggregate queries; sorting shipped instead                                                                      |
| Row selection / bulk actions                           | None                                                     | None                                                                         | Low for Orbit's datasets                | Large  | Needs a safe multi-row action first (audit logs and deliveries are append-only evidence)                                               | —                                                                                      | **Rejected for now** — no domain action is safe to apply to many rows                                                                               |
| Column visibility                                      | Shipped this pass (`DataTable`)                          | —                                                                            | Medium                                  | Small  | Client state only                                                                                                                      | A "Columns" menu that cannot hide the last column                                      | **Implemented**                                                                                                                                     |

## Table foundation

One component (`apps/web/components/data-table.tsx`) serves audit, moderation
cases, ledger and delivery history:

- rows come from `GET /api/guilds/:id/history`, already paginated and filtered
  by the database — the browser never loads a whole table;
- sorting is a **request parameter**, validated per dataset in
  `packages/db/src/history-sort.ts`, and the query string is built and parsed by
  one shared contract (`packages/core/src/history-query.ts`) so a rename cannot
  silently drop a filter;
- changing sort or filter resets to page 1, and the footer states both the
  matching row count and the ordering;
- loading, empty, error-with-retry states are explicit, and the empty state
  distinguishes "no rows at all" from "no rows match".

Deliberately absent: TanStack Table (the server already paginates, so a client
row model would only re-sort the current page), row selection and bulk actions
(no dataset has a safe multi-row action), drag-and-drop (no ordering domain),
and chart scaffolding.

## Styling and component base

The reference is a shadcn dashboard. At revision
`481d523374745e77d0cf9c53a4115ab5dd7c8481` the shadcn registry ships parallel
bases: `radix`, `base` (Base UI) and `aria` (react-aria-components) versions of
the same components and blocks. Orbit's primitives are Radix
(`@radix-ui/react-dropdown-menu`, `react-dialog`, `react-switch`), so the
**radix base is the compatible one**. Adopting `aria` would mean adding
react-aria-components as a second primitive library — a competing foundation,
not a normalisation — so it was rejected.

Normalisation that _was_ done: the new table toolbar, column menu, sort headers,
image frames and feed cards use the existing `Button`/`Badge`/`Card`/`EmptyState`
primitives and tokens, and the one new menu part (`DropdownMenuLabel`) lives with
the existing Radix wrapper instead of a second menu implementation.
