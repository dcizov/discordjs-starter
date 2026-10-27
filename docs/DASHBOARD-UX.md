# Dashboard UX: audit identity, music state, first-visit tour, hero animation

Date: 2026-10-25 (audit identity, music state) · 2026-10-27 (economy identity, table composition).
Branch: `arena/99c6cf65-discordjs-starter`.

## Pass 9 — who people are, and how lists behave

### Economy identity is now recorded, not guessed

**Gap.** The audit log could show a recorded avatar, but the economy leaderboard,
the transaction history, the music queue and the member picker could not: the
`accounts` row stored a display name and nothing else, the ledger had no place
for a picture, and a transfer recipient was stored as a raw user id until they
interacted themselves.

**What changed.**

- `accounts.avatar` (nullable `text`, migration `drizzle/0006_accounts_avatar.sql`)
  stores the avatar **hash** captured from the member object on the daily,
  activity, transfer and purchase paths (`packages/db/src/economy.ts`, callers in
  `apps/bot`). An interaction that carries no hash never erases a stored one, and
  a transfer recipient is created with their display name and hash when known.
- `loadDashboard()` adds `avatarUrl` to every account (and to the wallet) through
  the same `userAvatarUrl()` helper the audit log uses: the URL is derived from
  the stored hash on the server. There is no per-row Discord request and no new
  OAuth scope.
- The paged `/api/guilds/:id/history` response for `kind=audit` now includes
  `actorAvatarUrl`. The audit table is built from that endpoint (not from the
  snapshot), so before this its avatars could not appear at all.
- `components/identity/identity-cell.tsx` is the one identity cell used by the
  leaderboard, ledger, audit rows, moderation cases and music queue: 24 px slot,
  `object-cover` cropping, truncating name, optional marker ("You") and a second
  quiet line. `ActorAvatar` keeps three cases apart — a recorded picture, an
  Orbit/system glyph, and honest initials with "no avatar captured"/"no avatar
  recorded" when nothing was ever stored.

**Policy.**

- *Current identity* (leaderboard, transaction history, member picker, account
  menu): whatever the bot last captured for that account. It is refreshed the
  next time the member earns, spends or receives something; no profile is
  fetched to decorate a list.
- *Historical identity* (audit rows and their detail dialog): the hash recorded
  with the action, never overwritten by a later profile change. A row written
  before avatars were captured keeps initials and says so.
- An unusable hash yields `null` rather than a URL that would 404, and demo
  illustrations are the only local paths accepted.

### Table composition

Every dataset table renders one shared foundation
(`apps/web/components/data-table.tsx` + `table-facet.tsx`):

- **One toolbar**: search on the left, faceted filters (single-choice, because
  the history API filters one value) with counts only where they are known, a
  Reset that appears only when a filter is active, and view options plus real
  actions on the right.
- **One footer**: a single range sentence ("Showing 1–7 of 24"), rows-per-page,
  and first/previous/next/last controls that stay visible and disabled when
  everything fits on one page. There is no second "N records" line and no
  selected-row count, because selection is not offered.
- **Honest modes**: TanStack Table owns sorting and paging for a complete client
  list (leaderboard, channels, roles); for server-paged data (audit, ledger,
  deliveries, cases, wallet history) it runs in manual mode and only reports
  intent, so a page of seven rows is never re-sorted in the browser and called
  "sorted by date". Client sorting uses stable columns and row ids derived from
  the domain (user id, channel id, resource id).
- **States**: loading dims the body with `aria-busy`, a failed request shows the
  error with a retry instead of an empty table, and a zero-match search says
  "No records match" while keeping the search and filters reachable.
- **Column controls**: a "Columns" menu that cannot hide the row's identity
  column; numeric columns are right-aligned and tabular.

Reference mapping (shadcn *tasks* table): search toolbar ✔, faceted filters ✔
(counts only when known), column visibility ✔, sortable headers with `aria-sort`
✔, pagination + page size + disabled edge states ✔, row actions ✔, tabs with
counts where a real count exists ✔. Deliberately absent: row selection and bulk
actions (no dataset has a safe multi-row operation; audit rows are append-only
evidence), drag-and-drop (no persisted ordering), and the task-specific
priority/status/label columns (Orbit has no such fields).

## Audit identity images

**Problem.** "Around the community" and the audit log drew a coloured letter for
every actor, so a real avatar was never shown.

**What changed.**

- `audit_logs.actor_avatar` (nullable `text`, migration
  `drizzle/0003_audit_actor_avatar.sql`) records the actor's avatar **hash** at
  the moment the action is written. Callers that already have the value pass it:
  the dashboard actor (session profile), a failed slash command (`i.user.avatar`),
  a failed dashboard job (cached Discord user, no extra REST call), and a failed
  SponsorBlock setup (`member.user.avatar`).
