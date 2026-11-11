# WoW: Forever ruleset watching

`/wowforever` reports whether each WoW: Forever ruleset is up, and can
announce it in a channel when one changes.

**Read the "What this cannot see" section before you trust its output.** The
single biggest risk with a monitor like this is not that it misses an outage —
it is that it announces one that is not happening, or implies it knows about a
problem it cannot observe. A monitor that is wrong once in a visible way gets
muted, and the one thing worse than no monitor is one nobody believes.

## What it actually reads

The Battle.net Game Data API's ruleset endpoints:

- `GET /data/wow/ruleset/index` → the list of rulesets
- `GET /data/wow/ruleset/{id}` → `{ id, name, auctions, status }`

`status` is a type/name pair whose `type` is `UP` when the ruleset is up. That
is the entire signal. Everything below follows from how narrow it is.

The client is [`@pinta365/blizzard_api`](https://github.com/Pinta365/blizzard_api),
kept behind a two-method interface in `packages/core/src/wow-forever-client.ts`
so the failure paths can be tested without credentials.

## What this cannot see

This is the important part, and the reason every message carries a caveat.

**The ruleset `status` field comes from the web API. The error people hit comes
from somewhere else.** "This ruleset is temporarily unavailable" is produced by
the game's own login and character-creation services, which are a separate
system from the web API this reads. The two have disagreed: on 9 November 2026
the game was down during emergency maintenance with no evidence the web API
flipped. So this feature reports _a ruleset is not reporting UP_. It does not
report, and must never be described as reporting, that players are seeing the
error.

**Three look-alike messages are not the same thing.** Two of them are not
faults at all:

| Message                                           | What it really is                                                    | Visible here? |
| ------------------------------------------------- | -------------------------------------------------------------------- | ------------- |
| "This ruleset is temporarily unavailable"         | A server-side outage or maintenance                                  | Indirectly    |
| "This faction is currently unavailable…"          | A **deliberate** PvP faction-balance lock. Support cannot bypass it. | No            |
| "Creation of that type of character is throttled" | Load control under heavy creation, mostly Horde PvP                  | No            |

None of the three appears in any field this can read. The faction lock and
throttling are invisible; the outage is only inferred from a status field on a
different system.

## Three states, and why `unknown` never announces anything

A ruleset is `up`, `down`, or `unknown`. `unknown` covers two cases: the
ruleset's own request failed, or it reported no status at all.

**`unknown` never produces a flip, in either direction.** Collapsing it into
`down` would fire an outage on every rate limit and an all-clear on every
recovery. That failure mode — a monitor crying wolf — is why status monitors
get ignored, so the code refuses to do it rather than being careful about it.

**A failed poll is never an event.** No network, a rate limit, a 5xx: the
previous reading is kept and nothing is announced. An outage we cannot confirm
is not an outage.

**The first successful poll sets the baseline and stays quiet.** Without a
prior reading there is nothing to compare against, so "these rulesets are
down" would be a guess about how long they had been down — possibly for hours
before anyone asked. This is the same reasoning as priming a news source: the
state you discover on arrival is not news.

Baseline state is **in memory only**. A worker restart re-baselines, which
costs one quiet cycle. That is a fair price for not persisting a third party's
availability as though it were ours.

## Setup

1. Register a client at <https://develop.battle.net/access/clients>. It needs a
   Battle.net account with an authenticator attached and the Developer API
   Terms accepted.
2. Set on **both** the bot and the worker:

   ```
   BLIZZARD_CLIENT_ID=...
   BLIZZARD_CLIENT_SECRET=...
   WOW_FOREVER_REGION=eu      # us | eu | kr | tw
   ```

   Never `NEXT_PUBLIC_*`.

The ruleset endpoints are Game Data, so the **client credentials** flow is
enough — no player ever authorises anything, and there is no OAuth dance in the
product. Every request carries `Authorization: Bearer <token>`; query-string
tokens have been rejected since 30 September 2024, so there is no way around
this.

**Leave the two credential variables blank and nothing happens.** That is a
supported state, not a fault: the watcher skips without logging, so a
deployment that does not use this stays quiet instead of emitting an error
every five minutes.

## Using it

| Command               | Who           | What it does                              |
| --------------------- | ------------- | ----------------------------------------- |
| `/wowforever status`  | Anyone        | Current state of every ruleset, right now |
| `/wowforever watch`   | Manage Server | Announce changes in this channel          |
| `/wowforever unwatch` | Manage Server | Stop announcing                           |

`status` answers on demand without waiting for the next tick, which is the
point of having both shapes: an operator who has just been told "it's down"
wants an answer now, not in up to five minutes.

The region is per server, because rulesets are per region — an EU server
watching US rulesets would be told about outages nobody there can experience.
`WOW_FOREVER_REGION` is only the fallback for `status` before anyone has run
`watch`.

## How often

Five minutes, once per **region** and shared by every server watching that
region — not once per server. The answer is identical for all of them and the
API is rate limited. Five minutes is the compromise: observed outages have so
far lasted minutes to hours, so a tighter loop buys precision nobody needs and
spends rate limit doing it, while an hour would make a short outage invisible.

## Reading the output

- `All 21 rulesets are reporting up.` — the API says everything is `UP`.
- `20 of 21 reporting up.` followed by the named rulesets — the usual outage
  shape.
- The reported status is quoted verbatim (`reported MAINTENANCE`) rather than
  rendered as a word we chose, so a status Blizzard adds later reads as itself
  instead of being flattened into "down".
- `I could not check the rulesets.` — the poll failed. This is **not** an
  all-clear, and the command says so.

Every card carries the caveat that this is the API's view of the ruleset rather
than the login servers'.

## Not verified

The network path has never run against the live Battle.net API — no Blizzard
client was available while building this. What is covered by tests is the logic
around the API: state classification, flip detection, the never-announce-on-
`unknown` cases, and that a failed or empty poll is never rendered as an
all-clear (34 tests across `tests/wow-forever*.test.ts`). What is **not**
covered is whether the endpoints return what the community reverse-engineering
says they do, and the worker's announcement path end to end. Treat the first
real outage it reports as the first real test.
