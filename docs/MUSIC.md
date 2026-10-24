# The listening room: Lavalink v4

Orbit uses **Shoukaku** as a maintained Discord.js-to-Lavalink client. Lavalink handles source loading, encoding, voice connectivity, and Discord voice encryption. The web dashboard is a remote controller; it never streams audio in the browser.

## Start the optional backend

1. For a bot started with `npm run dev:bot` on your host, set these in the root `.env`:

   ```env
   LAVALINK_URL=localhost:2333
   LAVALINK_PASSWORD=<your strong generated password>
   LAVALINK_SECURE=false
   MUSIC_SEARCH_PREFIX=scsearch
   MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com
   ```

2. Start a **current** Lavalink v4 release using the optional Compose service:

   ```sh
   docker compose --profile music up -d lavalink
   docker compose logs --tail=80 lavalink
   ```

   The service publishes `127.0.0.1:2333:2333`, so a host-run bot can connect without a Compose override. It does not bind the audio API to public interfaces. Allow the Java service to finish starting before restarting the bot.

3. Restart `npm run dev:bot` after `.env` changes. A successful backend connection logs `Lavalink connected`. `ECONNREFUSED 127.0.0.1:2333` means the bot could not reach a listener on that port; check that the service is running, its port is published, and startup has completed. If the container exited or keeps restarting, inspect the Lavalink logs above. An authentication failure is different: make sure the bot and backend use the same password.
4. When the bot runs **inside Compose**, the supplied environment selects `lavalink:2333` automatically when `LAVALINK_PASSWORD` is nonempty. It must not use `localhost`, which would refer to the bot container itself. The backend receives the same password.
5. Give Orbit **Connect** and **Speak** in a normal server voice channel. Join it and use `/play`. Stage-channel speaker promotion is not automated.

### Run without music

The music backend is optional. To stop connection attempts, leave **both** settings empty and restart the bot:

```env
LAVALINK_URL=
LAVALINK_PASSWORD=
```

This disables the backend connection, not the Discord bot. Roles, moderation, economy, news, and deals do not require Lavalink. Turning off the Music module in one server's dashboard stops music actions for that server, but does not disable the shared backend's connection; use the environment settings above for that. If you no longer need the container, `docker compose --profile music stop lavalink` stops only that service. This does not stop or remove PostgreSQL or Redis.

For a remote backend, use its hostname:port without a URL scheme, set `LAVALINK_SECURE=true` for TLS, and configure network ACLs. Keep the password server-side. Do not expose an unprotected Lavalink service to the internet.

## Source policy

The supplied `docker/lavalink/application.yml` enables Lavalink’s built-in **SoundCloud** and **Bandcamp** loaders. SoundCloud search uses `scsearch`. `bcsearch` may be selected if supported by your installed backend. Availability depends on current source support, region, provider restrictions, and upstream changes; a search may legitimately return no playable track.

- **YouTube is disabled.** No unsupported YouTube extractor or unofficial cookie setup is included.
- **Spotify is not an audio source here.** Spotify metadata does not grant access to play full recordings.
- Local filesystem and arbitrary HTTP audio loading are disabled.
- Direct URLs are restricted to the server-side allowed host list, HTTPS, and public DNS destinations. Do not add untrusted hosts or enable unrestricted HTTP source loading.
- Other sources/plugins require an operator to install a compatible, maintained plugin, verify its terms and Discord compatibility, and deliberately extend the source policy. They are not implicitly supported by the UI.
- Only request content you are authorized to play. There is no DRM bypass, login-cookie extraction, downloader, or access-control circumvention.

Use an up-to-date backend that supports Discord’s **current voice encryption and protocol requirements, including DAVE where applicable**. Older Lavalink images/plugins may stop connecting after Discord updates. The floating `:4` image selects the current v4 line; pin and regularly update a tested image digest for production.

## Connected but a track will not load

`Lavalink connected` verifies the control connection, **not** SoundCloud/Bandcamp availability. A message such as `Something went wrong while looking up the track` comes from source lookup before a new track can be played. It does not establish a Discord permission problem, a specific provider outage, or a particular fix.

New failures retain Lavalink's **message, severity, cause, and backend version**, instead of dropping the cause and shortening the audit record to 300 characters. Dashboard job failures, failed music slash-command actions, and asynchronous audio-source playback exceptions are recorded in the audit log. Open an event and use **Copy error** to copy its exact stored detail, or **Copy full event** for JSON. Line breaks are preserved. Credentials, authorization fields, and URL query values are redacted; details are bounded to 8,192 characters with an explicit truncation marker. Old shortened records cannot be recovered; retry once to capture a new event. A Java cause may itself be generic; the backend log remains necessary in that case.

### Read-only source check

Run from the repository root, with `DEMO_MODE=false`, `LAVALINK_URL`, and `LAVALINK_PASSWORD` in `.env`:

```sh
# Versions, plugin names/versions, and actually loaded source managers.
npm run music:doctor

# Repeat the same search phrase; shell quotes preserve spaces.
npm run music:doctor -- --query "the same failing search text"

# Or supply an authorized public SoundCloud/Bandcamp track URL.
npm run music:doctor -- --query "YOUR_PUBLIC_SUPPORTED_HTTPS_TRACK_URL"

# Help works without credentials or any services.
npm run music:doctor -- --help
```

Only `GET /v4/info` and, with a query, `GET /v4/loadtracks` are used. There is no Discord token requirement, gateway login, voice join, database/Redis access, queue mutation, playback, or fallback to a different source. The doctor uses the same input policy and result/error handling as the player, including configured search prefixes, HTTPS/host restrictions, and public DNS checks. It checks whether the configured source manager is actually loaded. A successful lookup proves only that metadata loaded, **not** that the stream or Discord voice connection will work.

JSON goes to stdout; failures return exit status 1. For clean piping use `npm run --silent music:doctor ...`. Production build: `node dist/music-doctor.js [--query "text"]`. For a Compose-run bot, run the utility inside that bot's network:

```sh
docker compose --profile live --profile music run --rm --no-deps bot node dist/music-doctor.js --query "the same failing search text"
```

When run on the host instead, use the host-published address (normally `localhost:2333`), not Compose's internal `lavalink:2333`. Keep the password in `.env`, never a command-line argument. Input source URLs may themselves be private; do not share them, tokens, or unreviewed logs.

### Act on the observed failure

- **Backend HTTP 401/403:** the doctor's `/v4/info` request could not authenticate. Match bot/backend passwords. This is different from a provider's HTTP 401/403 inside a source exception.
- **Source manager absent:** enable `lavalink.server.sources.soundcloud` or `.bandcamp` in the actual backend configuration and restart that backend. The supplied configuration enables both and explicitly enables SoundCloud search.
- **Provider HTTP 401/403, rate limiting, or region/access restrictions:** inspect the returned cause and Lavalink log. Respect provider restrictions; do not introduce login cookies, DRM bypasses, unauthorized fallbacks, or arbitrary HTTP loading.
- **DNS, connection, TLS, or timeout cause:** inspect outbound HTTPS/DNS reachability from the **Lavalink container**, not just from the host/browser.
- **Search fails, public source URL succeeds:** investigate the configured search prefix, search configuration, and installed source adapter/version. Current upstream supports `scsearch` and `bcsearch`, but an older deployed backend may not. Orbit does not switch providers silently. A pasted prefix for the configured provider is accepted without double-prefixing.
- **No playable result:** try a different authorized public track. Empty results, empty playlists, source exceptions, and unreachable backends are reported separately; none is treated as a successful play.

If the installed source adapter is stale, update a **compatible** Lavalink v4 image and restart only that service:

```sh
docker compose --profile music pull lavalink
docker compose --profile music up -d lavalink
docker compose logs --tail=150 lavalink
```

Updating can repair an outdated extractor; it is not a guarantee against a provider outage or restriction. For example, upstream reports [SoundCloud stream failures](https://github.com/lavalink-devs/lavaplayer/issues/189) and [metadata loading successfully but HLS playback returning 404](https://github.com/lavalink-devs/lavaplayer/issues/203). These are distinct from a lookup-stage failure and are not proof of the cause on your installation. Do not install an unreviewed third-party plugin/fork merely because an issue comment suggests it. Reproduce once and inspect `docker compose logs --tail=150 lavalink` immediately afterward. Review/redact logs before sharing. Without the cause or that log, a generic lookup error alone is not enough to confirm the upstream root cause or claim it is fixed.

## Commands and controls

`/play`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`, `/shuffle`, and `/repeat` are implemented; an operator must register the commands with Discord. The dashboard’s **Commands** reference comes from those definitions and does not verify live registration. Dashboard controls use the same music service through a dedicated action queue. Members must be in the bot’s voice channel. If a DJ role is configured, that role or Manage Server permission is required. The bot’s channel permissions and current module state are checked at execution time.

Volume is bounded to 0–100%; queue limits are configurable. Unsupported or unavailable sources produce a useful command/job error rather than a fabricated success. Dashboard actions wait briefly for the job; slow actions remain queued and failures are recorded in the audit log. Music actions are not automatically retried because repeating a skip/play request could change the queue twice.

Queue state is stored for dashboard observation. An ordinary Lavalink reconnect can use its short resume window, but a full bot restart does not automatically rejoin voice or restore an in-memory session. Start a new `/play` session after restart; the service replaces stale snapshots on new actions. Plan restarts accordingly. In demo mode, all tracks are fictional previews and **no audio is played**.