- `loadDashboard()` resolves `actorAvatarUrl` from the row itself via the
  existing `userAvatarUrl()` helper (`cdn.discordapp.com/avatars/…webp?size=128`
  with the URL-keyed Next `remotePatterns`). There is no per-row Discord request
  and no new OAuth scope.
- `components/features/overview/overview.tsx` and `server-pages.tsx` use the
  existing `IdentityImage` primitive: fixed 28 px slot, real image when
  available, initials fallback when the hash is missing or the request fails,
  and the Orbit mark for system entries.
- The audit page states plainly that names and avatars are **recorded when the
  action happens** and are not refreshed afterwards.

**Documented limits.**

- Recorded, not current: a later avatar change does not rewrite history, and the
  UI says so.
- Deleted or unknown users keep initials; no avatar is invented.
- Economy lists show the hash captured on the member's last economy
  interaction, which may lag a recent avatar change; it is refreshed by that
  member's next daily/activity/transfer/purchase. Rows never trigger a lookup.
- Community post audit rows still store the actor's snowflake as the display
  name (pre-existing behaviour in `packages/db/src/community.ts`); the avatar is
  not available at that layer. This is a known data-quality gap, not a UI bug.

Demo mode uses four original local illustrations (`/demo/jamie-davis.svg`,
`alex.svg`, `sophie.svg`, `milo.svg`) for its fictional personas; live mode never
accepts a local path as avatar metadata.

## Music: state, progress and volume

**Empty player.** The primary transport button used a filled primary style with
a Pause glyph even when nothing was playing (disabled, but visually active). It
now renders an outline, muted button labelled "Nothing is playing" when
`current` is null, and the progress bar reports the same through
`aria-valuetext`.

**Progress.** `playbackProgress()` (`packages/core/src/music-progress.ts`) is
pure and unit-tested:

- uses the persisted `position` with the snapshot's `updatedAt` timestamp,
- interpolates only while `current` exists **and** `paused` is false, and never
  when the snapshot time is in the future or unparseable,
- clamps to `[0, duration]` and ignores a stale position after stop,
- returns `duration: null` / `percent: null` for unknown durations (live
  streams) instead of dividing by zero.

The page reads that clock through `usePlaybackNow()`, which starts as `null`
(server and first client render agree — no hydration drift), ticks once per
second only while playing, and stops for paused/idle players.

**Volume.** The old slider sent a request on every pointer-up and key-up, showed
the stale server value while the bot was working, and only then snapped back.
`VolumeControl` now:

- updates the thumb locally on every input event,
- commits **one** debounced request (400 ms) per interaction, flushed early on
  pointer-up/blur,
- ignores responses from superseded commits (sequence guard),
- keeps the optimistic value while a live job is only _queued_, and clears it
  once the refreshed snapshot agrees,
- rolls back with a toast on failure,
- disables itself with an explicit reason when no player exists in live mode
  (the bot cannot apply volume without a player) or while another action runs,
- exposes `aria-label`, `aria-valuetext`, `aria-describedby` and a polite status
  region.

Wording is deliberate: live actions wait for the bot's job, so a completed job
reports "applied"; a bare acceptance would report "sent to the bot". The page no
longer claims the bot "completed" an action it merely queued.

## First-visit tour

`components/layout/first-visit-tour.tsx` + `tour-model.ts`:

- Opens after the workspace has hydrated and the guild is installed; six steps
  cover server selection, modules, channels/permissions, news/deals, Discord
  voice requirements and help/status.
- No spotlight selectors: each step is text plus an optional shortcut button, so
  a missing module, channel or permission cannot break it. It never writes
  configuration.
- `Skip`, `Back`, `Next`, `Finish`; Escape/close counts as a dismissal. Progress
  is an accessible `progressbar` with "Step n of 6".
- Stored per Discord user (`orbit:tour:v1:<userId>`), not per guild, so
  switching servers does not repeat it. The storage key carries the version
  (`TOUR_VERSION`); bumping it re-introduces the tour. Storage failures degrade
  to "shows again", never to an error.
- Replay from "A little help?" → "Replay the introduction".
- Radix Dialog supplies focus trapping, labelling and mobile sizing; the dialog
  disables its own animations under `prefers-reduced-motion`.

The policy (versioning, per-user scope, corrupt/unavailable storage, step
bounds) is covered by `tests/tour.test.ts`. The dialog interaction is covered by
`tests/e2e/tour.spec.ts`, which passes in CI's Chromium run alongside the music
specs (51 e2e tests green on `5665a71`); the authoring sandbox itself has no
browser, so local runs of that file are not available.

## Overview hero animation

