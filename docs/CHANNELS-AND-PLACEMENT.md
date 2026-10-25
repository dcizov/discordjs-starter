# Where to use each module

Requirements and recommendations are separated on purpose. A **requirement** is
enforced in code; if it is missing, the action fails with an explanation. A
**recommendation** is what usually works well in a real community — Orbit does
not enforce it, and it is not a readiness signal.

Nothing on this page proves that a live delivery, publication or audible
playback succeeded. Configuration plus synced permission bits only describe the
saved setup. Use **Test source**, **Send test message**, delivery history, the
audit log and the read-only music doctor for evidence.

## Permission model in one paragraph

Orbit needs its own role, placed **above** only the roles it assigns and below
the roles of the people who manage it. Server owners and members with **Manage
Server / Administrator** can always administer Orbit. Channel-level overwrites
that deny Orbit's role are respected: a category that denies **View Channel**
also hides every channel in it. `Administrator` never bypasses Orbit's internal
policy (protected roles, NSFW voice, publication safeguards). See
[PERMISSIONS.md](PERMISSIONS.md) for the exact bit mask and hierarchy rules.

## Commands

| Command                                                                                                        | Required                                                                                                                                                                                    | Recommended                                                                                                   | Never                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `/play`, `/search`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`, `/seek`, `/volume`, `/shuffle`, `/repeat` | A **normal voice channel** that Orbit can join (View Channel, Connect, Speak) and where the caller is present; music module enabled; Lavalink configured; DJ role satisfied when configured | A dedicated `#listening-room` voice channel with its own text channel for `/queue`; keep the channel non-NSFW | Stage channels (speaker promotion is not supported), NSFW voice channels, AFK channels, full channels without Move Members |
| `/deals search`, `/deals info`                                                                                 | Deals module enabled; `ITAD_API_KEY` on the server; commands registered                                                                                                                     | Run them in a public `#game-deals` text channel where replies stay ephemeral previews                         | Do not expect automatic posting from a search — that needs a subscription                                                  |
| `/deals feed`, `/deals watch`, `/deals pause`                                                                  | **Manage Server** at execution (even though the parent command is visible to everyone)                                                                                                      | `#game-deals` with Embed Links and Read Message History                                                       | Private channels the bot cannot read; announcements-only channels without Send Messages                                    |
| `/news list`, `/news test`                                                                                     | News module enabled; a source configured in that guild                                                                                                                                      | `#community-news` feed channel, and a separate `#staff` for tests                                             | Do not point a test at a public channel unless you want the test visible                                                   |
| `/poll`, `/announce`                                                                                           | Polls/announcement module enabled; a compatible text destination; **Send Polls** only for polls (deliberate channel opt-in)                                                                 | A dedicated `#announcements` or `#polls` channel; slow mode off                                               | Announcement channels for polls (interactive voting needs a normal text channel)                                           |
| `/roles`, `/role-panel`                                                                                        | A text destination with Embed Links (reaction mode adds Add Reactions, Read Message History)                                                                                                | `#roles` or `#pick-a-role`, pinned                                                                            | Do not publish panels where the protected role set includes staff roles                                                    |
| `/warn`, `/timeout`, `/kick`, `/ban`, `/purge`, `/cases`                                                       | Moderation module enabled; the bot's role above the target's highest role; specific permissions per action                                                                                  | A `#mod-log` audit channel, and a private `#mod-commands` channel                                             | Never give Orbit `Administrator` to "make it work"                                                                         |
| `/balance`, `/daily`, `/transfer`, `/leaderboard`, `/shop`, `/inventory`, `/transactions`                      | Economy module enabled; role rewards additionally need Manage Roles and hierarchy                                                                                                           | A `#economy` channel; keep transfers guild-scoped                                                             | No real-money gambling, no cross-guild balances                                                                            |
| `/ping`                                                                                                        | Nothing                                                                                                                                                                                     | —                                                                                                             | —                                                                                                                          |

## Modules

### News

- **Required channel type:** an ordinary text channel with View Channel, Send
  Messages, Embed Links (plus Read Message History if you want thread or
  reaction follow-ups).
- **Suggested placement:** one channel per audience (`#game-news`,
  `#community-updates`), with routing rules rather than duplicating a source.
- **Category overrides:** a category that denies View Channel wins. If Orbit
  posts nowhere, check the category first, then the channel.
- **Incomplete setup:** a starter source without a URL or app ID shows **Needs
  setup** and is skipped; a paused module keeps configuration but stops
  delivery.
- **Important distinction:** **Test source** fetches and parses only. **Send
  test message** publishes one message to the configured channel. Neither is a
  guarantee of scheduled delivery.

### Deals

- **Required channel type:** text channel with Embed Links.
- **Suggested placement:** a public deals channel for subscriptions, and a
  private staff channel for testing.
- **Filters:** region/currency/store settings change which offers appear;
  "historical low" is a provider field, not an Orbit estimate. If pricing is
  unavailable, the card says so instead of inventing a number.
- **Incomplete setup:** no `ITAD_API_KEY` on the server means search and feeds
  are unavailable; the setup guidance says so rather than showing an empty
  list.

### Music

- **Required channel type:** a normal voice channel; Stage channels are refused
  because speaker promotion and request-to-speak flows are out of scope.
- **Suggested placement:** a dedicated voice channel plus a text channel for
  commands. The dashboard is a remote control — it never streams audio.
- **Bot permissions in the voice channel:** View Channel, Connect, Speak. For
  routing a user into a full channel, Move Members (optional, and only then).
- **Caller permissions:** everyone in the bot's voice channel can control
  playback unless a **DJ role** is configured; members with Manage Server can
  always control it. If the configured DJ role is deleted, controls are limited
  to managers until a new role is chosen — access is never silently widened.
- **Incomplete setup:** no Lavalink means an explicit "not configured" error,
  not a silent queue entry.

### Polls and announcements

- **Required channel type:** an ordinary text channel. Polls need **Send
  Polls** in that channel (a deliberate opt-in), announcements need Embed
  Links.
- **Suggested placement:** a channel dedicated to announcements keeps the audit
  trail readable.
- **Publication safeguards:** drafts are previewed, published explicitly, and
  revised with conflict checks. An unconfirmed delivery is never reported as
  sent and never blindly resent.

### Roles

- **Required:** Manage Roles, and Orbit's role above any role it assigns.
  Protected/managed/elevated roles are refused even with Administrator.
- **Suggested placement:** `#roles` with a pin, one panel per purpose.
- **Incomplete setup:** a panel that references a deleted or protected role
  shows **Needs setup** instead of failing silently at click time.

### Moderation and economy

- **Moderation:** the audit channel is optional; the module and permission
  checks are not. Cases remain readable when the module is paused.
- **Economy:** role rewards need Manage Roles and hierarchy; item-only rewards
  do not. Ledger writes are atomic and guild-scoped.

## Where a dashboard action runs

Dashboard controls do not execute in the browser. A control submits an action,
the web route authorizes the member against Discord, the action is queued, the
bot re-checks the member, module, role and channel state, and only then talks to
Discord or Lavalink. The UI therefore distinguishes:

- **submitted / queued** — accepted for execution,
- **applied** — the bot reported success,
- **failed** — a specific, actionable error,
- **unconfirmed** — the outcome is not known; do not resubmit blindly.

For music, "applied" still means "the backend accepted the command"; audible
playback is a separate claim that only a live test can establish.
