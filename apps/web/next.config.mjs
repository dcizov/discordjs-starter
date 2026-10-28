import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
dotenv.config({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
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
          /*
           * The one header that was missing. `frame-ancestors 'none'` is the
           * modern equivalent of X-Frame-Options and is enforced even where
           * X-Frame-Options is skipped below (the demo build), so clickjacking
           * is not left to a per-environment accident.
           *
           * `object-src 'none'` and `base-uri 'self'` close the two remaining
           * cheap injection sinks. `script-src` keeps 'unsafe-inline' because
           * Next injects its own bootstrap and hydration scripts; tightening
           * that needs nonces wired through the framework, which is a larger
           * change than this header deserves.
           */
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://cdn.discordapp.com https://*.discordapp.com",
              "font-src 'self' data:",
              // Dev needs a plaintext websocket to itself for HMR; production
              // is HTTPS only, so it does not.
              `connect-src 'self' ${
                process.env.NODE_ENV === "production" ? "wss:" : "ws: wss:"
              } https://discord.com`,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
            ].join("; "),
          },
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
