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
 */
function contentSecurityPolicy() {
  const production = process.env.NODE_ENV === "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.discordapp.com https://*.discordapp.com",
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
