import { assertFeedUrl, isPublicAddress } from "@orbit/core";
import { diagnosticText, errorDiagnostic } from "@orbit/core/diagnostics";
import {
  DEFAULT_MUSIC_SEARCH_PREFIX,
  providerUnavailableMessage,
  resolveSearchProvider,
  type MusicSearchProvider,
  type MusicSearchProviderId,
} from "@orbit/core/music-sources";
import { lookup } from "node:dns/promises";
import {
  LoadType,
  type Exception,
  type LavalinkResponse,
  type NodeInfo,
  type Track,
} from "shoukaku";

/** Hard cap on search candidates, matching `/search`'s menu size. */
export const MAX_SEARCH_CANDIDATES = 5;

export type MusicSourceSettings = {
  searchPrefix: string;
  allowedHosts: string[];
};
export type MusicNodeInfo = Pick<NodeInfo, "lavaplayer" | "sourceManagers"> & {
  version: Pick<NodeInfo["version"], "semver">;
  plugins?: NodeInfo["plugins"];
};
export type MusicResolver = {
  resolve(identifier: string): Promise<LavalinkResponse | undefined>;
};
export type MusicLookup = (
  hostname: string,
  options: { all: true }
) => Promise<{ address: string; family: number }[]>;
export function musicSourceSettings(): MusicSourceSettings {
  return {
    searchPrefix:
      process.env.MUSIC_SEARCH_PREFIX ?? DEFAULT_MUSIC_SEARCH_PREFIX,
    allowedHosts: (
      process.env.MUSIC_ALLOWED_HOSTS ??
      "soundcloud.com,bandcamp.com,youtube.com,youtu.be,ocremix.org"
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}
const SOURCE_HOSTS: Record<string, string[]> = {
  soundcloud: ["soundcloud.com"],
  bandcamp: ["bandcamp.com"],
  youtube: ["youtube.com", "youtu.be"],
  ocremix: ["ocremix.org"],
};
const matchesHost = (hostname: string, host: string) =>
  hostname === host || hostname.endsWith(`.${host}`);
const PROVIDER_LABELS: Record<string, string> = {
  soundcloud: "SoundCloud",
  bandcamp: "Bandcamp",
  youtube: "YouTube",
  ocremix: "OC ReMix",
};
const providerLabel = (source: string | null) =>
  PROVIDER_LABELS[source ?? ""] ?? "Configured source";

/**
 * Why a source manager is missing, in terms of the switch that actually exists in
 * this deployment's Lavalink config. Used for direct URLs, where the provider was
 * derived from the hostname instead of chosen.
 */
function urlSourceUnavailable(source: string) {
  const extra =
    source === "soundcloud"
      ? "Enable plugins.soundy.enabled in the Soundy-enabled backend (keep the built-in sources.soundcloud disabled)."
      : source === "youtube"
        ? "Enable plugins.youtube.enabled; leave the built-in youtube loader disabled."
        : source === "ocremix"
          ? "Enable plugins.dunctebot.sources.ocremix."
          : `Enable lavalink.server.sources.${source}.`;
  return `${providerLabel(source)} is not enabled on this Lavalink node. ${extra} Restart Lavalink, then run npm run music:doctor. See docs/MUSIC.md. A connected backend does not guarantee an enabled source.`;
}
export function musicNodeDescription(info?: MusicNodeInfo | null) {
  if (!info) return "Backend version unavailable";
  const soundy = info.plugins?.find(
    (plugin) => plugin.name.toLowerCase() === "soundy"
  );
  return diagnosticText(
    `Lavalink ${info.version?.semver ?? "unknown"}; Lavaplayer ${info.lavaplayer ?? "unknown"}${soundy ? `; Soundy ${soundy.version}` : ""}`
  );
}
function sourceFailureHint(cause: string, source: string | null) {
  if (/\bdrm\b|encrypted|protected content/i.test(cause))
    return "Protected/encrypted tracks are not supported. Choose an authorized public, unencrypted track; do not bypass provider restrictions.";
  if (
    source === "soundcloud" &&
    /did not detect any supported formats/i.test(cause)
  )
    return "The SoundCloud adapter found no usable stream. The built-in loader does not support AAC/fMP4 HLS. Rebuild the pinned Soundy-enabled backend in docs/MUSIC.md; protected or unavailable tracks remain unsupported.";
  if (/no playable stream|no transcodings/i.test(cause))
    return "The provider supplied no usable public stream. Choose another authorized, unencrypted track and inspect provider restrictions; no fallback source is used.";
  if (/\b429\b|rate.?limit|too many requests/i.test(cause))
    return "The provider reports rate limiting. Wait before retrying and check provider restrictions; do not bypass its access controls.";
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|access denied/i.test(cause))
    return "The provider refused the request. Check backend logs, provider availability, and the installed source adapter; Discord voice permissions do not repair source access.";
  if (
    /timed?\s*out|timeout|unknownhost|connectexception|sslhandshake|dns|certificate/i.test(
      cause
    )
  )
    return "Check the Lavalink container’s DNS, outbound HTTPS access, TLS certificates, and provider reachability.";
  return source === "soundcloud"
    ? "Check the Lavalink root exception. If it says 'Did not detect any supported formats', use the pinned Soundy AAC/fMP4 backend in docs/MUSIC.md. Pulling Lavalink 4.2.2 alone does not add that support."
    : "Check Lavalink logs immediately after this failure and the installed source adapter; also try an authorized public track URL to separate search from URL loading.";
}
/** Machine-readable bucket for an audio failure, shown in the audit summary. */
export type MusicFailureCategory =
  | "provider-login"
  | "no-streams"
  | "drm"
  | "rate-limit"
  | "auth"
  | "network"
  | "format"
  | "unknown";

/**
 * Classify a Lavalink track failure from the evidence in the exception.
 *
 * The reported production failure ("ANDROID_VR: This video requires login" +
 * "WEB: No supported audio streams available") is a provider-side restriction,
 * not a voice or permission problem, so it gets its own bucket instead of the
 * generic "something went wrong" text. The bucket names what the provider
 * answered; it does not claim one universal cause for every item in it.
 */
export function musicFailureCategory(
  exception: Partial<Exception>
): MusicFailureCategory {
  const text = `${exception.message ?? ""} ${exception.cause ?? ""}`;
  if (
    /requires? (?:a )?login|sign in to confirm|not a bot|confirm you.re not a bot|age.?restrict/i.test(
      text
    )
  )
    return "provider-login";
  if (/\bdrm\b|encrypted|protected content/i.test(text)) return "drm";
  if (
    /no supported audio streams|no playable stream|no transcodings|did not detect any supported formats/i.test(
      text
    )
  )
    return "no-streams";
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return "rate-limit";
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|access denied/i.test(text))
    return "auth";
  if (
    /timed?\s*out|timeout|unknownhost|connectexception|sslhandshake|dns|certificate/i.test(
      text
    )
  )
    return "network";
  return "unknown";
}

