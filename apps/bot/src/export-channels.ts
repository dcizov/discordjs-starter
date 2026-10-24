import { isDemo, required } from "@orbit/core";
import { REST } from "discord.js";
import dotenv from "dotenv";
import {
  collectChannelPermissionExport,
  parseChannelExportArgs,
  writeChannelPermissionExport,
} from "./channel-export";

dotenv.config({ quiet: true });
const help = `Export Discord channels and configured permissions (read-only).

Usage:
  npm run channels:export -- --guild SERVER_ID [options]

Options:
  --guild ID       Required Discord server ID (not the bot/application ID).
  --channel ID     Export one channel plus its parent category for context.
  --out PATH       New JSON file. Defaults to .exports/channels-ID-TIMESTAMP.json.
  --stdout         Write JSON to stdout instead of a file. Conflicts with --out.
  -h, --help       Show this help; no credentials or network required.

Requires DISCORD_TOKEN and DEMO_MODE=false in the root .env.
No database, Redis, gateway connection, or privileged intents required.
No Discord settings are changed; no messages or member lists are exported.
Existing output files are never overwritten.

For JSON piping, suppress npm's own banner:
  npm run --silent channels:export -- --guild SERVER_ID --stdout > channels.json
`;
async function main() {
  const options = parseChannelExportArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  if (isDemo())
    throw new Error(
      "Channel export requires live read-only Discord access. Set DEMO_MODE=false and DISCORD_TOKEN in the root .env. No export was written."
    );
  const token = required("DISCORD_TOKEN");
  const rest = new REST({ version: "10", timeout: 10000, retries: 2 }).setToken(
    token
  );
  try {
    console.error(`Reading channels and roles for server ${options.guildId}…`);
    const data = await collectChannelPermissionExport(rest, options);
    if (options.stdout) {
      await new Promise<void>((done, fail) => {
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`, (error) =>
          error ? fail(error) : done()
        );
      });
      console.error(
        `Exported ${data.channels.length} channels and ${data.roles.length} roles.`
      );
    } else {
      const path = await writeChannelPermissionExport(data, options.out);
      console.error(
        `Exported ${data.channels.length} channels and ${data.roles.length} roles to ${path}`
      );
    }
    if (data.warnings.length)
      console.error(
        `Export contains ${data.warnings.length} warnings. Inspect the JSON warnings array for missing snapshot data.`
      );
  } finally {
    rest.clearHashSweeper();
    rest.clearHandlerSweeper();
  }
}
main().catch((error: unknown) => {
  // Do not log REST error objects: they can include request metadata.
  const message = error instanceof Error ? error.message : "Unknown error";
  const token = process.env.DISCORD_TOKEN;
  console.error(
    "Channel export failed:",
    token ? message.replaceAll(token, "[REDACTED]") : message
  );
  process.exitCode = 1;
});
