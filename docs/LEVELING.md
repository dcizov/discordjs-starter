# Levels & XP

A quiet record of who shows up. Levels are **not money** — they cannot be
spent, traded or bought, and they are stored separately from the economy's
currency. Turning the module off pauses the counting; it never resets anybody.

## The curve

Advancing **from level _n_ to level _n+1_** costs:

```
cost(n) = 5n² + 50n + 100
```

Reaching **level _n_ in total** has cost:

```
total(n) = (5/3)n³ + (45/2)n² + (455/6)n
```

Those are two different numbers, and the most common way to get a leveling
system wrong is to treat them as one: level 1 takes 100 XP to reach and 155 XP
to leave. `/rank` prints both, and so does the dashboard's "How levels work"
tab — and both are computed from these functions, not from a table that can
drift.

| Reaching level | Total XP to get here | XP to reach the next level |
| -------------: | -------------------: | -------------------------: |
|              1 |                  100 |                        155 |
|              2 |                  255 |                        220 |
|              3 |                  475 |                        295 |
|              4 |                  770 |                        380 |
|              5 |                 1150 |                        475 |
|             10 |                 4675 |                       1100 |
|             25 |                42000 |                       4475 |
|             50 |               268375 |                      15100 |
|            100 |              1899250 |                      55100 |

The same per-level cost is used by several of the established leveling bots,
so a member's intuition about how fast levels arrive is roughly right. Levels
are computed from the total with a bounded search, not by replaying history —
an adjustment to someone's total re-derives their level in one step.

## Earning from messages

- Each qualifying message awards a **random amount in a configured range**,
  default 15–25, once per member per cooldown (default 60 seconds).
- Messages shorter than 5 characters do not count.
- Bots and webhooks never earn.
- Excluded channels and excluded roles never earn.
- **Repetition protection without keeping your words.** A short fingerprint of
  the text is stored (`lastMessageHash`); the message content itself is never
  retained anywhere. Posting the same thing twice in a row earns once.
- **Editing a message does not award again** — Discord delivers an edit as a
  different event, which the earner does not listen for.
- **Deleting a message does not take XP back.** Clawing back would make the
  number feel punitive and would let a moderation sweep rewrite history.
- Awards are idempotent per message id, so a redelivered gateway event pays
  once.

## Earning from voice

- Voice XP comes from **Voice States only**. Presence is not used and not
  requested; Discord's own guidance is that presence is not the way to do this.
- The **AFK channel never earns.**
- A configurable **minimum number of human participants** (default 2) must be
  present. Bots never count. Sitting in a channel alone earns nothing.
- Eligibility for mute and deafen states is explicit and configurable:
  self-muted members still earn by default (they are listening), while
  self-deafened, server-muted and server-deafened members do not.
- Accounting is **per whole interval**, not per minute ticked: a member has to
  be present and eligible for the entire interval. Moving channel mid-interval
  simply starts the next one.
- A **session cap** (default 4 hours, 0 disables it) stops voice from being the
  cheapest thing on the server to farm.
- After a restart, nobody is paid for time the bot could not see. Open sessions
  are marked broken at startup rather than assumed to have continued.

## Commands

| Command   | What it does                                                      |
| --------- | ----------------------------------------------------------------- |
| `/rank`   | Your level, or someone else's. Shows total-to-here and next cost. |
| `/levels` | The leaderboard, 10 per page.                                     |
| `/xp`     | Adjust someone's XP. **Requires Manage Server.**                  |

`/xp` has three subcommands: `give`, `take` and `set`. `set` is recorded as the
**difference** to the member's current total, not as a raw assignment, so the
audit trail stays reversible and the `adjusted` figure stays meaningful.

`/xp` is hidden from members without Manage Server, but the bot **re-checks the
permission server-side**. Discord's `defaultMemberPermissions` is a hint to the
client and nothing more — a hand-crafted interaction can carry any name, so the
bot treats the client's claim as a claim.

## Role rewards

Each reward pairs a level with a role. Reaching that level grants the role.

- **Stack** (default) — every reward up to and including the current level is
  kept. Members read a stack as a record of what they passed through.
- **Replace** — only the highest reward reached is kept; earlier reward roles
  are given back.

Rewards are reconciled after **every** XP change, including an operator's
`/xp` adjustment. A member who jumps several levels at once gets every reward
in one pass; nothing depends on observing each boundary as it is crossed.

The ordering is deliberate, because two requirements pull against each other:
a retry must never announce the same level twice, and a failed announcement
must never cost anyone their XP.

1. XP is committed **before** reconciliation is attempted.
2. Each grant is **recorded first**, then announced.

A crash between the two loses an announcement, never a reward. A retry sees the
recorded grant and does nothing.

A reward is refused, and the refusal recorded with its reason, when:

- the role no longer exists;
- the role is `@everyone`;
- the role is managed by an integration;
- the role grants **Administrator** — refused outright, with no setting to
  override it. Reaching a level must never be a route to the server's highest
  permission;
- the role sits at or above the bot's own;
- the bot lacks **Manage Roles**.

Only roles this bot granted are ever taken away. A role a member holds for any
other reason survives a reward configuration changing underneath them.

## Announcements

Optional, one channel, with a message template supporting `{member}`, `{level}`
and `{role}`. Nothing else in the template is interpreted, so a server cannot
smuggle markup or a mention into a message posted publicly. Mentions are
stripped from the rendered message.

The dashboard renders a live preview as you type it.

## Where the numbers live

`xp_totals` holds one row per member per server, split into `message`, `voice`
and `adjusted` so you can see how someone got where they are. `xp_events`
carries the idempotency guarantee — a unique index on `(guild, user, key)`
means a duplicate insert simply does not happen, and the total is incremented
in SQL rather than read-modify-written, so two awards racing cannot lose one.

Everything is scoped by guild. Nothing leaks between servers.

## Operator notes

- Enable it under **Server settings → Levels & XP**, or with the toggle on the
  Levels page.
- The bot needs **Manage Roles** for rewards, and its own role must sit above
  every role it hands out.
- Gateway intents: `GuildVoiceStates` and `MessageContent` (both already
  requested). No privileged intent is required.
