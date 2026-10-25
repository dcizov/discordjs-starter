# Dashboard UX: audit identity, music state, first-visit tour, hero animation

Date: 2026-10-25. Branch: `arena/99c6cf65-discordjs-starter`.

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
- Economy leaderboards (`accounts`) still store no avatar hash, so those lists
  keep initials. Adding one would require syncing member metadata that the bot
  does not currently persist for every rewarded member.
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
`tests/e2e/tour.spec.ts`, which was **not executed** in this environment (no
browser binary available; see the continuation report).

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