const CATEGORY_NEXT: Record<MusicFailureCategory, string> = {
  "provider-login":
    "The provider asked for a signed-in/verified session or rejected this backend’s client (for example “requires login” or “…not a bot”). That is a provider-side challenge: it is not a Discord voice-permission problem and not a Lavalink connection problem, and Orbit never reuses cookies, tokens or somebody else’s account. Playback of this item stays unavailable here. Try another public item, or ask an operator to inspect the source diagnostics with npm run music:doctor.",
  "no-streams":
    "The provider returned no audio stream for this item. Try another public track or URL; private, region-locked and removed items stay unsupported.",
  drm: "Protected/encrypted items are not supported. Choose an authorized public, unencrypted item.",
  "rate-limit":
    "The provider is rate limiting this backend. Wait before retrying; do not bypass provider limits.",
  auth: "The provider refused the request. Check the backend credentials/configuration and provider availability.",
  network:
    "Check the Lavalink container’s DNS, outbound HTTPS access, TLS certificates and provider reachability.",
  format:
    "The adapter did not find a usable audio format. Check the pinned backend build for this source.",
  unknown:
    "Check the Lavalink log for the full Java exception and the installed source adapter.",
};

/**
 * Concise audit/table summary plus the full diagnostic.
 *
 * The dashboard table cell shows `summary`; the event dialog and copy button show
 * `details`. Splitting them keeps a stack trace out of the table without throwing
 * the diagnostics away.
 */
