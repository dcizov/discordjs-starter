# Review — pass 11

Date: 2026-10-28 · Branch `arena/88919263-discordjs-starter`.

Every finding below carries evidence (file:line), an impact, and a status. A
finding without evidence is not a finding, so nothing is listed on suspicion
alone. Status is one of: **fixed in `<sha>`**, **deferred (reason)**, or
**rejected (reason)**.

Scope completed in this pass: **Part 0** (the row-menu remount) and **Part A**
(security and vulnerability review). Parts B, C and D are not yet started and
are not covered here.

---

## Part 0 — a row menu that closed itself

|          |                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | **High** (functional defect with a security-adjacent symptom: it defeated the only e2e that exercised the flow)                       |
| Evidence | `apps/web/components/data-table.tsx` — `columnDefs` memoized on `columns`; `node_modules/@tanstack/react-table/dist/FlexRender.js:22` |
| Status   | **fixed in `4788498`**                                                                                                                |

`@tanstack/react-table` renders a cell with:

```js
function flexRender(Comp, props) {
  if (Comp === null || Comp === void 0) return null;
  return isReactComponent(Comp) ? React.createElement(Comp, props) : Comp;
}
```

`Comp` is `columnDef.cell`. `DataTable` built its column definitions inside a
`useMemo` keyed on `columns`, and every page constructs that array inline, so
the array — and every `cell` function in it — had a new identity on every
render. React does not reconcile a changed element type; it unmounts the old
subtree and mounts a new one.

So **every cell in every table was torn down and rebuilt on every render**: a
toast, a filter keystroke, or the dashboard's 30-second background refresh each
destroyed any open Radix menu, dropped focus, and reset uncontrolled state
inside cells.

Row keys were already id-based (`getRowId: (row) => row.id`, data-table.tsx:277)
and were never the problem — which is why the obvious hypothesis was wrong.

**Fix:** each column gets one stable `cell` function for as long as the column
exists; the function looks its column up by key through a ref at call time, so
identity is stable but data is never stale. `columnDefs` rebuilds only when a
signature of column keys, sortability and hideability changes.

**Verification:** `tests/data-table-stability.test.tsx`, four component tests —
cells are not unmounted when row data is replaced, an open menu survives a
background refresh, refreshed data still appears in a cell that was not
remounted, and a genuinely added column still takes effect. Reverting the source
fails exactly two of them.

**Related — flaky tests could pass CI.** `playwright.config.ts` had
`retries: process.env.CI ? 1 : 0` with no `failOnFlakyTests`, so a
fail-then-pass was reported green. This defect is precisely why that matters:
it is timing-dependent — whether the 30 s refresh lands during the interaction
— so CI passed it cleanly (checked: neither green run reports a flaky test)
while it failed on a real machine. `failOnFlakyTests: true` is now set; the
retry stays because reporting every failing spec in one run is worth keeping.

---

## Part A — security review

### Verified, no finding

These were checked against the code and found sound. They are recorded so the
next reviewer does not re-derive them, and so a regression is visible.

