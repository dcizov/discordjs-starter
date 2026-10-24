import { describe, expect, it } from "vitest";
import { DealGameSelection } from "../apps/bot/src/deal-game-selection";
import { deal, gameId, otherId } from "./fixtures/deals";
const guildId = "120000000000000001",
  actorId = "120000000000000002";

describe("title-based deal selection without public-card IDs or per-keystroke I/O", () => {
  it("shows a verified title/year but retains the real provider UUID as the selection value", () => {
    const choices = new DealGameSelection();
    const value = deal();
    choices.remember(guildId, actorId, [value]);
    expect(choices.choices(guildId, actorId, "popular TEST")).toEqual([
      { name: `${value.game.title} (2020)`, value: gameId },
    ]);
    expect(
      choices.resolve(guildId, actorId, `  ${value.game.title.toUpperCase()}  `)
    ).toBe(gameId);
    expect(choices.resolve(guildId, actorId, gameId.toUpperCase())).toBe(
      gameId
    );
    expect(choices.choices(guildId, actorId, "unrelated")).toEqual([]);
  });
  it("resolves the original catalog title with ampersands/markup while sanitizing the visible menu label", () => {
    const choices = new DealGameSelection();
    const value = deal();
    value.game.title = "Fictional <b>Game</b> & Friends";
    value.game.id = value.game.id.toUpperCase();
    choices.remember(guildId, actorId, [value]);
    expect(choices.resolve(guildId, actorId, value.game.title)).toBe(gameId);
    const menu = choices.choices(guildId, actorId, "& Friends");
    expect(menu).toHaveLength(1);
    expect(menu[0].name).not.toContain("<b>");
    expect(menu[0].value).toBe(gameId);
  });
  it("does not expose another user's or guild's recent searches", () => {
    const choices = new DealGameSelection();
    choices.remember(guildId, actorId, [deal()]);
    expect(choices.choices("another-guild", actorId, "")).toEqual([]);
    expect(choices.choices(guildId, "another-user", "")).toEqual([]);
    expect(() =>
      choices.resolve(guildId, "another-user", deal().game.title)
    ).toThrow("Run /deals search first");
  });
  it("expires suggestions while keeping manually supplied IDs backwards compatible", () => {
    let now = 0;
    const choices = new DealGameSelection(() => now, 100);
    choices.remember(guildId, actorId, [deal()]);
    now = 100;
    expect(choices.choices(guildId, actorId, "")).toEqual([]);
    expect(() => choices.resolve(guildId, actorId, deal().game.title)).toThrow(
      "Run /deals search first"
    );
    expect(choices.resolve(guildId, actorId, gameId)).toBe(gameId);
  });
  it("bounds contexts and evicts the oldest without leaking their contents", () => {
    const choices = new DealGameSelection(Date.now, 60_000, 2);
    for (const user of ["old", "new", "newest"])
      choices.remember(guildId, user, [deal()]);
    expect(choices.choices(guildId, "old", "")).toEqual([]);
    expect(choices.choices(guildId, "newest", "")).toHaveLength(1);
  });
  it("keeps at most 25 unique recent choices, with new results first and no UUID in the label", () => {
    const choices = new DealGameSelection();
    const values = Array.from({ length: 30 }, (_, index) => {
      const value = deal(
        `12000000-0000-4000-8000-${String(index).padStart(12, "0")}`
      );
      value.game.title = `Game ${index} ${"X".repeat(200)}`;
      return value;
    });
    choices.remember(guildId, actorId, values);
    choices.remember(guildId, actorId, [values[29], values[29]]);
    const result = choices.choices(guildId, actorId, "");
    expect(result).toHaveLength(25);
    expect(new Set(result.map((item) => item.value)).size).toBe(25);
    expect(result[0].value).toBe(values[29].game.id);
    for (const item of result) {
      expect(item.name.length).toBeLessThanOrEqual(100);
      expect(item.name).not.toContain(item.value);
    }
  });
  it("never guesses the first result for an ambiguous or partial title", () => {
    const choices = new DealGameSelection();
    choices.remember(guildId, actorId, [deal(), deal(otherId)]);
    expect(() => choices.resolve(guildId, actorId, deal().game.title)).toThrow(
      "Several game editions"
    );
    expect(() => choices.resolve(guildId, actorId, "Fictional")).toThrow(
      "Run /deals search first"
    );
    expect(choices.resolve(guildId, actorId, otherId)).toBe(otherId);
  });
  it("accepts only verified non-mature base-game results and valid provider IDs", () => {
    const choices = new DealGameSelection();
    const mature = deal(),
      unknown = deal(),
      dlc = deal(),
      invalid = deal(),
      emptyTitle = deal();
    mature.game.mature = true;
    unknown.game.mature = null;
    dlc.game.type = "dlc";
    invalid.game.id = "not-a-provider-id";
    emptyTitle.game.title = "<b></b>";
    choices.remember(guildId, actorId, [
      mature,
      unknown,
      dlc,
      invalid,
      emptyTitle,
    ]);
    expect(choices.choices(guildId, actorId, "")).toEqual([]);
  });
});