export function musicSourceFailureReport(
  exception: Partial<Exception>,
  context: {
    stage: "lookup" | "playback";
    source: string | null;
    info?: MusicNodeInfo | null;
  }
) {
  const category = musicFailureCategory(exception);
  const details = musicSourceFailure(exception, context);
  const summary = diagnosticText(
    `${providerLabel(context.source)} ${context.stage === "playback" ? "playback" : "lookup"} failed (${category}). ${CATEGORY_NEXT[category]}`
  );
  return { summary: summary.slice(0, 300), details, category };
}

export function musicSourceFailure(
  exception: Partial<Exception>,
  context: {
    stage: "lookup" | "playback";
    source: string | null;
    info?: MusicNodeInfo | null;
  }
) {
  const cause =
    exception.cause ||
    "Not supplied by Lavalink. Inspect the backend logs for the full Java exception.";
  const searchable = `${exception.message ?? ""} ${cause}`;
  const hint = sourceFailureHint(searchable, context.source);
  return diagnosticText(
    [
      `${providerLabel(context.source)} track ${context.stage} failed.`,
      `Message: ${exception.message || "No message supplied by Lavalink."}`,
      `Severity: ${exception.severity || "unknown"}`,
      `Cause: ${cause}`,
      `Backend: ${musicNodeDescription(context.info)}`,
      `Next: ${hint}`,
      context.stage === "lookup"
        ? "This is a source lookup failure, not a Discord voice-connection failure. No fallback source was used."
        : "This failure occurred during audio playback, after track lookup.",
    ].join("\n")
  );
}

/** Policy checks shared by the live player and the read-only music doctor. */
/**
 * Policy checks shared by the live player, the read-only music doctor and the
 * dashboard. Returns the identifier to send to Lavalink plus the provider it
 * belongs to.
 *
 * `provider` is an explicit user choice. For text it selects the search prefix;
 * for a URL it may only confirm the host's own provider (see below).
 */
export async function prepareMusicQuery(
  query: string,
  settings = musicSourceSettings(),
  resolveHost: MusicLookup = lookup,
  provider?: MusicSearchProviderId | string | null
): Promise<{
  identifier: string;
  source: string;
  kind: "url" | "search";
  provider: MusicSearchProvider | null;
}> {
  let value = query.trim();
  if (value.length < 2 || value.length > 200)
    throw new Error(
      "Enter 2–200 characters of search text or an approved source URL."
    );
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(value) || /^(?:file|data):/i.test(value)) {
    let url: URL;
    try {
      url = assertFeedUrl(value);
    } catch {
      throw new Error(
        "Audio source URLs must use public HTTPS on port 443 without credentials."
      );
    }
    const source = Object.entries(SOURCE_HOSTS).find(([, hosts]) =>
      hosts.some((host) => matchesHost(url.hostname, host))
    )?.[0];
    if (
      !source ||
      !settings.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    )
      throw new Error(
        "This audio source is not enabled. Ask your administrator which sources are supported."
      );
    // A link is routed by its hostname, never rewritten into a search. An explicit
    // provider that belongs to a different source manager is a contradiction, so
    // it is refused instead of silently ignored.
    const chosen = provider
      ? resolveSearchProvider(provider, settings.searchPrefix)
      : null;
    if (chosen && "error" in chosen) throw new Error(chosen.error);
    if (chosen && chosen.provider.manager !== source)
      throw new Error(
        `That link belongs to ${providerLabel(source)}, but the selected source is ${chosen.provider.label}. Remove the source option, or paste a ${chosen.provider.label} link. Direct links always follow their hostname.`
      );
    const addresses = await resolveHost(url.hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some((ip) => !isPublicAddress(ip.address))
    )
      throw new Error("Private audio-source addresses are not allowed.");
    return { identifier: url.toString(), source, kind: "url", provider: null };
  }
  const chosen = resolveSearchProvider(provider, settings.searchPrefix);
  if ("error" in chosen) throw new Error(chosen.error);
  const selected = chosen.provider;
  // A pasted identifier for the selected provider must not be prefixed twice.
  if (value.toLowerCase().startsWith(`${selected.prefix}:`))
    value = value.slice(selected.prefix.length + 1).trim();
  if (value.length < 2 || value.length > 200)
    throw new Error(
      "Enter 2–200 characters of search text or an approved source URL."
    );
  if (/^[a-z]+search:/i.test(value))
    throw new Error(
      `Use plain search text with the selected source (${selected.label}), or an approved source URL — not another provider’s search identifier.`
    );
  // A bare YouTube id is not a URL: it cannot be host-checked, so it must not be
  // silently sent to the search adapter (where it becomes a meaningless query).
  if (/^[\w-]{11}$/.test(value) || /^(?:PL|UU|OL|RD)[\w-]{10,}$/.test(value))
    throw new Error(
      "That looks like a bare YouTube identifier. Paste the full link (https://www.youtube.com/watch?v=… , https://youtu.be/… or https://www.youtube.com/playlist?list=…) so Orbit can check the host and the public address first."
    );
  return {
    identifier: `${selected.prefix}:${value}`,
    source: selected.manager,
    kind: "search",
    provider: selected,
  };
}

