import { assertFeedUrl, isPublicAddress } from "@orbit/core";
import { diagnosticText, errorDiagnostic } from "@orbit/core/diagnostics";
import { lookup } from "node:dns/promises";
import {
  LoadType,
  type Exception,
  type LavalinkResponse,
  type NodeInfo,
  type Track,
} from "shoukaku";

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
    searchPrefix: process.env.MUSIC_SEARCH_PREFIX ?? "scsearch",
    allowedHosts: (
      process.env.MUSIC_ALLOWED_HOSTS ?? "soundcloud.com,bandcamp.com"
    )
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}
const providerLabel = (source: string | null) =>
  source === "soundcloud"
    ? "SoundCloud"
    : source === "bandcamp"
      ? "Bandcamp"
      : "Configured source";
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
export async function prepareMusicQuery(
  query: string,
  settings = musicSourceSettings(),
  resolveHost: MusicLookup = lookup
) {
  let value = query.trim();
  // Pasted identifiers for the configured search provider must not get prefixed twice.
  if (value.startsWith(`${settings.searchPrefix}:`))
    value = value.slice(settings.searchPrefix.length + 1).trim();
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
    if (
      !settings.allowedHosts.some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    )
      throw new Error(
        "This audio source is not enabled. Ask your administrator which sources are supported."
      );
    const addresses = await resolveHost(url.hostname, { all: true });
    if (
      !addresses.length ||
      addresses.some((ip) => !isPublicAddress(ip.address))
    )
      throw new Error("Private audio-source addresses are not allowed.");
    const source =
      ["soundcloud", "bandcamp"].find(
        (name) =>
          url.hostname === `${name}.com` ||
          url.hostname.endsWith(`.${name}.com`)
      ) ?? null;
    return { identifier: url.toString(), source, kind: "url" as const };
  }
  if (!["scsearch", "bcsearch"].includes(settings.searchPrefix))
    throw new Error(
      "Configure a supported MUSIC_SEARCH_PREFIX: scsearch or bcsearch."
    );
  if (/^[a-z]+search:/i.test(value))
    throw new Error(
      "Use plain search text for the configured provider or an approved source URL, not another provider’s search identifier."
    );
  return {
    identifier: `${settings.searchPrefix}:${value}`,
    source: settings.searchPrefix === "scsearch" ? "soundcloud" : "bandcamp",
    kind: "search" as const,
  };
}
export async function resolveMusicQuery(
  rest: MusicResolver,
  query: string,
  options: {
    info?: MusicNodeInfo | null;
    settings?: MusicSourceSettings;
    resolveHost?: MusicLookup;
  } = {}
): Promise<{ tracks: Track[]; source: string | null; kind: "url" | "search" }> {
  const prepared = await prepareMusicQuery(
    query,
    options.settings,
    options.resolveHost
  );
  const managers = options.info?.sourceManagers;
  if (
    prepared.source &&
    Array.isArray(managers) &&
    !managers.some((name) => name.toLowerCase() === prepared.source)
  )
    throw new Error(
      `${providerLabel(prepared.source)} is not enabled on this Lavalink node. ${prepared.source === "soundcloud" ? "Enable plugins.soundy.enabled in the Soundy-enabled backend (keep the built-in sources.soundcloud disabled)." : `Enable lavalink.server.sources.${prepared.source}.`} Restart Lavalink, then run npm run music:doctor. See docs/MUSIC.md. A connected backend does not guarantee an enabled source.`
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
  const tracks =
    result.loadType === LoadType.TRACK
      ? [result.data]
      : result.loadType === LoadType.PLAYLIST
        ? result.data.tracks
        : result.loadType === LoadType.SEARCH
          ? result.data.slice(0, 1)
          : [];
  if (!tracks.length)
    throw new Error(
      `${providerLabel(prepared.source)} returned no playable tracks for this ${prepared.kind}. Try an authorized public track URL or another query. Search availability depends on the installed backend and provider; a connection alone is not sufficient.`
    );
  return { tracks, source: prepared.source, kind: prepared.kind };
}
