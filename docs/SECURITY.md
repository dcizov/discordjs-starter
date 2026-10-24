# Security model

## Trust boundaries

- The web server, bot, workers, PostgreSQL, Redis, and Lavalink are trusted infrastructure. Publisher content, custom feed URLs, webhook bodies, browser input, and Discord member input are not.
- Discord OAuth verifies who can manage each guild. Every API request is authorized, every repository operation is scoped by guild, and job execution re-checks permissions/context.
- `Manage Server` is deliberately sufficient for dashboard configuration. Bot slash moderation actions additionally require their specific Discord permissions. Discord’s native role hierarchy remains authoritative.
- Demo mode is intentionally open to anyone who can access the demo environment. Never treat its identity or file store as authentication. No live bot/worker/webhook operation is allowed in demo mode.

## Sessions and requests

Opaque session cookies are HTTP-only, SameSite=Lax, and Secure in production. Sessions expire after seven days; upstream OAuth tokens refresh server-side and are encrypted at rest. OAuth state is random, expires in ten minutes, and is compared before exchanging a code. State is cleared on success.

Mutating dashboard requests require the configured public `APP_URL` origin. Demo/development supports the preview proxy’s forwarded host without weakening the live origin policy. Redis-backed request limits fail closed when live infrastructure is unavailable. API responses use no-store and content-type sniffing is disabled. Live production pages reject framing; isolated demo previews may be embedded.

Run behind a trusted TLS reverse proxy with request/body/time limits, connection limits, and trusted forwarded-header handling. Do not expose internal administrative endpoints or databases publicly. Consider a deployment-specific CSP/nonces and WAF rules in your reverse proxy; this implementation does not pretend an unsafe generic CSP is a replacement for those controls.

## Source and webhook protections

- HTTPS-only feed requests, default HTTPS port, no URL credentials.
- Public-address checks for **all** DNS results, address pinning on the socket, and revalidation for every redirect.
- Loopback, RFC1918, link-local/cloud metadata, carrier-grade NAT, multicast, reserved, IPv6 local/mapped/special-use ranges blocked.
- Bounded redirects, request timeouts, response size, item count, XML parsing, and body sizes.
- No DTDs, XML entities, scripts, arbitrary executable adapters, or default HTML scraping.
- HTML is stripped; text, URLs, and embeds are bounded. Unwanted Discord mentions are suppressed in content and in `allowed_mentions`.
- Incoming webhooks require source-specific encrypted secrets, constant-time HMAC comparison, a recent timestamp, bounded typed payloads, and stable deduplication IDs.

Also apply **network egress controls** to the worker/Lavalink containers. Application-level SSRF checks are defense in depth, not a substitute for blocking internal and metadata networks at the network boundary. Publisher URLs and their summaries are untrusted links; moderators should review sources before enabling automatic distribution.

## Roles and moderation

Roles must be explicitly included in a panel/shop configuration, non-integration, below Orbit, not `@everyone`, and free of privileged permission bits. Safety checks apply to both additions and removals. Prerequisites are required for new grants; members can still opt out after losing a prerequisite. Single/multi limits and exclusive groups are checked per request, and Redis member locks serialize changes.

Moderation requires the acting member and bot to have the relevant permission and outrank the target. The owner, acting moderator, and bot are protected. Administrator timeouts are rejected. Auto rules exempt configured roles/channels, administrators, the owner, bots, and members above the bot. Discord API failures are handled without claiming a successful action.

Discord does not offer a transaction across role removal and role addition. A partial Discord failure may require trying a panel again; the next request re-fetches actual membership and validates the intended result. Do not allow other bots to manipulate the same exclusive role groups without coordinating policy.

## Storage, logging, and operations

No token, API key, signing secret, or database URL is sent as public configuration. Logs redact named credentials and never intentionally include OAuth token responses, source URL query secrets, or webhook bodies. API keys are configured only in the server environment. Source URLs are visible to authorized administrators and must not contain credentials.

Configuration changes, moderation cases, inventory, ledger entries, and delivery attempts are retained. Audit/case/ledger records are append-only through the application, **not cryptographically tamper-proof against a database owner**. Use separate least-privilege database credentials, protected backups, and database-level grants/monitoring where stronger guarantees are required.

Rotate `APP_SECRET` carefully: existing encrypted sessions/webhook secrets cannot be decrypted with a different key. Clear sessions, rotate webhook secrets, and plan user sign-in again. Rotate Discord and provider credentials via their official portals. Never paste them into chat, issue trackers, or browser code.

Run `npm audit --omit=dev`, tests, and production builds as part of updates. Maintain a tested dependency/backend image baseline and regularly patch it. Report security issues privately to your deployment owner rather than publishing live credentials or exploit payloads against an active community.
