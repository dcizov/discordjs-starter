/**
 * Support tickets. Pure rules only: no Discord, no database, no clock.
 *
 * A ticket is a private channel between a member and the people who support
 * them. Two things make it worth building carefully rather than bolting on:
 *
 * 1. **It creates channels and touches overwrites.** That is the most
 *    permission-sensitive thing a bot can do, and the flow has to stay honest
 *    when the permission it needed disappears halfway through.
 * 2. **It holds what people wrote while upset.** Retention is a policy
 *    question, not an implementation detail.
 *
 * Everything that can be decided without I/O is decided here, so the
 * interesting behaviour is testable without a Discord server.
 */
import { z } from "zod";

/**
 * Defined locally rather than imported from `./config`.
 *
 * `config.ts` imports `ticketConfigSchema` from here, so importing anything
 * back would make the two modules load each other. The rule itself is two
 * lines, and duplicating it is cheaper than a cycle that only shows up as an
 * undefined binding at runtime.
 */
const snowflake = z.string().regex(/^\d{17,20}$/, "Enter a valid Discord ID");
/** An unset id, matching the convention in `./config`. */
const optionalId = z.union([snowflake, z.literal("")]).default("");

export const ticketStates = ["open", "claimed", "closed"] as const;
export type TicketState = (typeof ticketStates)[number];

/** A closed ticket's transcript is kept this long by default. */
export const TICKET_RETENTION_DAYS_DEFAULT = 30;
export const TICKET_RETENTION_DAYS_MAX = 365;
/** Nobody needs more than this many tickets open at once; the cap is an abuse limit. */
export const TICKET_MAX_OPEN_PER_MEMBER_MAX = 10;
export const TICKET_SUBJECT_MAX = 100;
export const TICKET_CLOSE_REASON_MAX = 500;

/**
 * The permissions the ticket channel grants the opener.
 *
 * Deliberately narrow. A ticket is *not* a private lounge: the opener can read
 * and write, and that is all. Notably absent are Manage Messages, Manage
 * Channels, mentioning everyone, and anything about roles. Bot authors are
 * routinely asked for "member can delete messages in their ticket" and it is a
 * mistake — it lets someone destroy the record of what they said.
 */
export const OPENER_ALLOW = [
  "ViewChannel",
  "SendMessages",
  "ReadMessageHistory",
  "AttachFiles",
  "EmbedLinks",
  "AddReactions",
] as const;

/** Support staff get Manage Messages so they can keep a ticket readable. */
export const SUPPORT_ALLOW = [
  ...OPENER_ALLOW,
  "ManageMessages",
  "ManageChannels",
] as const;

export const ticketConfigSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * Where ticket channels are created. Empty means "next to the panel", which
   * keeps working if the category is deleted — a hardened default is better
   * than a broken one.
   */
  categoryId: optionalId,
  /** Roles allowed to claim and close. Empty means Manage Server holders. */
  supportRoleIds: z.array(snowflake).max(25).default([]),
  /** 0 disables the limit. Bounded: an unbounded cap is no cap. */
  maxOpenPerMember: z
    .number()
    .int()
    .min(0)
    .max(TICKET_MAX_OPEN_PER_MEMBER_MAX)
    .default(1),
  /** Threads under one channel instead of a channel per ticket. */
  useThreads: z.boolean().default(false),
  /** Where transcripts go. Empty means the ticket channel itself. */
  transcriptChannelId: optionalId,
  /** Days a closed transcript is kept. 0 means delete on close. */
  retentionDays: z
    .number()
    .int()
    .min(0)
    .max(TICKET_RETENTION_DAYS_MAX)
    .default(TICKET_RETENTION_DAYS_DEFAULT),
  /** Hours of inactivity before an open ticket is auto-closes. 0 disables. */
  autoCloseHours: z.number().int().min(0).max(720).default(0),
  /** Ask for a subject when opening. Off means one fewer step. */
  askSubject: z.boolean().default(true),
  /** Message shown at the top of a new ticket. */
  welcomeMessage: z
    .string()
    .max(1000)
    .default(
      "Thanks for reaching out. Describe what you need and someone will be with you."
    ),
  /** Message posted when a ticket closes. */
  closeMessage: z
    .string()
    .max(1000)
    .default("This ticket is closed. Open a new one any time."),
  /**
   * Keep the closed channel instead of deleting it. Some servers need the
   * channel to stay for their own record-keeping.
   */
  keepChannelOnClose: z.boolean().default(false),
});

