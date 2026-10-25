import { describe, expect, it } from "vitest";
import {
  checkDependencies,
  REMEDIATION,
  REQUIRED_DEPENDENCIES,
} from "../scripts/check-dependencies.mjs";

describe("dependency guard for the shared root manifest", () => {
  it("reports every package that does not resolve", () => {
    const present = new Set(["next", "marked"]);
    const { missing } = checkDependencies({
      resolve: (id) => {
        if (!present.has(id)) throw new Error("MODULE_NOT_FOUND");
        return `/repo/node_modules/${id}/index.js`;
      },
      list: ["next", "marked", "discord.js"],
    });
    expect(missing).toEqual(["discord.js"]);
  });

  it("passes when the whole list resolves", () => {
    expect(
      checkDependencies({
        resolve: (id) => `/repo/node_modules/${id}`,
        list: REQUIRED_DEPENDENCIES,
      })
    ).toEqual({ missing: [] });
  });

  it("names the build-critical packages used by the docs renderer", () => {
    expect(REQUIRED_DEPENDENCIES).toContain("marked");
    expect(REQUIRED_DEPENDENCIES).toContain("sanitize-html");
    expect(REQUIRED_DEPENDENCIES).toContain("next");
  });

  it("explains both a normal install and a masked Docker volume", () => {
    expect(REMEDIATION).toContain("npm ci");
    expect(REMEDIATION).toContain("dev_node_modules");
    expect(REMEDIATION).toMatch(/never the database volume/);
    // Guidance must never invite printing environment values.
    expect(REMEDIATION).not.toMatch(/\.env\b|printenv|cat .*env/i);
  });
});