| Area                        | Evidence                                                                                               | Conclusion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF — feed fetch**       | `packages/core/src/feeds.ts:23-100`; `packages/core/src/safety.ts:130-190`                             | HTTPS/443 only, no URL credentials, host blocklist (`.local`, `.internal`, `localhost`, non-public IPs). Resolves **all** addresses and rejects unless every one is public. Pins the validated address into the undici `Agent.connect.lookup`, so DNS rebinding cannot swap the socket after the check. ≤3 redirects, each re-validated from the top. 10 s headers / 10 s body / 15 s total. Content-type allowlist. 1 MB cap enforced both from `content-length` and while streaming, body destroyed on every reject path. This is the strongest part of the codebase. |
| **SSRF — address ranges**   | `safety.ts:131-158`                                                                                    | Covers RFC1918, loopback, link-local `169.254/16` (cloud metadata), CGNAT `100.64/10`, `0/8`, benchmark ranges, multicast, reserved; IPv6 ULA, link-local, multicast, Teredo, 6to4, ORCHID `2001::/23`, and requires global unicast (`2`/`3` prefix).                                                                                                                                                                                                                                                                                                                   |
| **Authorization**           | `apps/web/lib/auth.ts:authorize`; `apps/web/app/api/[...path]/route.ts:93`                             | Every guild-scoped route re-derives the actor's guild membership from Discord's own guild list. Mutations use a shorter permission cache window, so a revoked role stops working quickly.                                                                                                                                                                                                                                                                                                                                                                               |
| **IDOR**                    | `route.ts:111-118` (job reads); `:86` (guildId); `:740` (resource id)                                  | Job reads assert `job.data.guildId === guildId && job.data.actorId === actor.id`. Snowflake validation on guild ids, UUID validation on resource ids.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **CSRF**                    | `apps/web/lib/security.ts:5-34`; `route.ts:92`                                                         | `assertOrigin` runs on every non-GET. In production it compares the `Origin` header for exact equality against `APP_URL`, and `APP_URL` is **required** by the web runtime env schema (`packages/core/src/environment.ts:77`), so the `x-forwarded-host` fallback is unreachable outside demo/dev.                                                                                                                                                                                                                                                                      |
| **OAuth**                   | `apps/web/app/api/auth/login/route.ts`, `.../callback/route.ts`                                        | State is 32 random bytes in an httpOnly, sameSite=lax, secure-in-prod cookie with a 10-minute life, compared with `timingSafeStringEqual` and deleted after use. `redirect_uri` is built from `APP_URL`, never from the request. Disabled in demo.                                                                                                                                                                                                                                                                                                                      |
| **Sessions**                | `auth.ts:identity`, `createSession`                                                                    | Session token is stored as a SHA-256 hash; Discord access and refresh tokens are AES-256-GCM encrypted with `APP_SECRET`. Expiry checked on read, refreshed within 60 s of expiry, 7-day absolute cap.                                                                                                                                                                                                                                                                                                                                                                  |
| **Rate limiting**           | `security.ts:36-59`; `route.ts:94`                                                                     | Keyed on the **authenticated** `${userId}:${guildId}`, not on IP, so it cannot be bypassed by rotating addresses. Redis-backed in production with a 60 s window; in-memory in demo.                                                                                                                                                                                                                                                                                                                                                                                     |
| **Request size**            | `security.ts:60-82`                                                                                    | `readBounded` enforces both `content-length` and the actual streamed byte count, cancelling the reader at 64 KB.                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Discord-side authority**  | `apps/bot/src/features/roles/member-roles.ts:209-241`; `packages/core/src/member-role-edit.ts:233-261` | A dashboard user cannot borrow the bot's privileges: the bot's `ManageRoles` **and** the actor's are both required, the ceiling is `min(actor highest, bot highest)`, and a role is only offered if `roleBits & ~actorBits === 0n` — you cannot grant permissions you do not hold.                                                                                                                                                                                                                                                                                      |
| **Job re-authorization**    | `apps/bot/src/infrastructure/action-consumer.ts:44-52`                                                 | The actor is re-fetched from Discord at execution time and `ManageGuild` re-checked, independently of whatever the browser claimed when the job was queued.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Job payload trust**       | `action-consumer.ts:63-70`                                                                             | `member-roles` re-reads the target's roles from Discord and answers from that re-read, not from the client's claim. `test-message` checks the **bot's** own channel permissions before sending, uses `allowedMentions: { parse: [] }`, and sets a deterministic nonce for idempotency.                                                                                                                                                                                                                                                                                  |
| **Job retry bounds**        | `packages/core/src/queue.ts:24-29`; `apps/worker/src/index.ts:311-330`                                 | `attempts: 5`, exponential backoff from 3 s, `removeOnComplete`/`removeOnFail` both bounded by age and count, worker concurrency 5 with a 20/s limiter, and a provider-aware backoff that honours `Retry-After`. No unbounded retries.                                                                                                                                                                                                                                                                                                                                  |
| **Webhook signature**       | `packages/core/src/safety.ts:111-129`; `apps/web/app/api/webhooks/[sourceId]/route.ts`                 | HMAC-SHA256 over `${timestamp}.${raw}`, 5-minute replay window, timing-safe comparison against a length-validated digest, secret encrypted at rest, per-source rate limit of 30, 64 KB body cap, disabled in demo.                                                                                                                                                                                                                                                                                                                                                      |
| **ReDoS**                   | `packages/core/src/feed-routing.ts:11`                                                                 | News keyword routing is `text.includes(...)`, not a regex — user input never reaches a pattern. The one dynamically built `RegExp` (`packages/core/src/diagnostics.ts:32`) escapes its input and only ever runs over short secrets during log redaction.                                                                                                                                                                                                                                                                                                                |
| **Prototype pollution**     | `packages/core/src/config.ts:177`                                                                      | `configSchema` is `.strict()` and `saveConfig` parses through it (`packages/db/src/store.ts:371`), so `__proto__` and any other unknown key are rejected rather than merged.                                                                                                                                                                                                                                                                                                                                                                                            |
| **SQL injection**           | `packages/db/src/**`                                                                                   | Every `sql` template interpolates column objects and bound parameters, never concatenated strings. No `db.execute` with built SQL.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Secrets in the tree**     | grep over `apps`, `packages`, `tests`, `docs`, `.env.example`                                          | No hardcoded tokens, keys or passwords. `.env.example` ships empty placeholders with generation instructions.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **Image optimizer**         | `apps/web/next.config.mjs:26-36`                                                                       | Allowlist is exactly one pattern: `cdn.discordapp.com/avatars/*/*.webp`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Demo mode in production** | `packages/core/src/environment.ts:112-120`                                                             | `isDemo()` requires an explicit `DEMO_MODE=true` in production. The implicit fallback is gated on `NODE_ENV !== "production"`.                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Medium — non-music bot actions had no freshness bound

