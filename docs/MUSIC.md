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

## Commands and controls

`/play`, `/queue`, `/pause`, `/resume`, `/skip`, `/stop`, `/volume`, `/shuffle`, and `/repeat` are registered. Dashboard controls use the same music service through a dedicated action queue. Members must be in the bot’s voice channel. If a DJ role is configured, that role or Manage Server permission is required. The bot’s channel permissions and current module state are checked at execution time.

Volume is bounded to 0–100%; queue limits are configurable. Unsupported or unavailable sources produce a useful command/job error rather than a fabricated success. Dashboard actions wait briefly for the job; slow actions remain queued and failures are recorded in the audit log. Music actions are not automatically retried because repeating a skip/play request could change the queue twice.

Queue state is stored for dashboard observation. An ordinary Lavalink reconnect can use its short resume window, but a full bot restart does not automatically rejoin voice or restore an in-memory session. Start a new `/play` session after restart; the service replaces stale snapshots on new actions. Plan restarts accordingly. In demo mode, all tracks are fictional previews and **no audio is played**.
