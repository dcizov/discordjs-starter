/*
 * The config type and the config schema describe the same shape.
 *
 * `GuildConfig` is written out by hand in types.ts while `configSchema` is what
 * actually parses stored jsonb, so the two can drift with no signal at all:
 * adding a field to one and forgetting the other compiles cleanly, and the miss
 * only surfaces at whichever call site happens to touch the new field. Adding
 * `wowForever` needed edits in both places, which is how the gap was found.
 *
 * A compile-time assertion in config.ts now makes drift a type error, but a
 * type error is only as good as someone running the typechecker in a context
 * that sees it. These are the runtime consequences of the same contract — that
 * what the schema accepts is what the type claims, and vice versa.
 */
import { describe, expect, it } from "vitest";
import { configSchema, defaultConfig } from "@orbit/core";
import { LOCALES, type Locale } from "@orbit/core/locales";
import { WOW_FOREVER_REGIONS } from "@orbit/core/wow-forever";

describe("config schema and GuildConfig agree", () => {
  it("accepts every locale the type allows", () => {
    // The type is now narrowed to the union rather than `string`, so a locale
    // outside the catalogue cannot be written through either route.
    for (const locale of LOCALES)
      expect(configSchema.parse({ locale }).locale).toBe(locale);
  });

  it("rejects a locale that is not in the catalogue", () => {
    expect(() => configSchema.parse({ locale: "xx" })).toThrow();
  });

  it("rejects a ruleset region that has no Forever gateway", () => {
    // Passing one through would build requests for a host that does not exist
    // and fail every poll in a way that looks like an outage.
    expect(() =>
      configSchema.parse({ wowForever: { region: "cn" } })
    ).toThrow();
  });

  it("accepts every region the type allows", () => {
    for (const region of WOW_FOREVER_REGIONS)
      expect(
        configSchema.parse({ wowForever: { region } }).wowForever.region
      ).toBe(region);
  });

  it("defaults to a value the type permits, so the two cannot start apart", () => {
    const parsed = configSchema.parse({});
    expect(LOCALES).toContain(parsed.locale as Locale);
    expect(WOW_FOREVER_REGIONS).toContain(parsed.wowForever.region as never);
  });

  it("round-trips a full default config without losing a field", () => {
    // Guards the other direction: if the schema grew a field the hand-written
    // type forgot, `defaultConfig` would carry it and the parse would echo it
    // back while call sites typed against GuildConfig could not see it.
    expect(configSchema.parse(defaultConfig)).toEqual(defaultConfig);
  });
});
