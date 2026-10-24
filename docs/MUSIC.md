# The listening room: Lavalink v4

Orbit uses **Shoukaku** as a maintained Discord.js-to-Lavalink client. Lavalink handles source loading, encoding, voice connectivity, and Discord voice encryption. The web dashboard is a remote controller; it never streams audio in the browser.

## Start the optional backend

1. Set `LAVALINK_PASSWORD` to a strong value in `.env`.
2. Start a **current** Lavalink v4 release:

   ```sh
   docker compose --profile music up -d lavalink
   ```

3. When the bot is inside Compose, use:

   ```env
   LAVALINK_URL=lavalink:2333
   LAVALINK_PASSWORD=<same password>
   LAVALINK_SECURE=false
   MUSIC_SEARCH_PREFIX=scsearch
   MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com
   ```

4. For a bot running directly on your host, run Lavalink locally or expose its port on **loopback only** using a local Compose override. The base Compose file does not publish the Lavalink port. `localhost:2333` cannot reach a container-only port without this step.
5. Give Orbit **Connect** and **Speak** in a normal server voice channel. Join it and use `/play`. Stage-channel speaker promotion is not automated.

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
