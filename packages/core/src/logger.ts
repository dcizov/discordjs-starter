import pino from "pino";
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "token",
      "secret",
      "accessToken",
      "refreshToken",
      "headers.authorization",
      "req.headers.cookie",
      "DISCORD_TOKEN",
      "ITAD_API_KEY",
    ],
    censor: "[REDACTED]",
  },
});
