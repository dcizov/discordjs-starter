# Reviewed Lavalink plugin profile

Reviewed against upstream release tags/source on **2026-10-24**. The base remains **Lavalink 4.2.2 / Lavaplayer 2.2.6**, with its official unprivileged JVM image. The nine requested plugins are in addition to the existing pinned Soundy SoundCloud adapter.

## Inventory and one owner per capability

| Requested project                                                                    | Pinned release | Active responsibility                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [youtube-source](https://github.com/lavalink-devs/youtube-source/tree/1.18.2#plugin) | 1.18.2         | The **only YouTube audio manager**, including `ytsearch`/`ytmsearch`. The built-in YouTube loader stays off. Credential-free clients `MUSIC, ANDROID_VR, WEB, WEBEMBEDDED` (upstream's documented example list); OAuth, TV and `poToken` remain disabled by default.                                                    |
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

### Why one specific YouTube item still fails (and what Orbit does about it)

Observed on a production deployment (`youtube-source 1.18.2`, Lavalink 4.2.2,
Lavaplayer 2.2.6, Soundy 1.1.0); audit event
`ec6855f8-5803-4246-91ef-d80db9bc962f`, 2026-10-27T12:03:39.191Z:

```text
ANDROID_VR: This video requires login.
WEB: No supported audio streams available.
WEB_EMBEDDED: This video is unavailable.
All clients failed to load the item.
```

This is a **provider restriction raised after lookup, during playback**. It is not
a Discord voice handshake failure, not an URL-validation rejection (the URL was
accepted and resolved), and not a plugin conflict — all three failures come from
three different clients of the same source manager. Upstream documents exactly this
class of error as "requests flagged by YouTube"; the documented ways to change the
outcome are OAuth (a signed-in session) or a `poToken`, with the important caveat
that neither is a guaranteed fix ("not a silver bullet"), and OAuth means lending a
YouTube account to the backend — upstream advises a burner account because of the
risk. Terms and account risk are the operator's decision, not a default.

> **The audit ID does not identify the video.** No failing URL was captured with
> the incident, so the item cannot be reproduced and no fix can be verified as
> fixing _that_ item. Everything below is configuration hygiene and diagnostics
> quality, not a proven repair.

Orbit therefore ships the credential-free client list, keeps `oauth.enabled: false`
and `pot` unset, and never supplies cookies or account tokens implicitly. If an
operator chooses to opt in, upstream's own keys are used, unchanged:

```yaml
plugins:
  youtube:
    oauth:
      enabled: true
      # refreshToken: "..."   # only after completing upstream's device flow
    # or, for WEB/WEBEMBEDDED only:
    # pot:
    #   token: "..."
    #   visitorData: "..."
```

Never commit those values: they are credentials. Keep them in an ignored
`application.yml` overlay or the container environment, restart Lavalink, and
re-run `npm run music:doctor`. Orbit's audit summary names the failure category
(`provider-login`, `no-streams`, `drm`, `rate-limit`, `auth`, `network`,
`format`, `unknown`) so an operator can tell "the provider answered with an
authentication/bot challenge" from "the backend cannot reach the provider".

`provider-login` is a **classification of the evidence in the exception**, not a
diagnosis of one universal cause: the message says the provider asked for a
signed-in/verified session or rejected this backend's client (for example
`requires login`, `Sign in to confirm you're not a bot`). It deliberately does
not claim "this item is fully private", and it is kept distinct from a Discord
voice-permission problem (Connect/Speak) and from backend connectivity, which are
different failures with different diagnostics. Ordinary listeners get that
concise explanation and nothing else — no tokens, cookies, signed URLs or stack
traces; the full exception stays in the operator-only audit detail, and the
doctor is the next step for whoever can read the backend logs.

What was checked and ruled out for that report:

- **Version**: 1.18.2 is the newest youtube-source release (published
  2026-07-27; **re-verified directly against the releases API on 2026-10-27** —
  there is still no 1.18.3). So this is not an outdated-plugin problem and there
  is no upgrade to apply. A version bump would be theatre.
