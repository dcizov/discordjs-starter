import { describe, expect, it } from "vitest";
import { errorCode, errorMessage } from "@orbit/core/errors";

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
