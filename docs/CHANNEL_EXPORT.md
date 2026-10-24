# Export channels, server roles, and configured permissions

Orbit includes a **read-only CLI developer utility**. It queries Discord directly rather than exporting the dashboard's simplified database snapshot. It does not log in to the gateway, start another bot session, send messages, or change roles/channels/permissions. The running bot does not need to be stopped.

## Requirements

Run commands from the repository root after `npm ci`. In your root `.env`, use:

```dotenv
DEMO_MODE=false
DISCORD_TOKEN=your_existing_bot_token
```

Use your existing bot token; do not put it on the command line or share it. The bot must belong to the selected server, and Discord must permit the required API reads (three for channels, two for roles only). Only export servers you are authorized to administer. No database, Redis, application client secret, gateway connection, or privileged gateway intents are needed by this utility.

The numeric server ID is in your dashboard URL: `/dashboard/SERVER_ID/…`. Alternatively enable Developer Mode in Discord, right-click the server, and select **Copy Server ID**. Do not use the application/bot ID as the server ID.

## Export all server channels

```sh
npm run channels:export -- --guild YOUR_SERVER_ID
```

This creates a timestamped JSON file under `.exports/`, for example:

```text
.exports/channels-SERVER_ID-2026-10-24T12-00-00-000Z.json
```

Choose a new output path explicitly:

```sh
npm run channels:export -- --guild YOUR_SERVER_ID --out .exports/server-channels.json
```

Existing files are **never overwritten**. Choose a different name for another snapshot. Parent directories are created automatically. File creation requests mode `0600` and newly created directories `0700` on Unix-like systems; protect the folder using appropriate OS permissions/ACLs on other platforms.

## Export all server roles, without channels

```sh
npm run roles:export -- --guild YOUR_SERVER_ID
npm run roles:export -- --guild YOUR_SERVER_ID --out .exports/server-roles.json
npm run --silent roles:export -- --guild YOUR_SERVER_ID --stdout | jq '.roles'
```

This uses exactly **two GETs** (server metadata and server roles), with no channel or member requests. It includes `@everyone`, ordinary roles, and managed/integration roles returned by Discord. The format is `orbit.discord-server-roles`, schema version 1. Default output is `.exports/roles-SERVER_ID-TIMESTAMP.json`, with the same private file permissions and no-overwrite behavior as channel exports.

Equivalent forms are `npm run channels:export -- --roles-only --guild YOUR_SERVER_ID` and, after the service build, `node dist/export-channels.js --roles-only --guild YOUR_SERVER_ID`. `--roles-only` cannot be combined with `--channel`.

Both role-only and channel exports now include role color and enhanced colors, hoist (separate display), mentionability, icon hash/Unicode emoji, role flags, `isEveryone`, and available bot/integration/subscription tags, alongside positions, managed state, and exact permission masks. Colors retain Discord's integer RGB representation. Discord's **present-null tag markers mean true**; an absent marker inside a returned tags object means false. Entirely absent optional metadata is `null`, not an invented default. No member list, member-role assignments, CDN fetch, or effective-permission calculation is performed.

## Export one channel

```sh
npm run channels:export -- --guild YOUR_SERVER_ID --channel YOUR_CHANNEL_ID
```

The selected channel and its parent category, if returned by Discord, are included. Parent context IDs are listed in `selection.contextChannelIds`. Role definitions are still included so the overwrite IDs and base permissions are meaningful. Selecting a category exports that category alone, **not** a recursive subtree; use the full server export for all its children.

## Pipe JSON to another tool

```sh
npm run --silent channels:export -- --guild YOUR_SERVER_ID --stdout | jq '.channels'
```

`--silent` suppresses npm's own banner. The exporter writes only JSON to stdout and progress/errors to stderr. `--stdout` and `--out` are mutually exclusive. With shell redirection, the shell—not this utility—controls destination permissions and may truncate an existing file; prefer the default file output when you want overwrite protection.

Help does not require credentials or contact Discord:

```sh
npm run channels:export -- --help
```

The production service build also provides the standalone bundle:

```sh
npm run build:services
node dist/export-channels.js --guild YOUR_SERVER_ID
```

## What the JSON contains

- Format identifier, schema version, timestamp, server ID/name/owner ID, and selection information.
- Server roles, including `@everyone`, with names, hierarchy positions, managed status, **configured base permissions**, and the optional role metadata described above.
- Channel IDs, names, numeric/explanatory channel types, positions, and parent-category IDs. Text, voice, announcements, categories, stages, forums, and media channels retain their distinct types.
- Role and member **permission overwrites**, with explicit `allow` and `deny` masks and human-readable permission names. Role targets have names where available; member targets retain IDs without fetching member names or memberships.
- Exact decimal bitfield **strings**, plus `unknownBitfield` for bits not recognized by the installed Discord.js version. Do not convert these masks to JavaScript `Number`, which loses precision for high bits.
- `overwritesMatchParent`: an order-independent comparison of the stored overwrite sets at export time. `null` means no parent/comparison is available. Missing overwrite data is `null`, not a fabricated empty policy; related warnings are included.

## Boundaries and privacy

This is **not calculated effective permission access for every member**. Unset overwrite bits are unspecified/inherited, not an explicit deny or grant. Effective access also depends on membership/role combinations, owner/Administrator bypasses, channel-type rules, timeouts, and other Discord behavior. Administrator is not expanded into every permission in the exported masks.

Threads (including forum posts, active/archived/private threads), thread membership, member role assignments, messages, channel topics, webhooks, environment variables, and tokens/secrets are not exported. No import/restore command is included: this is a diagnostic configuration snapshot, not a complete server backup.

The channel export reads server, role, and channel metadata through three separate GET requests (the role-only export uses two), so concurrent edits can produce snapshot warnings such as a deleted role target. IDs and raw masks are retained rather than silently dropping unresolved references. Re-export after edits settle if consistency matters.

Treat the file as sensitive: it can contain private channel names and role/member IDs. `.exports/` is excluded from Git and Docker build context by default. A custom `--out` destination outside that directory is your responsibility. Do not commit private exports or paste them into public logs.

Demo mode refuses the live export and never writes fake server data. Authentication/access failures or invalid inputs fail the command with a nonzero exit code instead of reporting a successful partial export.
