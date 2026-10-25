# Integration architecture

Orbit talks to five kinds of external systems. They are deliberately **not**
wrapped in one universal client, and there is no plugin registry: each provider
has a small, typed adapter with one owner, and only the boring parts are shared.

This page is the map. It also describes how to add a provider without weakening
an existing one.

## Ownership

| Integration                                      | Runtime owner                                   | Code                                                                    | Auth                                                             | Entry points                                          |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Steam app news (`ISteamNews/GetNewsForApp/v2`)   | Delivery worker (`pollSourceDetailed`)          | `packages/core/src/feeds.ts`, `feed-content.ts`, `news-presentation.ts` | None (keyless endpoint, rate-limited upstream)                   | Worker poll, **Test source** in the dashboard         |
| RSS / Atom feeds (administrator-supplied)        | Delivery worker                                 | `packages/core/src/feeds.ts` (`fetchFeedText`)                          | None; URL is untrusted input                                     | Worker poll, **Test source**                          |
| Incoming webhooks (administrator-supplied)       | Web route `/api/webhooks/{sourceId}`            | `packages/core/src/feeds.ts`, `apps/web/app/api/webhooks`               | HMAC-SHA256 over `timestamp.body` with a per-source secret       | Publisher `POST`                                      |
| IsThereAnyDeal (ITAD)                            | Bot commands and worker deal jobs               | `packages/core/src/itad.ts`, `deals.ts`, `deal-policy.ts`               | Server-side `ITAD_API_KEY` only                                  | `/deals …`, deal subscriptions                        |
| Discord OAuth + REST (identity, guild list, bot) | Web (OAuth, guild list) and bot (gateway, REST) | `apps/web/lib/auth.ts`, `packages/core/src/discord-permissions.ts`      | OAuth2 access token (web), bot token (bot), never in the browser | Sign-in, `/api/guilds/*`, slash commands              |
| Lavalink v4 via Shoukaku                         | Bot                                             | `apps/bot/src/features/music/*`                                         | `LAVALINK_PASSWORD` server-side; the dashboard never sees it     | `/play`, `/search`, `/seek`, dashboard music controls |

**Trusted provider endpoints and administrator-supplied URLs are never the same
code path.** Steam and ITAD are contacted through the shared transport in
`packages/core/src/integration-http.ts`. Feed and webhook URLs come from a guild
administrator, so they go through the SSRF pipeline in `feeds.ts`: HTTPS only, a
public DNS answer that is pinned to the socket, no credentials in the URL, a
1 MiB body ceiling, validated redirects (maximum three), and rejected XML
DTDs/entities. A shared "fetch anything" helper would merge those two threat
models; it does not exist on purpose.

## Shared responsibilities (`integration-http.ts`)

Only properties every outbound provider call needs:

- an explicit timeout (`PROVIDER_TIMEOUT_MS`, 15 s by default),
- a bounded body read (`PROVIDER_MAX_BYTES`, 1 MiB) enforced while streaming,
  not after buffering,
- `redirect: "error"` and `cache: "no-store"`,
- JSON parsing that refuses non-JSON,
- a small error vocabulary (`UpstreamError.kind`): configuration/auth failure,
  rate limited, timeout/unavailable, invalid upstream response, not found,
  rejected; `retryable` is derived, not guessed,
- secret-safe messages: never the URL, query string, token or response body,
- **no automatic retries**. The route, the job queue and a caller may already
  retry; a primitive that also retries multiplies load exactly when a provider
  is failing.

## Provider-specific responsibilities

Each adapter owns, in its own file, what only it can know:

- auth/signing (ITAD key, webhook HMAC, Lavalink password),
- schemas for the response shape it actually consumes (zod),
- pagination and result caps,
- rate-limit handling and `Retry-After` parsing where the provider documents it,
- cache keys and freshness (for example the 30 s / 10 s permission-snapshot
  windows in `discord-permissions.ts`),
- domain mapping: what of the payload becomes a Discord card, a queue entry or
  an alert, and what is dropped,
