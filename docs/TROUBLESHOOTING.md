# Troubleshooting

Start from the symptom you can see, not from a guess about the cause. This page
is a **router**: it names the evidence worth collecting and links to the page
that owns the fix. It deliberately does not restate any procedure — a second
copy of a fix is a second copy that can go stale, and the owning page is the one
whose tests and code review cover it.

Two rules apply to every entry here:

- **Read the error, do not replace it.** A message that says nothing is a bug in
  the diagnostic, not permission to invent a cause.
- **Do not destroy data to make a symptom disappear.** No `down -v`, no deleted
  PostgreSQL/Redis volumes, no `pkill` of a process you have not identified.

## The dashboard

| Symptom                                                       | Where the fix is owned                                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `http://localhost:3000` shows nothing or connection refused   | [Dashboard unreachable at localhost:3000](DEVELOPMENT.md#dashboard-unreachable-at-localhost3000)            |
| Dashboard works, the bot does not answer in Discord           | [Start the bot, not only the dashboard](MUSIC.md#start-the-bot-not-only-the-dashboard)                      |
| `Module not found: Can't resolve '<package>'` after an update | [Dependency mismatch after an update](DEVELOPMENT.md#module-not-found-cant-resolve-package-after-an-update) |
| Dashboard still unreachable inside the Dev Container          | [Dev Container: dashboard still unreachable](DEVCONTAINER.md#dashboard-still-unreachable)                   |
| Hydration warnings in the browser console                     | [Hydration warnings](DASHBOARD-UX.md#hydration-warnings-in-the-browser-console)                             |

## Sign-in, permissions and identity

| Symptom                                         | Where the fix is owned                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Discord says `Invalid OAuth2 redirect_uri`      | [OAuth redirect](DEPLOYMENT.md#discord-says-invalid-oauth2-redirect_uri)                      |
| "You need Manage Server" but you own the server | [Practical setup in Discord](PERMISSIONS.md#practical-setup-in-discord)                       |
| A command is missing from Discord               | [Slash-command registration](../README.md#3-register-slash-commands)                          |
| Dashboard cannot verify server permissions      | [Permission verification](DEPLOYMENT.md#dashboard-cannot-verify-discord-server-permissions)   |
| A moderation or role action is refused          | [Six layers, do not conflate them](PERMISSIONS.md#six-different-layers--do-not-conflate-them) |
| Avatars, or the audit log, look wrong           | [Audit identity images](DASHBOARD-UX.md#audit-identity-images)                                |

## PostgreSQL and Redis

| Symptom                                                           | Where the fix is owned                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PostgreSQL is unhealthy: data directory exists but is not empty` | [PostgreSQL volume mismatch](DEPLOYMENT.md#postgresql-is-unhealthy-data-directory-exists-but-is-not-empty) |
| Migrations did not run before the app started                     | [Development lifecycle](DEVELOPMENT.md#development-lifecycle)                                              |
| Services restart in a loop after an environment change            | [Environment changes](DEVELOPMENT.md#development-lifecycle)                                                |

## Music and voice

Music is optional. None of these failures disable the rest of Orbit.

| Symptom                                                       | Where the fix is owned                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Health row or log says `Lavalink connection error`            | [What that error means](MUSIC.md#what-lavalink-connection-error-means)                  |
| Backend HTTP 401/403, no source manager, provider 401/403     | [Other failures and diagnostics](MUSIC.md#other-failures-and-diagnostics)               |
| `Did not detect any supported formats` for a SoundCloud track | [SoundCloud format diagnosis](MUSIC.md#soundcloud-did-not-detect-any-supported-formats) |
| `Voice handshake: not established in 15 seconds`              | [Voice handshake](MUSIC.md#voice-handshake-not-established-in-15-seconds)               |
| Playback stops, or the bot leaves an empty channel            | [Leaving voice: the disconnect policy](MUSIC.md#leaving-voice-the-disconnect-policy)    |
| A search or URL is refused before it reaches Lavalink         | [Which links are accepted](MUSIC.md#which-links-are-accepted)                           |
| "Is the source even loaded?"                                  | [Read-only source check](MUSIC.md#read-only-source-check) (`npm run music:doctor`)      |

Before asking anyone for help with music, run the doctor and redact what you
paste. It prints sanitized JSON and never prints the Lavalink password or
encoded/signed track URLs.

```sh
npm run --silent music:doctor -- --query "the same failing search text"
```

A successful doctor run proves metadata loading, **not** audible playback. Only
listening in the voice channel does that.

## News, deals and deliveries

| Symptom                                                     | Where the fix is owned                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A delivery never arrives                                    | [News sources and webhooks](INTEGRATIONS.md) — check the delivery history and retry state |
| A source starter is unavailable                             | [Feature setup](DEVELOPMENT.md#3-enableconfigure-the-features)                            |
| A card is truncated or attributed differently than expected | [News formatting contract](NEWS-FORMATTING.md)                                            |
| Deal prices or regions look wrong                           | [Deals and watchlists](DEALS.md)                                                          |

## Tests and CI

| Symptom                                              | Where the fix is owned                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A check fails locally but not in CI (or the reverse) | [Before you open a pull request](WORKFLOWS.md#before-you-open-a-pull-request)               |
| Playwright cannot start (no browser installed)       | [The same page](WORKFLOWS.md#before-you-open-a-pull-request) — install Chromium, then rerun |
| A flaky browser test                                 | [Current status](CONTINUATION.md), then fix the interaction; never raise the timeout        |

## When the evidence is not enough

If a diagnostic says `unknown`, that is honest: the error carried no name, code,
status or cause the bot is allowed to read. Collect the surrounding lines from
both sides before changing configuration:

```sh
# The bot's own view (never includes credentials).
docker compose logs --tail=200 bot

# The backend's view of the same window.
docker compose logs --tail=200 lavalink
```

Do not paste `.env`, tokens, passwords, cookies or private source URLs into an
issue. If you must share a URL, replace its query values first.

## Related

- [Development workflows](WORKFLOWS.md) — which workflow you are running, and the commands for it.
- [Deployment](DEPLOYMENT.md) — the runtime images, health checks and updates.
- [Security model](SECURITY.md) — trust boundaries before you change a provider or a webhook.
