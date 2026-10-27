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

  it("gives the verified remedy for both host and container installs", () => {
    expect(REMEDIATION).toContain("npm ci");
    // The container remedy is the same command: the volume is the install path.
    expect(REMEDIATION).toContain("docker compose exec web npm ci");
    expect(REMEDIATION).toContain("dev_node_modules");
    // Volume recreation is the fallback, scoped to the dependency volume only.
    expect(REMEDIATION).toMatch(/Never delete the database, Redis/);
    expect(REMEDIATION).toContain("down -v");
    expect(REMEDIATION).not.toMatch(/remove only that volume/i);
    // It must not repeat the earlier, false claim about npm inside a container.
    expect(REMEDIATION).not.toMatch(/does not fix a masked volume/);
    // Guidance must never invite printing environment values.
    expect(REMEDIATION).not.toMatch(/\.env\b|printenv|cat .*env/i);
  });

  it("does not pretend to install or to be a package-manager replacement", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("scripts/check-dependencies.mjs", "utf8");
    expect(source).not.toMatch(/execFile|spawn|exec\(/);
    expect(source).toMatch(/It only reports that the tree is incomplete/);
  });
});
