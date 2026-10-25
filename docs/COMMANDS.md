# Dashboard command reference

Open **Commands** in the dashboard's server navigation (`/dashboard/SERVER_ID/commands`). The page lists the implemented slash-command invocations, including subcommands, and supports:

- Search by command, usage, description, argument, choice, or permission.
- Filtering by General, Self roles, Moderation, Economy, Music, Game deals, News & feeds, Native polls, or Announcements.
- Current server module switches, labeled **Module on / Module paused** (not an assertion that every read-only command is disabled).
- Exact usage copying; `<argument>` is required and `[argument]` is optional.
- Expandable argument types, constraints, choices, autocomplete, default member permissions, and execution-check notes.
- Loading, retryable failure, no-match, and mobile layouts.

## Source of truth and authorization

`packages/core/src/commands.ts` contains the actual Discord.js builders. The bot's existing `apps/bot/src/commands.ts` re-exports those builders, so `commands:register` and the server-side catalog use the same definitions. The catalog flattens subcommands and serializes arguments, bounds, choices, and permission masks from each builder's `toJSON()` result. Additional execution notes describe behavior not expressible as registration metadata, such as DJ/voice checks and the Manage Server restriction on `/deals watch`, `/deals feed`, `/deals pause` and `/news test`.

The authenticated, read-only endpoint is `GET /api/guilds/SERVER_ID/commands`. It uses the same server authorization, installed-bot guard, rate limiting, and no-store policy as the rest of the dashboard. Module state comes from the authorized server. Discord builders remain server-side; clients receive plain JSON only. No command is executed or registered by visiting the reference or copying usage.

## What it does not verify

This is an **implemented command reference**, not a query of Discord's current registered command registry. It does not prove that the running bot matches the deployed dashboard, that an operator registered the definitions, or that Discord has propagated a global update. The API explicitly reports `source: registration-definitions` and `registrationVerified: false`.

An operator registers commands from the same deployment. On a Docker-only host, use the direct Compose command (npm is **inside** the development image):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live run --rm --no-deps bot npm run commands:register
```

For the production image use `docker compose --profile live run --rm --no-deps bot node dist/register.js`. Registration replaces the configured guild/global command set, so verify the intended application/scope first. Do not run an extra gateway bot in the editor. Optional host-Node workflow:

```sh
npm run commands:register
```

Use the existing application token and registration scope configuration documented in the README. Never put credentials in browser code or clipboard examples. The reference itself works in credential-free demo mode without Discord requests.

Default permission flags describe registration defaults, not effective authorization. Discord's command overrides, current member/bot permissions, hierarchy, module settings, source/integration setup, and per-action checks still apply at execution. Read-only `/cases` and `/queue` can remain readable while their related action module is paused; their notes make this distinction explicit. A reference entry is not a promise of live music/source availability.

## Audit error copying

An audit detail dialog offers **Copy error** for a failed event (otherwise **Copy details**). It passes `AuditEntry.detail` verbatim to the clipboard, without truncation, reformatting, metadata prefixes, or visual line wrapping. **Copy full event** separately copies the stored event as formatted JSON. The complete recorded detail remains selectable if both clipboard mechanisms fail; the UI reports failure rather than showing a copied state.

New diagnostic audit details retain whitespace and are sanitized server-side before storage: known credentials, authorization fields, and URL query values are redacted, terminal controls are removed, and an explicit marker identifies details exceeding the 8,192-character bound. Copying does not undo that privacy protection or reconstruct older records that were already shortened. Backend logs may still be required to obtain a full Java exception chain.

## Discord reply presentation

Command replies use a shared embed formatter (`apps/bot/src/interactions/replies.ts`). Daily rewards and balances have currency fields; the leaderboard shows the top ten wallets; the queue shows current/upcoming tracks and music state; deals use rich artwork/rating/price cards and source/offer links; other commands use titled result cards. The new deals setup, preview and pause commands are detailed in [Game deals](DEALS.md). Technical failures appear in red embeds with fenced, sanitized multiline code blocks. Long diagnostics are shortened **before** closing the fence, and aggregate/per-field Discord limits are enforced. Give the bot **Embed Links** in command channels.

Embeds do not change visibility or permissions: replies remain ephemeral, mentions are disabled, and user-controlled labels are escaped. Existing guild/module, moderation, economy, DJ, and voice checks still run. Published role panels and scheduled channel deliveries keep their separate public-message behavior. Play confirmations mean the request was accepted, not that audio was heard. Audit storage/copying and the music doctor's JSON are not reformatted or shortened to fit an embed.

## New opt-in community commands

The shared definitions now contain **29 command roots / 44 flattened invocations**. New roots are `/poll`, `/announce` and `/transactions`; no live registration is claimed by this count.

- `/poll list|publish|refresh|close`: manager-only, saved dashboard records with bounded autocomplete; publication requires the enabled module and fresh View/Send/Send Polls. Refresh/close remain available while paused and require the bot's own recorded poll plus View/Read History. Native Discord handles voting; no custom collector needs to survive a restart.
- `/announce list|publish|schedule|cancel`: manager-only; one-time UTC schedule 1 minute–30 days ahead, current revision/actor revalidated at execution, late schedules expire instead of catch-up flooding. No mentions or webhook/crosspost requirement.
- `/transactions page:1`: private **own-account only**, 10/page, readable while economy is paused; no arbitrary-account option.

Draft creation/editing lives in the dashboard. Autocomplete is bounded to 20 recent records; use dashboard pagination for older records. [Community setup and examples](COMMUNITY.md) cover registration, precise permissions, disabled defaults, privacy, simulation and ambiguous-send recovery. A saved/queued action is not a successful publication; the shared receipt helper waits for actual completion.
