# Continuation record — pass 11

Date: 2026-10-27 · Branch `arena/88919263-discordjs-starter`.

This document is written from commands **executed in this session** on the new
branch. Every number below was produced by a command, not copied from the
previous handoff. Where the handoff disagreed with the repository, the
repository wins and the difference is recorded in §3.

---

## 1. Continuity verification

The new branch was handed over as a **shallow clone**. That was the single most
important thing to establish before any work, because a shallow clone looks
identical to a complete one at the tip but silently carries no history.

### 1.1 What was found

```
$ git rev-parse HEAD
d3e5b6153a0d73e028272db8df2e752b289e6e0c

$ git rev-list --count HEAD
1

$ git rev-parse --is-shallow-repository
true

$ cat .git/shallow
d3e5b6153a0d73e028272db8df2e752b289e6e0c
dc9726a8aa039c31b5e5be33de738c8c95756710
```

`d3e5b61` was present as a **root commit with no parents**, so the branch
appeared to contain a single snapshot. The full product history — every
dashboard, music, roster and template commit — was **absent from the object
store**, not merely un-referenced.

### 1.2 The repair (non-destructive)

The remote still held the complete history at the same SHA, so the history did
not need to be reconstructed, replayed or cherry-picked — only fetched.

```
$ git fetch --unshallow origin
```

`git fetch --unshallow` only deepens the object store. It does not move any ref,
does not touch the index, and does not touch the working tree. No merge, rebase,
reset or force-push was involved.

### 1.3 Verification after the repair

```
$ git rev-parse --is-shallow-repository
false

$ git rev-list --count HEAD
155

$ git rev-list --count main..HEAD
138

$ git rev-parse HEAD^{tree}
ec520998955f290956b353b06757252fb890589d   # identical to the pre-fetch tree

$ git status --porcelain | wc -l
0
```

