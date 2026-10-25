# Opt-in community tools

Orbit now includes two complete, **disabled-by-default** modules: native Discord polls and one-time announcements. Existing installations acquire no automatic messages, new member/content collection, role assignments or moderation. [Feature research and priorities](FEATURE-RESEARCH.md) distinguish official product offerings from Orbit-specific usefulness judgments; they are not adoption rankings.

## Quick start — Docker host

Keep your existing private `.env`; never put credentials in a command, issue or browser bundle. Follow [development](DEVELOPMENT.md), [deployment](DEPLOYMENT.md) and [permissions](PERMISSIONS.md) for the intended application and server. Do not start a second gateway bot in the idle editor container.

```sh
# Applies the additive migration through the existing migrate service and starts
# the existing web, bot, worker, PostgreSQL and Redis services. No data reset.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live up -d --build

# Register once in the configured development guild/application. REST only:
# this does not start a second gateway connection. npm runs in the container.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live run --rm --no-deps bot npm run commands:register

docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live ps -a
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live logs --tail=100 web bot worker migrate
```

Add `--profile music` to your existing full-stack Compose invocation if you also use Lavalink. For the production image (without the TypeScript development CLI), command registration is `docker compose --profile live run --rm --no-deps bot node dist/register.js`. Registration replaces the application's command set in its configured scope; verify `DISCORD_CLIENT_ID` and the optional guild scope before running it. The Commands screen is a read-only catalog, **not proof of live registration**.

Migration `drizzle/0002_community_posts.sql` adds `community_posts`, its guild/idempotency/due/retention indexes and the own-ledger index. It does not drop, rewrite or seed existing data. The existing Drizzle migration journal/snapshot are updated. Legacy JSON configurations parse missing `polls` and `announcements` as false and `music.maxPerMember` as zero (unlimited); no configuration backfill or reset is required.

1. Sign into a server you can manage; both new modules initially say **Off until you opt in**.
2. Review **Channels & roles → Permissions** and the feature's setup guidance. Synced/sample metadata is not a live delivery check.
3. Deliberately enable the desired module in its page or Settings.
4. Create an **unsent draft**, choose an ordinary server text channel, and review its content/destination. Saving never contacts Discord.
5. Explicitly **Review & publish**, or schedule an announcement in UTC. The UI also previews the saved server timezone, independent of your browser timezone.
6. Inspect the resulting record and Audit. A saved draft, saved schedule or admitted queue job is not a confirmed Discord message.

Authorized records are server rendered and readable without JavaScript. The dashboard editor/actions require JavaScript; registered slash commands offer management alternatives. No entire-dashboard SSR disablement, hidden-until-mount content, hydration suppression or browser-clock initialization is used.

## Native polls

- A private manager label (80 characters), native question (300), **2–10 distinct answers** (55 each), integer **1–168 hours**, optional multiple answers. Text is normalized; role/user/everyone pings are suppressed.
- Ordinary guild text channels only in this release: not threads, DMs, voice text, forums or announcement-channel crossposts.
- The explicit publication uses Discord's native poll API, not a custom vote database or in-memory component collector. Voting continues across Orbit restarts. Published poll text/answers are immutable.
- **Refresh results** explicitly fetches the bot's recorded message and stores only an aggregate snapshot. Omitted results are **unknown**, not zero. Available ongoing counts are labeled approximate; Discord's finalized flag is preserved. No synthetic live vote counts.
- **End poll** ends voting early on a recorded message authored by the current bot. Refresh/close remain available while the module is paused; no new publication is permitted.
- Native polls are **not an anonymity feature**. Discord controls which vote information members can see. Orbit does not request/store voter lists or promise anonymous voting.

Manager commands (all ephemeral):

```text
/poll list
/poll publish post:<autocomplete a saved draft>
/poll refresh post:<autocomplete a published poll>
/poll close post:<autocomplete a published poll>
```

