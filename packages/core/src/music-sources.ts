/**
 * The one definition of Orbit's text-search providers.
 *
 * Text search goes through a Lavalink *search prefix* (`scsearch:`, `ytsearch:`,
 * `ytmsearch:`, `bcsearch:`), and each prefix belongs to a source manager the
 * backend must have registered. Keeping that mapping here means the slash
 * commands, `/help`, the dashboard, the runtime resolver and the read-only music
 * doctor cannot disagree about which providers exist or which adapter a missing
 * provider needs.
 *
 * Pure data: no Node built-ins, so client components can import it.
 */
export type MusicSearchProviderId =
  "soundcloud" | "youtube" | "youtube-music" | "bandcamp";

export type MusicSearchProvider = {
  id: MusicSearchProviderId;
  /** Lavalink search prefix, sent to the backend exactly as written. */
  prefix: string;
  /** Source manager that must be registered for this provider. */
  manager: "soundcloud" | "youtube" | "bandcamp";
  label: string;
  /** Slash-command choice description. */
  description: string;
  /**
   * Where an operator enables the adapter for *this* deployment. These are the
   * switches Orbit actually ships in `docker/lavalink/application.yml`; no
   * invented plugin flag is suggested.
   */
  enableHint: string;
};

export const MUSIC_SEARCH_PROVIDERS: readonly MusicSearchProvider[] = [
  {
    id: "soundcloud",
    prefix: "scsearch",
    manager: "soundcloud",
    label: "SoundCloud",
    description: "Search SoundCloud (the Soundy source manager)",
    enableHint:
      "Enable plugins.soundy.enabled and keep lavalink.server.sources.soundcloud disabled (one owner per source).",
  },
  {
    id: "youtube",
    prefix: "ytsearch",
    manager: "youtube",
    label: "YouTube",
    description: "Search YouTube videos (youtube-source)",
    enableHint:
      "Enable plugins.youtube.enabled and keep lavalink.server.sources.youtube disabled.",
  },
  {
    id: "youtube-music",
    prefix: "ytmsearch",
    manager: "youtube",
    label: "YouTube Music",
    description: "Search YouTube Music (same adapter, music catalogue)",
    enableHint:
      "Enable plugins.youtube.enabled; YouTube Music search uses the same adapter as YouTube and needs no extra switch.",
  },
  {
    id: "bandcamp",
    prefix: "bcsearch",
    manager: "bandcamp",
    label: "Bandcamp",
    description: "Search Bandcamp (Lavalink's built-in Bandcamp source)",
    enableHint: "Enable lavalink.server.sources.bandcamp.",
  },
] as const;

/** Prefix used when `MUSIC_SEARCH_PREFIX` is unset. */
export const DEFAULT_MUSIC_SEARCH_PREFIX = "scsearch";

/**
 * Look up a provider by its user-facing id. Prefixes are deliberately *not*
 * accepted here: a user-facing option carries an approved choice, and raw
 * backend identifiers (`scsearch:`, a Lavalink source name) stay internal.
 */
export function musicSearchProvider(
  value: string | null | undefined
): MusicSearchProvider | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  return MUSIC_SEARCH_PROVIDERS.find((provider) => provider.id === key);
}

/** Look up a provider by the configured search prefix (`MUSIC_SEARCH_PREFIX`). */
export function musicSearchProviderByPrefix(
  prefix: string | null | undefined
): MusicSearchProvider | undefined {
  const key = prefix?.trim().toLowerCase();
  if (!key) return undefined;
  return MUSIC_SEARCH_PROVIDERS.find((provider) => provider.prefix === key);
}

/** Human label for a provider id, without inventing one for unknown values. */
export function musicSearchProviderLabel(
  value: string | null | undefined
): string | null {
  return musicSearchProvider(value)?.label ?? null;
}

/** The provider selected by an explicit choice, else by configuration. */
export function resolveSearchProvider(
  requested: string | null | undefined,
  configuredPrefix: string
): { provider: MusicSearchProvider } | { error: string } {
  if (requested) {
    const provider = musicSearchProvider(requested);
    if (!provider)
      return {
        error: `Unknown search provider "${String(requested).slice(0, 40)}". Choose ${MUSIC_SEARCH_PROVIDERS.map((p) => p.id).join(", ")}.`,
      };
    return { provider };
  }
  const configured = musicSearchProviderByPrefix(configuredPrefix);
  if (!configured)
    return {
      error: `MUSIC_SEARCH_PREFIX must be one of ${supportedPrefixes().join(", ")}.`,
    };
  return { provider: configured };
}

/** Prefixes the runtime understands, for error messages and the doctor. */
export function supportedPrefixes() {
  return MUSIC_SEARCH_PROVIDERS.map((provider) => provider.prefix);
}

/** Provider that a registered source manager belongs to (first match wins). */
export function providerForManager(
  manager: string
): MusicSearchProvider | undefined {
  const key = manager.trim().toLowerCase();
  return MUSIC_SEARCH_PROVIDERS.find((provider) => provider.manager === key);
}

/**
 * Actionable message for a provider whose adapter is not registered, using that
 * provider's real configuration switch rather than a generic guess.
 */
export function providerUnavailableMessage(provider: MusicSearchProvider) {
  return `${provider.label} search is not enabled on this Lavalink node. ${provider.enableHint} Restart Lavalink, then run npm run music:doctor. A connected backend does not guarantee an enabled source.`;
}
