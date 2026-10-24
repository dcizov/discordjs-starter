import type { GameDeal } from "@orbit/core/deal-types";
import { safeText } from "@orbit/core";

const gameId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();
type GameChoice = { id: string; title: string; year: string };
type RecentSearch = { expires: number; games: GameChoice[] };

/**
 * Bounded, short-lived title choices from verified results, scoped to the
 * requesting guild AND user. Autocomplete never calls ITAD on each keystroke,
 * exposes someone else's searches, or persists tokens/prices/interaction data.
 * After a bot restart, search again; saved watches retain their real game IDs.
 */
export class DealGameSelection {
  private readonly searches = new Map<string, RecentSearch>();
  constructor(
    private readonly now = Date.now,
    private readonly ttlMs = 15 * 60_000,
    private readonly capacity = 200
  ) {}
  private key(guildId: string, userId: string) {
    return `${guildId}:${userId}`;
  }
  private current(guildId: string, userId: string) {
    const key = this.key(guildId, userId);
    const value = this.searches.get(key);
    if (value && value.expires <= this.now()) {
      this.searches.delete(key);
      return undefined;
    }
    return value;
  }
  remember(guildId: string, userId: string, results: GameDeal[]) {
    const key = this.key(guildId, userId);
    const previous = this.current(guildId, userId)?.games ?? [];
    const fresh = results
      .filter(
        ({ game }) =>
          game.type === "game" && game.mature === false && gameId.test(game.id)
      )
      .map(({ game }) => ({
        id: game.id.toLowerCase(),
        title: game.title.trim().replace(/\s+/g, " ").slice(0, 512),
        year: /^\d{4}-\d{2}-\d{2}$/.test(game.releaseDate ?? "")
          ? game.releaseDate!.slice(0, 4)
          : "",
      }))
      .filter((game) => safeText(game.title, 512).trim().length > 0);
    if (!fresh.length) return;
    const ids = new Set<string>();
    const games = [...fresh, ...previous]
      .filter((game) => {
        if (ids.has(game.id)) return false;
        ids.add(game.id);
        return true;
      })
      .slice(0, 25);
    for (const [key, search] of this.searches)
      if (search.expires <= this.now()) this.searches.delete(key);
    this.searches.delete(key);
    this.searches.set(key, { expires: this.now() + this.ttlMs, games });
    while (this.searches.size > Math.max(1, this.capacity))
      this.searches.delete(this.searches.keys().next().value!);
  }
  choices(guildId: string, userId: string, query: string) {
    const q = normalize(query);
    return (this.current(guildId, userId)?.games ?? [])
      .filter(
        (game) =>
          normalize(game.title).includes(q) ||
          game.id.toLowerCase().startsWith(q)
      )
      .map((game) => ({
        name: `${safeText(game.title, 90)}${game.year ? ` (${game.year})` : ""}`.slice(
          0,
          100
        ),
        value: game.id,
      }));
  }
  resolve(guildId: string, userId: string, value: string) {
    const input = value.trim();
    if (gameId.test(input)) return input.toLowerCase(); // backwards-compatible manual IDs
    const matches = (this.current(guildId, userId)?.games ?? []).filter(
      (game) =>
        normalize(game.title) === normalize(input) ||
        normalize(safeText(game.title, 512)) === normalize(input)
    );
    if (matches.length === 1) return matches[0].id;
    throw new Error(
      matches.length > 1
        ? "Several game editions have that title. Choose an autocomplete suggestion from your recent /deals search."
        : "Run /deals search first, then choose the game by title from the game suggestions. An IsThereAnyDeal game ID also works."
    );
  }
}
export const dealGameSelection = new DealGameSelection();
