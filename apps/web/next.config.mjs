import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
/**
 * The Content-Security-Policy, rebuilt per call so it follows `NODE_ENV`
 * rather than freezing at import time.
 *
 * `frame-ancestors 'none'` is the modern equivalent of X-Frame-Options and is
 * enforced even where X-Frame-Options is skipped below (the demo build), so
 * clickjacking is not left to a per-environment accident. `object-src 'none'`
 * and `base-uri 'self'` close the two remaining cheap injection sinks.
 *
 * `script-src` keeps `'unsafe-inline'` everywhere, because Next injects its own
 * bootstrap and hydration scripts; tightening that needs nonces wired through
 * the framework, which is a larger change than this header deserves.
 *
 * Two directives differ by environment, and both are load-bearing for the dev
 * server:
 *
 * - **`'unsafe-eval'` in development only.** Next's dev build serves eval
 *   source maps, so `main-app.js` calls `eval()`. Without this the very first
 *   script on the page throws `EvalError: call to eval() blocked by CSP`,
 *   React never hydrates, and every page on `npm run dev` is a dead,
 *   unclickable document. Production bundles contain no `eval`, so the
 *   production header is left without it — adding it there would weaken the
 *   one header that mitigates injected-script execution.
 * - **`ws:` for `connect-src` in development**, for the HMR websocket.
 *   Production is HTTPS only.
 *
 * The directives that follow `default-src 'self'` were audited for the same
 * mistake as `img-src` — a browser-side fetch the policy quietly forbids —
 * and none of them has one. There is no `<audio>`, `<video>` or `<iframe>`
 * anywhere in the app, so `media-src` and `frame-src` are never exercised;
 * fonts are bundled, so `font-src 'self' data:` is enough; and nothing in the
 * client fetches a third-party origin, so `connect-src` covers only this app
 * and Discord.
 */
function contentSecurityPolicy() {
  const production = process.env.NODE_ENV === "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    /*
     * Feed artwork is whatever the feed says it is.
     *
     * It was `'self' data:` plus the Discord CDN, which is the right policy for
     * avatars and the wrong one for a dashboard that previews third-party
     * feeds: `CoverArt` renders a plain `<img src>` straight at the provider's
     * URL, so every Steam, ITAD and RSS image was refused and each card fell
     * back to "This image did not load". The allowlist approach cannot work
     * here — an RSS feed can put its image on any host there is, so no list
     * written in advance can ever be complete.
     *
     * `https:` is deliberate, and the alternative was considered rather than
     * assumed. Routing artwork through `next/image` or a same-origin proxy
     * would keep this directive tight, but both make *the server* fetch a URL
     * chosen by the feed, which is the more dangerous place to do it: a
     * server-side fetch can reach internal hosts and return their contents,
     * and the image optimizer is a well-known SSRF and amplification surface.
     * In the browser the same URL is fetched with no credentials, and the
     * response cannot be read back — the operator's browser is a safer place
     * to absorb an untrusted image than this server is.
     *
     * What this does cost, written down so it is a decision and not an
     * oversight: a hostile or compromised feed can name an image host of its
     * choosing and every operator who opens the preview fetches from it, so
     * the preview is a feed-driven request trigger into the operator's
     * browser. `safeImageUrl()` still refuses non-HTTPS, non-443, bare-IP and
     * blocked hosts, and requires an image extension, and the element is
     * `referrerPolicy="no-referrer"` — but it cannot refuse a public HTTPS
     * host, because that is the entire point. That is a tracking and blind
     * network-probe exposure, bounded by never letting the page read the
     * response: `connect-src` stays at `'self'` and Discord, so nothing here
     * can turn a fetch into an exfiltration of page content unless an
     * injection sink also opens up. The one `dangerouslySetInnerHTML` in the
     * app renders in-repo Markdown, so that sink is trusted today; it would
     * not be if docs ever rendered remote content.
     */
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${production ? "wss:" : "ws: wss:"} https://discord.com`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

const config = {
  transpilePackages: ["@orbit/core", "@orbit/db"],
  allowedDevOrigins: ["*.e2b.app"],
  serverExternalPackages: [
    "pg",
    "bullmq",
    "ioredis",
    "pino",
    "undici",
    "discord.js",
  ],
  poweredByHeader: false,
  devIndicators: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/icons/*/*.webp",
        search: "?size=128",
      },
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/avatars/*/*.webp",
        search: "?size=128",
      },
      /*
       * Discord's default avatars: the coloured disc served for an account
       * that never uploaded one. Different path (`/embed/avatars/`), PNG
       * rather than WebP, and no query string — so it needs its own pattern.
       * Without it `next/image` rejects the URL at render time
       * ("Invalid src prop ... not configured under images"), which turns
       * every member without a custom avatar into initials again.
       */
      {
        protocol: "https",
        hostname: "cdn.discordapp.com",
        port: "",
        pathname: "/embed/avatars/*.png",
        search: "",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          ...(process.env.NODE_ENV === "production" &&
          process.env.DEMO_MODE !== "true"
            ? [{ key: "X-Frame-Options", value: "DENY" }]
            : []),
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
};
export default config;
