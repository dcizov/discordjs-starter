import { diagnosticText, errorDiagnostic } from "@orbit/core/diagnostics";
import {
  MUSIC_SEARCH_PROVIDERS,
  musicSearchProvider,
  musicSearchProviderByPrefix,
  providerUnavailableMessage,
  supportedPrefixes,
} from "@orbit/core/music-sources";
import { parseArgs } from "node:util";
import { LoadType, type LavalinkResponse } from "shoukaku";
import { z } from "zod";
import {
  musicSourceSettings,
  resolveMusicQuery,
  type MusicLookup,
  type MusicResolver,
  type MusicSourceSettings,
} from "./source";

const infoSchema = z.object({
  version: z.object({ semver: z.string().max(100) }),
  lavaplayer: z.string().max(100),
  sourceManagers: z.array(z.string().max(100)).max(100),
  plugins: z
    .array(
      z.object({ name: z.string().max(100), version: z.string().max(100) })
    )
    .max(100)
    .default([]),
});
const trackSchema = z.object({
  encoded: z.string(),
  info: z.object({
    identifier: z.string(),
    isSeekable: z.boolean(),
    author: z.string(),
    length: z.number(),
    isStream: z.boolean(),
    position: z.number(),
    title: z.string(),
    uri: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    artworkUrl: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    isrc: z
      .string()
      .nullish()
      .transform((v) => v ?? undefined),
    sourceName: z.string(),
  }),
  pluginInfo: z.unknown().default({}),
});
const responseSchema = z.discriminatedUnion("loadType", [
  z.object({ loadType: z.literal(LoadType.TRACK), data: trackSchema }),
  z.object({
    loadType: z.literal(LoadType.SEARCH),
    data: z.array(trackSchema),
  }),
  z.object({
    loadType: z.literal(LoadType.PLAYLIST),
    data: z.object({
      info: z.object({ name: z.string(), selectedTrack: z.number() }),
      tracks: z.array(trackSchema),
      pluginInfo: z.unknown().default({}),
    }),
  }),
  z.object({
    loadType: z.literal(LoadType.EMPTY),
    data: z.record(z.string(), z.never()),
  }),
  z.object({
    loadType: z.literal(LoadType.ERROR),
    data: z.object({
      message: z
        .string()
        .nullable()
        .transform((v) => v ?? "No message supplied"),
      severity: z.enum(["common", "suspicious", "fault"]),
      cause: z
        .string()
        .nullish()
        .transform(
          (v) => v ?? "Not supplied by Lavalink. Inspect backend logs."
        ),
    }),
  }),
]);
export type MusicDoctorInfo = z.infer<typeof infoSchema>;
export type MusicDoctorClient = MusicResolver & {
  getLavalinkInfo(): Promise<MusicDoctorInfo>;
};

