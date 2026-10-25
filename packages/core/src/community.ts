/** Opt-in community publishing domain. No Discord, database or browser clock I/O. */
import { z } from "zod";
import type { GuildChannel } from "./types";

export const communityKinds = ["poll", "announcement"] as const;
export type CommunityKind = (typeof communityKinds)[number];
export const communityStates = [
  "draft",
  "scheduled",
  "sending",
  "published",
  "closed",
  "failed",
  "unconfirmed",
  "cancelled",
  "missed",
] as const;
export type CommunityState = (typeof communityStates)[number];
export const COMMUNITY_REQUEST_MAX_AGE_MS = 30_000;
export const communityIdSchema = z.uuid();
export const COMMUNITY_GRACE_MS = 15 * 60_000;
export const COMMUNITY_SEND_LEASE_MS = 2 * 60_000;
export const COMMUNITY_RETENTION_MS = 90 * 86400_000;
export const COMMUNITY_POST_LIMIT = 200;
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (v) => !/<(?:\/?[a-z]|!)/i.test(v),
      "Use plain text, not HTML markup"
    )
    .transform((v) =>
      v
        .replace(/@(everyone|here)/gi, "＠$1")
        .replace(/<@([!&]?)(\d+)>/g, "[mention]")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    )
    .refine((v) => v.trim().length > 0, "Enter readable text");
export const communityPollSchema = z
  .object({
    question: text(300),
    answers: z
      .array(text(55))
      .min(2)
      .max(10)
      .refine(
        (values) =>
          new Set(values.map((v) => v.toLowerCase())).size === values.length,
        "Poll answers must be different"
      ),
    durationHours: z.number().int().min(1).max(168),
    allowMultiselect: z.boolean().default(false),
  })
  .strict();
export const communityInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("poll"),
      title: text(80),
      channelId: z.string().regex(/^\d{17,20}$/),
      body: z.literal("").default(""),
      poll: communityPollSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("announcement"),
      title: text(80),
      channelId: z.string().regex(/^\d{17,20}$/),
      body: text(1800),
      poll: z.null().default(null),
    })
    .strict(),
]);
export type CommunityInput = z.infer<typeof communityInputSchema>;
export type CommunityPoll = z.infer<typeof communityPollSchema>;
export type CommunityResult = {
  checkedAt: string;
  expiresAt: string | null;
  finalized: boolean;
  answers: { id: number; text: string; votes: number | null }[];
};
export type CommunityPost = {
  id: string;
  guildId: string;
  kind: CommunityKind;
  title: string;
  channelId: string;
  body: string;
  poll: CommunityPoll | null;
  state: CommunityState;
  version: number;
  actorId: string;
  requestKey: string;
  scheduledFor: string | null;
  attemptedAt: string | null;
  messageId: string | null;
  lastError: string | null;
  result: CommunityResult | null;
  createdAt: string;
  updatedAt: string;
};
export type CommunityPage = {
  asOf: string;
  kind: CommunityKind;
  items: CommunityPost[];
  total: number;
  page: number;
  pageSize: number;
};
/** A slow dashboard refresh must not resurrect an older record after a local mutation. */
export function newerCommunityPage(
  current: CommunityPage,
  incoming: CommunityPage
): CommunityPage {
  return incoming.kind === current.kind &&
    incoming.page === current.page &&
    incoming.pageSize === current.pageSize &&
    incoming.asOf > current.asOf
    ? incoming
    : current;
}

export const communityQuerySchema = z.object({
  kind: z.enum(communityKinds),
  state: z.enum(["all", ...communityStates]).default("all"),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(20).default(12),
});
export const communityActionSchema = z
  .object({
    action: z.enum(["publish", "refresh", "close", "schedule", "cancel"]),
    version: z.number().int().positive(),
    scheduledFor: z.iso.datetime().optional(),
  })
  .strict();
export function communityModule(kind: CommunityKind) {
  return kind === "poll" ? "polls" : "announcements";
}
export class CommunityConflict extends Error {
  readonly status = 409;
}
export function assertCommunityVersion(post: CommunityPost, version: number) {
  if (post.version !== version)
    throw new CommunityConflict(
      "This record changed. Refresh before trying again; nothing was republished."
    );
}
export function assertCommunityEditable(post: CommunityPost) {
  if (!["draft", "failed", "cancelled", "missed"].includes(post.state))
    throw new CommunityConflict(
      "Only unsent drafts can be edited. Cancel a schedule first; published native polls are immutable."
    );
}
export function validateCommunitySchedule(value: string, now: number) {
  const timestamp = Date.parse(z.iso.datetime().parse(value));
  if (timestamp < now + 60_000 || timestamp > now + 30 * 86400_000)
    throw new Error(
      "Choose a UTC time at least one minute and at most 30 days ahead."
    );
  return new Date(timestamp).toISOString();
}
export function assertCommunityPublishable(
  post: CommunityPost,
  scheduled: boolean,
  now: number
) {
  if (scheduled) {
    if (
      post.kind !== "announcement" ||
      post.state !== "scheduled" ||
      !post.scheduledFor
    )
      throw new CommunityConflict("This schedule is no longer active.");
    const due = Date.parse(post.scheduledFor);
    if (now < due || now > due + COMMUNITY_GRACE_MS)
      throw new CommunityConflict(
        "The scheduled send window is not open. Old announcements are never replayed."
      );
  } else if (!["draft", "failed"].includes(post.state)) {
    throw new CommunityConflict(
      "This post is not an unsent draft. Sending/unconfirmed publications must not be retried blindly."
    );
  }
}
/** Explicit timezone, no ambient host locale or Date.now: safe in SSR and hydration. */
export function communityDate(value: string | null, timeZone: string) {
  if (!value) return "Not scheduled";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }
}

/** Unknown live channel types are not assumed compatible. Legacy demo samples are explicitly simulated. */
export function isCommunityChannel(channel: GuildChannel, demo = false) {
  return (
    channel.type === "text" &&
    (channel.supportsCommunityPosts === true ||
      (demo && channel.supportsCommunityPosts !== false))
  );
}