/**
 * Resolve one query into tracks.
 *
 * `limit` only applies to text search: `/play` takes the first result (quick
 * play), `/search` takes its bounded candidate list. A direct URL or playlist is
 * always an explicit request, so it is never truncated here.
 */
export async function resolveMusicQuery(
  rest: MusicResolver,
  query: string,
  options: {
    info?: MusicNodeInfo | null;
    settings?: MusicSourceSettings;
    resolveHost?: MusicLookup;
    /** Explicit provider choice; omit to use `MUSIC_SEARCH_PREFIX`. */
    provider?: MusicSearchProviderId | string | null;
    /** Search candidates to return (1 for quick play). */
    limit?: number;
  } = {}
): Promise<{
  tracks: Track[];
  source: string | null;
  kind: "url" | "search";
  provider: MusicSearchProvider | null;
}> {
  const prepared = await prepareMusicQuery(
    query,
    options.settings,
    options.resolveHost,
    options.provider
  );
  const managers = options.info?.sourceManagers;
  if (
    prepared.source &&
    Array.isArray(managers) &&
    !managers.some((name) => name.toLowerCase() === prepared.source)
  )
    throw new Error(
      prepared.provider
        ? providerUnavailableMessage(prepared.provider)
        : urlSourceUnavailable(prepared.source)
    );
  let result: LavalinkResponse | undefined;
  try {
    result = await rest.resolve(prepared.identifier);
  } catch (error) {
    throw new Error(
      diagnosticText(
        `The music backend request failed during track lookup.\n${errorDiagnostic(error)}\nBackend: ${musicNodeDescription(options.info)}\nCheck backend connectivity, authentication, and logs; this did not reach Discord audio playback.`
      )
    );
  }
  if (!result)
    throw new Error(
      "The music backend returned no lookup response. Check its connectivity and logs; no audio was started."
    );
  if (result.loadType === LoadType.ERROR)
    throw new Error(
      musicSourceFailure(result.data, {
        stage: "lookup",
        source: prepared.source,
        info: options.info,
      })
    );
  const searchLimit = Math.min(
    Math.max(1, Math.floor(options.limit ?? 1)),
    MAX_SEARCH_CANDIDATES
  );
  const tracks =
    result.loadType === LoadType.TRACK
      ? [result.data]
      : result.loadType === LoadType.PLAYLIST
        ? result.data.tracks
        : result.loadType === LoadType.SEARCH
          ? result.data.slice(0, searchLimit)
          : [];
  if (!tracks.length)
    throw new Error(
      `${providerLabel(prepared.source)} returned no playable tracks for this ${prepared.kind}. Try an authorized public track URL or another query. Search availability depends on the installed backend and provider; a connection alone is not sufficient.`
    );
  // Optional defensive metadata check; most adapters provide no content rating.
  // This is not a claim that unrated recordings/lyrics are automatically SFW.
  if (
    tracks.some((track) => {
      const flags = (track.pluginInfo ?? {}) as Record<string, unknown>;
      return (
        flags.isExplicit === true ||
        flags.explicit === true ||
        flags.isAgeRestricted === true
      );
    })
  )
    throw new Error(
      "This request contains explicitly marked or age-restricted content. Choose a clean, public recording."
    );
  if (
    tracks.some(
      (track) =>
        !Object.hasOwn(SOURCE_HOSTS, track.info.sourceName) ||
        track.info.sourceName !== prepared.source
    )
  )
    throw new Error(
      "The backend returned a source outside the approved music-source policy. No audio was started."
    );
  return {
    tracks,
    source: prepared.source,
    kind: prepared.kind,
    provider: prepared.provider,
  };
}