export type TicketConfig = z.infer<typeof ticketConfigSchema>;

export const defaultTicketConfig: TicketConfig = ticketConfigSchema.parse({});

/** A channel name derived from the ticket number. Discord allows 1-100 chars. */
export function ticketChannelName(number: number, subject?: string | null) {
  const prefix = `ticket-${String(number).padStart(4, "0")}`;
  // Slugs keep the name readable in the sidebar. Anything Discord would
  // reject is dropped rather than escaped, because the number already makes
  // the name unique.
  const slug = (subject ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug ? `${prefix}-${slug}` : prefix;
}

export type OpenAttempt = {
  /** Tickets this member already has open. */
  openCount: number;
  config: TicketConfig;
  moduleEnabled: boolean;
  /** Roles the member holds, for the support-role check. */
  memberRoleIds?: readonly string[];
};

export type OpenDecision =
  { ok: true; needsSubject: boolean } | { ok: false; reason: string };

/**
 * Whether a member may open another ticket.
 *
 * The abuse limit is per member, not per guild: one person opening fifty
 * channels is the failure mode, and it is the reason `maxOpenPerMember`
 * defaults to 1 rather than something generous.
 */
export function mayOpen(input: OpenAttempt): OpenDecision {
  if (!input.moduleEnabled)
    return { ok: false, reason: "Tickets are paused on this server." };
  const cap = input.config.maxOpenPerMember;
  if (cap > 0 && input.openCount >= cap)
    return {
      ok: false,
      reason:
        cap === 1
          ? "You already have an open ticket. Close it before opening another."
          : `You already have ${input.openCount} open tickets, and this server allows ${cap}.`,
    };
  return { ok: true, needsSubject: input.config.askSubject };
}

/** Whether a member is allowed to work tickets, as opposed to open them. */
export function isSupport(
  config: TicketConfig,
  input: { memberRoleIds: readonly string[]; canManageGuild: boolean }
): boolean {
  if (!config.supportRoleIds.length) return input.canManageGuild;
  // A support role is additive: it must not take the ability away from
  // someone who already has Manage Server. Operators are surprised by that
  // less often than the alternative.
  if (input.canManageGuild) return true;
  return config.supportRoleIds.some((id) => input.memberRoleIds.includes(id));
}

export type TicketRecord = {
  state: TicketState;
  openerId: string;
  claimerId: string | null;
  closedAt: string | null;
  lastActivityAt: string;
};

export type ActorRelation = {
  /** The member acting. */
  actorId: string;
  canManageGuild: boolean;
  isSupportMember: boolean;
};

/**
 * Whether an actor may claim, close or reopen a ticket.
 *
 * The opener can always close their own ticket — it is theirs, and making them
 * wait for staff to do it is the single most annoying thing a ticket system can
 * do. The opener may never claim, because "claim" means "I am handling this"
 * and that belongs to staff.
 */
export function mayAct(
  ticket: TicketRecord,
  actor: ActorRelation
): {
  claim: boolean;
  close: boolean;
  reopen: boolean;
  reason?: string;
} {
  const isOpener = ticket.openerId === actor.actorId;
  const staff = actor.isSupportMember || actor.canManageGuild;

  if (ticket.state === "closed")
    return {
      claim: false,
      close: false,
      // Reopening is staff-only: reopening your own closed ticket to add a
      // parting shot is a thing people do.
      reopen: staff,
      reason: staff ? undefined : "Only support staff can reopen a ticket.",
    };

  return {
    claim: staff && ticket.claimerId === null,
    close: staff || isOpener,
    reopen: false,
    reason:
      !staff && !isOpener ? "This ticket belongs to someone else." : undefined,
  };
}

/**
 * Whether an open ticket has gone quiet long enough to auto-close.
 *
 * `autoCloseHours = 0` means never. A missing or unparseable timestamp is
 * treated as *not* stale: an unknown last-activity must not silently close
 * someone's ticket while they are waiting for a reply.
 */
export function isStale(
  ticket: { lastActivityAt: string | null },
  autoCloseHours: number,
  now: Date
): boolean {
  if (autoCloseHours <= 0) return false;
  if (!ticket.lastActivityAt) return false;
  const last = Date.parse(ticket.lastActivityAt);
  if (Number.isNaN(last)) return false;
  const age = now.getTime() - last;
  // A clock that ran backwards must not close everything either.
  if (age < 0) return false;
  return age >= autoCloseHours * 3600_000;
}

/** Whether a transcript is still inside its retention window. */
export function withinRetention(
  closedAt: string | null,
  retentionDays: number,
  now: Date
): boolean {
  if (retentionDays <= 0) return false;
  if (!closedAt) return true;
  const closed = Date.parse(closedAt);
  if (Number.isNaN(closed)) return true;
  const age = now.getTime() - closed;
  if (age < 0) return true;
  return age < retentionDays * 86400_000;
}

export type TranscriptLine = {
  authorId: string;
  authorName: string;
  authorDiscriminator?: string;
  sentAt: string;
  content: string;
  /** Attachments are listed by name; the bytes are never retained. */
  attachmentNames?: readonly string[];
  /** True for the bot's own posts and system messages. */
  system?: boolean;
};

/**
 * Render a transcript as plain text, bounded.
 *
 * Transcripts are the one place a ticket's contents outlive the ticket, so the
 * output is capped in both lines and size. An over-long transcript is
 * truncated with an explicit note rather than silently cut: someone reading a
 * support record needs to know it is incomplete.
 */
export function renderTranscript(
  ticket: {
    number: number;
    subject: string | null;
    openedAt: string;
    closedAt: string | null;
  },
  lines: readonly TranscriptLine[],
  limits: { maxLines?: number; maxBytes?: number } = {}
): { text: string; truncated: boolean } {
  const maxLines = limits.maxLines ?? 2000;
  const maxBytes = limits.maxBytes ?? 500_000;

  const header = [
    `Ticket #${ticket.number}`,
    ticket.subject ? `Subject: ${ticket.subject}` : null,
    `Opened: ${ticket.openedAt}`,
    ticket.closedAt ? `Closed: ${ticket.closedAt}` : null,
    "-".repeat(40),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  const body: string[] = [];
  let truncated = false;
  for (const line of lines) {
    if (body.length >= maxLines) {
      truncated = true;
      break;
    }
    const stamp = line.sentAt;
    const name = line.system
      ? line.authorName
      : `${line.authorName} (${line.authorId})`;
    let text = `[${stamp}] ${name}: ${line.content || "(no text)"}`;
    if (line.attachmentNames?.length)
      text += ` [attachments: ${line.attachmentNames.join(", ")}]`;
    body.push(text);
  }

  let out = `${header}\n${body.join("\n")}`;
  if (truncated) out += `\n\n[Transcript truncated at ${maxLines} lines.]`;
  if (Buffer.byteLength(out, "utf8") > maxBytes) {
    // Cut on a character boundary by decoding and slicing code points.
    const chars = [...out];
    let kept = "";
    let bytes = 0;
    for (const ch of chars) {
      const size = Buffer.byteLength(ch, "utf8");
      if (bytes + size > maxBytes - 60) break;
      kept += ch;
      bytes += size;
    }
    out = `${kept}\n\n[Transcript truncated for size.]`;
    truncated = true;
  }
  return { text: out, truncated };
}

/**
 * Whether a ticket channel has been orphaned.
 *
 * A channel is orphaned when its ticket is still open but the channel no longer
 * exists — deleted by hand, or lost to a permission change. The database row
 * outliving its channel is the normal case after any incident, so detecting it
 * is a first-class rule rather than a cleanup script's private heuristic.
 */
export function isOrphaned(ticket: {
  state: TicketState;
  channelExists: boolean;
}): boolean {
  return ticket.state !== "closed" && !ticket.channelExists;
}
