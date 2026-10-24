# The listening room: Lavalink v4

Orbit uses **Shoukaku** as the Discord.js-to-Lavalink client. Lavalink handles source loading, encoding, voice connectivity, and Discord voice encryption. The dashboard is a remote controller; it never streams audio in the browser.

## Start the optional backend

1. For a bot started with `npm run dev:bot` **on your host**, set these in the root `.env`:

   ```env
   LAVALINK_URL=localhost:2333
   LAVALINK_PASSWORD=<your strong generated password>
   LAVALINK_SECURE=false
   MUSIC_SEARCH_PREFIX=scsearch
   MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com
   ```

2. Build/start the supplied **Lavalink 4.2.2 + Soundy AAC/fMP4** image:

   ```sh
   docker compose --profile music up -d --build lavalink
   docker compose logs --tail=100 lavalink
   ```

   The first build downloads the pinned plugin source and Gradle dependencies, runs the plugin's offline unit tests, and packages its jar into the official Lavalink image. Java/Gradle are not required on your host. No provider/Discord integration test runs during the build. The service publishes only `127.0.0.1:2333:2333`; allow the Java service to finish starting before testing music.

3. Restart `npm run dev:bot` after `.env` changes. `Lavalink connected` verifies the WebSocket connection. The bot also explicitly requests `/v4/info` to populate backend/plugin versions; Shoukaku 4.3.0 does not populate `node.info` automatically. Metadata failures are logged and retried on the next lookup, without inventing a backend version.
4. When the bot runs **inside Compose**, the supplied environment selects `lavalink:2333` automatically when `LAVALINK_PASSWORD` is nonempty. `localhost` would refer to the bot container itself. The backend receives the same password. For the main bot with hot reload, see [Docker development](DEVELOPMENT.md#run-just-the-main-bot).
5. Give the bot **Connect** and **Speak** in a normal server voice channel, and **Embed Links** for rich command replies. Join the voice channel and use `/play`. Stage-channel speaker promotion is not automated.

`ECONNREFUSED` means there is no reachable listener; check startup, address, and ports. An authentication failure means the bot/backend passwords need to match. Neither is the same as a provider's error after a successful connection.

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
- A small, checked-in **build-only metadata override** sets the Lavalink API version to `4.2.2` and manifest name to `soundy`. Upstream's `plugin.yml` is not the Gradle plugin's Lavalink manifest, and its Gradle module is named `plugin`. Playback source code is not patched.
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

Verify startup lists `registering SoundySourceManager`; then run the read-only check below. Its metadata should show `plugins: [{ name: "soundy", version: "1.1.0" }]` and source managers `soundcloud` and `bandcamp`. Metadata/lookup success still does **not** certify audible playback. Real provider availability, restrictions, and voice behavior must be checked in the test server. The network-isolated CI startup check verifies plugin/source registration, not provider access, decoding, or Discord voice playback.

## Source policy

The supplied backend uses **Soundy for SoundCloud**, and Lavalink's built-in **Bandcamp** loader. Search uses `scsearch`; set `MUSIC_SEARCH_PREFIX=bcsearch` for Bandcamp. Availability depends on provider restrictions, region, adapter support, and upstream changes.

- **YouTube is disabled.** No unsupported YouTube extractor or cookie setup is included.
- **Spotify is not an audio source here.** Metadata access does not grant access to play recordings.
- **Arbitrary HTTP and local-file loading are disabled** on the backend. The bot accepts only allowlisted public HTTPS source URLs; private DNS results, credentials, and nonstandard ports are rejected before lookup.
- **No silent provider fallback.** Failures remain failures; unrelated recordings are not substituted.
- **No protected, paid, snipped-preview, or unavailable stream bypass.** Use only content you are authorized to play, in accordance with provider terms. Full SoundCloud URLs are supported; short-link support is adapter-dependent.
- Restrict backend egress to public destinations. Bot-side DNS validation cannot police every redirect/CDN hop inside a source plugin. Do not enable arbitrary HTTP/local sources to make a broken provider work.

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

Volume is bounded to 0–100%; queue limits are configurable. Unsupported sources produce an error, not fabricated success. Accepted play requests do not certify audible playback. Jobs wait briefly before remaining queued; failures are audited. Music actions are not automatically retried, since a repeated skip/play could alter the queue twice.

Queue snapshots are for dashboard observation, not automatic voice-session restoration. An ordinary Lavalink reconnect can use its short resume window, but a full bot/backend restart or source-adapter change needs a new session. In demo mode all tracks are fictional previews and **no audio is played**.
