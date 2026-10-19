import { afterEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "./config";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseEnv", () => {
  it("returns the parsed variables", () => {
    expect(
      parseEnv({
        DISCORD_TOKEN: "token",
        DISCORD_CLIENT_ID: "123",
        DATABASE_URL: "postgres://localhost:5432/bot",
      })
    ).toEqual({
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123",
      DATABASE_URL: "postgres://localhost:5432/bot",
    });
  });

  it("keeps the optional guild id", () => {
    expect(
      parseEnv({
        DISCORD_TOKEN: "token",
        DISCORD_CLIENT_ID: "123",
        DATABASE_URL: "postgres://localhost:5432/bot",
        DISCORD_GUILD_ID: "123456789012345678",
      }).DISCORD_GUILD_ID
    ).toBe("123456789012345678");
  });

  it("names the missing variable and exits", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    parseEnv({ DISCORD_TOKEN: "token" });

    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("DISCORD_CLIENT_ID");
  });

  it("rejects a guild id that is not a snowflake", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    parseEnv({
      DISCORD_TOKEN: "token",
      DISCORD_CLIENT_ID: "123",
      DATABASE_URL: "postgres://localhost:5432/bot",
      DISCORD_GUILD_ID: "my-server",
    });

    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("DISCORD_GUILD_ID");
  });
});