Autocomplete searches within the 20 most recent saved records of that kind. Use the dashboard's filtered/paginated records for older entries. Draft creation/editing is intentionally a dashboard workflow, not a large slash modal wizard. Registered definitions set Manage Server, and execution re-fetches the member/current permissions; a stale command visibility snapshot is not authorization.

## One-time announcements

- Title up to 80 and plain-text body up to 1,800 characters, rendered as a bot-authored embed with a dashboard preview.
- Publish now or schedule **1 minute–30 days ahead**. Input/command date is an explicit ISO-8601 UTC instant; the dashboard shows UTC and the configured server timezone with deterministic DST-aware formatting.
- The existing worker reconciles once per minute. Delivery is **not an exact-second guarantee**. A schedule more than 15 minutes late becomes **missed**, rather than flooding a channel after downtime.
- **Cancel schedule** changes the stored revision, invalidating old jobs. Pausing blocks new sends and preserves drafts/schedules. Cancel unwanted schedules before re-enabling: a due schedule still inside its grace window can then run.
- No repeating messages, personal/DM reminders, mass mentions, webhooks or automatic announcement-channel crossposting. No surprise delivery when merely saving a draft.

```text
/announce list
/announce publish post:<autocomplete a saved draft>
/announce schedule post:<autocomplete a draft> utc:2026-11-01T18:00:00Z
/announce cancel post:<autocomplete an unsent or scheduled record>
```

The timestamp above is an example, **not an instruction to send anything**. The server validates the schedule against the actual request time. The scheduling manager is revalidated at execution; leaving the guild or losing Manage Server blocks delivery. Editing/rescheduling records the new approving manager.

## Least privilege and execution boundaries

| Operation                                         | Human                                                                                                              | Bot/channel                                                                                         | Intents and scopes                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dashboard read/create/edit/schedule/cancel/delete | Current OAuth-managed guild (Manage Server or owner); server-side session/guild checks on every protected endpoint | None for storing a draft; selected channel must belong to this guild and be a supported destination | Existing dashboard `identify` + `guilds`                                                  |
| Publish a poll                                    | Fresh guild membership, Manage Server and View Channel                                                             | View Channel + Send Messages + **Send Polls**                                                       | Existing `bot` + `applications.commands`, existing Guilds intent; **no poll-vote intent** |
| Publish an announcement                           | Same fresh manager/channel check                                                                                   | View Channel + Send Messages + Embed Links                                                          | Same scopes/Guilds; no Manage Webhooks or privileged intent addition                      |
| Refresh/close a recorded native poll              | Same fresh manager/channel check, even while paused                                                                | View Channel + Read Message History; recorded message must be this bot's own poll                   | Same; no voter-list collection                                                            |

The minimal install mask remains **19456** (View Channel, Send Messages, Embed Links). Send Polls is `562949953421312`; grant it deliberately only in chosen poll channels. No automatic invite-mask widening, Administrator, Mention Everyone, Manage Messages, Manage Channels or Move Members grant. Category/channel overwrites still apply. The combined existing runtime's Members/Message Content privileged intents are unchanged; the new modules do not need them or a new Portal toggle. GuildVoiceStates remains nonprivileged. Role hierarchy protections in existing role/moderation features are unchanged and are not bypassed by Administrator.

Dashboard admission checks Redis for an actual bot action consumer using the existing bounded gate. No consumer yields 503 and does not enqueue. An admitted live action yields 202 plus an actor/guild-scoped receipt; the shared dashboard helper waits for **completed**, surfaces failures and treats an unfinished receipt as pending/unconfirmed, not success. The worker does not impersonate the bot or start another gateway. Manual publication expires after 30 seconds, rechecked after preflight and inside the atomic claim; delayed jobs cannot surprise-publish after a restart.

## Failure, concurrency and recovery

