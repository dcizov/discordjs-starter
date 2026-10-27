# Decision record: table library

Status: **retain the current table**. Reviewed 2026-10-26 against
`@tanstack/react-table` v8 (headless), the library shadcn's Tasks and
dashboard-01 examples are built on.

## Correcting the earlier reason

The previous note said TanStack Table was unnecessary "because the server
paginates". That is not a limitation of the library: v8 supports
`manualPagination`, `manualSorting` and `manualFiltering`, where you feed it the
current page and tell it the row count. A client-side limitation was the wrong
argument.

The real question is what it would replace in _this_ codebase.

## What exists today

`apps/web/components/data-table.tsx` (255 lines) renders four datasets — audit,
moderation cases, ledger, delivery history — with:

- rows from `GET /api/guilds/:id/history`, already filtered, sorted and paged by
  PostgreSQL (`queryHistory`), with the query string built and parsed by one
  shared contract (`packages/core/src/history-query.ts`);
- sort allow-lists per dataset (`packages/db/src/history-sort.ts`), keyed by
  column, validated server-side;
- column visibility, `aria-sort` headers with keyboard-operable sort buttons,
  page reset on filter/sort change, "matching rows" versus "page" wording,
  loading, empty, no-match and error-with-retry states;
- stable row ids from the database, `key={row.id}`.

## What TanStack would add and cost

Measured, not estimated. Minimal tree-shaken bundle of
`createColumnHelper` + core/sorted/filtered/pagination row models:

```sh
mkdir /tmp/tt && cd /tmp/tt && npm init -y && npm i @tanstack/react-table@8
npx esbuild entry.ts --bundle --minify --format=esm \
  --external:react --external:react-dom --outfile=out.js
gzip -c out.js | wc -c
# out.js 54,133 bytes; 14,414 bytes gzipped; 5 packages installed
```

| Dimension          | Current                                                                              | TanStack v8 (manual server mode)                                                                              |
| ------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Column definitions | Inline `Column<T>[]` per screen                                                      | Same, plus accessor/`meta` types — a net gain only if columns are shared or reused                            |
| Visibility         | 25 lines of `useState` + menu                                                        | Built-in state and API; menu still written by us                                                              |
| Sorting            | Server key + `aria-sort` header buttons (written)                                    | State and handlers provided; `aria-sort`, focus and keyboard still written by us (the library is headless)    |
| Faceting           | Not implemented; counts must be server aggregates                                    | `getFacetedRowModel` computes counts over _loaded_ rows, so server-accurate counts are still a separate query |
| Selection          | Not needed today                                                                     | Available; bulk actions still need per-action authorization                                                   |
| Accessibility      | Written and asserted in the browser suite                                            | Still the caller's responsibility                                                                             |
| Bundle / deps      | 0 kB, no dependency                                                                  | +14.4 kB gzip, +5 packages                                                                                    |
| Boilerplate        | 255 lines, 4 call sites                                                              | Removes ~40 lines of visibility/sort state, adds a table instance, column defs and manual-mode adapters       |
| Testability        | Behaviour asserted end-to-end (`tests/e2e/command-audit.spec.ts`, history API tests) | Headless logic unit-testable; the rendering/ARIA still needs the same browser tests                           |
| Maintenance        | Ours, small and stable                                                               | Upstream tracking (v8 → v9 API changes, `rowSelectionFeature` etc.)                                           |

## Decision

Retain the current table. The library's real wins — shared column metadata,
selection state, client-side row models — do not apply to four fixed datasets
whose filtering and ordering are already a validated server contract, and it
would add 14.4 kB gzip plus a dependency to replace roughly forty lines of state.

Revisit when at least one is true:

- a fifth or sixth dataset needs client-side column ordering, grouping or
  selection;
- two screens must share one column definition with different capabilities;
- filtering moves client-side (for example a fully static analytics view).

Until then, consistency is enforced by using the one shared component: sorting
via `sortKey` on a column, filters and search in the page, row actions rendered in
a column, and dataset-specific behaviour validated in `packages/db`.

## Facet counts, if added later

Counts must come from the database with the same `WHERE` clause as the page, not
from the rows already loaded. For a filter on action type, that is
`select action, count(*) … group by action` under the same guild scope and search
term; for "needs attention" style filters, the same predicate the filter applies.
A count derived from the visible page would disagree with the total in the footer
as soon as there is more than one page.
