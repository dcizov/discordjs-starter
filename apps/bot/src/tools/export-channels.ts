import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { REST } from "discord.js";
import dotenv from "dotenv";
import {
  collectChannelPermissionExport,
  collectServerRoleExport,
  parseChannelExportArgs,
  writeChannelPermissionExport,
} from "./channel-export";

dotenv.config({ quiet: true });
const help = `Export Discord channels, server roles, and configured permissions (read-only).

Usage:
  npm run channels:export -- --guild SERVER_ID [options]
  npm run roles:export -- --guild SERVER_ID [--out PATH | --stdout]

Options:
  --guild ID       Required Discord server ID (not the bot/application ID).
  --channel ID     Export one channel plus its parent category for context.
  --roles-only     Export roles and their metadata only (no channel requests).
  --out PATH       New JSON file. Default: .exports/{channels|roles}-ID-TIMESTAMP.json.
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
      "Discord export requires live read-only Discord access. Set DEMO_MODE=false and DISCORD_TOKEN in the root .env. No export was written."
    );
  validateEnvironment("export");
  const token = required("DISCORD_TOKEN");
  const rest = new REST({ version: "10", timeout: 10000, retries: 2 }).setToken(
    token
  );
  try {
    console.error(
      `Reading ${options.rolesOnly ? "roles" : "channels and roles"} for server ${options.guildId}…`
    );
    const data = options.rolesOnly
      ? await collectServerRoleExport(rest, options)
      : await collectChannelPermissionExport(rest, options);
    const counts = `${"channels" in data ? `${data.channels.length} channels and ` : ""}${data.roles.length} roles`;
    if (options.stdout) {
      await new Promise<void>((done, fail) => {
        process.stdout.write(`${JSON.stringify(data, null, 2)}\n`, (error) =>
          error ? fail(error) : done()
        );
      });
      console.error(`Exported ${counts}.`);
    } else {
      const path = await writeChannelPermissionExport(data, options.out);
      console.error(`Exported ${counts} to ${path}`);
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
    "Discord export failed:",
    token ? message.replaceAll(token, "[REDACTED]") : message
  );
  process.exitCode = 1;
});
