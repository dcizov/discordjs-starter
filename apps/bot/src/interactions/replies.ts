import type { Account, GuildConfig, MusicState, Track } from "@orbit/core";
import { safeText } from "@orbit/core";
import { safePublicLink } from "@orbit/core/public-url";
import { diagnosticText } from "@orbit/core/diagnostics";
import { safeImageUrl } from "@orbit/core/feed-content";
import {
  EmbedBuilder,
  escapeMarkdown,
  type InteractionReplyOptions,
} from "discord.js";

const colors = { info: 0x8b5cf6, success: 0x43c59e, error: 0xf87171 };
type ReplyField = { name: string; value: string; inline?: boolean };
export type ReplyCard = {
  title?: string;
  description: string;
  fields?: ReplyField[];
  tone?: keyof typeof colors;
  footer?: string;
  /** Public page this card is about, e.g. the track's provider page. */
  url?: string;
  /** Validated public artwork; never a signed or stream URL. */
  thumbnail?: string;
};
const titles: Record<string, string> = {
  ping: "Orbit is online",
  roles: "Your community roles",
  "role-panel": "Role panel published",
  warn: "Warning recorded",
  timeout: "Timeout recorded",
  kick: "Kick recorded",
  ban: "Ban recorded",
  purge: "Channel cleanup",
  cases: "Moderation cases",
  balance: "Community wallet",
  daily: "Daily reward",
  transfer: "Transfer complete",
  leaderboard: "Community leaderboard",
  shop: "Community shop",
  inventory: "Your inventory",
  queue: "Listening room · queue",
  deals: "Game deals",
  news: "Community news",
};

