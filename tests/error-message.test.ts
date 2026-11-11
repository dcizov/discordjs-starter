import { describe, expect, it } from "vitest";
import { errorCode, errorMessage } from "@orbit/core/errors";
import { evictOldest } from "@orbit/core/collections";

/*
 * These helpers replaced 29 `catch (e: any)` clauses. The point of the tests
 * is the part the annotation was hiding: a catch clause can hold anything, and
 * the interesting cases are the ones that are not an Error.
 */

describe("errorMessage", () => {
  it("reads the message off an Error", () => {
    expect(errorMessage(new Error("Channel not found"))).toBe(
      "Channel not found"
    );
  });

  it("returns a thrown string as-is", () => {
    // `throw "nope"` is legal; `e.message` on it was `undefined`.
    expect(errorMessage("nope")).toBe("nope");
  });

  it("falls back when an Error has an empty message", () => {
    expect(errorMessage(new Error(""))).toBe("Unknown error");
    expect(errorMessage(new Error("   "))).toBe("Unknown error");
  });

  it("falls back for values with no message at all", () => {
    expect(errorMessage(undefined)).toBe("Unknown error");
    expect(errorMessage(null)).toBe("Unknown error");
    expect(errorMessage({ code: "ENOENT" })).toBe("Unknown error");
    expect(errorMessage(42)).toBe("Unknown error");
  });

  it("takes a caller-supplied fallback", () => {
    expect(errorMessage(undefined, "Could not save")).toBe("Could not save");
  });

  it("does not mistake a truthy non-string message for one", () => {
    expect(errorMessage({ message: 123 })).toBe("Unknown error");
  });
});

describe("errorCode", () => {
  it("reads a node-style code", () => {
    expect(
      errorCode(Object.assign(new Error("missing"), { code: "ENOENT" }))
    ).toBe("ENOENT");
  });

  it("returns undefined when there is no code", () => {
    expect(errorCode(new Error("boom"))).toBeUndefined();
    expect(errorCode("ENOENT")).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
  });

  it("returns undefined when code is not a string", () => {
    expect(errorCode({ code: 404 })).toBeUndefined();
  });

  it("keeps the ENOENT check it was written for", () => {
    const missing = Object.assign(new Error("no such file"), {
      code: "ENOENT",
    });
    expect(errorCode(missing) === "ENOENT").toBe(true);
    expect(errorCode(new Error("disk on fire")) === "ENOENT").toBe(false);
  });
});

describe("evictOldest", () => {
  it("removes the first-inserted entry", () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ]);
    expect(evictOldest(map)).toBe(true);
    expect([...map.keys()]).toEqual(["b", "c"]);
  });

  it("reports false on an empty map and never asks delete for undefined", () => {
    /*
     * Observing the key is the point. `map.delete(undefined)` also returns
     * false, so a version that skipped the emptiness check would pass a
     * size-only assertion while still calling delete with nothing.
     */
    const map = new Map<string, number>();
    const asked: (string | undefined)[] = [];
    const realDelete = map.delete.bind(map);
    map.delete = (key: string) => {
      asked.push(key);
      return realDelete(key);
    };
    expect(evictOldest(map)).toBe(false);
    map.set("a", 1);
    expect(evictOldest(map)).toBe(true);
    expect(asked).toEqual(["a"]);
    expect(map.size).toBe(0);
  });

  it("lets a loop that only checks size terminate", () => {
    const map = new Map<string, number>();
    for (let i = 0; i < 5; i++) map.set(`k${i}`, i);
    let guard = 0;
    while (map.size > 2 && guard < 100) {
      evictOldest(map);
      guard++;
    }
    expect(map.size).toBe(2);
    expect(guard).toBe(3);
  });
});
