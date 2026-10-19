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

  it("names the missing variable and exits", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never);

    parseEnv({ DISCORD_TOKEN: "token" });

    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("DISCORD_CLIENT_ID");
  });
});