|          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | **Medium**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Evidence | `packages/core/src/bot-actions.ts:21-27` (before the fix)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Impact   | Only `music` was age-checked. `community` guarded itself separately (`packages/core/src/community.ts:49`, 30 s). Every other action — `member-roles`, `publish-panel`, `claim-role`, `capture-template`, `apply-template`, `sync-roster`, `test-message` — had no bound at all, so a job queued during a worker outage executed whenever the worker returned, however long that took. Not an authorization bypass: permissions are re-read at execution time. It is an unbounded _intent_: an operator's click from arbitrarily long ago still takes effect, and "was run" and "was intended just now" are different facts. |
| Status   | **fixed in `3f17d1c`**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

All actions now share one bounded window. Music keeps 30 s because a queue is
live state; the rest get 15 minutes (`BOT_ACTION_MAX_AGE_MS`) because they are
deliberate configuration changes and a 30-second window would fail on any
ordinary restart.

### Medium — no Content-Security-Policy

|          |                                                                                                                                                                                                                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | **Medium**                                                                                                                                                                                                                                                                                                                    |
| Evidence | `apps/web/next.config.mjs:38-59` (before the fix)                                                                                                                                                                                                                                                                             |
| Impact   | `nosniff`, `Referrer-Policy` and `Permissions-Policy` were set, but no CSP. `X-Frame-Options: DENY` was emitted only when `NODE_ENV === "production" && DEMO_MODE !== "true"`, so in the demo build there was **no** framing protection at all — clickjacking resistance depended on which environment you happened to be in. |
| Status   | **fixed in `3f17d1c`**                                                                                                                                                                                                                                                                                                        |

Adds `frame-ancestors 'none'` (enforced everywhere, including demo), plus
`object-src 'none'`, `base-uri 'self'` and `form-action 'self'`.

**Deferred within the same fix:** `script-src` keeps `'unsafe-inline'` because
Next injects its own bootstrap and hydration scripts. Replacing that with
per-request nonces is a framework-level change, not a header change, and is
recorded here rather than silently omitted.

### Medium (deferred) — 4 moderate npm advisories, dev-only, no upgrade available

|          |                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | Medium, **deferred**                                                                                                                                                                                                                                                                                                                                                                     |
| Evidence | `npm audit` (with dev): `esbuild` GHSA-67mh-4wv8-2f99, GHSA-g7r4-m6w7-qqqr, reached only via `drizzle-kit@0.31.11 → @esbuild-kit/esm-loader → @esbuild-kit/core-utils → esbuild`                                                                                                                                                                                                         |
| Impact   | Both advisories require an attacker to reach a running **esbuild development server**. `drizzle-kit` is a migration/codegen CLI and never starts one. `npm audit --omit=dev` reports **0 vulnerabilities**, so nothing affected ships.                                                                                                                                                   |
| Status   | **deferred** — `drizzle-kit` is already at the latest release (0.31.11) and still carries `@esbuild-kit/esm-loader`, so no upgrade exists. `npm audit fix --force` would install `drizzle-kit@0.18.1`, which is a **downgrade** across a major version boundary and would break the migration tooling to silence an unreachable advisory. Revisit when drizzle-kit drops `@esbuild-kit`. |

### Low — unbounded JSON nesting depth

|          |                                                                                                                                                                                                                                                                                                                                                           |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Severity | Low                                                                                                                                                                                                                                                                                                                                                       |
| Evidence | `apps/web/lib/security.ts:83-90`                                                                                                                                                                                                                                                                                                                          |
| Impact   | `body()` bounds a request to 64 KB but not its nesting depth, so a small payload of `[[[[[…]]]]]` makes `JSON.parse` throw `RangeError`, surfacing as a 500 rather than a 400. Reachable only after authentication and rate limiting, and the failure is a rejected request rather than a crash, so the impact is error-quality rather than availability. |
| Status   | **deferred** — fixed properly by a depth check in `body()`; not worth a change in this pass, and Zod rejects the shapes that matter downstream.                                                                                                                                                                                                           |

---

## Process notes

- CI was **red on every commit since `84c9c7f`** and was not checked for
  twenty runs. The cause and the corrected timeline are recorded in
  `docs/CONTINUATION-PASS-11.md`.
- The lockfile was left out of sync in `4788498` (a dependency added to
  `package.json` by hand), which failed CI's `npm ci` before any test ran.
  Fixed in `f481a39`. Editing `package.json` directly without regenerating
  `package-lock.json` is a guaranteed CI failure.