- semantics Orbit refuses to overstate, such as "lowest recorded price" versus
  "currently cheapest".

## Domain policy and presentation

Transport → mapping → policy → presentation, in that order:

1. **Transport + validation** (`integration-http.ts`, provider `client`/schemas).
2. **Provider mapping** (`feeds.ts`, `itad.ts`): upstream payload to an
   Orbit-shaped object. No Discord types here.
3. **Domain policy** (`deal-policy.ts`, `news-presentation.ts`,
   `music-policy.ts`, `module-setup.ts`, `permissions.ts`): eligibility,
   deduplication, freshness, permissions, prefixes such as "historical low".
4. **Presentation** (`apps/bot/src/interactions/replies.ts` and the dashboard):
   embeds, cards, truncation and the exact wording of an unconfirmed state.

A test that only exercises step 1 proves nothing about a delivered message; the
delivery tests use the same presentation functions as the bot.

## Caching and rate limits

| Where                    | Key                     | Lifetime                  | Instance scope                           |
| ------------------------ | ----------------------- | ------------------------- | ---------------------------------------- |
| Discord guild list (web) | session id + token hash | 30 s read / 10 s mutation | Per web process, shared via `globalThis` |
| Discord API 429          | token hash / global     | `Retry-After`             | Per web process                          |
| Source freshness         | guild + source          | 1.5 × interval            | Read from the database snapshot          |
| Lavalink player state    | guild                   | Live + 15 s persistence   | Per bot process                          |

These are in-memory caches in a single process. With more than one web
replica, each replica keeps its own window and its own 429 backoff: that is
acceptable for OAuth guild lookups (read-only, per-user, small) and is not used
for execution authority. A dashboard decision is always re-checked by the bot
against freshly fetched member, module, role and channel state before an action
runs.

## Error vocabulary in delivery code

- `UpstreamError` → HTTP 502 with the provider's `Retry-After` when present.
  "The provider is down" is not "your configuration is wrong".
- `HttpError(4xx)` → the administrator or member must change something.
- A job that cannot be confirmed stays `unconfirmed`/`failed` in the audit log;
  it is never reported as delivered.
- Music actions are `accepted` when queued and `completed` only when the bot's
  job reports success. Audible playback is a separate, unproven claim.

## Adding a provider

1. **Decide the owner.** Does it run on a timer for every guild (worker), on a
   member's command (bot), or on a signed inbound request (web)? If two of
   those need it, put the mapping in `packages/core` and keep the runtime
   entry points thin.
2. **Write the schema first.** A zod schema for the fields Orbit consumes,
   with explicit maxima. Unknown fields are ignored; missing required fields
   are an invalid response, not an empty result.
3. **Use `providerJson`.** Do not add `fetch` calls in feature code. Do not
   reuse it for administrator-supplied URLs.
4. **Map into an Orbit type** in the provider's own module. No Discord or React
   types in that layer.
5. **Decide policy explicitly**: deduplication key, freshness, what "lowest"
   or "official" means for this provider, and which claims the provider cannot
   support.
6. **Add presentation** through the existing reply/card functions, so the
   dashboard preview and the delivered message cannot disagree.
7. **Test the boundaries**: schema rejection, timeout, 429 with and without
   `Retry-After`, oversized body, invalid JSON, secret redaction, and one
   domain case with a recorded fixture. If the provider needs a key, add the
   variable to `.env.example`, the environment schema and the docs — never to
   a browser bundle.
8. **Document the limitation** in `docs/INTEGRATIONS.md` and, if it is not
   verified live, in `docs/CONTINUATION.md`. A green suite with mocked
   transport is not provider verification.

## What Orbit will not do

- Scrape HTML news sites, Steam store pages or Discord.
- Proxy arbitrary URLs for a browser or a guild member.
- Accept an API key in a form, a query string or a client component.
- Retry a non-idempotent request automatically.
- Hide an upstream failure behind a fabricated success.
