# The listening room: Lavalink v4

Orbit uses **Shoukaku** as the Discord.js-to-Lavalink client. Lavalink handles source loading, encoding, voice connectivity, and Discord voice encryption. The dashboard is a remote controller; it never streams audio in the browser.

## Start the bot, not only the dashboard

`npm run dev` starts **only Next.js**. It does not handle Discord commands or
consume dashboard actions. Lavalink alone cannot do either. A `bot-1 exited
with code 143` line means that bot process stopped (SIGTERM); it does not
establish a provider failure or explain who stopped it. Both `/leaderboard`
and `/play` timing out is consistent with no running gateway consumer.

From the **Docker host**, with your existing live `.env` (`DEMO_MODE=false`,
Discord credentials, database settings and music password) already configured:

```sh
# Starts/rebuilds web, bot, delivery worker and their infrastructure together.
# Does not delete volumes, seed data, or register/replace Discord commands.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 web bot worker lavalink

# Confirm the bot is Up, not Exited (143), and web actually publishes :3000.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music ps -a
```

The bot now distinguishes **gateway connected / initializing** from
**Orbit is ready; dashboard action consumer is listening**. It also rejects a
`DISCORD_CLIENT_ID` that does not belong to the logged-in bot token. Keep
credentials server-side; do not paste them into chat/logs. If registration is
needed, use the container-side REST-only command in [the development guide](DEVELOPMENT.md#2-start-every-service) for the intended guild/application.
This is a gateway-based bot: leave Discord's **Interactions Endpoint URL**
empty rather than pointing it at an old/unimplemented HTTP endpoint.

For host development, run `npm run dev:bot` separately from `npm run dev` and
`npm run dev:worker`. In the Dev Container, the web service is already running;
start `npm run dev:bot` there **only if the Compose bot is stopped**. Never run
both copies. Opening the editor intentionally does not log a second bot into
Discord. See [development lifecycle](DEVELOPMENT.md) and [the editor guide](DEVCONTAINER.md).

The earlier `main` and `arena/752cdf1a-discordjs-starter` branches used
`npm run dev` for `tsx watch src/index.ts` — **the bot**. This monorepo deliberately
split those roles. Reusing the old command starts a different service; copying
their old PostgreSQL 18 volume layout would not fix that.

### Truthful dashboard receipts

- With no actual BullMQ `discord-actions` consumer, a live mutation returns
  **503** and is **not enqueued**. Redis consumer detection is bounded and needs
  Redis `CLIENT LIST` permission, not a recent-looking dashboard heartbeat.
- An admitted music job returns **202 Accepted** with a guild/actor-scoped
  receipt. HTTP 200 from a status poll does **not** mean the job completed.
- The UI only reports processing success after `state=completed`. Failures
  surface the sanitized worker error. After roughly 30 seconds without
  completion it shows an **unconfirmed/pending warning**, preserves the input,
  and does not display success. Do not blindly resubmit an active request.
- Music jobs still have **one attempt**. A request that waited over 30 seconds
  before execution expires before any voice/provider call, so restarting a
  stopped bot does not unexpectedly replay old play/skip requests. Existing
  old Redis jobs are rejected by the same execution-time check, not purged.
- Completion means the bot processed the control request, **not proof of audible
  sound**. Source playback exceptions are audited; inspect Now playing/queue,
  voice membership and Lavalink logs. No browser audio is played.

Both `/play` and `/leaderboard` defer an ephemeral Discord response **before**
member/database/backend lookups. Regression tests cover a deliberately blocked
member fetch. No code can acknowledge a gateway command while its bot is stopped.

## Start the optional backend

1. For a bot started with `npm run dev:bot` **on your host**, set these in the root `.env`:

   ```env
   LAVALINK_URL=localhost:2333
   LAVALINK_PASSWORD=<your strong generated password>
   LAVALINK_SECURE=false
   MUSIC_SEARCH_PREFIX=scsearch
   MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com,youtube.com,youtu.be,ocremix.org
   ```

2. Build/start the supplied **Lavalink 4.2.2 + Soundy AAC/fMP4 + nine reviewed plugins** image:

   ```sh
   docker compose --profile music up -d --build lavalink
   docker compose logs --tail=100 lavalink
   ```

   The first build downloads checksum-pinned plugin artifacts and the pinned Soundy source/Gradle dependencies, runs Soundy's offline unit tests, and packages the JARs into the official Lavalink image. Nothing downloads plugins at runtime. See [the plugin inventory/configuration](MUSIC-PLUGINS.md). Java/Gradle are not required on your host. No provider/Discord integration test runs during the build. The service publishes only `127.0.0.1:2333:2333`; its image-owned authenticated `/v4/info` healthcheck reports HTTP readiness (inherited by Compose). The same `/opt/Lavalink/healthcheck/run` is usable by other supervisors. The probe uses curl already verified in the pinned image; no host Java/curl/Node or extra runtime package is required. It sends the secret header via stdin, disables proxies/config/redirects, and accepts only HTTP 200. The superseded custom Java probe and compilation are removed.

3. Restart `npm run dev:bot` after `.env` changes. `Lavalink connected` verifies the WebSocket connection. The bot also explicitly requests `/v4/info` to populate backend/plugin versions; Shoukaku 4.3.0 does not populate `node.info` automatically. Metadata failures are logged and retried on the next lookup, without inventing a backend version.
4. When the bot runs **inside Compose**, the supplied environment selects `lavalink:2333` automatically when `LAVALINK_PASSWORD` is nonempty. `localhost` would refer to the bot container itself. The backend receives the same password. For the main bot with hot reload, see [Docker development](DEVELOPMENT.md#run-just-the-main-bot).
5. Give the bot **Connect** and **Speak** in a normal server voice channel, and **Embed Links** for rich command replies. Join the voice channel and use `/play`. Stage-channel speaker promotion is not automated.

`ECONNREFUSED` means there is no reachable listener; check startup, address, and ports. An authentication failure means the bot/backend passwords need to match. Neither is the same as a provider's error after a successful connection.

## Backend availability is not a Discord Portal permission

The bot can be gateway-ready and handle `/deals` while its independent Lavalink connection is down. An error **before track lookup/voice join**, especially `ECONNREFUSED`, is not repaired by enabling another Discord privileged intent, granting Administrator, changing the Interactions Endpoint URL, or publishing extra audio ports.

The reported cold-start sequence exposed a reproducible **Shoukaku 4.3.0 retry bug**: its `Node.connect()` saves a failed attempt in `connectError`, later successfully opens a WebSocket, but never clears that old error. It then closes the newly working socket (often close code 1000), removes the node from its pool and stops reconnecting. A normal-looking "connection successfully established" in Lavalink's log alone was therefore not enough. Offline tests reproduce the defect using the actual installed library and real loopback WebSockets.

Orbit now uses one connection attempt per Shoukaku call and supervises calls with a **5 → 10 → 20 → 30 second capped backoff**, continuing after extended downtime. It retains the node/REST identity and resumable session, refreshes metadata on ready, and cancels retries/sockets on shutdown. A configured-but-disconnected backend is labeled **retrying**, not "configure Lavalink". Music control jobs are still **not retried**. If a restarted backend cannot resume its previous session, stale local players/queue snapshots are cleared instead of pretending they are playing or automatically replaying tracks.

Compose also waits for Lavalink's authenticated readiness when the music profile is active. The dependency is optional: a missing/failed music service does not permanently block the non-music bot features. Recovery still matters for later backend restarts and host/editor-run bots; readiness ordering alone does not fix a retry bug.

### Recover an existing Docker development stack

Keep your existing `.env` and data. Pull the updated working branch, then run from the **Docker host**:

```sh
# Stop the old gateway process, not the database/worker. No volume reset.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music stop bot
# No service list: bring up/rebuild the whole enabled stack, including bot/Lavalink.
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music ps -a bot lavalink
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 bot lavalink
```

**`up ... web worker` only targets web/worker and their dependencies.** Merely passing `--profile music` enables that profile; it does not start every service when an explicit service list is supplied, and it does not restart an already-stuck bot. Expect Lavalink **healthy**, then bot **Lavalink connected** and **Lavalink metadata loaded**. No schema migration, volume deletion, new credentials or command re-registration is required for this fix.

For a read-only authenticated REST check from the bot's Docker network (npm runs **inside** the one-off container; no second Discord login):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run music:doctor
```

`music:doctor` success verifies REST/metadata, not the running bot's WebSocket or audible voice playback. Check both doctor output and the bot's connection logs. HTTP 401 means password mismatch; do not paste credentials or raw voice/session logs.

### Discord permissions that actually apply to voice

- **Guild Voice States** is a normal, non-privileged gateway intent, already requested in code; it has no privileged-intent switch to enable in the Developer Portal.
- The invited bot needs **View Channel, Connect and Speak** in the chosen ordinary voice channel, including its channel overrides. Choose a non-full/non-NSFW channel. Administrator is not necessary.
- **Embed Links** is needed in text destinations for rich replies. `bot` and `applications.commands` are the invite scopes.
- This bot also requests **Server Members** and **Message Content** for its other modules. Their Portal toggles are still required by that overall bot configuration; missing privileged intents cause a gateway login/disconnect error, not a localhost/Lavalink connection refusal.

The connection/retry and permission tests do not log in to Discord or prove live provider playback. Voice-handshake failures after the backend is ready remain a separate stage described below.

### Run without music

Leave **both** settings empty and restart the bot to disable backend connection attempts:

```env
LAVALINK_URL=
LAVALINK_PASSWORD=
```

This disables music, not the Discord bot. Roles, moderation, economy, news, and deals do not require Lavalink. Pausing the Music module in one server does not disable the shared backend connection. `docker compose --profile music stop lavalink` stops only the audio backend, not PostgreSQL/Redis.

For a remote backend, use hostname:port without a scheme, set `LAVALINK_SECURE=true` for TLS, and configure network ACLs. Keep the password server-side; never expose an unprotected Lavalink service publicly. A remote backend needs its **own** compatible source adapter; rebuilding Orbit's local image does not change it.

## SoundCloud: `Did not detect any supported formats`

The supplied logs identify a **lookup-stage source-format failure** on Lavalink **4.2.2 / Lavaplayer 2.2.6**:

```text
java.lang.RuntimeException: Did not detect any supported formats
    at DefaultSoundCloudFormatHandler.chooseBestFormat
    at SoundCloudAudioSourceManager.loadFromTrackData
```

The legacy built-in handler recognizes MP3/Opus formats, not the newer **AAC in fragmented-MP4 HLS**. It throws this error when none of the returned formats match. The error alone does not reveal the track's format list: protected/unavailable streams can also leave no usable format. Successful WebSocket/session setup does not repair this, and Discord voice permissions are not the cause of this lookup exception.

As of **2026-10-24**, the [Lavaplayer AAC/DRM fix](https://github.com/lavalink-devs/lavaplayer/pull/202) is still unmerged; simply pulling Lavalink 4.2.2 again does not add it. The [Lavaplayer 2.2.7 release](https://github.com/lavalink-devs/lavaplayer/releases/tag/2.2.7) is not that fix either.

### What the checked-in fix changes

- `docker/lavalink/Dockerfile` builds the **canonical** [Soundy merged AAC/fMP4 implementation](https://github.com/lowkwrs/soundy/pull/1), pinned to commit [`e2c5da8e96661d2a9eb96ee53e3d5b95903bc194`](https://github.com/lowkwrs/soundy/commit/e2c5da8e96661d2a9eb96ee53e3d5b95903bc194). The source archive is SHA-256 checked by BuildKit. It compiles against the same Lavalink 4.2.2 / Lavaplayer 2.2.6 APIs as the supplied logs.
- Upstream labels this source **1.1.0**, but has not tagged/published that version in its release workflow yet. We do **not** rely on an unverified `1.1.0` Maven artifact, a mutable JitPack fork, or a downloaded jar from an issue comment.
- A small, checked-in **build-only metadata override** sets the Lavalink API version to `4.2.2` and manifest name to `soundy`. Upstream's `plugin.yml` is not the Gradle plugin's Lavalink manifest, and its Gradle module is named `plugin`. The override also declares the class-output dependency needed when Gradle 8 runs unit tests and jar packaging together. Playback source code is not patched.
- The configuration enables `plugins.soundy.enabled` and **disables the legacy built-in `sources.soundcloud`** so it cannot handle the request first. Soundy still reports its source-manager name as `soundcloud`, and supports `scsearch:` and full `soundcloud.com` track/playlist URLs.
- The adapter selects unencrypted AAC/fMP4 HLS and feeds the init/media segments to Lavaplayer's existing decoder. This is a replacement SoundCloud adapter, **not a fallback to a different provider**. No login cookies, premium credentials, or DRM bypass are added.
- The MIT license is included in the image. Updates require reviewing/changing the source pin/checksum and rebuilding. Keep the Lavalink version/current Discord voice compatibility under review as well.

Stop any current listening session before switching adapters. Old encoded queue entries are not interchangeable; restart the bot and submit a **fresh** `/play` request after the change.

For **Docker development** (the `bot` service is the main Discord gateway):

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build bot lavalink
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music restart bot
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 bot lavalink
```

For the compiled runtime, omit `-f docker-compose.dev.yml` and build/recreate the same services. Do not delete database/Redis volumes. Rebuilding only the web app does not replace Lavalink's source loader.

Verify startup lists `registering SoundySourceManager`; then run the read-only check below. Its metadata should include `{ name: "soundy", version: "1.1.0" }`, the nine pinned plugins (ten identities total), and source managers `soundcloud`, `bandcamp`, `youtube` and `ocremix`. Metadata/lookup success still does **not** certify audible playback. Real provider availability, restrictions, and voice behavior must be checked in the test server. The network-isolated CI startup check verifies plugin/source registration, not provider access, decoding, or Discord voice playback.

## Source policy

The supplied profile has **one audio-source owner per provider**: Soundy for
SoundCloud, the built-in Bandcamp adapter, youtube-source for YouTube, and
Skybot's OC ReMix adapter. All nine requested plugins, versions, exclusions,
API responsibilities and licensing/integrity notes are documented in the
[reviewed plugin profile](MUSIC-PLUGINS.md).

- `MUSIC_SEARCH_PREFIX` chooses the **default** text-search provider:
  `scsearch` (SoundCloud), `ytsearch` (YouTube), `ytmsearch` (YouTube Music) or
  `bcsearch` (Bandcamp). OC ReMix is URL-only. No automatic provider fallback.
  Listeners do not have to accept that default: `/search` and `/play` take an
  optional `source` option (`soundcloud`, `youtube`, `youtube-music`,
  `bandcamp`) and the dashboard's play form has the same choice. Omitting it
  means "this server's configured default".
- **One provider table.** `packages/core/src/music-sources.ts` maps each
  user-facing provider to its approved Lavalink prefix and to the source manager
  that must be registered. The slash-command choices, `/help`, the dashboard
  selector, the runtime resolver and the doctor all read that table, so an
  option cannot be offered for something the runtime does not know. Raw Lavalink
  prefixes/ids are never accepted from a user; unknown values are refused with
  the list of real choices.
- **YouTube and YouTube Music share one adapter** (`plugins.youtube`) but not one
  catalogue; they stay two distinct choices. A provider whose manager is missing
  from `/v4/info` is reported with the switch that enables it for this deployment
  (`enableHint` above) instead of being quietly swapped for another provider.
- **A `source` option never reroutes a link.** A pasted URL is routed by its
  validated hostname. Passing `source` together with a link for a different
  provider is refused with the reason; the matching provider (or omitting the
  option) is accepted and the query stays a URL, never a search.
- Update an **existing** `.env` host allowlist if you want YouTube/OC ReMix;
  changing `.env.example` does not overwrite your settings. The allowlist can
  restrict these supported providers, not add arbitrary/adult loaders.
- Adult/social/upload adapters, arbitrary HTTP/local files, credential-dependent
  premium sources, Spotify mirroring and yt-dlp are disabled. No cookies,
  age-bypass clients, decryption keys or access-control workarounds are supplied.
- NSFW voice channels and explicitly flagged/age-restricted results are rejected.
  **Public catalogs/lyrics do not carry universal SFW ratings.** Use clean,
  administrator-curated recordings; no plugin configuration can certify all
  unrestricted search results as all-ages. SponsorBlock skips marked sponsor
  segments, **not explicit content**. Lyrics are not automatically posted.
- Public HTTPS URLs only: no credentials, nonstandard ports or private DNS.
  Keep backend egress limited to public destinations; bot-side DNS checks cannot
  inspect every redirect/CDN request made by a plugin.
- Use only authorized, available, unencrypted recordings in accordance with
  provider terms. Protected/paid/unavailable streams remain unsupported. Neither
  a connected node nor an installed plugin guarantees provider playback.

## Read-only source check

With `DEMO_MODE=false`, `LAVALINK_URL`, and `LAVALINK_PASSWORD` configured:

```sh
# Versions, plugins, and actually loaded source managers.
npm run music:doctor

# Repeat a search or use an authorized public track URL.
npm run music:doctor -- --query "the same failing search text"
npm run music:doctor -- --query "YOUR_PUBLIC_SUPPORTED_HTTPS_TRACK_URL"

# Test one provider explicitly (soundcloud, youtube, youtube-music, bandcamp).
npm run music:doctor -- --query "the same failing search text" --source youtube

# Help works without credentials/services.
npm run music:doctor -- --help
```

Inside the **development** bot's network:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run music:doctor -- --query "the same failing search text"
```

For a compiled runtime container: `docker compose --profile live --profile music run --rm --no-deps bot node dist/music-doctor.js --query "the same failing search text"`. On the host use the published address (normally `localhost:2333`), not Compose's internal hostname. Keep the password in `.env`, never a command-line argument.

The report lists **every supported provider** with its prefix, required source
manager, whether that manager is registered, and whether it is the configured
default. That table is the same one the runtime uses, so "the doctor is happy"
and "`/search` offers this provider" cannot disagree. An unknown
`MUSIC_SEARCH_PREFIX` is reported with the four valid values and is **not**
switched for you; a reachable backend with no registered search adapter says so
explicitly rather than looking healthy.

Only `GET /v4/info` and, with a query, `GET /v4/loadtracks` are used. There is no gateway login, voice join, database/Redis access, queue mutation, playback, or fallback. The doctor shares the player's source/input policy. JSON goes to stdout and failures return exit status 1; use `npm run --silent music:doctor ...` for clean piping. Encoded tracks and signed source URLs are not printed. A successful lookup proves metadata loading, **not** stream decoding or voice.

## Voice handshake: `not established in 15 seconds`

The newer supplied logs are a **different stage** from the earlier stopped-bot
or unsupported-format failures: the gateway/action consumer is ready and
Lavalink logs a successfully loaded YouTube track, but there is no player voice
PATCH before the 15-second error. That identifies the **Discord gateway voice
handshake**, not a failed YouTube search, proof of a broken decoder, or a need to
publish a Docker UDP port. Audio playback has not started at that point.

Orbit now uses `MusicDiscordConnector` / `joinMusicVoice` to:

- Fail explicitly if the guild's real gateway shard is missing, incorrect or not ready, rather than silently dropping/replaying the voice request.
- Replace (not duplicate) the Shoukaku 4.3 listener contract, retain shard metadata, initialize an already-ready client's bot identity after construction, and detach listeners at shutdown. Normal startup still constructs the service before login; late construction is a protected edge, not an established live root cause.
- Claim attempt ownership before stale cleanup and reject overlapping joins without disconnecting the pending attempt. MusicService's existing per-guild locks are retained, not presented as a newly missing feature.
- Pair only this guild/bot/expected channel/shard; ignore unrelated or stale wrong-channel state and retain the existing server-before-state buffer.
- Accept either order of the bot's `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE`.
  Shoukaku 4.3 otherwise assumes the state/session event arrives first.
- Leave and await the bot's own leave acknowledgement before retrying an orphaned
  same-channel connection. Shoukaku's failed initial join removes its connection
  map entry without sending a voice leave; a same-channel retry can receive no
  fresh server event/token. This failure loop is reproduced in offline tests.
- Await **both** the bot's leave acknowledgement and completion of the old Lavalink player destruction before a new join. Otherwise Shoukaku can delete the new guild player-map entry when the old REST cleanup finally resolves; an offline deferred-destruction regression reproduces that ordering.
- Send a voice leave on a failed join **even when no player was ever created**, but only while the attempt still owns its connection; recheck ownership after awaited cleanup. Old player close/end/update callbacks cannot overwrite a replacement session, including after acquiring the existing guild lock.
  `/stop` can also clear a pending/orphaned same-room connection without a player.
- Reject full channels without the relevant Move Members bypass permission, and
  report unsupported Stage channels explicitly. Do not grant Administrator just
  to work around a voice-channel user limit.

Structured `voiceHandshake` logs report a lifecycle stage (`gateway-failed`, `player-failed`, `player-created`), safe guild/channel/shard identifiers, readiness/identity/listener/event booleans, a bounded guild-event count and elapsed milliseconds. Text errors carry the corresponding flags, including unexpected-channel and wrong-shard observations. `joinSent=true` means a local gateway frame was submitted, **not a Discord acknowledgement**; `player-created` still does not prove a track is audible. No voice token, session ID, raw packet or endpoint is dumped. Raw Shoukaku debug logging stays off, and generic error sanitization also redacts session-ID/endpoint fields.

If a fresh request still fails after updating:

1. Check the new sanitized error in **Audit** or the bot logs. Both gateway events
   missing points to request/shard/gateway handling; state present but server
   missing identifies a different case from both present and backend player
   setup failing. These flags narrow the issue; the supplied old error alone
   cannot prove which packet was missing.
2. Verify exactly **one** host/editor/Compose bot process uses the token. The
   running code already requests `GuildVoiceStates`; it is not a separate
   privileged-intent switch to invent in the Developer Portal.
3. Try a normal, non-NSFW, non-full voice channel with Connect/Speak permissions.
   If needed, manually disconnect only the bot from a stranded voice session,
   then submit one fresh request. Do not clear database/Redis volumes.
4. Read Lavalink logs **after a player voice PATCH** for any later backend voice,
   UDP, encryption or decoding failure. Those are later stages, not what the
   pre-player gateway timeout establishes. The music doctor is read-only source
   diagnostics; it deliberately does not join voice.

The default handshake timeout was not merely increased to hide the problem.
Tests use the real pinned Shoukaku implementation and a simulated gateway/REST
transport to verify event ordering, the orphan retry, cleanup, missing-shard
errors and secret-free diagnostics. They are not a live Discord voice test and
do not prove that every external server/network problem is resolved.

### Reading the latest zero-event trace and detecting an old checkout

`Lavalink connected` + `/v4/info` + a successfully loaded track establishes that backend authentication and track lookup work. If the next error says **own voice state received: false; voice server received: false**, no Discord voice handshake completed, and no Lavalink player was created. This is a different failure from an unavailable backend, a failed YouTube lookup, or a later UDP/decoder problem. "Join sent" means the connector submitted the request to the local gateway shard; it is not a Discord acknowledgement or packet-capture proof that the request reached the server.

Both missing events alone do **not** identify the exact cause. Verify View Channel/Connect/Speak including per-channel overrides, a connected correct gateway shard, the requested GuildVoiceStates intent and exactly one gateway process for the token. The permission preflight now explicitly includes View Channel and refreshes the bot's member roles. It fails before track lookup/join if a required permission is missing. The connector also fails immediately for a non-ready target shard or a running client missing GuildVoiceStates, instead of silently queueing a join for later. Diagnostics include safe gateway/shard-ready, intent, attached-listener, matching-identity and unexpected-event flags/counts; these narrow the failure without exposing raw gateway payloads. Do not grant Administrator, enable a nonexistent privileged voice intent, or replace audio plugins to diagnose missing gateway acknowledgements.

Also verify the code actually deployed. The earlier report used missing Java-probe stages, an unqualified `Lavalink connected` log and old inline deal layout as older-checkout evidence **at that revision**. The current refactor deliberately removes `Healthcheck.java` and its compile/copy stages after CI verified curl is already in the image; their absence is now expected. Inspect the actual commit, image-owned HEALTHCHECK and `/opt/Lavalink/healthcheck/run`, not the superseded Java command. Logs still include resume booleans and existing messages keep old layouts. Old startup lines are retained when a container is not recreated.

**`docker compose up --build` builds your local files; it never fetches newer Git commits.** `--no-cache` cannot update an old checkout either, and dev bind mounts override image source with the local checkout. From the intended working branch:

```sh
git status --short --branch
git log -1 --oneline
# Preserve local edits; this safely refuses divergent/unmergeable updates.
git pull --ff-only origin arena/e2b42b08-discordjs-starter
```

Then use the [Docker-only recovery commands](#recover-an-existing-docker-development-stack), including the bot and Lavalink. Use `logs --since=5m --tail=100 bot lavalink` to distinguish new attempts from retained startup output. Keep `.env`, database and Redis volumes; do not hard-reset local edits or run `down -v`. No live Discord/voice test is claimed by the offline regression tests.

## Other failures and diagnostics

- **Backend HTTP 401/403:** match bot/backend passwords. This differs from provider HTTP 401/403 inside a source exception.
- **Source manager absent:** check that the Soundy-enabled image is actually running and `plugins.soundy.enabled=true`; keep the built-in SoundCloud loader disabled. Bandcamp uses `lavalink.server.sources.bandcamp`. Restart the backend and inspect `/v4/info`.
- **No usable public stream / DRM / encrypted format:** choose another authorized public, unencrypted track. An adapter update does not grant access to restricted media.
- **Provider 401/403, rate limiting, region/access restrictions:** inspect the actual cause; respect provider limits and do not bypass them.
- **DNS, TLS, connection, timeout:** inspect outbound access from the **Lavalink container**, not just the host/browser.
- **Search fails but a public URL works:** check the configured prefix and adapter. Pasting the configured prefix is accepted without double-prefixing.
- **Lookup succeeds but playback fails:** inspect Lavalink logs immediately afterward. Historical [HLS playback-404 reports](https://github.com/lavalink-devs/lavaplayer/issues/203) are a different failure stage from the supplied unsupported-format exception.

Slash-command errors use a red embed with a fenced, sanitized multiline diagnostic. Lavalink's returned message/severity/cause and fetched backend/plugin versions are retained; the bot cannot read a nested Java exception that Lavalink only wrote to its own logs. Discord display limits can shorten the code block without breaking its closing fence.

Music slash/action/playback failures are also sent to the dashboard's **Audit** log. **Copy error** copies the exact stored sanitized detail, and **Copy full event** copies JSON. Line breaks are preserved, credentials/auth fields/URL query values are redacted, and storage is bounded to 8,192 characters with a truncation marker. The embed is only a presentation layer; it does not rewrite the audit detail or doctor JSON. Old shortened records cannot be recovered. Inspect/redact logs before sharing; never share `.env`, tokens, passwords, or private source URLs.

### What `Lavalink connection error` means

The bot used to log the fixed string `Lavalink connection error` with whatever
the Shoukaku error event carried. Shoukaku forwards the WebSocket client's error,
and for a refused dual-stack connect that is an `AggregateError` whose own
message is **empty** — so the log line named no cause at all.

The handler now reads only the fields the library actually sets — `name`,
`message`, `code`, HTTP `status`, the `cause` chain and the members of an
`AggregateError` — and prints them with the configured target. Everything passes
through the same redaction as every other diagnostic, so a password or a signed
URL that ends up in a message becomes `[REDACTED]`.

| Category  | Evidence the bot saw                          | What it means                                                               |
| --------- | --------------------------------------------- | --------------------------------------------------------------------------- |
| `refused` | `ECONNREFUSED` (also as aggregate members)    | Nothing is listening at that address/port.                                  |
| `dns`     | `ENOTFOUND`, `EAI_AGAIN`, …                   | The host name does not resolve from where the bot runs.                     |
| `timeout` | `ETIMEDOUT`, `UND_ERR_CONNECT_TIMEOUT`, …     | A connection was attempted and nothing answered in time.                    |
| `auth`    | HTTP `401`/`403`                              | Lavalink answered and rejected the request.                                 |
| `tls`     | `DEPTH_ZERO_SELF_SIGNED_CERT`, `ERR_SSL_*`, … | The TLS handshake failed before Lavalink answered.                          |
| `closed`  | `ECONNABORTED`, `EPIPE`                       | The socket opened and then closed.                                          |
| `unknown` | nothing above                                 | No evidence in the error, so **no cause is invented** and no hint is shown. |

Only the evidenced categories get a next step. For a refusal the log says to
check that Lavalink is running and that the address and port are right — a
host-run bot reaches `localhost:2333`, a Compose bot reaches `lavalink:2333`.
The health row shows the same summary (category, code and sanitized message), so
"Music backend — degraded" no longer hides the reason.

An identical error repeating while the library retries with backoff is logged
once and then counted at debug level, so a flapping backend cannot bury the first
line that explains it. `disconnect` resets that counter.

Music remains optional: a failed backend degrades the music module only. The
dashboard, news, deals, moderation and economy keep working, and Orbit never
starts a container for you.

## Capability matrix

Installed is not the same as working. This table records what Orbit implements,
where it is reachable, what is covered by mocks, and what still needs an
authorized live check on your deployment. **"Verified live" is only claimed
where a real Discord/Lavalink run confirmed it**; in this repository it stays
empty, because no live guild or audible test is available here.

| Capability                | Backend capability                                          | Implemented                   | Slash commands                     | Dashboard                                | Mocked tests                                               | Verified live | Disabled / limits                                                                                                      |
| ------------------------- | ----------------------------------------------------------- | ----------------------------- | ---------------------------------- | ---------------------------------------- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Text search (quick play)  | Lavalink search, `MUSIC_SEARCH_PREFIX` (default `scsearch`) | Yes (first result, by design) | `/play query:<text>`               | **Add to the queue** field               | `music-source`, `music-service`                            | No            | First match only; use `/search` to choose                                                                              |
| Explicit search selection | Same search, up to 5 results                                | Yes                           | `/search query:<text>`             | Not offered (Discord-only menu)          | `music-search` (expiry, ownership, single use, duplicates) | No            | One use per menu, 2-minute expiry, same member + guild                                                                 |
| Direct links              | Allowlisted hosts + DNS/SSRF checks                         | Yes                           | `/play query:<url>`                | Same field                               | `music-source` (URL matrices)                              | No            | HTTPS only, `MUSIC_ALLOWED_HOSTS`, public DNS, no adult adapters; public page linked, query strings stripped           |
| Idle disconnect policy    | Per-guild timer + live re-check                             | Yes                           | `/queue`, `/stop`                  | Music settings (`idleDisconnectSeconds`) | `music-idle`, `music-service`                              | No            | Queue end/failure waits 60 s by default; empty channel 15 s; explicit stop leaves at once                              |
| Track artwork and source  | Provider metadata                                           | Yes                           | `/queue`                           | Now-playing card + queue rows            | `replies`                                                  | No            | `safeImageUrl()`/`safeLink()` only; no signed media URLs, no stream endpoints                                          |
| Playlists                 | Provider playlist load                                      | Yes (all returned tracks)     | `/play query:<playlist url>`       | Same field                               | `music-service` (whole-request admission)                  | No            | Rejected as a whole over `maxQueue`/`maxPerMember`; no partial enqueue                                                 |
| Queue view                | Persisted snapshot                                          | Yes                           | `/queue`                           | Queue card                               | `music-service`, `replies`                                 | No            | Snapshot for observation, not session restore                                                                          |
| Pause / resume            | `setPaused`                                                 | Yes                           | `/pause`, `/resume`                | Transport button                         | `music-service`                                            | No            | Requires an active player                                                                                              |
| Skip                      | `stopTrack` + `end` event                                   | Yes                           | `/skip`                            | Transport button                         | `music-service`                                            | No            | Never retried automatically (a duplicate skip changes the queue)                                                       |
| Stop                      | leave voice + clear snapshot                                | Yes                           | `/stop`                            | Stop dialog + transport                  | `music-service`                                            | No            | Clears the persisted queue; a restart does not replay it                                                               |
| Volume                    | `setGlobalVolume`                                           | Yes                           | `/volume level:<0-100>`            | Slider (latest value wins)               | `music-service`, `volume-control`                          | No            | 0–100 integer; coalesced per interaction                                                                               |
| Repeat                    | Queue policy                                                | Yes                           | `/repeat mode:<off\|track\|queue>` | Cycle button                             | `music-service`                                            | No            | Not an eviction policy                                                                                                 |
| Shuffle                   | Queue order                                                 | Yes                           | `/shuffle`                         | Two buttons                              | `music-service`                                            | No            | Shuffles upcoming only                                                                                                 |
| Remove a queued track     | Queue policy                                                | Yes                           | — (use `/queue` to see state)      | Row action                               | `music-api`                                                | No            | Dashboard only; the playing track is not removable this way                                                            |
| Seek                      | `seekTo` (milliseconds)                                     | Yes                           | `/seek position:<seconds>`         | Seek slider                              | `music-service` (clamp, live duration, invalid input)      | No            | Finite duration only; clamps to 1 s before the end; not retried                                                        |
| Progress display          | `playerUpdate` + persisted snapshot                         | Yes                           | —                                  | Progress bar + labels                    | `music-progress` (interpolation, staleness, clock skew)    | No            | Freezes after 90 s of silence and says "State unconfirmed"                                                             |
| Voice join/leave          | Shoukaku/Discord handshake                                  | Yes                           | Implicit on `/play`                | —                                        | `music-voice` (event orders, stale cleanup)                | No            | Normal voice channels only; Stage supported as target is refused                                                       |
| SponsorBlock skipping     | Lavalink plugin                                             | Optional                      | —                                  | —                                        | `music-plugins`, `music-plugin-config`                     | No            | Only when the plugin is loaded and categories are configured                                                           |
| Lyrics                    | —                                                           | **No**                        | **No**                             | **No**                                   | —                                                          | —             | **No maintained, license-clear provider is configured.** No button, no command, no fabricated synced lyrics. See below |
| Spotify / Apple Music     | —                                                           | **No**                        | —                                  | —                                        | —                                                          | —             | Deliberately absent (metadata mirroring is not playback)                                                               |

### Why there is no lyrics feature

Orbit does not ship a lyrics endpoint today. The maintained options all add a
new credential, a licensing/attribution obligation and a per-guild cache, and
several are undocumented or rate-limit aggressively. Adding a **Lyrics** button
that sometimes returns nothing would imply a capability Orbit cannot promise, so
the absence is documented instead of shipped as a dead control. A lyrics
integration would need: a server-side key (never in the browser), a cache with
explicit freshness, attribution next to the text, honest "not found" handling,
and — for a _synchronized_ view — real timestamps plus alignment with the
Lavalink position. Without those, static text only, and never the word "synced".

## Commands and controls

`/play`, `/search`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`, `/seek`, `/volume`, `/shuffle`, and `/repeat` are implemented; register them with Discord. Command replies remain **ephemeral**, including embeds. The dashboard's Commands reference is not live registration verification. Dashboard controls share the music service/action queue. Members must be in the bot's voice channel; configured DJ-role/Manage Server checks, module state, and bot channel permissions are enforced at execution time.

Volume is bounded to 0–100%; queue limits are configurable. Unsupported sources produce an error, not fabricated success. Accepted play requests do not certify audible playback. The dashboard waits for actual job completion and warns rather than claiming success if completion remains unconfirmed; failures are audited. Requests older than 30 seconds at execution are rejected instead of replayed. Music actions are not automatically retried, since a repeated skip/play could alter the queue twice.

### `/search` and `/seek` in detail

`/search` runs the same resolver and source policy as `/play` and lists at most
five results with title, artist, source and duration. Each menu is:

- **bound** to the member who ran it and to that guild (another member cannot
  spend the results),
- **single-use** — the interaction is claimed once, so a double click or a
  replayed component cannot enqueue the same tracks twice,
- **short-lived** — two minutes, then it must be run again,
- **re-checked** — the chosen tracks still go through the voice, DJ-role,
  module, queue-capacity and per-member admission checks, and a track that is
  already queued or currently playing is not added again.

Quick play is unchanged: `/play` resolves and queues the first match
immediately, asking the backend for **one** result instead of fetching a list and
discarding it. `/search` asks for the same bounded five it displays.

The optional `source` option is available on both commands:

| Choice          | Prefix      | Source manager to have registered | Enable it with                                            |
| --------------- | ----------- | --------------------------------- | --------------------------------------------------------- |
| `soundcloud`    | `scsearch`  | `soundcloud`                      | `plugins.soundy.enabled` (keep built-in SoundCloud off)   |
| `youtube`       | `ytsearch`  | `youtube`                         | `plugins.youtube.enabled`                                 |
| `youtube-music` | `ytmsearch` | `youtube`                         | `plugins.youtube.enabled` (same adapter, music catalogue) |
| `bandcamp`      | `bcsearch`  | `bandcamp`                        | `lavalink.server.sources.bandcamp`                        |

The provider that answered is named in the `/search` header (so a YouTube result
and a YouTube Music result are never confused), and a missing adapter produces an
actionable error naming that switch — playback is not attempted and no other
provider is substituted.

`/seek` takes seconds, requires a finite duration, clamps to one second before
the end, and refuses live/unknown-length sources instead of pretending. It is
sent to Lavalink in milliseconds. A successful reply means "the backend
accepted the seek", not "you can hear it from that point". The dashboard slider
behaves the same way: one request when the listener lets go, no request per
pixel.

The dashboard progress bar never polls Discord or Lavalink per second. It starts
from the persisted snapshot and interpolates with a monotonic local clock,
reconciling whenever a new dashboard payload arrives (every 30 s, or as soon as
a background tab becomes visible). If the snapshot is more than 90 seconds old,
interpolation stops, the badge reads **State unconfirmed**, and the position is
labelled "last known" instead of continuing to animate.

Queue snapshots are for dashboard observation, not automatic voice-session restoration. An ordinary Lavalink reconnect can use its short resume window, but a full bot/backend restart or source-adapter change needs a new session. In demo mode all tracks are fictional previews and **no audio is played**.

## Verification boundary for this repair

The inspected lockfile resolves Shoukaku **4.3.0**, Discord.js **14.27.0** and @discordjs/ws **1.2.3**. Tests use the installed Shoukaku Connection/Player implementation with an offline gateway transport, not a mocked replacement music pipeline. They cover both event orders, synchronous delivery, wrong identity/guild/channel/shard, late initialization, concurrent joins, stale leave + REST cleanup ordering, retry/listener cleanup, player REST failure after both events and obsolete player callbacks. Separate real local WebSocket fixtures retain the backend retry/startup/recovery checks.

These demonstrate concrete edge/race defects and protect the installed library contract. They **do not establish which edge or deployment condition caused your live both-events-absent trace**. The original runtime already enabled GuildVoiceStates, checked permissions, buffered event order and serialized actions per guild; those are not relabeled as newly discovered missing prerequisites. The normal service starts before Discord login and already holds a per-guild action lock. Missing acknowledgements remain an authorized live gateway/deployment investigation, not proof of a source/plugin/UDP/DAVE issue.

Compose and the editor were inspected: the `bot` service owns the gateway, the editor is idle, and registration/doctor processes do not log in. The sandbox cannot inventory separately launched processes on another host or another Compose stack; verify only one intended gateway for this token. No duplicate external process was killed and no global distributed gateway-lease claim is made.

Use [PERMISSIONS.md](PERMISSIONS.md) for installation scopes, exact selected-channel permissions, actor/DJ restrictions and Docker-only setup. The read-only doctor diagnoses backend/track loading, **not** a successful Discord voice join. No live guild credentials or authorized audible test were available for this change set.

## Leaving voice: the disconnect policy

Orbit no longer leaves the channel the instant one track ends. That behaviour made
a normal queue finish, and every provider-side load failure, look like the bot
dropping out of the call.

| Situation                                                     | What Orbit does                                                                                                        |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Queue finished, nothing playing                               | Waits `music.idleDisconnectSeconds` (default **60**, `0` = leave at once), then disconnects                            |
| A track failed to load or was skipped to the end of the queue | Same wait, same timer — one failed item is not treated as a reason to abandon the call                                 |
| Nobody human is left in the voice channel                     | Waits **15 seconds**, then disconnects **even if audio is still playing**; a human returning cancels the pending leave |
| Someone queues something during the wait                      | A queue-idle timer is cancelled and playback continues in the same session                                             |
| Someone queues something in a still-empty channel             | The queue is kept, but the **empty-channel timer is not cancelled** — the bot still leaves after the grace period      |
| Other bots are the only "listeners" left                      | Counted as empty: bots do not keep Orbit in a call                                                                     |
| `/stop`, `/disconnect`, node loss, or a closed voice session  | Leaves immediately; any pending timer is cancelled                                                                     |

Details that matter when reading logs:

- One timer per guild, replaced rather than stacked, and every timer is `unref`ed so a
  pending leave never keeps the process alive.
- The timer's **reason** decides what is re-checked, always inside the per-guild
  mutation lock: `queue-finished`/`track-failed` require no playback and no queued
  tracks, while `alone` requires that no non-bot member is in Orbit's current
  voice channel. Active playback therefore does not rescue an empty channel, and a
  full queue does not rescue a finished one.
- Leaving voice always resets the persisted snapshot for that guild, so an
  `alone` departure **drops the queued tracks with it**. That is the existing
  single-session policy, not a new queue-retention rule: nothing is replayed on
  the next session. Leave a listener in the channel (or `/stop` first) if the
  queue should be kept.
- Removing Orbit from a guild cancels its timer, forgets its search menus and
  leaves voice; shutdown clears every timer.
- The wait is stored per guild (`music.idleDisconnectSeconds`, 0–1800) and editable on
  the Music page; the Discord-side behaviour is `/queue` for the current state.
- Only the bot's own voice channel is watched. Orbit does not add the Presence intent,
  read other servers, or infer "alone" from a member cache it cannot see.

## Which links are accepted

`/play` and the dashboard's queue field accept a title or a link. A link must be
HTTPS, resolve to public addresses, and belong to a host in `MUSIC_ALLOWED_HOSTS`.
Recognized forms (source in brackets):

| Accepted                                                              | Notes                                            |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| `https://www.youtube.com/watch?v=<id>` (also `m.`/`music.`/bare host) | `v` is kept; tracking parameters are dropped     |
| `https://youtu.be/<id>` (with or without `?t=`)                       | Share links                                      |
| `https://www.youtube.com/shorts/<id>`, `/live/<id>`                   | Resolved by the plugin, not rewritten by Orbit   |
| `https://www.youtube.com/playlist?list=<id>`                          | Whole playlist; rejected as a whole if too large |
| `https://soundcloud.com/<artist>/<track>` or `.../sets/<album>`       | SoundCloud source manager                        |
| `https://on.soundcloud.com/<share-id>`                                | SoundCloud share links                           |

Refused examples: `http://` URLs, URLs containing credentials
(`https://user:pass@host/...`), lookalike hosts (`youtube.com.evil.example`),
`https://soundcloud.app.goo.gl/...` (a different domain), and any host that is not
in the allowlist — an allowlist entry never grants an unrelated adapter.

Embedded and dashboard links are always the provider's **public page**. Query
strings are stripped except for YouTube's `v`/`list`, so a signed or session-bearing
URL never reaches Discord or the browser. Artwork is used only when
`safeImageUrl()` accepts it (HTTPS, public host, image extension); otherwise the
neutral vinyl placeholder is shown.

## Optional requester fairness limit

Settings and the Music page expose `music.maxPerMember`: **0 (the backward-compatible default) is unlimited**, otherwise 1–500 upcoming tracks per requester. The current track does not count. The existing per-guild mutation lock checks both global and per-requester queue admission before mutating the queue or joining voice; an over-limit playlist is rejected in full, including concurrent requests. The demo uses the same pure admission policy and the authenticated requester identity.

This is a queue policy, not a new provider, permission, voice ownership strategy or playback guarantee. DJ/same-room restrictions, supported-source/SFW rules, global queue cap and owned voice ACK/cleanup behavior remain unchanged. No new gateway intent or Move Members/Administrator grant is needed. Existing attributed queue rows count toward the requester; unknown legacy attribution is not guessed from a display name.