| Check                                                                | Result                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `d3e5b61` is an ancestor of `HEAD`                                   | **yes** — it _is_ `HEAD`                                                    |
| Working tree before / after deepen                                   | clean / clean                                                               |
| `HEAD` tree before / after deepen                                    | `ec52099…` / `ec52099…` — unchanged                                         |
| `main` (`dc9726a`) is an ancestor of `HEAD`                          | **yes**                                                                     |
| `eeb0e68` (handoff's stated baseline start) is an ancestor of `HEAD` | **yes**, `git rev-list --count eeb0e68..HEAD` → `98` (99 commits inclusive) |
| All 11 pass-10 commits present with matching subjects                | **yes**                                                                     |

**No previous work was replayed.** The baseline was already the branch tip; only
its truncated ancestry was missing, and that was restored by fetch alone.

### 1.4 Other branches inspected and deliberately not merged

`git ls-remote origin` shows four branches:

| Branch                             | Tip       | Decision                                                               |
| ---------------------------------- | --------- | ---------------------------------------------------------------------- |
| `main`                             | `dc9726a` | ancestor of `HEAD`; nothing to merge                                   |
| `arena/99c6cf65-discordjs-starter` | `d3e5b61` | **identical SHA to `HEAD`** — no newer commits exist on the old branch |
| `arena/e2b42b08-discordjs-starter` | `eeb0e68` | ancestor of `HEAD`                                                     |
| `arena/752cdf1a-discordjs-starter` | `2ed0fec` | **not** an ancestor — inspected, see below                             |

`2ed0fec` (`feat: add an optional dev container backed by the dev compose
service`, 2026-10-19) branches directly off `main` and is **older** than the
pass-10 work. It is not "newer old-branch work". Its content is superseded:

- It adds `.devcontainer/devcontainer.json`, `.dockerignore`,
  `.vscode/extensions.json`, `Dockerfile`, `README.md`, `docker-compose.yml`,
  `vitest.config.mts` (7 files, +163/−13).
- `HEAD` already contains a strict superset — `.devcontainer/check-workspace.mjs`
  and `.devcontainer/ci-smoke.sh` exist only in `HEAD`.

Merging it would be a regression. It was left alone.

---

## 2. Baseline verification (executed this session)

All commands run on `arena/88919263-discordjs-starter` at `d3e5b61`, Node
`v22.22.3`, npm `10.9.8`.

| Command                                           | Result                                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm ci`                                          | **pass** — 642 packages, exit 0 (4 moderate npm-audit advisories, pre-existing) |
| `npm run typecheck`                               | **pass** — exit 0 (`next typegen` + `tsc --noEmit` ×2)                          |
| `npx eslint apps packages tests --max-warnings=0` | **pass** — exit 0                                                               |
| `npm run format:check`                            | **pass** — "All matched files use Prettier code style"                          |
| `npx vitest run`                                  | **pass** — **76 files / 953 tests**, 37.38 s                                    |
| `npm run build:web`                               | **pass** — exit 0, 33 routes generated                                          |

The 76/953 figure reproduces the previous session's result exactly. **The
baseline is green and no failures were hidden.** `npm run test:e2e` (Playwright)
was not run — no browsers are installed in this sandbox; it runs in CI.

---

## 3. Handoff corrections

The handoff was accurate about the big picture and wrong about several details.
Each correction below was verified against the repository.

| #   | Handoff said                                                           | Actually                                                                                                                                                                                                                                                                                         | Evidence                                                                           |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | "Tables currently in `schema.ts` (**16**)", then lists 17 names        | **17** `pgTable` exports                                                                                                                                                                                                                                                                         | `grep -cE '^export const … = pgTable' packages/db/src/schema.ts` → 17              |
| 2   | React `^19.1.0` "would allow a fresh `npm ci` to resolve below 19.2.0" | **Wrong.** `npm ci` installs the lockfile exactly: React is **locked at 19.3.1**. The declared range only matters when the lockfile is regenerated. (This correction came from the user and is confirmed.)                                                                                       | `package-lock.json` → `react 19.3.1`, lockfileVersion 3                            |
| 3   | Music includes "lyrics" as implemented                                 | **Not implemented.** LavaLyrics/LRCLIB are configured in Lavalink, but there is no lyrics command and no lyrics code path. The only match is a comment at `music/source.ts:407`.                                                                                                                 | `moduleRoots.music` = play, search, queue, pause, resume, skip, stop, volume, seek |
| 4   | "Next migration starts at `0009`"                                      | **Correct.** Journal has 9 entries (`idx` 0–8); last tag `0008_account_identity_fields`. Next is `0009_*`.                                                                                                                                                                                       | `drizzle/meta/_journal.json`                                                       |
| 5   | Blizzard presence unstated                                             | **Present and selectable.** `sourceSchema.data.adapter` enum = `["rss","steam","webhook","blizzard","wowhead","mojang"]`; `blizzard`/`wowhead`/`mojang` have **no fetch implementation** in `feeds.ts` (only `webhook` and `steam` are handled) but are offered in the UI. 53 matches repo-wide. | `packages/core/src/config.ts:207`, `feeds.ts:324-325`, `resource-editor.tsx:754`   |
| 6   | Templates "capture, preview, apply, delete"                            | **Confirmed.** No PATCH/PUT, no duplicate, no blank-create, no blueprints — the builder is greenfield. `templates-page.tsx` has exactly one `load()` in one `useEffect` (lines 129–131): no polling, no abort, no stale guarding.                                                                | grep on both files                                                                 |

### 3.1 A scoping note that matches what I found

The user's instruction "do not delete the `webhook_secrets` table just because
it contains _webhook_" is correct and I verified why: `webhook_secrets` is an
**in-house HMAC signing table** for Orbit's own signed-webhook ingestion
endpoint (`apps/web/app/api/webhooks/[sourceId]/route.ts`), not a news-webhook
delivery mechanism. It has its own protected server endpoint and is unrelated to
news ingestion. It must not be touched by the news cleanup.

---

## 4. Current-state checklist

Kept up to date as the pass progresses.

### Implemented (verified in code / by the baseline run)

| Area                                        | State                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard shell, server-side tables         | TanStack Table v9 manual mode, server-side sort/filter/page, named column menus                                                                       |
| Auth                                        | Discord OAuth, sessions, per-guild authorization, server-only permission checks                                                                       |
| Audit log                                   | Append-only, actor avatars, hash-derived URLs                                                                                                         |
| Economy                                     | Accounts, ledger, daily, transfer, shop, inventory, deliveries, outbox                                                                                |
| Moderation                                  | warn/timeout/kick/ban/purge/cases + hierarchy & protected-target checks                                                                               |
| Roles / role panels                         | Publish job, hierarchy and managed-role checks                                                                                                        |
| Music                                       | Lavalink via shoukaku, 4 providers with explicit selection, queue, progress, volume, idle-disconnect, `music:doctor`                                  |
| Deals / news / polls / announcements / help | Provider adapters, presentation policies, 32 commands / 47 invocations                                                                                |
| Documentation                               | 30 files in `docs/`, bespoke renderer (`marked` + `sanitize-html`), nav/search/anchors/copy                                                           |
| Member directory                            | Synchronized roster, bounded sweeps, `complete`/`partial`/`failed`, server-side querying, read-only detail                                            |
| Identity                                    | One resolver: guild nickname → globalName → username → storedName                                                                                     |
| Templates                                   | Capture, preview (create/reuse/skip + blockers + fingerprint), queued apply run with per-step results, retry-safe by name, DELETE (source guild only) |
| Jobs                                        | `sync-roster`, `capture-template`, `apply-template`, `publish-panel`, `send-test` over BullMQ + Redis                                                 |
| Signed webhook ingestion                    | `webhook_secrets` + HMAC endpoint (**out of scope for news removal**)                                                                                 |

### Partial

| Area                  | Exists                                                                                                | Missing                                                                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template live refresh | One-shot `load()`; `GET /templates/runs/:id`                                                          | No polling, no abort, no stale-response guard, no queued/running/step display without manual reload, no cleanup                                         |
| Template editing      | Capture, preview, apply, delete                                                                       | No PATCH/PUT, no duplicate, no blank create, no blueprints, no validation UI, no dirty state, no unsaved-navigation guard, no reference-integrity check |
| Template retries      | Retry-safe "reuse by name" + fingerprint                                                              | No persisted run-step → created-resource mapping, no renamed/duplicate handling, no concurrent-run arbitration, no crash-after-create recovery          |
| Cross-server apply    | `assertTargetAllowed` + preview for a second guild                                                    | No complete target picker/mapping UI, no execution-time recheck surfaced to the UI                                                                      |
| Music diagnostics     | `diagnosticText` with secret redaction                                                                | No per-stage client taxonomy, no dedupe of repeated exception text, no bounded per-client summary                                                       |
| Embeds                | `replies.ts`: `ReplyCard`, tones `info\|success\|error`                                               | No `warning` tone, no identity/pagination/attribution primitives, 4 files still call `EmbedBuilder` directly, no fixtures                               |
| News adapters         | `rss` + `steam` + `webhook` implemented; the three unimplemented starters removed by migration `0009` | —                                                                                                                                                       |

### Absent (confirmed by search this session)

| Area                                                               | Evidence                                                                                                                                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **XP / leveling**                                                  | `grep -rniE '\bxp\b\|leveling' apps packages` → **0 matches**; no XP/level table in `schema.ts`                                                                         |
| **Tickets**                                                        | 2 matches total, both cosmetic (a shop-item description in `demo-seed.ts:299`, a test fixture name in `database.test.ts:258`). No table, command, or dashboard surface. |
| Welcome/goodbye, autoroles, starboard, reminders, AFK, suggestions | 0 code matches                                                                                                                                                          |
| Fumadocs / Nextra                                                  | Not installed                                                                                                                                                           |
| Any YouTube fix                                                    | None beyond current configuration                                                                                                                                       |

---

## 5. Dependency facts (declared vs locked)

`npm ci` installs the **lockfile**; the declared range only constrains a future
lockfile regeneration. Both columns are recorded because they answer different
questions.

| Package               | Declared   | Locked     |
| --------------------- | ---------- | ---------- |
| next                  | `^16.4.3`  | 16.4.3     |
| react                 | `^19.1.0`  | **19.3.1** |
| react-dom             | `^19.1.0`  | **19.3.1** |
| typescript            | `^5.9.3`   | 5.9.3      |
| tailwindcss           | `^3.4.18`  | 3.4.19     |
| discord.js            | `^14.22.1` | 14.27.0    |
| drizzle-orm           | `^0.45.4`  | 0.45.4     |
| @tanstack/react-table | `^9.3.1`   | 9.3.1      |
| shoukaku              | `^4.1.1`   | 4.3.0      |
| bullmq                | `^5.63.0`  | 5.81.5     |
| zod                   | `^4.6.7`   | 4.6.7      |
| marked                | `^16.4.2`  | 16.4.2     |
| sanitize-html         | `^2.17.0`  | 2.18.1     |
| vitest                | `^5.0.5`   | 5.0.5      |
| @playwright/test      | `^1.64.1`  | 1.64.1     |

**Consequence for the docs migration:** a Fumadocs requirement of
`react >= 19.2.0` is **already satisfied by the locked install (19.3.1)**. The
declared range `^19.1.0` is a _future-regeneration_ risk, not a current
`npm ci` incompatibility. Raising the declared range is therefore a hygiene
change to be made **if and only if** Fumadocs is actually adopted — not a
prerequisite invented in advance.

---

## 6. Decision matrix — research

Check date for every entry: **2026-10-27**. Source type is stated explicitly.

### 6.1 YouTube / Lavalink

| Source                                                       | Type                     | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.github.com/repos/lavalink-devs/youtube-source/releases` | **fetched**              | Latest release is **1.18.2 (2026-07-27)**. No 1.18.3 exists. A version bump is therefore **not available** — this is now verified, not reported.                                                                                                                                                                                                                                                                                                             |
| `lavalink-devs/youtube-source` open issues (API list)        | **fetched**              | Recent: #250 (2026-10-13) ytsearch empty when IOS precedes WEB; #249 (2026-10-08) playlist layout; #248 (2026-10-08) SABR seeking; #247 (2026-09-26) auto-dubbed audio; #244 (2026-09-08) "why no 1.18.3"; #242 (2026-08-27) live streams; #240 (2026-08-21) login required; #236 (2026-08-19) IOS client; #229 (2026-08-17) remote poToken support                                                                                                          |
| issue #240 (chunks 1/5 read)                                 | **fetched**              | Reporter is on 1.18.2 and sees `TVHTML5: The page needs to be reloaded` / `MWEB: This video requires login`. **Critically**, that reporter runs `oauth.enabled: true` **and** `remoteCipher: https://cipher.kikkia.dev/` — a third-party cipher service — and explicitly answered **"I DO NOT confirm that this has been filled out truthfully."** Its client list (`TV, MWEB, WEB, MUSIC, WEBEMBEDDED, ANDROID_VR, TVHTML5_SIMPLY`) also differs from ours. |
| `docker/lavalink/application.yml`                            | **fetched (local file)** | Our clients are `[MUSIC, ANDROID_VR, WEB, WEBEMBEDDED]`; `oauth.enabled: false`; **no** `remoteCipher`; `allowDirectVideoIds: false`; `allowDirectPlaylistIds: false`; LavaSrc `providers: []`                                                                                                                                                                                                                                                               |
| `docker/lavalink/plugins.lock.json`                          | **fetched (local file)** | Lavalink 4.2.2; youtube-plugin **1.18.2** @ `158726dc…` sha256 `dd4b3bce…`, reviewed 2026-10-24                                                                                                                                                                                                                                                                                                                                                              |

**Conclusion, stated as inference and not as fact:** issue #240's SABR /
region / login narrative is a **plausible upstream hypothesis**. It is _not_
evidence about this deployment, because (a) the reporter's configuration differs
materially from ours (OAuth on, third-party cipher service, different client
list) and (b) the reporter declined the truthfulness attestation. The incident
audit (`ec6855f8-5803-4246-91ef-d80db9bc962f`) contains **no video URL**, so the
failing item cannot be reproduced. See §7.

### 6.2 Documentation framework

| Source                      | Type         | Note                                                                                                                         |
| --------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Fumadocs v16 blog (handoff) | **snippet**  | Claims React ≥ 19.2.0 + Next 16. Not re-verified this session; will be re-verified against package metadata before adoption. |
| Nextra 4                    | **snippet**  | App Router only, Pagefind search                                                                                             |
| `package-lock.json`         | **verified** | Next 16.4.3, React 19.3.1 — both frameworks' stated floors are met by the locked tree                                        |

Decision deferred until Fumadocs/Nextra metadata is fetched directly (§13 slice 10).

### 6.3 Leveling curve

| Source                                     | Type        | Note                                                                                                   |
| ------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------ |
| Carl-bot docs `levels.md` (handoff)        | **snippet** | Curve `5n² + 50n + 100`, 15–25 XP default — **reported, not verified**; will be re-verified before use |
| MEE6 / Dyno voice-leveling rules (handoff) | **snippet** | ≥2 humans, no AFK, no self/server-deafen — **reported**                                                |

---

## 7. Operator decisions (answered 2026-10-27)

| Question                                    | Answer                               | Consequence                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The exact failing YouTube video URL         | **Not available**                    | No reproduction is possible. Playback is reported as **unverified**; the music work is limited to diagnostics quality and configuration, and no claim of a fix is made. |
| A disposable test server for live mutations | **Authorized**                       | Template apply, member role-edit and voice-XP may be exercised against a disposable guild. Never against the user's real server.                                        |
| YouTube OAuth / poToken                     | **Keep the credential-free default** | `oauth.enabled: false`, no `pot`, no `remoteCipher`. Restricted items stay unavailable and are reported honestly.                                                       |

## 7b. Slice log

### Slice 3 — music diagnosis (committed `c795370`)

Confirmed defects, both reproduced before the fix:

1. **Per-client answers were collapsed.** The incident reported three different
   sentences from three clients; `musicFailureCategory` classified the whole
   blob at once and kept only the first regex match, discarding two thirds of
   the evidence.
2. **The summary was cut mid-word.** `slice(0, 300)` ended the operator-facing
   sentence on `"...and O"`.

Fixed with `parseClientFailureGroups` + `truncateAtWord` in
`packages/core/src/diagnostics.ts`, and `musicFailureCategories` /
`musicClientFailureGroups` in `apps/bot/src/features/music/source.ts`. The
~490-character guidance paragraph moved from the 300-character summary to the
unbounded `details` — a deliberate change, recorded in the commit and in the
adjusted test.

Checked and found **not** to be code defects (documented, not "fixed"):

- _Markdown linkification of Java package names._ No Markdown renderer touches
  audit text; the `marked` + `sanitize-html` pipeline renders repository-authored
  `docs/` only.
- _Version bump._ Verified against the releases API: **1.18.2 is still the
  newest release**. There is nothing to upgrade to.

### Slice 4 — template live refresh

The gap was larger than "no polling". `waitForBotAction` (the bridge every
dashboard mutation goes through) gives up after **30 attempts × 1s** and throws
`"may still be processing"`. A capture or apply that takes longer than that was
reported as an error **while the worker carried on without the UI** — the page
lost track of work it had started, and a reload left no way back to it.

| Requirement                          | How it is met                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Bounded polling during active work   | `useLiveRefresh` polls every 2s while work is in flight                                                |
| Cleanup on navigation/unmount        | `AbortController` + `clearTimeout` in every effect cleanup                                             |
| Discard stale responses              | `createSequenceGuard` — a ticket is honoured at most once, an older response is dropped                |
| Backend work continues independently | Capture and apply now pass `awaitJob: false`; the queue owns them                                      |
| Recover after reload/reconnect       | `GET /templates/active` + `getActiveTemplateRun` rediscover an in-flight run from the database         |
| Stop polling when idle               | `idleMs: 0` for the run and capture-job pollers; `nextPollDelay` returns `null`                        |
| Pause when hidden                    | No timer while `document.visibilityState !== "visible"`; one reconcile on return                       |
| Clear errors and retry               | `retry()` resets the failure count and fetches immediately; backoff doubles to a 60s ceiling           |
| Preserve unsaved builder edits       | The list refresh only replaces server-owned state; no draft is touched (the builder itself is slice 5) |
| Accessible announcements             | `role="status"` banner plus an `aria-live="polite"` sentence naming the state and step counts          |

**Verified against a running demo server** (`npm start` with `DEMO_MODE=true`):

| Step                                                   | Result                                                                            |
| ------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `POST /templates`                                      | `201`, id returned; fingerprint `19-f94fa17b` reproduces the recorded baseline    |
| `POST /templates/:id/preview`                          | `counts {create: 0, reuse: 19, skip: 0}`, `blockers []`                           |
| `POST /templates/:id/apply`                            | `202 { runId, accepted, demo }`                                                   |
| `GET /templates/runs/:id`                              | `state: simulated` (terminal)                                                     |
| `GET /templates/active` with only terminal runs        | `{"run":null}` — a finished run is not rediscovered                               |
| `GET /templates/active` with an injected `running` run | returns the run with its `templateId`, so a reloaded page re-selects the template |
| Same run moved to another guild                        | `{"run":null}` for the original guild; `403` for the other — no cross-guild leak  |

**Partial / not done in this slice:** the builder (draft editing, dirty state,
unsaved-navigation guard) is slice 5; no live Discord apply was run.

---

## 8. Execution order for this pass

Following §13 of the brief, with one stated reorder: the YouTube work (slice 3)
is **research-and-configuration only** and cannot be verified without the
failing URL, so it is documented and de-risked first but cannot block the
feature slices.

1. Continuity verification and baseline run — **done** (§1, §2)
2. Current-state audit and decision matrix — **done** (§3–§6)
3. Music: diagnosis, per-client diagnostics, config documentation
4. Template live refresh
5. Template builder, mappings, cross-server application
6. Members refactor, role presentation, connected views
7. Leveling / XP
8. Tickets + selected multipurpose features
9. News source cleanup and formatting
10. Documentation framework migration
11. Embed / message presentation layer
12. Cross-feature validation and final report

### Slice 9 — news source cleanup

Done out of the brief's order, for a stated reason: the template builder
(slice 5) is the largest remaining piece and this one is self-contained and
completable, while a half-built builder would violate the "working vertical
slices, not schemas" rule.

`blizzard`, `wowhead` and `mojang` were selectable news adapters that never had
a fetch path: `feeds.ts` handles `webhook` and `steam` explicitly and every
other adapter falls through to the RSS/Atom reader, so all three already
behaved exactly like `rss`. The extra values only implied a provider
integration that did not exist.

Removed from the `sourceSchema` enum, the source editor, the source cards and
their icons, and from the setup/permission guidance strings.

**Migration `0009_drop_unimplemented_news_adapters`** converts stored rows
instead of dropping them — a deliberate choice. Narrowing the enum alone would
have been the destructive version: existing rows would fail validation and an
administrator could not fix them from the dashboard, because the editor would
no longer offer the value the row still carried. The migration rewrites
`resources.data->>'adapter'` to `rss` and is scoped to `kind = 'source'` so
unrelated jsonb carrying the same key is left alone.

`tests/news-adapters.test.ts` proves the conversion against a real PGlite
instance: the URL, schedule and tags survive; a disabled starter with no URL is
converted rather than dropped; a `steam` row is untouched; a `route` row is
untouched; and no row is deleted.

Demo sources were renamed from the publisher names to
"Community feed · Minecraft / Warcraft / Diablo", because what they demonstrate
is a bring-your-own feed about a subject, not an integration with a provider.
The three e2e heading assertions were updated to match.

`docs/INTEGRATIONS.md` now documents how a future provider is added in four
small pieces, and warns against the two things that produced this problem:
speculative adapters, and adapters whose only implementation is "the
administrator will supply a URL" — which is what RSS / Atom already means.

**Not done:** webhook-based news ingestion was _not_ removed. Orbit's
`webhook_secrets` table backs its own HMAC-signed ingestion endpoint and is
unrelated to news-provider webhooks; deleting it would have been collateral
damage.

---

## Slice 5 — editable template builder

Templates were previously write-once: the only way to make one was to capture a
live server, and the only edit the dashboard offered was delete. This slice adds
a real editor, so a template can be started from a starter layout or from
nothing, edited, copied and validated before anything touches Discord.

### What was added

**`packages/core/src/template-builder.ts`** (new, pure — no Discord calls, no
I/O). Blueprints, blank documents, duplicate, rename, item ordering
(`moveItem` / `canMoveUp` / `canMoveDown`), and `validateTemplateDocument`
which reports issues as `{severity, path, message}` so the editor can point at
the offending row instead of failing the whole save.

**`packages/core/src/permission-bits.ts`** (new). A plain `Record<string,
bigint>` mirroring discord.js `PermissionFlagsBits`. Duplicated deliberately:
`packages/core` is bundled into the dashboard, and importing discord.js into a
client component pulls `undici` and `node:async_hooks` into a browser build and
fails the webpack compile. `tests/permission-bits.test.ts` asserts the table
still matches discord.js (same key count, same values, Administrator `=== 8n`),
so upstream drift is a test failure rather than a silent mismatch. The bot keeps
using discord.js directly.

**`apps/web/components/template-builder.tsx`** (new). A dialog with a start
screen (three starter blueprints, each with a summary and a "best for" line,
plus three blank kinds) and an editor with role rows, channel rows, permission
grids and per-channel overwrites. State is local and seeded once, so the
templates page's live-refresh poll cannot clobber typing; a `beforeunload`
guard and a confirm-on-discard cover unsaved edits. Validation runs on every
keystroke and is split into error and warning panels.

**API** (`apps/web/app/api/[...path]/route.ts`, all under
`/api/guilds/:guildId/templates`): `POST` now accepts `blueprint` or
`blankKind`; `POST /:id/duplicate`; `PATCH /:id` with `{name?, document}`.
Validation runs server-side on every one of these, not only in the browser, so a
hand-crafted request cannot store a template with dangling references.

**`updateTemplate`** added to `packages/db/src/templates.ts` — replaces the
whole document rather than patching it, because a template's structure is
internally cross-referenced (a channel points at a category key, bindings point
at channel and role keys); a partial patch could leave half a reference.

### Two real defects the tests caught

- `duplicateTemplateDocument` used an object spread, which shares the role and
  channel arrays. Editing a duplicate silently rewrote the source template. Now
  `structuredClone(document)`.
- `blankChannel` discarded its `overwrites`, `topic` and `nsfw` inputs and
  always returned `[]` / `null` / `false`, so a caller could not build a channel
  with permission overrides at all.

One failing assertion was the test's fault, not the code's: a blank template
legitimately produces the non-blocking empty-`structure` warning, so the
assertion now checks errors only.

### Verified

- `npm run typecheck` clean; `eslint --max-warnings=0` clean on all touched
  files; `npm run format` applied; `npm run build:web` succeeds.
- `npx vitest run`: **1031 passed** (991 baseline + 34 template-builder + 6
  permission-bits).
- Live demo server (guild `120000000000000001`): blueprint create → 201 with
  roles `[role:moderator, role:member]`, channels `[channel:information,
channel:announcements, channel:general, channel:audit-log]`, bindings
  resolved; blank create → 201 with `structure: {roles: [], channels: []}`;
  duplicate → 201 with keys preserved; PATCH → 200 applying a rename and an
  appended role; unknown blueprint → 404; dangling parent → 422;
  Administrator-granting overwrite → 422. All mutating calls required
  `content-type: application/json` and `Origin`.
- The dashboard page renders in demo mode and the server-rendered HTML contains
  the new "New template" and "Capture this server" buttons.

### Not verified

The builder dialog was never opened in a browser — this session has no browser
tool, so no interaction or screenshot review happened. The dialog compiles, is
included in the client bundle and the surrounding page SSRs, but its layout and
interaction are unproven. "Edit template" and "Duplicate" are per-selection
controls and do not appear until a template is chosen, which happens
client-side; they are therefore absent from the server-rendered HTML by design.

### Known pre-existing lint warning

`npx eslint . --max-warnings=0` also flags `prettier.config.mjs` for an
anonymous default export. That file is untouched by this work (tracked since the
initial commit), so it was deliberately left alone.

---

## Slice 6a — durable run steps and crash recovery

An apply run creates Discord resources one round trip at a time, and the
process can die between any two of them. The run's `result` column was rewritten
after every step, which shows progress but cannot resume: it is a flat list of
names and ids with nothing saying which template key produced which Discord id,
and nothing recording a step that failed.

### What was added

**`drizzle/0010_template_run_steps.sql`** plus journal entry and snapshot. One
row per `(run_id, key)`, with a unique index so a re-recorded step updates
instead of duplicating. `key` is the template's own addressing scheme
(`role:moderator`, `channel:general`, `channel:general#overwrites`), never a
Discord id, so the mapping stays meaningful when the template is applied to a
different server.

**`packages/core/src/template-run-steps.ts`** (new, pure). `rebuildRunProgress`
turns recorded steps back into a role/channel id mapping, a `finished` set and a
report of what the whole run did. Only `done` steps count — a `failed` step is
exactly what a retry is for. A `done` step whose target has since vanished is
dropped, because keeping it would point overwrites and configuration bindings at
an id that no longer resolves.

**`packages/db/src/templates.ts`** — `recordTemplateRunStep` (upsert on
`(runId, key)`) and `listTemplateRunSteps` (oldest first), with demo branches.
The step types now live in core and are re-exported, so there is one definition.

**`apps/bot/src/features/templates/apply.ts`** — records a step after each
Discord call, seeds the mapping from recorded steps on entry, skips what an
earlier attempt finished, and reports the whole run rather than only the attempt
that completed it. Configuration is resolved but not re-written on a resume,
because re-saving would duplicate the audit entry without changing anything.

### Resume had to change the fingerprint guard

The fingerprint says "the target still looks like the plan the operator
approved". A resumed run has _already changed the target itself_, so the
fingerprint no longer matches even though nothing is stale — without a change,
every retry would be rejected for the work its own first attempt did.

The check is now skipped when the run has recorded steps, and kept for a first
attempt, where a changed server really does mean the plan is out of date. The
blockers check still runs in both cases.

### Verified

- `npm run typecheck` clean; `eslint --max-warnings=0` clean on all touched
  files; `npm run format` applied; `npm run build:web` succeeds.
- `npx vitest run`: **1057 passed** (1031 + 13 pure + 7 SQL + 6 recovery).
- `tests/template-run-steps.test.ts` (13) — the rebuild rule, including that a
  failed step is retried, a vanished resource is remade, and steps with no
  resource of their own (overwrites, config) are remembered but not reported as
  resources.
- `tests/template-run-steps-db.test.ts` (7) — real SQL: the unique index
  collapses a re-recorded step, steps do not leak between runs, and deleting a
  run cascades.
- `tests/template-apply-recovery.test.ts` (6) — end to end against a fake guild
  with the database mocked. A crash is injected on a path with no `try` around
  it, which is the real distinction: a failed _step_ is caught and the run
  finishes `partial`, while a crash leaves it `running` with half its work done.
  Proven: the resumed run does not recreate what it already made, overwrites
  point at the id the first attempt produced, configuration is written once,
  overwrites are not applied twice, a role deleted between the two attempts is
  remade with the stale mapping replaced, and a genuinely stale first attempt is
  still rejected.
- Demo server: blueprint create → preview → apply returns `202` with a
  `simulated` run and 2 reused items; no steps are recorded, which is correct
  because demo mode must not pretend it created Discord resources.

### Not verified

No crash was reproduced against a real Discord server. The recovery proof is a
fake guild with the database mocked, so it proves the engine's decisions, not
Discord's behaviour under a real interruption.

### One existing test updated

`tests/news-adapters.test.ts` asserted migration 0009 was the newest file. That
was true when written and is no longer meaningful. It now asserts 0009 is
present and sits directly after 0008 — the substance of the original claim —
rather than that nothing newer exists.

---

## Slice 6b — cross-server target selection

A template is portable: it addresses its own roles and channels by key, never by
Discord id. The API already accepted any `targetGuildId` and checked it against
the guilds the user administers, but the dashboard never sent anything but the
current workspace, so a template could only ever be applied to the server it was
captured from.

### What was added

**`apps/web/components/templates-page.tsx`** — an "Apply to" selector listing
every server the user manages that Orbit is installed in. Choosing another
server drops the plan, the explicit mappings and any run being followed, because
all three describe the _old_ target: a mapping names a resource in a specific
server, and a fingerprint is a hash of one target's plan. The card title and the
preview prose both name the selected target.

Servers the bot was never invited to are not offered as choices; the server
refuses them regardless.

**`apps/web/app/api/[...path]/route.ts`** — reading an apply run no longer
requires the run to belong to the workspace whose dashboard is open. A
cross-server apply is started from the template's home server but its run lives
on the target, so the check is now "the caller manages the run's server" rather
than "the run is in this workspace". `auth.guilds` is the Discord-derived list
this user administers, so an id alone still grants nothing. A run the user
cannot manage is reported as missing rather than forbidden, so the endpoint does
not confirm that it exists.

### Verified

- `npm run typecheck` clean; `eslint --max-warnings=0` clean on all touched
  files; `npm run format` applied; `npm run build:web` succeeds.
- `npx vitest run`: **1062 passed** (1057 + 5).
- `tests/template-cross-server.test.ts` (5) at the API boundary: a run is
  followable from the workspace that started it, servable from its own server,
  refused for a workspace the user does not manage, and hidden — 404, not 403 —
  when the run's server is not in the caller's guild list.
- Live demo server, three guilds (two installed, one not): template created in
  "The Cozy Corner"; previewed against "The Workshop" → 200 with a plan
  computed for the _other_ server; previewed against the uninstalled guild → 400
  "Invite Orbit to the target server before applying a template."; applied to
  The Workshop from The Cozy Corner's dashboard → 202, and the resulting run is
  readable from both workspaces while an unmanaged guild is rejected with 403
  before the run is ever touched.

### Not verified

The selector was never clicked in a browser — this session has no browser tool.
It compiles, is in the client bundle, and the surrounding page renders, but the
dropdown only appears once a template is selected, which happens client-side, so
it is absent from the server-rendered HTML and its appearance and interaction
are unproven.

---

## Slice 12a — shared role presentation

### Why

Roles were drawn in at least five places and no two agreed. The members table
showed the first two names as plain badges with no colour and no ordering. Member
detail showed every name as a plain badge. The roles view drew a colour dot with
`r.color || "#aaa"`. Two pickers had their own dots with different fallbacks
(`#999`, `#aaa`). None marked managed roles, none ordered by hierarchy, and the
overflow affordances differed.

### What was added

**`packages/core/src/roles.ts`** (new, pure). The decisions, kept out of the
markup so they can be tested without rendering anything:

- `roleSwatch` — resolves a colour to something safe to paint. Treats `""`,
  `null`, and `#000000` as _no colour_: Discord stores `#000000` for "no colour"
  as well as for a genuinely black role, and painting that black makes the dot
  vanish on a dark background. Anything unparseable falls back the same way
  rather than reaching CSS as an invalid value.
- `sortRolesByHierarchy` — position descending, ties broken by name so renders
  are stable instead of depending on row order.
- `splitRolesForDisplay` / `describeRoles` — compact `+N` overflow where the
  collapsed names feed both the tooltip and the accessible label, so the full
  list is reachable by mouse and screen reader.
- `assignableRoles` — excludes `@everyone` and managed roles.
- `rolesBelowCeiling` / `effectiveHierarchyCeiling` — hierarchy guards, with the
  ceiling being the **lower** of the actor's and the bot's reach so a dashboard
  user cannot borrow the bot's privileges.

**`apps/web/components/role-badge.tsx`** (new). `RoleBadge`, `RoleList` and
`RoleDot`, used by the members table, member detail, the roles view, and both
pickers. The dot carries an inset ring so a near-white role stays visible on a
light background and a near-black one on a dark background.

### Verified colour support, not assumed

discord.js is **14.27.0** (declared `^14.22.1`, locked `14.27.0`). Its `Role`
exposes `hexColor` and nothing else — `colors`, `unicodeEmoji` and `icon` are all
absent, checked by inspection of `Role.prototype`. Gradient and holographic role
styles therefore do not exist in this version and were not invented. The stored
`GuildRole` type carries a single `color: string`.

### Deliberately left alone

The self-role _preview_ button in `resources-page.tsx` still renders a bare role
name. It is a deliberate mock of Discord's own UI on Discord's own palette
(`bg-[#4e5058]` and friends); forcing the shared badge into it would make the
simulation less faithful, not more consistent.

### Verified

- `npm run typecheck` clean; `eslint --max-warnings=0` clean on every touched
  file; `npm run format` applied.
- `npx vitest run`: **1083 passed** (1062 baseline, +21).
- `tests/roles.test.ts` (21) covers the colour fallback including the `#000000`
  sentinel and unparseable input, stable hierarchy ordering with tie-breaks and
  no mutation of the input, overflow splitting and its accessible description,
  exclusion of `@everyone` and managed roles, and the hierarchy ceilings —
  including that nothing is assignable when either the actor or the bot sits at
  the bottom.

### Not verified

No browser is available in this session, so none of these surfaces were looked
at. The components compile and the suite passes; their rendered appearance is
unproven.

---

## Slice 12b — connected views: members by role, roles to members

Section 1 asked for views that link into each other. Slice 12a made roles look
the same everywhere; this slice makes them _reachable_ from one another, so a
reader can move from a role to the people holding it and back without losing
their place.

### What was added

**A `roleId` parameter threaded through the whole stack.** One parameter, added
in one place per layer rather than special-cased per surface:

- `packages/core/src/members-query.ts` — `roleId` joins `membersQuerySchema`
  (still `.strict()`, so an unknown parameter is a 400 rather than a silent
  no-op), `parseMembersQuery`, and `membersQueryString`. The serializer emits it
  **only when it is non-empty**, so the common case keeps short URLs instead of
  advertising a narrowing that is not happening.
- `packages/db/src/members.ts` — `listMembers` narrows in **both** branches: the
  demo branch with `m.roles.includes(...)`, the Postgres branch with a jsonb
  containment test (`roles @> '["…"]'::jsonb`).
- `apps/web/app/api/[...path]/route.ts` — needed **no change**; it already
  forwards the whole parsed query, which is the payoff of having one schema.

**A real role → members link.** The roles table in `server-pages.tsx` gained a
_Members_ column with a per-role "View" button that navigates to the directory
with `roleId` set. `@everyone` is the exception and says _Everyone_ instead of
linking: it is the guild itself, not something anyone is "holding", so a link
that returns the entire roster would be a misleading narrowing.

**A real members → role link.** `RoleBadge` and `RoleList` take an optional
`onSelect`. Clicking a role in the members table or in the member detail dialog
filters the directory to that role and closes the dialog. When no `onSelect` is
passed the badge stays a plain `span` — the component is used in places where
clicking means nothing, and a stray focus stop in a table row would be worse
than no link.

**The filter is visible and clearable.** The directory shows a _"Holding the
role"_ chip with the same badge the rest of the app uses, plus a Clear control.
If the role has since been deleted the chip says the server no longer has it
rather than rendering an empty badge. Changing the role resets to page 1,
because it is a new result set and page 3 of the old one is meaningless.

**`navigate` learned to carry state.** `Workspace.navigate(section, query?)`
builds search params, so any surface can hand another a starting point without
the two knowing about each other's internals. The directory seeds `roleId` from
the URL on mount only — making it follow the address bar continuously would push
history on every change and fight the page's own state.

### A bug this slice found

`listMembers` rebuilt its query from individual fields
(`membersQuerySchema.parse({ page, pageSize, … })`) and simply did not list
`roleId`, so the parameter defaulted to empty and **the filter silently did
nothing**. The first version of the test passed the filter and got the whole
roster back. Fixed by adding `roleId: input.roleId ?? ""` to the parse call.
Worth remembering: a schema field is not honoured by a repository until the
repository actually passes it through.

### Tests

- `tests/member-directory.test.ts` — four contract cases (round-trip, omission
  when empty, combination with the other filters, rejection of malformed ids)
  and three directory cases (narrowing, guild isolation, no-role means
  everyone).
- `tests/member-role-filter-db.test.ts` — **new**, six PGlite cases against real
  SQL, because the demo branch and the SQL branch are two implementations of the
  same directory. These cover the ways jsonb containment could quietly go wrong:
  matching a strict **prefix** of a role id, leaking a role across **guilds**,
  returning nobody for an unheld role, and composition with the presence filters.

### Corrected expectations (stated, not hidden)

Two assertions were updated rather than worked around:

1. The pre-existing `toEqual` on the parsed query in
   `tests/member-directory.test.ts` listed every field exactly, so adding
   `roleId` broke it. It now names `roleId: ""` alongside the existing values.
   The same values are still asserted; the contract genuinely gained a field.
2. My own snowflake test wrongly expected a 19-digit and then a 20-digit id to
   be rejected. Discord's range is 17–20 digits, so both are valid. It now uses
   a 21-digit id for the too-long case.
3. My first composition test assumed `filter: "all"` excludes departed members.
   It does not — "all" is genuinely all. The test now asserts the real
   composition across `all` / `humans` / `departed`.

### What was deliberately not built

Two of section 1's linked views are **not reachable yet** and were not faked:

- **Channel → permission overwrites.** The synced `GuildChannel` does not carry
  permission overwrites; only `channel-export.ts` reads them, and only for
  templates. There is no stored data to link to.
- **Member → moderation cases.** There is no moderation case surface in the
  dashboard at all, so there is nothing to link from a member to.

Building either would mean inventing data that does not exist.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean on every touched file.
`npm run format:check` clean. `npm run build:web` succeeds. `npm test`: **1096
passed / 86 files** (was 1083 / 85).

### Not verified

No browser is available in this session, so no changed UI surface was looked at.
The new column, the chip and the click-through compile and their logic is
covered by tests, but their rendered appearance is unproven.

---

## Slice 12c — editing a member's roles

The last piece of section 1, and the one with the most ways to go wrong: it is
the only surface that mutates Discord on behalf of an operator.

### Where the rules live

`packages/core/src/member-role-edit.ts`, pure and Discord-free, so every branch
is reachable in a test. `planMemberRoleChanges` is the single decision point —
a caller that skips it has no protection at all. 20 tests cover it.

It refuses, before anything is sent to Discord:

- **`@everyone`** in either direction — it is the guild itself.
- **Managed roles** — they belong to an integration and Discord rejects them.
- **Roles at or above the effective ceiling.** A role sitting _at_ the
  caller's own top position is out of reach, not just one above it: that is
  Discord's rule, not a conservative reading.
- **Anything outside `min(actor, bot)`.** A dashboard user must not be able to
  borrow the bot's position, and the bot must not be able to exceed the user's.
- **Escalation** — a role granting permissions the actor does not themselves
  hold. An administrator already holds everything, so there is nothing to
  exceed and the check is skipped for them.
- **Unreadable permissions** — for either the actor or the role. A change made
  on a guess is worse than no change.

### What the bot does

`apps/bot/src/features/roles/member-roles.ts`:

1. Takes the existing per-member Redis lock, so two edits cannot interleave.
2. Checks the **bot's** own `Manage Roles` and hierarchy first — without it
   every later check is academic. This is the half of the check the brief
   asked for that a purely server-side implementation would have missed.
3. Re-reads the target from Discord with `force: true`, so the decision is made
   from Discord's current roles rather than a possibly-stale stored row.
4. Applies the plan, then **re-reads the member again** and writes that to the
   roster. The dashboard's next view comes from Discord's answer, not from
   what we hoped happened — no optimistic UI.
5. Audits actor, target, and how many roles were added, removed, refused and
   failed.
6. Refuses the server owner and Orbit itself.

Per-role results on partial failure come from applying each direction as one
call and, if it throws, retrying role by role so the operator is told _which_
role failed rather than the whole change looking broken.

### Wiring

POST `/api/guilds/:id/members/:userId/roles` with `mode: "offer"` or `"apply"`.
An apply is deduplicated on an `Idempotency-Key` header, so a double submit
cannot race itself; an offer is always fresh, because it must reflect the
hierarchy right now.

The `member-roles` action is exempted from the consumer's blanket Manage
_Server_ gate. That gate is broader than Discord's own rule and would have
blocked people Discord would happily allow; this action does its own, more
precise check instead.

### The editor

`apps/web/components/member-roles-editor.tsx`: a searchable picker seeded from
what the bot says is assignable (only the bot knows the live hierarchy), a
pending-change summary, a confirmation step once more than one role is
involved, and per-role reporting of what was refused, what Discord refused,
and what landed. On success it refreshes the roster rather than patching the
row.

Roles outside the offer are never shown as "being removed" — they are simply
not ours to touch, and implying otherwise would promise a change that will not
happen.

### Honest demo behaviour

In demo mode the endpoint returns `accepted: false` with an explanation rather
than a fake success. There is no live hierarchy to check, and pretending
otherwise would be the worst kind of demo.

### Conversions to the shared badge

- `music-page.tsx` — the "who's on the decks" summary now uses `RoleBadge`,
  and the DJ role picker shows a role dot. `Combobox` gained a generic
  `leading` node so pickers can draw a role without that component needing to
  know what a role is.
- `permission-setup.tsx` — the protected-roles list uses `RoleBadge`.

**Left alone, deliberately:**

- `template-builder.tsx` is a role _editor_ (name and colour fields), not a
  badge.
- `templates-page.tsx` maps roles through a native `<select>`; `<option>`
  cannot contain a node, and the comment there records why it stays a select.
- `module-setup.tsx` turned out to have no role rendering at all — its only
  match was a docs link. Nothing to convert.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean on every touched file.
`format:check` clean. `build:web` succeeds. `npm test`: **1116 passed / 87
files** (was 1096 / 86), +20 from the new planning tests.

### Not verified

No browser is available, so the editor dialog has not been looked at. No live
Discord server was available either, so the mutation path has **not** been
exercised against the real API — the rules are tested exhaustively, but
Discord's own response to a real role change is unproven here. That is the
first thing to check on a disposable server.

---

## Slice 13a — the leveling curve, the schema and the award path

Section 2, first slice. This one is the foundation: the curve every level,
reward and leaderboard reads, plus the storage that has to make awards exactly
once.

### Research (checked 2026-10-27)

**MEE6** documents the per-level cost as `5 * lvl^2 + 50 * lvl + 100`, where
`lvl` is the _current_ level, and publishes a table whose first row is "level
0, 100 needed, 0 total". Source: `github.com/Mee6/Mee6-documentation`,
`docs/levels_xp.md`. Message XP is a random 15–25, once per 60 seconds.

**Carl-bot** documents the same per-level cost, the same 15–25 default range,
and a cumulative closed form of `(5/3)n^3 + (55/2)n^2 + (755/6)n + 100`.
Source: `github.com/botlabs-gg/carlbot-docs`, `docs/levels.md`.

**The two cumulative formulas are not the same polynomial, and that matters.**
Carl-bot's `n` is one behind MEE6's level: `carl(n)` returns what MEE6 calls
the total for level `n + 1`. Both sources describe the same curve; they index
it differently. Copying either formula without noticing this produces a
leveling system that is exactly one level out. `totalXpForLevel` is indexed the
way MEE6's table is, and a test asserts the two readings agree under that
shift.

The closed form actually used is `(5/3)L^3 + (45/2)L^2 + (455/6)L`, verified
against the brute-force sum of per-level costs for every level from 0 to 1000.

**Dyno** was researched but its curve could not be verified: the search
returned only third-party comparisons and a documentation landing page, with
no published formula. Dyno's curve is therefore _not_ a source for this
implementation, and that is recorded rather than papered over.

**Voice XP**, from maintained implementations (Atlas, Wabbit, DraftBot,
PeakBot, and the `ironclad1/xp` reference bot):

- Awarded for **whole intervals only** — joining, leaving, moving or changing
  mute/deafen part-way earns nothing for that interval. Every maintained
  implementation does this, and any partial rule can be gamed at the boundary.
- The **AFK channel is excluded**, because Discord moves people into it
  automatically when they go idle.
- A **minimum number of humans** is required (two, in every implementation
  checked). Bots never count.
- **Voice States only**, never Presence — Discord deprecated using presence for
  this, and it cannot express mute.
- **Deafen excludes; self-mute usually does not.** This is the one place the
  sources genuinely disagree, so it is configurable, defaulting to allowing
  self-mute (a self-muted member is listening, not absent) and excluding
  deafen.
- Session caps exist in several implementations, because voice XP is otherwise
  the cheapest thing in the system to farm by leaving a client connected
  overnight.

### What was built

- `packages/core/src/leveling.ts` — the curve, its inverse, progress, seeded
  award rolls, and the voice eligibility and whole-interval rules. Pure, no
  Discord, no database.
- `packages/core/src/config.ts` — an `xp` module flag and an `xp` settings
  section, every field bounded.
- `packages/db/src/schema.ts` + `drizzle/0011_leveling_xp.sql` — four tables:
  totals, events (idempotency), voice sessions, and reward grants.
- `packages/db/src/leveling.ts` — the award path.

### Two properties that matter

**Awards are idempotent.** The unique index on `(guild, user, key)` is the
guarantee, not a check in application code. A redelivered gateway event, a
retried job or a restart mid-interval all collide and lose.

**Awards are atomic.** The total is incremented in SQL
(`total = total + amount`), never read into the application, added to, and
written back. A test fires three awards concurrently and asserts all three
land; a read-modify-write would silently drop two of them.

Neither is decorative — both are covered by tests that would fail if the
property were lost.

### A migration journal defect, found and repaired

`npm run db:generate` was failing before any of this work:

```
[drizzle/meta/0008_snapshot.json, drizzle/meta/0009_snapshot.json]
are pointing to a parent snapshot — a collision
```

Migrations 0008 and 0009 shared the **same snapshot `id`**
(`3b6592ae-87ce-426d-8c45-63c68450ef0e`), and 0009 pointed at 0007 as its
parent, skipping 0008. Migration 0009 is a data-only `UPDATE` that changes no
schema, so its snapshot was evidently written by copying 0008's file — `id`
included — rather than by drizzle-kit.

Repaired by giving 0009 its own id and re-linking the chain 0008 → 0009 → 0010. **No SQL changed, and the journal's tags and timestamps are untouched**,
so the runtime migrator (which tracks by journal tag) is unaffected; only
drizzle-kit's snapshot chain was broken. The snapshot files are metadata for
the generator, not something a database reads.

### A template schema coupling

Adding a module to the guild config broke two template tests: templates capture
configuration through a `.strict()` schema, so a new module key is an
"unrecognized key". Two changes:

- `xp` added to the template `modules` schema.
- An entry in the template's `omitted` list, because the XP _settings_ point at
  channels and roles by id and carrying them across would produce dangling
  references or reward levels against the wrong roles. The module travels as an
  on/off switch; the settings do not. Saying so beats shipping a template that
  half-applies.

Worth remembering: adding a config module means touching the template schema
too. The two are coupled by `.strict()`.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean on every touched file.
`format:check` clean. `npm test`: **1155 passed / 89 files** (was 1116 / 87),
+39 across the two new suites. `tests/database.test.ts` applies all eleven
migrations from an empty PGlite database, so 0011 is proven to apply from
scratch.

### Not verified

No live Discord server, so no message or voice XP has been earned for real.
The rules and the storage are tested; the gateway event handlers that call them
do not exist yet.

---

## Slice 13b — earning XP from messages and voice

### Message XP

`awardMessageXp` runs alongside moderation on `MessageCreate`, not inside it:
a message that trips a rule is still a message, and one handler throwing must
not stop the other.

The decision itself lives in `@orbit/core/leveling` as `messageEarns`, taking
plain data rather than a Discord `Message`, so every branch is testable. It
skips bots and webhooks per configuration, excluded channels and roles, and
anything under five characters — below that, "participation" is a single emoji
and the leaderboard starts measuring keystrokes.

The idempotency key is the message id. An **edit fires `MessageUpdate`, not
`MessageCreate`**, so an edit cannot earn twice, and a redelivered event
collides and loses.

**Deletion does not claw XP back.** Reversing an award would make a member's
level oscillate on someone else's delete, and would let a member farm and then
scrub their way to a clean history. The award stands — and since XP cannot be
spent, a clawback would only ever be cosmetic anyway.

Repetition protection keeps a **fingerprint of the normalised content, never
the content**. The XP tables were at risk of becoming the most sensitive data
in the database; they now only ever answer "is this the same message as last
time".

### Voice XP

`VoiceStateUpdate` opens, closes and reopens sessions — a channel move is a
leave and a join, which is what makes "in one channel for the whole interval"
a meaningful question. A 30-second ticker pays out.

The award key is derived from the session's own start and interval length
rather than from "now", so a restart or a duplicate tick cannot invent a new
key for the same interval and pay twice.

**The restart rule is the important one.** On startup every open session is
marked broken, because nothing that happened while the process was down can be
vouched for. Without this the bot would wake up, see a session that began six
hours ago, and credit offline time. The next award waits for a whole interval
that was actually observed.

The AFK channel never earns, but its session stays open so moving back to a
real channel resumes cleanly. A session cap is enforced before the award, and
the interval is still recorded so the window advances rather than leaving the
member stuck on one interval forever.

`GuildVoiceStates` and `MessageContent` were both already in the gateway intent
list, so no intent change was needed.

### Command module root

`xp` registered in `CommandModule`, `moduleRoots` and `commandModuleLabels`.

The XP leaderboard is called **`top`, deliberately not `leaderboard`** — that
root already belongs to the economy, and two modules shipping the same root
would make the help catalog and autocomplete ambiguous. Planned roots: `rank`,
`top`, `xp`.

### Two couplings worth knowing about

`GuildConfig` in `packages/core/src/types.ts` is maintained **by hand** next to
the zod schema in `config.ts`. Adding a module means editing both, and the
compiler only catches it indirectly. The same is true of
`CommandModule`, which is derived from `ModuleKey` — adding a module
immediately breaks the command catalog, the help docs map and the overview
toolkit, which is a useful forcing function but a noisy one.

### Corrected expectations

`tests/bot-maintenance.test.ts` asserted the maintenance loop creates exactly
three timers. It now creates four, because the voice ticker is owned there like
the others so a shutdown clears it. Updated to 4 with a comment rather than
worked around — the test's intent (every timer is cleared on abort) is
unchanged, and the final assertion that zero remain after abort still holds.

A test also caught the implementation disagreeing with its own documented
intent: `cooldownElapsed` returned false for a negative elapsed time, which
would lock a member out of XP for as long as a clock skew lasted after a
restored backup or an NTP step. The implementation now matches the comment.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean on every touched file.
`format:check` clean. `build:web` succeeds. `npm test`: **1168 passed / 89
files** (was 1155 / 89), +13 for the message eligibility, cooldown and
fingerprint rules.

### Not verified

No live Discord server, so no message or voice XP has been earned for real.
The rules are tested and the gateway handlers are wired, but Discord's actual
event stream is unproven here. The commands (`rank`, `top`, `xp`) are
registered in the catalog but **not yet implemented**, and the dashboard has no
leveling surface yet.

---

## Slice 13c — `/rank`, `/levels`, `/xp`

### The leaderboard root had to be renamed twice

The brief only warned about colliding with the economy's `leaderboard`. Two
names were rejected in the end:

- **`leaderboard`** — already the economy's root. Two modules shipping the same
  root would make the help catalog and autocomplete ambiguous.
- **`top`** — `/timeout` already exists and **contains** it. The `/help`
  overview test, which counts how often a root name appears, caught this: `/top`
  matched twice, once inside `` `/timeout` ``. Anything matching command names by
  substring would confuse the two.

The root is **`levels`**. That test earned its keep here.

### Authorization is re-checked server-side

`/xp` sets `defaultMemberPermissions(ManageGuild)`, but the handler checks the
actor's guild permissions again. That Discord field is a hint to the client — it
hides the command in the picker and nothing more. A hand-crafted interaction can
carry any name, so the bot treats the client's claim as a claim.

Adjustments are audited with the actor, the target and the change, and keyed on
the interaction id so a retried interaction cannot adjust twice.

`set` is stored as the **difference** to the current total, not as an
assignment: setting 1000 when a member has 400 records `+600`. That keeps the
adjustment reversible in the audit trail and keeps `adjustedXp` meaningful.

### Showing both XP numbers

`/rank` deliberately shows _"reaching level N has cost X in total"_ alongside
_"the next level costs Y"_. Conflating those two is the most common way to get
a leveling system wrong, and showing both is the cure — it is also the thing
the two published sources index differently.

### More couplings

`HELP_ORDER` in `replies.ts` is another hand-maintained list keyed on
`CommandModule`. Missing `xp` there made the whole group vanish from `/help`
silently, with no type error — it is a plain array, not a `Record`. Adding a
module now means touching: the zod config schema, the hand-written
`GuildConfig` type, `ModuleKey`, `commandModuleLabels`, `moduleRoots`,
`MODULE_DOCS` in `help.ts`, `HELP_ORDER` in `replies.ts`, and the overview
toolkit's module cards. Six of those are compiler-enforced; `HELP_ORDER` is not.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean on every touched file.
`format:check` clean. `build:web` succeeds. `npm test`: **1182 passed / 90
files** (was 1168 / 89), +11 covering `/rank`, `/levels` and the `/xp`
authorization path — including that an actor without Manage Server is refused
and no award is made.

### Not verified

No live Discord server, so none of these commands have been run against the
real API. The handlers are tested against mocked storage; Discord registration
and the interaction round-trip are unproven. The dashboard still has no
leveling surface.

---

## Slice 13d — level rewards (stack or replace, reconcile, announce)

### Ordering is what satisfies the two requirements that pull against each other

The brief wants _no duplicate rewards or announcements on retry_ **and**
_announcement failure never loses XP_. Those fight, and the order resolves them:

1. XP is awarded and committed **before** reconciliation is attempted.
2. Each grant is **recorded first**, then announced.

So a crash between recording and announcing loses an announcement — never a
reward. And a retry sees the recorded grant and does nothing, so nothing is
announced twice. A refusal is recorded too, with its reason, so the dashboard
can say why and a later reconcile can retry once the configuration is fixed.

A failure anywhere in reconciliation is caught at the top and logged. It is a
consequence of earning, not a condition of it.

### Administrator has no override

`rewardRoleIssue` refuses a role carrying Administrator, and there is no
configuration that can ask for it. Reaching a level must never be a route to
the server's highest permission — a leveling system is the wrong thing to
control that, and it is exactly the kind of thing someone would configure
without thinking.

The same function refuses `@everyone`, integration-managed roles, roles at or
above the bot's own, and a bot without Manage Roles.

### Stack versus replace

- **Stack** (default) — every reward up to and including the current level is
  held. Members read a stack as a record of what they passed through.
- **Replace** — only the highest tier reached is held; earlier ones are removed.

Revocation only ever removes roles **this bot granted**. A role a member holds
for any other reason must survive a reward configuration changing underneath
them.

### A deleted reward role is reported, not dropped

A reward whose role has vanished from the server is returned in
`missingRole` and logged, and is **not** recorded as a refusal. Recording it
as refused would mask the real problem, which is a dangling configuration.

### Multi-level jumps

`owedRewards(level, rewards, stack)` is computed from the member's level, not
from a delta, so a jump from nothing to level 20 grants all three rewards in
one pass. Nothing depends on observing each level boundary as it is crossed.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean. `format:check` clean.
`build:web` succeeds. `npm test`: **1212 passed / 92 files** (was 1182 / 90):
+17 pure policy tests, +13 against a fake guild covering the multi-level jump,
the already-granted case, deleted roles, Administrator, bot reach, missing
Manage Roles, a refused role add, a failed announcement, and both stacking
modes.

One test was written against a hand-made level table that did not match the
curve; it is now derived from `totalXpForLevel` so it cannot drift.

### Not verified

No live Discord server, so no reward role has actually been granted or
announced through the API. `reconcileRewards` is tested against a fake guild;
the shape of Discord's permission and hierarchy checks is modelled, not
proven. The dashboard has no reward editor yet, so `rewardStack` and the
announcement message can only be changed in the database.

---

## Slice 13e — the leveling dashboard and `docs/LEVELING.md`

### The documented curve table was wrong, and it now cannot be

`docs/LEVELING.md` prints concrete numbers. They were written out by hand from
the closed-form formula and **eight of the nine rows were wrong** — the level-1
row claimed reaching level 1 costs 155 XP when it costs 100, and the error
compounded all the way up (level 100 was out by ~170,000 XP).

The cause is a real off-by-one in how the two functions relate, and it is
exactly the confusion the doc warns about:

- `totalXpForLevel(n)` — XP to *reach* level n.
- `xpForLevel(n)` — XP to *leave* level n, i.e. `5n² + 50n + 100`.

`total(n+1) = total(n) + cost(n)`. Writing "level n costs 5n²+50n+100" without
saying *to advance from it* invites the wrong reading.

The table is now generated from the functions and pinned by two tests: every
documented row matches, and `total(n+1) = total(n) + cost(n)` holds for
n = 1…200. The doc says which number is which.

### The leaderboard joins the roster, and does not invent names

XP rows carry a bare user id — the storage layer deliberately records no name,
so it cannot show a stale one. The dashboard joins each row against the
synchronized roster in the same batched read the economy already uses (no
request per row). A member with no roster row — someone who left, or a server
that has never synced — is shown as an id rather than a guessed name.

### `HELP_ORDER` was one of six lists, and the only silent one

Adding a module means touching the zod config schema, the hand-written
`GuildConfig` type, `ModuleKey`, `commandModuleLabels`, `moduleRoots`,
`MODULE_DOCS`, `HELP_ORDER` and the overview toolkit. Six of those break the
build when missed. `HELP_ORDER` is a plain array rather than a `Record`, so
missing `xp` there made the whole group vanish from `/help` with no type
error — it took the help-overview test to surface it.

### The page

Three tabs. **Leaderboard** (rank, identity, level, progress bar, total, and
the message/voice/adjusted split). **How levels work** — the curve, with both
numbers side by side and the note about which is which. **Role rewards**, with
the total XP each one takes.

Settings cover: message range and cooldown, voice interval/cap/participants and
the four mute-deafen eligibility switches, excluded channels and roles, the
stack-or-replace choice, reward editing, and the announcement channel plus a
**live preview** rendered by the same function the bot uses.

### Verification

Typecheck clean. `eslint --max-warnings=0` clean. `format:check` clean.
`build:web` succeeds. `npm test`: **1214 passed / 92 files** (was 1212 / 92),
+2 pinning the documented curve.

### Not verified

**No browser was used on the new page.** It typechecks, lints and builds, but
nothing about it has been looked at — layout, tab behaviour, the settings
dialog, the announcement preview and the progress bar are all unreviewed. The
page has never been loaded against a real guild, so the shape of the data
reaching it (`data.xpBoard`) is asserted by type but not observed. Member XP
detail linked from the member page is still unbuilt.