The table is guild scoped and versioned. Short transactions lock the guild and post, verify the current revision/module/install/state, enforce a 10-claim/server/hour audit-backed cap, and **commit the sending claim before external I/O**. A draft creation UUID deduplicates identical creates; an action UUID deduplicates one explicit dashboard intent. Scheduled jobs have stable record/revision IDs. Queue attempts are one, with bounded concurrency. Invalid, foreign, deleted or stale records cannot be retargeted by a UUID.

The feature-specific Discord REST client uses a 15-second timeout, zero 5xx/timeout retries, explicit rejection instead of SDK rate-limit requeueing, an AbortSignal and a stable message nonce with `enforce_nonce`. A definite preflight/HTTP 4xx rejection becomes **failed** and may be explicitly retried with a new intent. A timeout/network/5xx ambiguity becomes **unconfirmed** and **cannot be blindly edited or republished**. After two minutes, an abandoned `sending` lease is recovered to unconfirmed without creating another message. A late acknowledgement can settle the same claim.

There is no distributed transaction with Discord and no claim of mathematical exactly-once delivery. If unconfirmed, inspect the real Discord channel and Audit before making any new draft. Deleting the stored record does not recall a message. Loss of database settlement after Discord acceptance can leave a message present but the row unconfirmed; automated resend is deliberately forbidden. There is no unsafe generic “force retry” button.

Deleted channels, missing overwrites, removed managers, paused/uninstalled guilds, deleted/foreign messages and expired jobs produce explicit failures/missed states rather than success. Payload validation happens before a claim/send. Closing a poll when Discord is unavailable does not fabricate a final result. Cancel/pause cannot recall a Discord request already in flight; stop at the review screen if you do not want a live action.

Bounds: 200 stored records/server; at most 20/page (dashboard 12); maintenance at most 100 changes and 50 due schedules per minute, with the due query independently excluding the over-grace backlog. No per-guild scheduling timers, unbounded voter scans or transactions held over Discord requests. Multiple workers use row locking/CAS and stable jobs. Dashboard snapshots carry server-generated request timestamps so a slow older refresh cannot resurrect a locally cancelled record.

## Privacy, retention and deletion

| Data                                                                                                                     | Access / purpose                                                                                                                                   | Retention and deletion                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draft title/body/poll choices, guild/channel/message IDs, manager actor ID, state/revision/times, sanitized failure text | Authorized server managers via protected reads and bot management commands; job execution/diagnostics                                              | Live content is eligible for automatic deletion after **90 days without an update** by the running worker. This is not a hard deletion SLA when the worker is offline/backlogged. Explicit **Delete stored record** is available except during a scheduled/in-flight claim (cancel or settle first). |
| Poll aggregate counts, checked/expiry time and finalized flag                                                            | Managers explaining the latest explicit refresh; no per-voter records                                                                              | Deleted with the stored record. No new message-content/activity collection or poll gateway listener.                                                                                                                                                                                                 |
| Existing audit metadata: actor ID, post ID/kind/state/revision, event time                                               | Existing manager audit/history; quota enforcement                                                                                                  | **No title, body or question/answer text** is copied into audit. IDs persist under the existing audit retention policy (no automatic TTL in this release), even after the 90-day content cleanup or record deletion.                                                                                 |
| Own economy ledger                                                                                                       | A member's own private `/transactions`; own dashboard ledger for the currently authenticated manager. Existing broader ledger remains manager-only | Existing financial ledger retention is unchanged; no user-selectable account in the own-history endpoint.                                                                                                                                                                                            |
| Routing preview sample                                                                                                   | Current authorized manager and the response only                                                                                                   | Not stored, fetched, logged as content, enqueued or sent to Discord.                                                                                                                                                                                                                                 |

Guild removal marks Orbit uninstalled, blocks protected access/execution and is not an immediate data erasure promise. The worker still maintains expired/retained records; a database-owner deletion of the guild cascades community records through the foreign key. Existing audits, backups and third-party Discord messages have separate lifecycles: follow [security](SECURITY.md) and your deployment's access/backup erasure policy. Do not drop/reset a database to erase one record. Orbit cannot delete Discord's native vote information or promise deletion of a published message when only deleting its local record.