- **Upstream issue #240 is _not_ evidence about this deployment.** It is the most
  cited report for this error text, so it is worth stating the differences
  precisely rather than inheriting its conclusions:
  - The reporter runs `oauth.enabled: true` **and** `remoteCipher.url:
https://cipher.kikkia.dev/` — a third-party cipher service. Orbit's
    configuration has `oauth.enabled: false` and **no** `remoteCipher`, which
    stays the default.
  - The reporter enables seven clients (`TV, MWEB, WEB, MUSIC, WEBEMBEDDED,
ANDROID_VR, TVHTML5_SIMPLY`); Orbit enables four, and `TV` — the one whose
    playback requires sign-in — is not among them.
  - The reporter explicitly answered the issue template's attestation with "I DO
    NOT confirm that this has been filled out truthfully."
  - Issues #244 (2026-09-08, "why was there no 1.18.3"), #250 (2026-10-13,
    client ordering affects search) and #248 (2026-10-08, SABR seeking) show the
    same area is still in flux upstream.
  - The SABR / region / rollout explanation in that thread is therefore a
    **plausible upstream hypothesis**, not a verified cause of this incident.
- **Client list**: the configured list is upstream's own default
  (`DEFAULT_CLIENTS = MUSIC, ANDROID_VR, WEB, WEBEMBEDDED` in
  `YoutubeAudioSourceManager`), and none of those four is OAuth-only. `TV` is the
  only client whose _playback_ needs sign-in; it is not enabled.
- **`allowDirectVideoIds: false` / `allowDirectPlaylistIds: false`**: these only
  gate _bare identifiers_ (`dQw4w9WgXcQ`, `PL…`). Full `watch?v=`, `youtu.be`,
  `shorts`, `live` and `playlist?list=` URLs are routed regardless of the flag, so
  the setting is not why a pasted link fails.
- **Plugin overlap**: both error lines come from two clients of one source
  manager, so no second YouTube manager is fighting over the item.

Because Orbit also treats a bare identifier as search text, `/play` now answers
that case with an explicit "paste the full link" hint instead of a generic empty
result.

### Per-client evidence in the failure report

Three clients answered the incident above with three **different** sentences.
Reporting one category for all of them hides two thirds of the evidence, so the
report is now built per client:

| Where                                    | What it contains                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Audit **summary** (≤300 chars, one line) | `YouTube playback failed (provider-login, no-streams). ANDROID_VR: This video requires login. WEB: No supported audio streams available. WEB_EMBEDDED: This video is unavailable. …` |
| Audit **details** (unbounded)            | One numbered line per distinct answer with the clients that gave it and its category, then the full next-step text for **every** observed category                                   |

Rules the implementation follows:

- **Each client line is classified on its own.** `musicFailureCategories` returns
  every category the evidence supports; `category` remains the first for
  backwards compatibility. Previously the whole blob resolved to a single
  category by regex order and the other answers were discarded.
- **Identical answers are grouped, not repeated.** Three clients saying "requires
  login" produce one entry listing all three, instead of the same sentence three
  times. Grouping is case-insensitive so `This video requires login.` and
  `this video requires login` are one answer.
- **Java stack frames are dropped.** `\tat dev.lavalink…(Client.java:77)` lines
  and a reason that ran into its own frame are evidence for the Lavalink log,
  not for an audit row.
- **Truncation is word-safe.** `slice(0, 300)` used to end the summary mid-word
  (`…and O`). `truncateAtWord` cuts at the last space and always ends with `…`
  when it cut anything.
- **The guidance text is no longer squeezed into the summary.** It is ~490
  characters and the summary is capped at 300, so it now lives in `details`
  where an operator reads it whole rather than half of it.
- **Backends that report no per-client lines are unaffected.** Ordinary
  single-reason failures (`HTTP 429`, `SocketTimeoutException`, …) fall back to
  classifying the whole message, exactly as before.

Two reported symptoms were checked against the code and are **not** code defects
here, so nothing was changed for them:

- _"Markdown linkification of Java package names."_ No Markdown renderer touches
  audit text: the bespoke `marked` + `sanitize-html` pipeline renders
  repository-authored `docs/` files only. The audit summary and details are
  rendered as plain text.
- _"Duplicated per-client exception text."_ The duplication was **real** but it
  is now handled by grouping (above) rather than by suppressing information.

Items that require a login, are private, region-locked, removed, DRM-protected or
otherwise provider-restricted can remain unplayable. Orbit reports that plainly
instead of pretending a different recording was played.

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
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music up -d --build
docker compose -f docker-compose.yml -f docker-compose.dev.yml --profile live --profile music logs -f --tail=100 web bot worker lavalink
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
