import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/*
 * The Node version is stated in four places that are read by four different
 * tools: `.nvmrc` (nvm), `.node-version` (fnm, asdf, nodenv), `engines.node`
 * in `package.json` (npm, and `engine-strict` in `.npmrc` decides whether that
 * is enforced), and the CI workflow. Nothing connects them, so they drift —
 * and when they do, CI and a developer running `nvm use` test different Node
 * versions while both believe they are testing the supported one.
 *
 * These tests assert they agree. They read the files rather than importing the
 * manifest, because `.nvmrc` and `.npmrc` have no importable form.
 */

const read = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const NVMRC = read(".nvmrc").trim();
const NODE_VERSION_FILE = existsSync(
  new URL("../.node-version", import.meta.url)
)
  ? read(".node-version").trim()
  : null;
const CI = read(".github/workflows/ci.yml");
const NPMRC = read(".npmrc");
const MANIFEST = JSON.parse(read("package.json"));

/** Compare dotted version strings without coercing them to numbers. */
function compare(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The lowest version a `>=x.y.z` range admits. */
function floorOfEngine(range: string): string {
  const match = /^\s*>=\s*([0-9]+(?:\.[0-9]+)*)\s*$/.exec(range);
  if (!match)
    throw new Error(
      `engines.node is ${JSON.stringify(range)}; this test only understands a bare >=x.y.z range`
    );
  return match[1];
}

describe("the pinned Node version", () => {
  it("is a full version, not a major", () => {
    // `22` would let nvm pick whatever 22.x happens to be newest, which is
    // exactly the drift this file exists to prevent.
    expect(NVMRC).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it("is on the Node 22 line", () => {
    expect(NVMRC.startsWith("22.")).toBe(true);
  });

  it("satisfies the engines floor in package.json", () => {
    // The point of pinning is to name a version that is actually supported.
    const floor = floorOfEngine(MANIFEST.engines.node);
    expect(
      compare(NVMRC, floor),
      `.nvmrc pins ${NVMRC} but engines.node requires ${MANIFEST.engines.node}`
    ).toBeGreaterThanOrEqual(0);
  });

  it("is what the running process reports, so the pin is exercised here", () => {
    // A pin nobody runs against is a claim, not a check.
    expect(`v${NVMRC}`).toBe(process.version);
  });
});

describe("the version files agree with each other", () => {
  it("has both .nvmrc and .node-version", () => {
    expect(existsSync(new URL("../.nvmrc", import.meta.url))).toBe(true);
    expect(existsSync(new URL("../.node-version", import.meta.url))).toBe(true);
  });

  it("states the same version in .node-version as in .nvmrc", () => {
    // nvm reads one, fnm/asdf/nodenv read the other; a developer using either
    // has to land on the same Node.
    expect(NODE_VERSION_FILE).toBe(NVMRC);
  });
});

describe("the engines floor is enforced", () => {
  it("sets engine-strict in .npmrc", () => {
    // Without it npm prints EBADENGINE as a warning and installs anyway, so
    // the declared floor is advisory and the failure surfaces later, in a
    // place that does not mention Node.
    expect(NPMRC).toMatch(/^\s*engine-strict\s*=\s*true\s*$/m);
  });

  it("declares an engines.node floor at all", () => {
    expect(typeof MANIFEST.engines?.node).toBe("string");
  });
});

describe("CI uses the pinned version rather than a major", () => {
  it("reads the version from .nvmrc", () => {
    expect(CI).toMatch(/node-version-file:\s*\.nvmrc/);
  });

  it("names no bare node-version, which would float to the newest 22.x", () => {
    // `node-version: 22` and `node-version-file: .nvmrc` can both be present
    // without any error, and the explicit one wins — which would quietly
    // unpin CI while the file still looked correct.
    expect(CI).not.toMatch(/^\s*node-version:/m);
  });
});
