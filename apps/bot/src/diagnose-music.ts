import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import dotenv from "dotenv";
import {
  createMusicDoctorClient,
  parseMusicDoctorArgs,
  runMusicDoctor,
} from "./music-doctor";

dotenv.config({ quiet: true });
const help = `Check Lavalink v4 and its configured audio source (read-only).

Usage:
  npm run music:doctor
  npm run music:doctor -- --query "the same failing search text"
  npm run music:doctor -- --query "https://soundcloud.com/ARTIST/TRACK"

Options:
  --query TEXT    Optional 2–200 character search or approved source URL.
  -h, --help      Show help with no credentials or network requests.

Requires DEMO_MODE=false, LAVALINK_URL=hostname:port, and LAVALINK_PASSWORD
in the root .env. LAVALINK_SECURE=true enables TLS.
Run from the same network as the bot: host-run localhost:2333 or Compose's
lavalink:2333. Does not require Discord credentials, a database, or Redis.

Reads /v4/info and optionally /v4/loadtracks. Reports version, loaded source
managers, plugins, and sanitized lookup failure details. Never logs in to
Discord, joins voice, plays audio, or changes the queue. Successful metadata
loading does not verify Discord playback. It never falls back to another source.
JSON goes to stdout; exit status 1 indicates a failed check.
For clean JSON piping: npm run --silent music:doctor -- --query "search text"
Do not include passwords, tokens, or private source URLs when sharing results.
`;
async function main() {
  const options = parseMusicDoctorArgs(process.argv.slice(2));
  if (options.help) {
    console.log(help);
    return;
  }
  if (isDemo())
    throw new Error(
      "Music diagnostics require DEMO_MODE=false. Demo mode never contacts Lavalink or audio providers."
    );
  validateEnvironment("music-doctor");
  const client = createMusicDoctorClient({
    host: required("LAVALINK_URL"),
    password: required("LAVALINK_PASSWORD"),
    secure: process.env.LAVALINK_SECURE === "true",
  });
  const report = await runMusicDoctor(client, { query: options.query });
  await new Promise<void>((done, fail) => {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`, (error) =>
      error ? fail(error) : done()
    );
  });
  if (!report.ok) process.exitCode = 1;
}
main().catch((error: unknown) => {
  console.error("Music diagnostic failed:", errorDiagnostic(error));
  process.exitCode = 1;
});
