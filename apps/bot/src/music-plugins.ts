import { Rest } from "shoukaku";

const SPONSOR_CATEGORIES = new Set([
  "sponsor",
  "selfpromo",
  "interaction",
  "intro",
  "outro",
  "preview",
  "music_offtopic",
  "filler",
]);
export function sponsorBlockCategories(
  value = process.env.MUSIC_SPONSORBLOCK_CATEGORIES ??
    "sponsor,selfpromo,interaction"
) {
  const categories = [
    ...new Set(
      value
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
    ),
  ];
  if (categories.some((category) => !SPONSOR_CATEGORIES.has(category)))
    throw new Error(
      "MUSIC_SPONSORBLOCK_CATEGORIES contains an unsupported SponsorBlock category. See docs/MUSIC-PLUGINS.md."
    );
  return categories;
}

/** Keep auth, API version and timeouts in Shoukaku; never expose the password to the browser. */
export class MusicPluginRest extends Rest {
  // Shoukaku's structure hook uses new (...args: unknown[]) even though it
  // actually supplies Rest's ordinary (node, options) constructor arguments.
  constructor(...args: unknown[]) {
    super(...(args as ConstructorParameters<typeof Rest>));
  }
  async setSponsorBlock(guildId: string, categories: string[]) {
    if (!/^\d{17,20}$/.test(guildId) || !this.sessionId)
      throw new Error(
        "A connected music session and server are required for SponsorBlock."
      );
    await this.fetch({
      endpoint: `/sessions/${encodeURIComponent(this.sessionId)}/players/${guildId}/sponsorblock/categories`,
      options: {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Shoukaku's type only models object bodies; this upstream endpoint
        // explicitly accepts a JSON ARRAY. Its transport serializes it once.
        body: categories as unknown as Record<string, unknown>,
      },
    });
  }
}
