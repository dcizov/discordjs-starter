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

   The first build downloads checksum-pinned plugin artifacts and the pinned Soundy source/Gradle dependencies, runs Soundy's offline unit tests, and packages the JARs into the official Lavalink image. Nothing downloads plugins at runtime. See [the plugin inventory/configuration](MUSIC-PLUGINS.md). Java/Gradle are not required on your host. No provider/Discord integration test runs during the build. The service publishes only `127.0.0.1:2333:2333`; its image-owned authenticated `/v4/info` healthcheck reports HTTP readiness (inherited by Compose). The same `/opt/Lavalink/healthcheck/run` is usable by other supervisors. The probe is a tiny standard-library Java class compiled in the existing build stage, not a requirement for host Java/curl/Node.

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

- Choose **one** default `MUSIC_SEARCH_PREFIX`: `scsearch`, `bcsearch`,
  `ytsearch` or `ytmsearch`. OC ReMix is URL-only. No automatic provider fallback.
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

# Help works without credentials/services.
npm run music:doctor -- --help
```

Inside the **development** bot's network:

```sh
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music run --rm --no-deps bot npm run music:doctor -- --query "the same failing search text"
```

For a compiled runtime container: `docker compose --profile live --profile music run --rm --no-deps bot node dist/music-doctor.js --query "the same failing search text"`. On the host use the published address (normally `localhost:2333`), not Compose's internal hostname. Keep the password in `.env`, never a command-line argument.

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

Also verify the code actually deployed. The reported build still showed the older Lavalink Dockerfile **without the `Healthcheck.java` compile/copy stages**, the older unqualified `Lavalink connected` log (the newer one includes resume booleans), and the old inline deal layout. Those are evidence of an older/mixed checkout, not evidence that a fresh build of the newest code was used. Old startup lines are also retained in `docker compose logs` when a container is not recreated.

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

## Commands and controls

`/play`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`, `/shuffle`, and `/repeat` are implemented; register them with Discord. Command replies remain **ephemeral**, including embeds. The dashboard's Commands reference is not live registration verification. Dashboard controls share the music service/action queue. Members must be in the bot's voice channel; configured DJ-role/Manage Server checks, module state, and bot channel permissions are enforced at execution time.

Volume is bounded to 0–100%; queue limits are configurable. Unsupported sources produce an error, not fabricated success. Accepted play requests do not certify audible playback. The dashboard waits for actual job completion and warns rather than claiming success if completion remains unconfirmed; failures are audited. Requests older than 30 seconds at execution are rejected instead of replayed. Music actions are not automatically retried, since a repeated skip/play could alter the queue twice.

Queue snapshots are for dashboard observation, not automatic voice-session restoration. An ordinary Lavalink reconnect can use its short resume window, but a full bot/backend restart or source-adapter change needs a new session. In demo mode all tracks are fictional previews and **no audio is played**.

## Verification boundary for this repair

The inspected lockfile resolves Shoukaku **4.3.0**, Discord.js **14.27.0** and @discordjs/ws **1.2.3**. Tests use the installed Shoukaku Connection/Player implementation with an offline gateway transport, not a mocked replacement music pipeline. They cover both event orders, synchronous delivery, wrong identity/guild/channel/shard, late initialization, concurrent joins, stale leave + REST cleanup ordering, retry/listener cleanup, player REST failure after both events and obsolete player callbacks. Separate real local WebSocket fixtures retain the backend retry/startup/recovery checks.

These demonstrate concrete edge/race defects and protect the installed library contract. They **do not establish which edge or deployment condition caused your live both-events-absent trace**. The original runtime already enabled GuildVoiceStates, checked permissions, buffered event order and serialized actions per guild; those are not relabeled as newly discovered missing prerequisites. The normal service starts before Discord login and already holds a per-guild action lock. Missing acknowledgements remain an authorized live gateway/deployment investigation, not proof of a source/plugin/UDP/DAVE issue.

Compose and the editor were inspected: the `bot` service owns the gateway, the editor is idle, and registration/doctor processes do not log in. The sandbox cannot inventory separately launched processes on another host or another Compose stack; verify only one intended gateway for this token. No duplicate external process was killed and no global distributed gateway-lease claim is made.

Use [PERMISSIONS.md](PERMISSIONS.md) for installation scopes, exact selected-channel permissions, actor/DJ restrictions and Docker-only setup. The read-only doctor diagnoses backend/track loading, **not** a successful Discord voice join. No live guild credentials or authorized audible test were available for this change set.

## Optional requester fairness limit

Settings and the Music page expose `music.maxPerMember`: **0 (the backward-compatible default) is unlimited**, otherwise 1–500 upcoming tracks per requester. The current track does not count. The existing per-guild mutation lock checks both global and per-requester queue admission before mutating the queue or joining voice; an over-limit playlist is rejected in full, including concurrent requests. The demo uses the same pure admission policy and the authenticated requester identity.

This is a queue policy, not a new provider, permission, voice ownership strategy or playback guarantee. DJ/same-room restrictions, supported-source/SFW rules, global queue cap and owned voice ACK/cleanup behavior remain unchanged. No new gateway intent or Move Members/Administrator grant is needed. Existing attributed queue rows count toward the requester; unknown legacy attribution is not guessed from a display name.
