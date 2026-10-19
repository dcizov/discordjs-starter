import { describe, expect, it } from "vitest";
import { commands } from "./index";

describe("command registry", () => {
  it("registers every command under its own name", () => {
    for (const [name, command] of Object.entries(commands)) {
      expect(command.data.name).toBe(name);
    }
  });

  it("builds deployable payloads without duplicates", () => {
    const payloads = Object.values(commands).map((command) =>
      command.data.toJSON()
    );
    const names = payloads.map((payload) => payload.name);

    expect(payloads.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });
});
