/*
 * The Content-Security-Policy, in both environments.
 *
 * The e2e suite runs against `npm start`, which is a production bundle, so it
 * can only ever see one of the two headers this config emits. The development
 * header is the one that broke the developer workflow, and nothing else can
 * catch it: a CSP that kills `npm run dev` produces a page that loads fine in
 * CI and is completely dead on a developer's machine.
 *
 * What went wrong, so the test has a reason to exist: `script-src` was set to
 * `'self' 'unsafe-inline'` for every environment. Next's dev server serves eval
 * source maps, so `main-app.js` calls `eval()`, which the browser refused:
 *
 *   Uncaught EvalError: call to eval() blocked by CSP
 *
 * React never hydrated and no control on the page responded to a click. It
 * shipped because the only environment anyone exercised was production, where
 * the bundles contain no `eval` at all.
 *
 * These tests read the header through `config.headers()` rather than importing
 * an internal helper, so they cover whatever the server actually sends.
 */
import { afterEach, describe, expect, it } from "vitest";
import config, { type HeaderRule } from "../apps/web/next.config.mjs";

/** The CSP the server would send for one `NODE_ENV`. */
async function policyFor(env: string): Promise<string> {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = env;
  try {
    const rules: HeaderRule[] = await config.headers();
    const rule = rules.find((entry) => entry.source === "/:path*");
    expect(rule, "no rule matches /:path*").toBeTruthy();
    const header = rule!.headers.find(
      (entry) => entry.key === "Content-Security-Policy"
    );
    expect(header, "no Content-Security-Policy header").toBeTruthy();
    return header!.value;
  } finally {
    process.env.NODE_ENV = previous;
  }
}

/** One directive's sources, parsed out of the policy string. */
function sources(policy: string, directive: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${directive} `));
  expect(found, `policy has no ${directive} directive`).toBeTruthy();
  return found!.slice(directive.length + 1).split(/\s+/);
}

afterEach(() => {
  process.env.NODE_ENV = "test";
});

describe("Content-Security-Policy", () => {
  it("allows eval in development, because Next's dev server needs it", async () => {
    const policy = await policyFor("development");
    expect(sources(policy, "script-src")).toContain("'unsafe-eval'");
  });

  it("does not allow eval in production", async () => {
    const policy = await policyFor("production");
    const script = sources(policy, "script-src");
    expect(script).not.toContain("'unsafe-eval'");
    // The weaker-but-necessary allowance stays in both.
    expect(script).toContain("'unsafe-inline'");
    expect(script).toContain("'self'");
  });

  it("is rebuilt per call, so NODE_ENV is honoured after import", async () => {
    // The config module is a singleton; if the policy were computed once at
    // import time, whichever environment the first test used would win.
    const development = await policyFor("development");
    const production = await policyFor("production");
    expect(sources(development, "script-src")).toContain("'unsafe-eval'");
    expect(sources(production, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("opens a plaintext websocket for HMR in development only", async () => {
    expect(sources(await policyFor("development"), "connect-src")).toContain(
      "ws:"
    );
    expect(sources(await policyFor("production"), "connect-src")).not.toContain(
      "ws:"
    );
    // Encrypted websockets and the Discord API are allowed in both.
    for (const env of ["development", "production"]) {
      const connect = sources(await policyFor(env), "connect-src");
      expect(connect).toContain("wss:");
      expect(connect).toContain("https://discord.com");
    }
  });

  it("keeps the hardening directives in both environments", async () => {
    for (const env of ["development", "production"]) {
      const policy = await policyFor(env);
      // Clickjacking, even where X-Frame-Options is skipped by the demo build.
      expect(policy).toContain("frame-ancestors 'none'");
      // The two remaining cheap injection sinks.
      expect(policy).toContain("object-src 'none'");
      expect(policy).toContain("base-uri 'self'");
      expect(policy).toContain("form-action 'self'");
      expect(sources(policy, "default-src")).toEqual(["'self'"]);
    }
  });

  /*
   * Feed artwork, in both environments.
   *
   * `img-src` was `'self' data:` plus the Discord CDN. That is right for
   * avatars and wrong for a dashboard that previews third-party feeds:
   * `CoverArt` points a plain `<img>` straight at the provider's URL, so every
   * Steam, ITAD and RSS image was refused and every card fell back to "This
   * image did not load". It shipped because the recorded Steam fixture has no
   * images at all, so no test ever rendered one.
   *
   * The assertion is not "Discord is listed" — it is "an arbitrary HTTPS host
   * is allowed", because that is the actual requirement: an RSS feed can put
   * its image anywhere, so a list written in advance can never be complete.
   * `tests/e2e/news-preview.spec.ts` proves a real external URL then loads.
   */
  it("lets feed artwork load from any HTTPS host, because a feed chooses it", async () => {
    for (const env of ["development", "production"]) {
      const images = sources(await policyFor(env), "img-src");
      // The scheme source is what covers an arbitrary provider host.
      expect(images).toContain("https:");
      // Inline data URIs and this origin stay allowed regardless.
      expect(images).toContain("data:");
      expect(images).toContain("'self'");
      // Host entries would be dead weight: `https:` already subsumes them, and
      // leaving them in would suggest the allowlist is what does the work.
      for (const host of [
        "https://cdn.discordapp.com",
        "https://*.discordapp.com",
      ])
        expect(images).not.toContain(host);
    }
  });

  /*
   * The same mistake, checked for in the directives that follow default-src.
   *
   * `img-src` was broken for months because nothing asked what the browser
   * actually fetches. These are the other places a policy can silently refuse
   * something the app renders, so the answer is recorded as a test rather than
   * left to memory.
   */
  it("covers every directive the app can exercise, and none that it cannot", async () => {
    for (const env of ["development", "production"]) {
      const policy = await policyFor(env);
      // Bundled fonts only: nothing loads a typeface from a third party, so a
      // font-src without a CDN is correct rather than incomplete.
      expect(sources(policy, "font-src")).toEqual(["'self'", "data:"]);
      // No <audio>, <video> or <iframe> exists in the app, so media-src and
      // frame-src are deliberately absent and fall back to default-src.
      for (const unused of ["media-src", "frame-src", "worker-src"]) {
        expect(
          policy
            .split(";")
            .map((part) => part.trim())
            .some((part) => part.startsWith(`${unused} `)),
          `${unused} should not be set; the app renders no such resource`
        ).toBe(false);
      }
      // Nothing in the client fetches a third-party origin, so connect-src
      // stays narrow — which is what keeps img-src's breadth from becoming an
      // exfiltration channel.
      const connect = sources(policy, "connect-src");
      expect(connect).toContain("'self'");
      expect(connect).not.toContain("https:");
    }
  });
});