**Likely cause of roughness.** The float animation was applied directly to the
`<img>` element, which renders an SVG containing static `feGaussianBlur` and
`feDropShadow` filters. Without a composited layer the browser can repaint (and
re-filter) that bitmap every frame, and the same element also carried
`opacity` utilities that change at breakpoints.

**Change.**

- The loop now lives on a dedicated wrapper (`.orbit-float-wrap`) and the `<img>`
  inside it is static, so the filtered SVG is rasterized once.
- Only `transform: translate3d(...)` animates — no layout-triggering property, no
  per-frame React state, no opacity animation.
- `will-change: transform` is scoped to the animated wrapper; it is removed under
  `prefers-reduced-motion` and below 640 px (cropped art, likely weaker device),
  where the animation is disabled entirely.
- The image declares `width`/`height` and `decoding="async"` to avoid layout
  shift.
- The same reduced-motion block disables the generic `.animate-in`/`.page-enter`
  fades and forces `scroll-behavior: auto`.

**Evidence limits.** This is a code-level optimisation; a before/after frame-time
measurement in DevTools on a low-powered device was not possible here (no
browser available in the sandbox). The user-facing preview should be checked on
the deployment hardware.

## Hydration warnings in the browser console

React hydration warnings mean the server HTML and the first client render
disagreed. They are worth fixing, but only once the cause is known — a warning
does not by itself prove that a component, an icon library or the activity chart
is nondeterministic.

**What was reported.** Console diffs on `/login` (the Lucide `Orbit` mark), on
dashboard routes (sidebar icons, identity images, the activity chart's `<stop>`
elements and `fill` attributes) that contained `--darkreader-inline-*` and
`data-darkreader-inline-*` properties, plus `style="color:transparent"` on
images. Next 16.4.3, Webpack build.

**What the evidence shows.**

- No application file emits a `darkreader` attribute, custom property or
  stylesheet rule. The names above are written by the **Dark Reader** browser
  extension, which rewrites the live DOM after the page has loaded. They cannot
  appear in server HTML because the extension is not running on the server.
- `style="color:transparent"` on an `<img>` is React's own hydration-inserted
  style for images (the same attribute is in a clean browser); it is not an
  extension artefact and not a mismatch by itself.
- The dashboard deliberately renders time-sensitive data from serialized server
  values: relative times are computed from `presentation.referenceAt`, and the
  activity chart exposes its labels/values/reference as `data-activity-*`
  attributes computed on the server. `tests/e2e/activity-hydration.spec.ts`
  checks that equality across three client timezones.
- The one place that did read the clock while rendering was the server's
  `retryAt` prop for `AuthProblem` (a rate-limit countdown). It was removed in
  pass 8: the page now passes only the serialized `retryAfterSeconds`, the first
  paint uses that number verbatim, and the deadline is resolved in a client
  effect. See [continuation, pass 8](CONTINUATION.md#pass-8-2026-10-26-fixing-what-the-new-checks-found).
- The only `suppressHydrationWarning` in the codebase is on `<html>`, where
  `next-themes` sets the theme class before React hydrates. It stays exactly
  that narrow.

So the reported diffs are **extension mutation**, not an app-owned mismatch. No
rendering behaviour was changed to hide them: there is no blanket
`suppressHydrationWarning`, no console filtering, no DOM script or
`MutationObserver` that strips extension attributes, no SSR opt-out and no
rewrite of Lucide or `next/image`.

**What the app does about it.**

- `<meta name="darkreader-lock">` is rendered once in the root layout (and
  hoisted into `<head>`). This is Dark Reader's documented opt-out for sites
  that already provide their own dark theme. It is a request, not a guarantee:
  a user whose extension is configured to ignore site preferences, or an
  extension version that re-applies styling after the page has settled, can
  still restyle Orbit. It never changes anyone's extension setting.
- `color-scheme: light` / `dark` is declared for the two themes, so native
  widgets (scrollbars, form controls, overscroll canvas) follow the active
  theme instead of staying light.
- Orbit ships its own theme toggle in the dashboard header, including the
  system setting; nothing depends on an extension to look right.

**What to do if you still see extension noise.** Disable Dark Reader for the
Orbit origin (or set it to respect site themes) and reload; then use the
dashboard's own light/dark toggle. If a warning remains with the extension
disabled, it is worth a bug report — include the route, the theme, and the
message.

**Verification.** `tests/e2e/hydration.spec.ts` loads `/login`, the dashboard
overview, identity images and the activity chart in a fresh browser context
(Playwright does not load extensions), captures every console message and page
error without filtering, and fails on hydration errors in light, dark and system
themes. A real Dark Reader run is **not** part of CI: it would need a persistent
Chromium profile with an unpacked extension, which this project does not set up.
Do not read a green test as "tested with Dark Reader".
