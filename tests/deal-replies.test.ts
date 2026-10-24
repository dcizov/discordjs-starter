import { describe, expect, it } from "vitest";
import { dealEmbed, dealLinkRow } from "../packages/core/src/deal-presentation";
import { gameDealReply } from "../apps/bot/src/deal-replies";
import { deal } from "./fixtures/deals";

describe("rich Discord game cards shared with automatic delivery", () => {
  it("uses actual artwork, Steam ratings/counts, offers and retained purchase links", () => {
    const value = deal(),
      embed = dealEmbed(value);
    expect(embed.image?.url).toBe(value.game.image);
    expect(embed.thumbnail?.url).toBe(value.game.boxart);
    expect(embed.fields).toContainEqual(
      expect.objectContaining({
        name: "Steam reviews",
        value: "90% positive · 50,000 reviews",
      })
    );
    expect(embed.fields).toContainEqual(
      expect.objectContaining({
        name: "Save 75%",
        value: expect.stringContaining("10 EUR"),
      })
    );
    expect(embed.footer?.text).toContain("IsThereAnyDeal");
    expect(dealLinkRow(value)!.components[0].url).toBe(value.offer!.url);
  });
  it("stays under Discord's aggregate/per-field limits with three large metadata cards", () => {
    const value = deal();
    value.game.title = "X".repeat(500);
    value.game.tags = Array(100).fill("**<@&123456789012345678>**".repeat(20));
    const reply = gameDealReply([value, value, value, value]);
    expect(reply.embeds).toHaveLength(3);
    expect(reply.components).toHaveLength(3);
    expect(reply.allowedMentions).toEqual({ parse: [] });
    let total = 0;
    for (const embed of reply.embeds) {
      expect(embed.title!.length).toBeLessThanOrEqual(256);
      expect(embed.description!.length).toBeLessThanOrEqual(4096);
      total +=
        embed.title!.length +
        embed.description!.length +
        embed.footer!.text.length;
      for (const field of embed.fields!) {
        expect(field.value.length).toBeLessThanOrEqual(1024);
        total += field.name.length + field.value.length;
      }
    }
    expect(total).toBeLessThanOrEqual(6000);
  });
  it("leaves missing artwork out and states missing prices/ratings instead of inventing them", () => {
    const value = deal();
    value.game.image = "";
    value.game.boxart = "";
    value.game.reviews = [];
    value.game.players = null;
    value.offer = null;
    const embed = dealEmbed(value);
    expect(embed).not.toHaveProperty("image");
    expect(embed).not.toHaveProperty("thumbnail");
    expect(embed.fields).toContainEqual(
      expect.objectContaining({ name: "Price unavailable" })
    );
    expect(embed.fields).toContainEqual(
      expect.objectContaining({
        name: "Steam reviews",
        value: "Rating unavailable",
      })
    );
    expect(dealLinkRow(value)!.components).toHaveLength(1);
  });
  it("does not show artwork for mature/unknown content even if a caller bypassed discovery", () => {
    const value = deal();
    value.game.mature = true;
    expect(() => dealEmbed(value)).toThrow("non-mature");
    value.game.mature = null;
    expect(() => gameDealReply([value])).toThrow("non-mature");
  });
});
