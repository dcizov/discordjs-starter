import { describe, expect, it } from "vitest";
import { parseResource } from "@orbit/core";

/*
 * These tests exist for the shape of the return value, not its contents.
 *
 * `parseResource` tags its result with the kind it was asked for so that
 * `if (parsed.kind === "route")` narrows `parsed.data` on its own. Callers
 * used to reach the data with `as any` instead, which typechecked regardless
 * of whether the field they then read actually existed on that kind. The
 * narrowing is what makes a wrong field a compile error, so the thing worth
 * pinning down here is that the tag and the data agree.
 */

const routeInput = {
  name: "Patch notes",
  enabled: true,
  data: {
    sourceIds: ["00000000-0000-4000-8000-000000000000"],
    channelId: "123456789012345678",
    keywords: [],
    tags: [],
    notificationRoleId: "",
    embedColor: "#5865f2",
    includeSummary: true,
  },
};

const sourceInput = {
  name: "Steam",
  enabled: true,
  data: {
    adapter: "rss",
    url: "https://example.com/feed.xml",
    channelId: "123456789012345678",
    keywords: [],
    tags: [],
    intervalMinutes: 30,
    firstFetchPostCount: 5,
  },
};

describe("parseResource narrowing", () => {
  it("tags the result with the kind it was asked for", () => {
    expect(parseResource("route", routeInput).kind).toBe("route");
    expect(parseResource("source", sourceInput).kind).toBe("source");
  });

  it("carries the data for the kind it was asked for", () => {
    const route = parseResource("route", routeInput);
    expect(route.data.sourceIds).toEqual(["00000000-0000-4000-8000-000000000000"]);

    const source = parseResource("source", sourceInput);
    expect(source.data.adapter).toBe("rss");
    expect(source.data.url).toBe("https://example.com/feed.xml");
  });

  it("narrows on the tag, so a branch only sees its own shape", () => {
    const parsed = parseResource("route", routeInput);
    // Assigned through the narrowed branch: this is the pattern the casts
    // replaced, and it is what fails if the tag ever stops narrowing.
    const sourceIds: string[] = parsed.kind === "route" ? parsed.data.sourceIds : [];
    expect(sourceIds).toHaveLength(1);
  });

  it("narrows a union kind the same way", () => {
    const kinds = ["route", "source"] as const;
    for (const kind of kinds) {
      const parsed = parseResource(kind, kind === "route" ? routeInput : sourceInput);
      if (parsed.kind === "route") expect(parsed.data.sourceIds).toBeDefined();
      else expect(parsed.data.adapter).toBeDefined();
    }
  });

  /*
   * Note, deliberately not asserted: `parseResource("source", routeInput)`
   * succeeds. Every field of sourceSchema.data carries a default, so an
   * object shaped like a route parses as a source with the defaults and the
   * unknown keys stripped. That looseness predates these tests and is a
   * question about the schemas, not about the narrowing, so it is left alone
   * here rather than pinned as intended behaviour.
   */

  it("keeps name and enabled alongside the data", () => {
    const parsed = parseResource("route", routeInput);
    expect(parsed.name).toBe("Patch notes");
    expect(parsed.enabled).toBe(true);
  });
});
