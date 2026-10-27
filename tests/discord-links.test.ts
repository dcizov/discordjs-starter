import { describe, expect, it } from "vitest";
import { discordMessageUrl } from "../apps/web/lib/discord-links";

describe("Discord message links", () => {
  it("builds a jump link from three confirmed snowflakes", () => {
    expect(
      discordMessageUrl(
        "120000000000000001",
        "120000000000000010",
        "120000000000000099"
      )
    ).toBe(
      "https://discord.com/channels/120000000000000001/120000000000000010/120000000000000099"
    );
  });
  it("omits the link when the send was never confirmed", () => {
    expect(
      discordMessageUrl("120000000000000001", "120000000000000010", null)
    ).toBeNull();
    expect(
      discordMessageUrl("120000000000000001", "120000000000000010")
    ).toBeNull();
  });
  it("refuses anything that is not a snowflake", () => {
    expect(
      discordMessageUrl(
        "120000000000000001",
        "120000000000000010",
        "../../evil"
      )
    ).toBeNull();
    expect(discordMessageUrl("not-a-guild", "1", "2")).toBeNull();
  });
});
