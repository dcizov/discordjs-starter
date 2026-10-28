# Tickets

Private support: a member asks for help, a channel is made for just them and
the people who support them, and it is tidied away when they are done.

Tickets are **not** a general private-channel feature. One ticket per person at
a time by default, and the channel is deleted when it closes unless you ask for
it to be kept.

## What happens when someone opens a ticket

1. Their current open-ticket count is checked against the server's limit
   (default 1). One person opening fifty channels is the failure mode this
   exists for.
2. A ticket record is created and given the next number for the server.
3. A text channel is created, named `ticket-0007` or
   `ticket-0007-billing-problem` if a subject was given.
4. Overwrites are written: **`@everyone` is denied ViewChannel first**, then the
   opener, the support roles and Orbit itself are allowed.
5. The welcome message is posted, and the channel is linked to the ticket.

The deny is explicit and it comes first because a category that grants
ViewChannel would otherwise leave every ticket public. That is the worst
possible default for a support channel.

## Who can do what

|                        | Opener | Support staff | Anyone else |
| ---------------------- | :----: | :-----------: | :---------: |
| Open                   |   ✓    |       ✓       |      ✓      |
| Close their own ticket |   ✓    |       ✓       |             |
| Claim                  |        |       ✓       |             |
| Close someone else's   |        |       ✓       |             |
| Reopen a closed ticket |        |       ✓       |             |

The opener can always close their own ticket — making someone wait for staff to
do that is the most annoying thing a ticket system can do. The opener may never
**claim**, because "claim" means "I am handling this" and that belongs to staff.
Reopening is staff-only: reopening your own closed ticket to add a parting shot
is a thing people do.

**Support staff** is either the roles you configure or, if you configure none,
anyone with Manage Server. Configuring support roles is **additive** — it never
takes the ability away from someone who already has Manage Server.

Every one of those checks happens server-side, recomputed from live guild state.
A command's own permissions are a hint to the client and nothing more.

## Commands

| Command                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| `/ticket open [subject]` | Open a ticket. A subject is asked for by default. |
| `/ticket close [reason]` | Close the ticket you are in.                      |
| `/ticket claim`          | Take a ticket (support only).                     |
| `/ticket reopen`         | Reopen a closed ticket (support only).            |
| `/ticket info`           | Show the ticket you are in, or how many you have. |

Running `close`, `claim` or `reopen` inside a ticket channel acts on that
ticket, which is the common case by a wide margin.

## Transcripts

When a ticket closes, its messages are rendered to plain text and stored with
the record. Attachments are **listed by name and never fetched or retained** —
the bytes were never Orbit's to keep.

Transcripts are read **before** the channel is deleted, because once the channel
is gone there is nothing left to read, and Discord's retention of a deleted
channel is not something to depend on for a support record.

A transcript is capped at 2,000 lines and 500 KB. One that hits either limit is
truncated **and says so** — someone reading a support record needs to know it is
incomplete.

If the transcript cannot be read, the ticket still closes. Closing is what stops
the channel existing; failing to build a record must never block it.

## Retention

Closed transcripts are kept for **30 days** by default (0 to 365; `0` means
delete on close). When one ages out, only the transcript is dropped — the
ticket's own record survives, so you can still see that it happened and who
closed it.

## Auto-close

Optionally, an open ticket with no activity for N hours is closed automatically.
**Activity means any message in the ticket**, so a member replying restarts the
clock.

A ticket whose last activity time is missing or unreadable is treated as **not**
stale: an unknown timestamp must not silently close a ticket someone is still
waiting on an answer to. A clock that ran backwards is treated the same way.

## When things go wrong

The sweep runs hourly and does three things, idempotently:

- **Auto-closes** quiet tickets.
- **Marks orphans** — an open ticket whose channel no longer exists. The record
  is kept and the channel link cleared, so nothing tries to post into a deleted
  channel. An operator may still need to know the ticket was opened.
- **Expires** transcripts past their retention.

A permission error while checking a channel is **not** treated as proof the
channel is gone. Not being able to see a channel is not the same as it not
existing, and deleting a live ticket's record on that basis would be far worse
than leaving an orphan alone.

The sweep is global, so one server's deleted category cannot stop the others
being swept.

## What Orbit needs

- **Manage Channels** to create and delete ticket channels.
- **View Channel** and **Send Messages** in them.

If Orbit is missing Manage Channels, the member is told plainly and the ticket
is recorded **without a channel**. Silence would be worse: they would think help
was coming and nobody would know.

## Operator notes

- Enable it under **Server settings → Tickets**.
- Set a **category** if you want tickets grouped; leave it empty to create them
  next to wherever they were opened. A configured category that has since been
  deleted falls back rather than failing.
- **Keep channel on close** if your server needs the channel to stay for its own
  record-keeping.
- Ticket numbers are per server and never reused or renumbered.
