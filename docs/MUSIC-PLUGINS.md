# Reviewed Lavalink plugin profile

Reviewed against upstream release tags/source on **2026-10-24**. The base remains **Lavalink 4.2.2 / Lavaplayer 2.2.6**, with its official unprivileged JVM image. The nine requested plugins are in addition to the existing pinned Soundy SoundCloud adapter.

## Inventory and one owner per capability

| Requested project                                                                    | Pinned release | Active responsibility                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [youtube-source](https://github.com/lavalink-devs/youtube-source/tree/1.18.2#plugin) | 1.18.2         | The **only YouTube audio manager**, including `ytsearch`/`ytmsearch`. The built-in YouTube loader stays off. Public, non-age-restriction-capable MUSIC/ANDROID_VR/WEB clients only; OAuth/embedded/TV clients are not enabled.                                                                                          |
| [SponsorBlock](https://github.com/topi314/SponsorBlock-Plugin/tree/3.0.1)            | 3.0.1          | Sponsor segment/chapter extension, not another music source. The bot sends the documented per-player categories PUT after joining voice.                                                                                                                                                                                |
| [LavaSrc](https://github.com/topi314/LavaSrc/tree/4.8.3)                             | 4.8.3          | **Extended YouTube search** for LavaSearch and **LRCLIB lyrics** for LavaLyrics. `sources.youtube` creates a search wrapper around youtube-source, not another audio manager. All premium/credential-dependent/mirroring/yt-dlp/TTS adapters stay off. `providers: []` prevents silent mirrored-recording substitution. |
| [LavaSearch](https://github.com/topi314/LavaSearch/tree/1.0.0)                       | 1.0.0          | Extended-search REST API, using LavaSrc's search wrapper. No additional audio source.                                                                                                                                                                                                                                   |
| [LavaLyrics](https://github.com/topi314/LavaLyrics/tree/1.1.0)                       | 1.1.0          | Lyrics facade/live-event capability with **only LRCLIB registered** by LavaSrc. No automatic lyric subscriptions or Discord lyric posts.                                                                                                                                                                                |
| [lava-xm-plugin](https://github.com/esmBot/lava-xm-plugin/tree/v0.2.8)               | 0.2.8          | Tracker-module **format decoder**, not a URL/upload source. Conservative amplification/interpolation. HTTP/local-file sources remain disabled. This does not make arbitrary `.xm` URLs or uploads accepted by the bot.                                                                                                  |
| [lyrics.kt](https://github.com/DRSchlaubi/lyrics.kt/tree/2.6.1)                      | 2.6.1          | **YouTube lyrics only**. LavaSrc's YouTube lyrics adapter is disabled so it does not invoke the same provider again through LavaLyrics.                                                                                                                                                                                 |
| [LavaDSPX](https://github.com/Devoxin/LavaDSPX-Plugin/tree/0.0.5)                    | 0.0.5          | High-pass, low-pass, normalization and echo extensions. The built-in `lowPass` filter is disabled to avoid two low-pass implementations. Effects are opt-in; nothing forces boosts/echo on playback.                                                                                                                    |
| [Skybot/DuncteBot](https://github.com/DuncteBot/skybot-lavalink-plugin/tree/1.7.2)   | 1.7.2          | **OC ReMix only**. Every other source switch is explicitly false, including adult/social/upload/TTS sources and the `elgato` switch omitted from its README example.                                                                                                                                                    |

SoundCloud remains owned **only by Soundy 1.1.0**, built from the existing reviewed upstream source pin. Bandcamp remains owned **only by Lavalink's built-in adapter**. The expected `/v4/info` audio-source set is exactly:

```text
bandcamp, ocremix, soundcloud, youtube
```

There are ten plugin identities: these nine plus Soundy. There is no second SoundCloud/YouTube loader, no second TTS provider, and no Spotify-to-YouTube/Deezer fallback. The same recording is not retried on unrelated services. Basic track search and LavaSearch's richer album/artist/playlist search are separate API shapes backed by the same YouTube loader.

### Important real configuration details

- `plugins.lavalyrics.sources` is an **ordering list**, not a provider enable/disable list. LavaSrc's `lyrics-sources` switches control registration. In LavaSrc 4.8.3, LRCLIB's `getSourceName()` returns an empty string; the config deliberately leaves the ordering list empty rather than inventing a `lrclib` key. Only that one provider is registered with LavaLyrics.
- lyrics.kt and LavaLyrics expose **different routes**, not conflicting Spring mappings. Do not call both for a single lookup: use lyrics.kt for YouTube, LavaLyrics/LRCLIB for other recordings. The dashboard does not currently expose lyrics or extended-search buttons, and it does not make duplicate/background lyric requests.
- SponsorBlock has **no global `enabled`/category YAML switch**. `MusicPluginRest` uses the actual authenticated `/v4/sessions/{sessionId}/players/{guildId}/sponsorblock/categories` PUT with a JSON array. The default is `sponsor,selfpromo,interaction`; set `MUSIC_SPONSORBLOCK_CATEGORIES=` and restart the bot to disable it. Other valid categories: `intro,outro,preview,music_offtopic,filler`. Invalid categories fail explicitly. A remote node without the plugin is left alone; optional setup failures are logged/audited and do not silently claim sponsor skipping.
- LavaDSPX 0.0.5 contains template/hand-written plugin packaging metadata. The build installer normalizes this to **one** `lavadspx-plugin` registration, preserving its classes/notices. It will not modify a signed JAR. There is no made-up `plugins.lavadspx.enabled` flag.

## SFW boundaries — do not confuse sources with content ratings

**No adult-source adapter is enabled.** PornHub and Soundgasm are disabled. Reddit, Tumblr, TikTok, Pixeldrain, Clyp, Yarn, Mixcloud, TTS and arbitrary uploads are also disabled in this conservative profile. Their classes may exist inside upstream's Skybot JAR, but their source managers are not registered. The bot's independent URL/prefix policy permits only the four approved providers, even if someone broadens `MUSIC_ALLOWED_HOSTS`.

Music requests in NSFW voice channels are rejected. When an adapter actually supplies an explicit/age-restriction flag, a flagged request/playlist is rejected as a whole, without silently selecting a different track. No age-bypass clients, account cookies, access tokens, decryption keys, proxies or yt-dlp service are configured.

**This is not an automatic guarantee that every SoundCloud/Bandcamp/YouTube/OC ReMix recording, title, cover or lyric is SFW.** These catalogs have no universal reliable content-rating flag. Unknown is not certified clean; SponsorBlock is not an explicit-content filter. Server administrators must curate clean recordings and moderate requests. For a strict all-ages guarantee, use a separately reviewed catalog/allowlist; unrestricted public search cannot provide that guarantee. Lyrics are not automatically posted to shared Discord channels.

Use only content you are authorized to play and respect provider terms/limits. Unsupported, protected, region-restricted, unavailable or blocked streams remain failures. Installing a plugin does not grant premium access or prove live playback.

## Build, integrity and runtime

`docker/lavalink/plugins.lock.json` records each release, immutable upstream source revision, HTTPS artifact URL and reviewed **SHA-256**. The installer verifies the original downloaded artifact **before** any metadata normalization. Source/license notices are included under `/opt/Lavalink/licenses`; LavaDSPX-Plugin supplies no LICENSE at its pinned tag, which is explicitly noted rather than described as MIT. Review redistribution rights before publishing a derived image.

Artifacts are downloaded in a **build-only Python stage**, not during Lavalink startup. Gradle still builds/tests the pinned Soundy source in a separate build stage. Neither Python nor Gradle is added to the final official JVM image. No runtime plugin directory volume is layered over the baked, reviewed set; stale externally mounted JARs can defeat these guarantees and should not be added.

Normal builds reject missing/mismatched hashes. `--review-unpinned` exists only for explicit CI maintenance review; it is never used by the Dockerfile or the regular CI build. Updates require reviewing upstream source/configuration/compatibility, replacing the version/revision/digest together, and rebuilding. Never accept a changed digest merely to make a build pass.

```sh
# From the Docker host, with existing live .env configured. No volume reset.
npm run dev:stack
npm run dev:stack:logs
```

Update an **existing** `.env` host list if you want the newly included public sources (copying `.env.example` is not automatic):

```env
MUSIC_ALLOWED_HOSTS=soundcloud.com,bandcamp.com,youtube.com,youtu.be,ocremix.org
MUSIC_SEARCH_PREFIX=scsearch
```

Choose **one** default prefix: `scsearch`, `bcsearch`, `ytsearch` or `ytmsearch`. There is no automatic provider fallback. OC ReMix is URL-only. Keep Lavalink private/loopback; never send its password to the browser. Raw extension APIs share Lavalink's server password and are trusted-server interfaces, not per-guild public dashboard endpoints.

## Extension API scope

Installed backend capabilities, not extra dashboard features:

- LavaSearch: `/v4/loadsearch` (the upstream richer-search API).
- LavaLyrics: `/v4/lyrics?track=...` and `/v4/sessions/{sessionId}/players/{guildId}/track/lyrics`; live subscriptions are **not** enabled by Orbit.
- lyrics.kt: `/v4/lyrics/{videoId}` and `/v4/sessions/{sessionId}/players/{guildId}/lyrics` for YouTube lyrics. Its broad track-search utility should not be used as a second lyrics path for the same recording.
- SponsorBlock: session/guild-scoped categories endpoint, used by the bot.
- LavaDSPX: Lavalink player-update `filters.pluginFilters`, not a duplicate frontend effects panel.

The dashboard retains the existing authorized music controls. They go through the bot's per-guild, fresh-member, voice/DJ/module permission checks. Do not proxy raw backend endpoints/passwords to browsers to add features.

## Verification boundary

Offline tests cover hashes/JAR identities, configuration exclusions, input/DNS/source policy, optional plugin request scoping, immediate command deferral, truthful action receipts and demo isolation. CI also builds the real image, starts it **without external network access**, and checks all plugin versions, exactly one approved audio manager per source, and the DSP filter registration. A separate real Redis/BullMQ smoke exercises offline rejection, a deterministic scoped stub consumer and expired-job rejection without logging into Discord.

These checks establish packaging/startup/protocol behavior, **not** live provider access, native tracker decoding, audible Discord playback, real SponsorBlock segments or lyric quality. Test an authorized clean recording in your server after startup; use [the read-only music doctor](MUSIC.md#read-only-source-check) and the bot/Lavalink logs to identify the actual failure stage.