Demo is a separate local single-process JSON file (`DEMO_DATA_PATH` or `.data/demo.json`), not live PostgreSQL. It has **no worker/background delivery/automatic retention**; demo records remain until explicitly deleted or the operator deliberately resets only that demo file. Samples should never contain secrets or real sensitive personal data.

## Demo and example payloads

No credentials, Redis, Discord or publisher access is needed in demo. Modules still require explicit opt-in. Publish/refresh/close/schedule/cancel are labeled **Simulation**; poll counts are unknown, not invented. Scheduled records do not produce background messages. Live entry points reject the demo execution adapter and the demo adapter rejects live mode.

The runnable dashboard is `/dashboard/120000000000000001/polls` or `/announcements` in the seeded demo. Optional host-Node development (Node >=22.14) uses `DEMO_MODE=true npm run build` then `DEMO_MODE=true npm start`; Docker-only users should use the existing Compose demo workflow, with npm inside the image. Include demo mode at build time when you intend the iframe-friendly demo preview; live builds retain frame-denial headers.

Sanitized, non-sending request examples are in [examples/community-posts.json](examples/community-posts.json). The create endpoint is `POST /api/guilds/{guildId}/community` with a fresh `Idempotency-Key` UUID; editing is `PATCH /community/{id}` with `{ "version": 1, "input": ... }`. Actions are `POST /community/{id}/actions` with the current version. Do **not** copy an old version or resend an unconfirmed publication. Normal session, guild, origin, size and rate checks apply; examples are not public unauthenticated endpoints.

Actual demo screenshots are generated by `tests/e2e/community.spec.ts` into ignored `.artifacts/native-polls-demo.png` and `.artifacts/announcements-demo.png`. They are simulated flows, not live Discord evidence.

## Improvements to existing modules

- **Own transactions:** `/transactions page:1` returns at most 10 own entries privately, even when economy earning/spending is paused. The Economy page server-renders five own rows with normal pagination links; manager-wide history is unchanged. The SQL query bounds page size and selects `(guild_id, user_id)` with an additive index. Reward amounts, rolling daily and activity cooldown policy are explicit in the dashboard; no new passive data collection or reward was enabled.
- **Music fairness:** optional `music.maxPerMember` (default 0 = unlimited) counts only upcoming tracks attributed to that requester, not the currently playing track. The existing per-guild lock checks global and requester caps **before** playlist mutation/voice join. An over-cap playlist is rejected in full; unrelated voice ACK/ownership and provider policies are preserved. See [MUSIC.md](MUSIC.md).
- **News dry run:** the preview reuses the actual source/route matcher and deduplication planner, merges saved source tags, applies keyword-any AND tag-any, and explains last-matching-route settings. It uses one saved source and at most 100 routes, sample title 300/summary 1,200/tags 20×40; it accepts no arbitrary fetch URL. Editing inputs invalidates an old result; controls are disabled during the request. Stored permission metadata is present/missing/**unknown**, never live delivery proof. Existing SSRF, redirect, webhook and safe-mention policies remain in force. See [INTEGRATIONS.md](INTEGRATIONS.md).

## Verification and intentionally deferred work

Fresh executable results, environment limitations and starting/ending revisions belong in [COMMUNITY-REVIEW.md](COMMUNITY-REVIEW.md), not in historical test counts. Unit/service/SQL tests are distinguished from actual browser tests, real-service CI and authorized live Discord checks. No unrelated real community is used as a test target.

Prioritized backlog, **not implemented**: suggestions with an anti-brigading/moderation/deletion policy; burst-safe onboarding; private tickets with overwrite/retention recovery; then conditional levels/autoresponders/starboards/temporary voice. Also deferred: recurring/personal reminders, anonymous custom voting, voter exports, announcement crossposting, generic force-retry/reconciliation, and full dashboard no-JavaScript mutation forms. None is exposed as a placeholder module or enabled in existing guilds.
