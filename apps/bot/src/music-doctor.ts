import { diagnosticText, errorDiagnostic } from "@orbit/core/diagnostics";
import { parseArgs } from "node:util";
import { LoadType, type LavalinkResponse } from "shoukaku";
import { z } from "zod";
import {
  musicSourceSettings,
  resolveMusicQuery,
  type MusicLookup,
  type MusicResolver,
  type MusicSourceSettings,
} from "./music-source";

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
    values.query !== undefined &&
    (values.query.trim().length < 2 || values.query.length > 200)
  )
    throw new Error("--query must contain 2–200 characters.");
  return { help: false, query: values.query } as const;
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
  lookup?: {
    status: "loaded" | "failed";
    tracks?: number;
    source?: string | null;
    kind?: "search" | "url";
  };
  error?: string;
};
export async function runMusicDoctor(
  client: MusicDoctorClient,
  options: {
    query?: string;
    settings?: MusicSourceSettings;
    resolveHost?: MusicLookup;
  } = {}
): Promise<DoctorReport> {
  const settings = options.settings ?? musicSourceSettings();
  const report: DoctorReport = {
    ok: false,
    scope:
      "Read-only backend/source metadata check. No Discord login, voice join, audio playback, or database/queue access. A successful lookup does not prove playback works.",
    backend: null,
    configuredSearch: diagnosticText(settings.searchPrefix, 100),
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
    const source =
      settings.searchPrefix === "scsearch"
        ? "soundcloud"
        : settings.searchPrefix === "bcsearch"
          ? "bandcamp"
          : null;
    if (!source)
      report.warnings.push("MUSIC_SEARCH_PREFIX must be scsearch or bcsearch.");
    else if (!info.sourceManagers.some((name) => name.toLowerCase() === source))
      report.warnings.push(
        `The configured ${source} source manager is not enabled. Enable it in Lavalink and restart that service.`
      );
    else report.ok = true;
    if (options.query !== undefined) {
      try {
        const result = await resolveMusicQuery(client, options.query, {
          info,
          settings,
          resolveHost: options.resolveHost,
        });
        report.lookup = {
          status: "loaded",
          tracks: result.tracks.length,
          source: result.source,
          kind: result.kind,
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
