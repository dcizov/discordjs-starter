import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SOURCE_REF,
  configuredSourceRef,
  normalizeSourcePath,
  normalizeSourceRef,
  sourceFileLink,
} from "../packages/core/src/source-links";

afterEach(() => vi.unstubAllEnvs());

describe("repository source links", () => {
  it("defaults to the main branch when nothing is configured", () => {
    vi.stubEnv("ORBIT_SOURCE_REF", "");
    expect(normalizeSourceRef(undefined)).toBe(DEFAULT_SOURCE_REF);
    expect(configuredSourceRef()).toBe(DEFAULT_SOURCE_REF);
    expect(
      sourceFileLink("docs/MUSIC.md", {
        ref: null,
        repository: "https://github.com/o/r/",
      })
    ).toBe("https://github.com/o/r/blob/main/docs/MUSIC.md");
  });

  it("uses a configured commit id, and reads the environment when no ref is passed", () => {
    const sha = "fee051a1b2c3d4e5f60718293a4b5c6d7e8f9012";
    vi.stubEnv("ORBIT_SOURCE_REF", sha);
    expect(configuredSourceRef()).toBe(sha);
    expect(sourceFileLink("docs/MUSIC.md")).toBe(
      `https://github.com/dcizov/discordjs-starter/blob/${sha}/docs/MUSIC.md`
    );
    expect(sourceFileLink("docs/MUSIC.md", { ref: "feature/x" })).toContain(
      "/blob/feature/x/docs/MUSIC.md"
    );
  });

  it("keeps slashes in branch names and strips a full refs/heads/ prefix", () => {
    const branch = "arena/99c6cf65-discordjs-starter";
    expect(normalizeSourceRef(branch)).toBe(branch);
    expect(
      sourceFileLink("docs/MUSIC.md", { ref: `refs/heads/${branch}` })
    ).toContain(`/blob/${branch}/docs/MUSIC.md`);
  });

  it.each([
    ["has spaces", "feature branch"],
    ["is a traversal", "../../etc/passwd"],
    ["contains a query", "main?x=1"],
    ["has an unsafe scheme", "javascript:alert(1)"],
    ["is far too long", "a".repeat(201)],
  ])("falls back to the default when a ref %s", (_label, ref) => {
    expect(normalizeSourceRef(ref)).toBe(DEFAULT_SOURCE_REF);
  });

  it("refuses anything that is not a repository-relative file path", () => {
    expect(normalizeSourcePath("./docs/MUSIC.md")).toBe("docs/MUSIC.md");
    expect(normalizeSourcePath("/docs/MUSIC.md")).toBe("docs/MUSIC.md");
    for (const bad of [
      "",
      "../secret",
      "docs/../x",
      "docs/MUSIC.md?x=1",
      "a b.md",
    ])
      expect(normalizeSourcePath(bad)).toBeNull();
    // The link builder never silently produces a partial URL.
    expect(() => sourceFileLink("../etc/passwd")).toThrow(
      /repository-relative/
    );
  });
});