// Discord measures its string limits in UTF-16 code units. Do not leave a
// dangling surrogate or an unclosed fence when shortening a reply.
function shorten(text: string, max: number, marker = "…") {
  if (text.length <= max) return text;
  return (
    text
      .slice(0, Math.max(0, max - marker.length))
      .replace(/[\uD800-\uDBFF]$/, "") + marker
  );
}
function displayText(text: string) {
  return text
    .replace(/@(everyone|here)/gi, "＠$1")
    .replace(/<@([!&]?)(\d+)>/g, "[mention]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}
export function replyLabel(text: string, max = 160) {
  return shorten(
    escapeMarkdown(safeText(text, max), { maskedLink: true }),
    max * 2
  );
}
/** Fence only after shortening; a provider/user cannot close our code block. */
export function replyCodeBlock(text: string, max = 3600) {
  const body = displayText(diagnosticText(text)).replace(/`/g, "ˋ");
  return `\`\`\`text\n${shorten(body, max - 12, "\n… (shortened for Discord)")}\n\`\`\``;
}

/** One embed, below the 6,000-character aggregate and per-part API limits. */
export function commandReply(command: string, input: string | ReplyCard) {
  const card: ReplyCard =
    typeof input === "string"
      ? { description: replyLabel(input, 1800) }
      : input;
  const title = shorten(
    displayText(card.title ?? titles[command] ?? "Command complete"),
    256
  );
  const footer = shorten(
    displayText(card.footer ?? `Orbit · /${command}`),
    256
  );
  const embed = new EmbedBuilder()
    .setTitle(title || "Orbit")
    .setColor(colors[card.tone ?? "info"])
    .setFooter({ text: footer || "Orbit" });
  const description = shorten(displayText(card.description), 3800);
  if (description) embed.setDescription(description);
  // A link is only ever the provider's public page; safeLink refuses anything
  // that is not plain http(s) or that carries credentials.
  const link = card.url ? safePublicLink(card.url) : "";
  if (link) embed.setURL(link);
  const thumbnail = card.thumbnail ? safeImageUrl(card.thumbnail) : "";
  if (thumbnail) embed.setThumbnail(thumbnail);
  let remaining =
    5800 - (title.length || 5) - (footer.length || 5) - description.length;
  for (const field of (card.fields ?? []).slice(0, 25)) {
    const name = shorten(displayText(field.name), Math.min(256, remaining - 1));
    if (remaining < 2 || !name) break;
    const value = shorten(
      displayText(field.value),
      Math.min(1024, remaining - name.length)
    );
    if (!value) continue;
    embed.addFields({ name, value, inline: field.inline ?? false });
    remaining -= name.length + value.length;
  }
  return {
    content: "",
    embeds: [embed],
    allowedMentions: { parse: [] },
  } satisfies InteractionReplyOptions;
}

export function commandErrorReply(command: string, detail: string) {
  return commandReply(command, {
    title: `Could not complete /${command}`,
    tone: "error",
    description: `The command could not be completed.\n${replyCodeBlock(detail)}`,
    footer:
      "Orbit · Details may be shortened here. Check bot/backend logs for more.",
  });
}
type Currency = Pick<GuildConfig["economy"], "currency" | "symbol">;
function amount(value: number, economy: Currency, signed = false) {
  return `**${signed && value > 0 ? "+" : ""}${value.toLocaleString("en-US")}** ${replyLabel(economy.symbol, 32)} ${replyLabel(economy.currency, 48)}`;
}
export function dailyCard(
  reward: { amount: number; balance: number },
  economy: Currency
): ReplyCard {
  return {
    title: "✦ Daily reward claimed",
    description:
      "A little reward for showing up. Thanks for being part of the community!",
    tone: "success",
    fields: [
      {
        name: "Reward",
        value: amount(reward.amount, economy, true),
        inline: true,
      },
      {
        name: "New balance",
        value: amount(reward.balance, economy),
        inline: true,
      },
    ],
    footer: "Orbit · Come back 24 hours after this claim for your next reward.",
  };
}
export function balanceCard(
  name: string,
  balance: number,
  economy: Currency
): ReplyCard {
  return {
    description: `${replyLabel(name)}’s community wallet.`,
    fields: [{ name: "Balance", value: amount(balance, economy) }],
    footer: "Orbit · Community currency has no real-money value.",
  };
}
export function leaderboardCard(
  accounts: Pick<Account, "name" | "balance">[],
  economy: Currency
): ReplyCard {
  const medals = ["🥇", "🥈", "🥉"];
  return {
    description: accounts.length
      ? accounts
          .slice(0, 10)
          .map(
            (account, index) =>
              `${medals[index] ?? `**${index + 1}.**`} ${replyLabel(account.name, 96)}\n${amount(account.balance, economy)}`
          )
          .join("\n\n")
      : "Every constellation starts with one star. Claim your first `/daily` reward.",
    footer: "Orbit · Top 10 community wallets · No real-money value.",
  };
}
function duration(ms: number) {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
const SOURCE_LABELS: Record<string, string> = {
  youtube: "YouTube",
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  twitch: "Twitch",
  vimeo: "Vimeo",
  http: "Provider",
  local: "Upload",
};
/**
 * The provider's public page, as a masked link. `Track.uri` is already the
 * public page (never the stream endpoint) and `safeLink` refuses anything that
 * is not plain http(s) without credentials, so a hostile provider cannot turn
 * this into a redirector or leak a token.
 */
function publicTrackUrl(value: string) {
  const safe = value ? safePublicLink(value) : "";
  if (!safe) return "";
  try {
    const url = new URL(safe);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    // Query strings on provider pages routinely carry tracking, session or
    // signature values. Keep only the two parameters a YouTube watch page needs
    // to resolve, and drop everything else (including the fragment).
    const keep = /(^|\.)youtube\.com$/.test(host) ? ["v", "list"] : [];
    const params = new URLSearchParams();
    for (const key of keep) {
      const found = url.searchParams.get(key);
      if (found) params.set(key, found);
    }
    url.search = params.toString();
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}
export function trackSourceLink(track: Pick<Track, "uri" | "source">) {
  const url = publicTrackUrl(track.uri);
  if (!url) return null;
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  })();
  const provider = SOURCE_LABELS[track.source ?? ""] ?? (host || "Source");
  return { url, label: `Open on ${provider}` };
}
function progress(position: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) return null;
  const at = Math.min(Math.max(0, Math.floor(position)), Math.floor(total));
  return `${duration(at)} / ${duration(total)} · ${duration(Math.max(0, total - at))} remaining`;
}
export function queueCard(
  state: MusicState,
  context: { voiceChannel?: string | null; queueLimit?: number } = {}
): ReplyCard {
  const source = state.current ? trackSourceLink(state.current) : null;
  const current = state.current
    ? `**Current track${state.paused ? " · paused" : ""}**\n${replyLabel(state.current.title)} — ${replyLabel(state.current.author, 80)}`
    : "Nothing is playing right now. Add some music with `/play`.";
  // Bound each label so all 15 rows fit, including Markdown escapes.
  const upcoming = state.tracks
    .slice(0, 15)
    .map(
      (track, index) =>
        `**${index + 1}.** ${replyLabel(track.title, 42)} — ${replyLabel(track.author, 20)} · ${duration(track.duration)}`
    );
  const track = state.current;
  const fields: ReplyField[] = [];
  if (source)
    fields.push({ name: "Source", value: `[${source.label}](${source.url})` });
  if (track)
    fields.push({
      name: "Requested by",
      value: replyLabel(track.requestedBy, 80),
      inline: true,
    });
  const position = track ? progress(state.position, track.duration) : null;
  if (position) fields.push({ name: "Progress", value: position });
  fields.push(
    {
      name: "Voice",
      value: context.voiceChannel
        ? replyLabel(context.voiceChannel, 80)
        : "Not connected",
      inline: true,
    },
    { name: "Volume", value: `${state.volume}%`, inline: true },
    { name: "Repeat", value: replyLabel(state.repeat), inline: true }
  );
  const limit = context.queueLimit;
  return {
    title: "Listening room · queue",
    url: source?.url,
    thumbnail: track?.artwork ?? undefined,
    description: `${current}\n\n**Up next · ${state.tracks.length}${limit ? ` of ${limit}` : ""}**\n${upcoming.join("\n") || "The queue is clear."}${state.tracks.length > 15 ? "\n… showing the next 15 tracks." : ""}`,
    fields,
    footer: "Orbit · Progress follows the position the backend reports.",
  };
}
export function musicActionCard(action: string, state: MusicState): ReplyCard {
  const messages: Record<string, string> = {
    play: "Play request accepted",
    pause: "Playback paused",
    resume: "Playback resumed",
    skip: "Skip requested",
    stop: "Listening room stopped",
    volume: "Volume updated",
    shuffle: "Queue shuffled",
    repeat: "Repeat updated",
    seek: "Seek requested",
  };
  const source = state.current ? trackSourceLink(state.current) : null;
  return {
    title: messages[action] ?? "Listening room updated",
    tone: "success",
    url: source?.url,
    thumbnail: state.current?.artwork ?? undefined,
    description:
      action === "stop"
        ? "Disconnected from voice and cleared the queue."
        : action === "skip"
          ? "The skip request was sent. Use `/queue` to see the updated track."
          : action === "seek"
            ? "The seek was sent to the backend. The progress bar follows the position the server reports next; it is not proof of audible playback."
            : state.current
              ? `**Current track**\n${replyLabel(state.current.title)} — ${replyLabel(state.current.author, 80)}`
              : "Use `/play` to add a track to the listening room.",
    fields:
      action === "stop"
        ? []
        : [
            {
              name: "Up next",
              value: `${state.tracks.length} tracks`,
              inline: true,
            },
            { name: "Volume", value: `${state.volume}%`, inline: true },
            { name: "Repeat", value: replyLabel(state.repeat), inline: true },
            ...(source
              ? [{ name: "Source", value: `[${source.label}](${source.url})` }]
              : []),
          ],
    footer:
      action === "play"
        ? "Orbit · Request accepted by the backend; this does not verify audible playback."
        : `Orbit · /${action}`,
  };
}