export function parseMusicDoctorArgs(args: string[]) {
  const { values, tokens } = parseArgs({
    args,
    options: {
      query: { type: "string" },
      source: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
    tokens: true,
  });
  if (values.help) return { help: true } as const;
  if (
    tokens.filter((t) => t.kind === "option" && t.name === "query").length > 1
  )
    throw new Error("Provide --query only once.");
  if (
    tokens.filter((t) => t.kind === "option" && t.name === "source").length > 1
  )
    throw new Error("Provide --source only once.");
  if (
    values.query !== undefined &&
    (values.query.trim().length < 2 || values.query.length > 200)
  )
    throw new Error("--query must contain 2–200 characters.");
  // Same table as the runtime: an unknown provider is refused here rather than
  // reported as a mysterious backend failure.
  if (values.source !== undefined && !musicSearchProvider(values.source))
    throw new Error(
      `--source must be one of: ${MUSIC_SEARCH_PROVIDERS.map((p) => p.id).join(", ")}.`
    );
  if (values.source !== undefined && values.query === undefined)
    throw new Error("--source only selects the provider for --query.");
  return { help: false, query: values.query, source: values.source } as const;
}

/** Exactly two possible read-only endpoints; never connects a gateway or voice player. */
export function createMusicDoctorClient(
  config: { host: string; password: string; secure: boolean },
  request: typeof fetch = fetch
): MusicDoctorClient {
  if (
    !config.host ||
    /[\s/@?#]/.test(config.host) ||
    config.host.includes("://")
  )
    throw new Error(
      "LAVALINK_URL must be hostname:port without a scheme, path, or credentials."
    );
  const base = new URL(`${config.secure ? "https" : "http"}://${config.host}`);
  if (base.username || base.password || base.pathname !== "/")
    throw new Error("Invalid Lavalink hostname:port configuration.");
  if (!config.password)
    throw new Error("LAVALINK_PASSWORD must be configured.");
  const get = async (
    pathname: "/v4/info" | "/v4/loadtracks",
    identifier?: string
  ) => {
    const url = new URL(pathname, base);
    if (identifier !== undefined)
      url.searchParams.set("identifier", identifier);
    const response = await request(url, {
      method: "GET",
      headers: {
        Authorization: config.password,
        "User-Agent": "Orbit music doctor",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? "Check that bot and Lavalink passwords match."
          : "Check the backend version, connectivity, and logs.";
      // Never put arbitrary HTTP error bodies or request headers into diagnostics.
      throw new Error(
        `Lavalink ${pathname} returned HTTP ${response.status}. ${hint}`
      );
    }
    return response.json();
  };
  return {
    async getLavalinkInfo() {
      const parsed = infoSchema.safeParse(await get("/v4/info"));
      if (!parsed.success)
        throw new Error(
          "Lavalink /v4/info returned an unexpected v4 metadata format."
        );
      return parsed.data;
    },
    async resolve(identifier) {
      const parsed = responseSchema.safeParse(
        await get("/v4/loadtracks", identifier)
      );
      if (!parsed.success)
        throw new Error(
          "Lavalink /v4/loadtracks returned an unexpected v4 response format."
        );
      // Shoukaku's Playlist type includes an encoded field that Lavalink's playlist envelope does not supply.
      return parsed.data as LavalinkResponse;
    },
  };
}

type DoctorReport = {
  ok: boolean;
  scope: string;
  backend: {
    version: string;
    lavaplayer: string;
    sourceManagers: string[];
    plugins: { name: string; version: string }[];
  } | null;
  configuredSearch: string;
  warnings: string[];
  providers: {
    id: string;
    prefix: string;
    manager: string;
    available: boolean;
    configured: boolean;
  }[];
  /**
   * Lookup outcome. Explicitly separate from playback: a loaded track only means
   * the backend answered with metadata.
   */
  lookup?: {
    status: "loaded" | "failed";
    tracks?: number;
    source?: string | null;
    kind?: "search" | "url";
    provider?: string | null;
  };
  error?: string;
};
export async function runMusicDoctor(
  client: MusicDoctorClient,
  options: {
    query?: string;
    settings?: MusicSourceSettings;
    resolveHost?: MusicLookup;
    /** Provider to test the optional lookup with; defaults to the config. */
    source?: string;
  } = {}
): Promise<DoctorReport> {
  const settings = options.settings ?? musicSourceSettings();
  const report: DoctorReport = {
    ok: false,
    scope:
      "Read-only backend/source metadata check. No Discord login, voice join, audio playback, or database/queue access. A successful lookup does not prove playback works.",
    backend: null,
    configuredSearch: diagnosticText(settings.searchPrefix, 100),
    /** Every provider the runtime understands, with its adapter status. */
    providers: [],
    warnings: [],
  };
  try {
    const info = await client.getLavalinkInfo();
    const clean = (text: string) => diagnosticText(text, 200);
    report.backend = {
      version: clean(info.version.semver),
      lavaplayer: clean(info.lavaplayer),
      sourceManagers: info.sourceManagers.map(clean),
      plugins: info.plugins.map((plugin) => ({
        name: clean(plugin.name),
        version: clean(plugin.version),
      })),
    };
    // One provider table, shared with the runtime, the commands and the
    // dashboard. Every supported prefix is recognised, and a configured prefix
    // the table does not know is reported instead of guessed at.
    const hasManager = (manager: string) =>
      info.sourceManagers.some((name) => name.toLowerCase() === manager);
    report.providers = MUSIC_SEARCH_PROVIDERS.map((provider) => ({
      id: provider.id,
      prefix: provider.prefix,
      manager: provider.manager,
      available: hasManager(provider.manager),
      configured: provider.prefix === settings.searchPrefix,
    }));
    const configured = musicSearchProviderByPrefix(settings.searchPrefix);
    if (!configured) {
      report.warnings.push(
        `MUSIC_SEARCH_PREFIX is "${diagnosticText(settings.searchPrefix, 100)}", which Orbit cannot map to a search adapter. Use one of: ${supportedPrefixes().join(", ")}. Text search stays unavailable until this is fixed; nothing is switched automatically.`
      );
    } else if (
      !report.providers.some((p) => p.id === configured.id && p.available)
    ) {
      report.warnings.push(providerUnavailableMessage(configured));
    } else report.ok = true;
    const unavailable = report.providers.filter((p) => !p.available);
    if (unavailable.length === MUSIC_SEARCH_PROVIDERS.length)
      report.warnings.push(
        "No search adapter is registered, but Lavalink answered. The backend is reachable; source managers are what serve lookups. Playback would still be unconfirmed either way."
      );
    else if (unavailable.length)
      report.warnings.push(
        `Not registered on this node: ${unavailable.map((p) => `${p.id} (${p.manager})`).join(", ")}. Those providers cannot be offered until their adapter is enabled and Lavalink restarted; the doctor does not suggest switches beyond the ones this deployment documents.`
      );
    if (options.query !== undefined) {
      try {
        const result = await resolveMusicQuery(client, options.query, {
          info,
          settings,
          resolveHost: options.resolveHost,
          provider: options.source,
        });
        report.lookup = {
          status: "loaded",
          tracks: result.tracks.length,
          source: result.source,
          kind: result.kind,
          provider: result.provider?.id ?? null,
        };
      } catch (error) {
        report.ok = false;
        report.lookup = { status: "failed" };
        report.error = errorDiagnostic(error);
      }
    } else
      report.warnings.push(
        "No track was looked up. Add --query with the same failing search text or approved source URL to test the source."
      );
  } catch (error) {
    report.error = errorDiagnostic(error);
  }
  return report;
}
