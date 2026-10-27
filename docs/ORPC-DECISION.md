# Decision record: oRPC

Status: **deferred** (not adopted, not rejected). Reviewed 2026-10-26 against
`https://orpc.dev/` (v2 docs, beta at the time of review).

## What oRPC offers

- Procedures defined once on the server, consumed as a fully typed client with no
  code generation, including typed _errors_ (`errors({ NOT_FOUND: … })` and
  `isDefinedError`).
- Contract-first definitions (`oc`), middleware that injects typed context, and
  OpenAPI generation from the same procedures.
- Adapters that Orbit would plausibly use: fetch/RPC link, TanStack Query utils,
  Next.js server functions, in-process calls, and typed realtime streams.

## How Orbit's API works today

- One catch-all App Router handler (`apps/web/app/api/[...path]/route.ts`) that
  dispatches on path segments, validates input with zod, and authorizes once per
  request (`authorize()` → guild ownership / Manage Server, plus CSRF origin and
  per-route rate limits).
- A small dashboard client (`useWorkspace().api`) that calls those paths and
  re-renders from fresh snapshots.
- Domain logic lives in `packages/core` and `packages/db` and is shared _in
  process_ by the web app, the bot and the worker. The bot and worker never go
  through the HTTP API, so a typed browser transport would not remove any
  duplication for them.

## Why not adopt now

1. **The transport is not where the duplication is.** The shared logic is already
   in `@orbit/core`/`@orbit/db`; oRPC would retype the _browser_ boundary only.
2. **Security surface would have to be re-established**, not inherited: the
   catch-all handler today enforces origin checks, per-route rate limits, size
   limits and a single authorization gate. Moving to a router with middleware
   means re-verifying each of those, and a mistake there is a privilege bug.
3. **A beta dependency on the only public request path.** The dashboard talks to
   the RPC surface for every action, including destructive ones.
4. **OpenAPI/MCP output is not a current requirement** — no partner API, no CLI
   client, no agent surface depends on it.

## What was reduced anyway

Confirmed duplication was in the _query contract_, not the transport: the
dashboard built history query strings by hand while the route parsed them by
hand. Both sides now use `packages/core/src/history-query.ts`
(`historyQueryString` / `parseHistoryQuery`), which rejects unknown parameters
instead of silently ignoring a misspelled filter. Response shapes stay typed by
the shared `@orbit/db` return types.

## Revisit triggers

Adopt or pilot when at least one holds:

- a second first-party client of the web API (CLI, desktop, partner/embed) must
  share the contract;
- the catch-all handler exceeds a few hundred lines of route dispatch, or a
  route is added per week;
- a published, versioned HTTP API becomes a requirement;
- oRPC v2 leaves beta and a migration can keep the current authorization,
  origin and rate-limit behaviour with tests that fail if they regress.

Hard constraint either way: **bot and worker domain services must never depend on
a browser RPC transport.** Domain functions in `packages/core` stay transport
agnostic.

_Decision record reviewed by: dashboard/API maintainers. Re-review date: next
dashboard architecture pass._
