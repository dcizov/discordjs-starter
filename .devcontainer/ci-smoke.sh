#!/usr/bin/env bash
# Disposable CI project only. Never run this against an existing local stack.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [[ "${GITHUB_ACTIONS:-}" != "true" || -e .env ]]; then
  echo "This smoke test requires a clean GitHub Actions checkout without .env." >&2
  exit 2
fi
export COMPOSE_PROJECT_NAME=orbit-devcontainer-ci
export DEMO_MODE=true
export APP_URL=http://localhost:3000
export POSTGRES_PASSWORD=ci-only-database-password
export LAVALINK_PASSWORD=ci-only-devcontainer-password
# No command in this test needs live credentials.
unset DISCORD_TOKEN DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET ITAD_API_KEY

log="$(mktemp "$RUNNER_TEMP/orbit-devcontainer-log.XXXXXX")"
output="$(mktemp "$RUNNER_TEMP/orbit-devcontainer-up.XXXXXX")"
exec > >(tee "$log") 2>&1
compose=(docker compose -p "$COMPOSE_PROJECT_NAME" -f docker-compose.yml -f docker-compose.dev.yml --profile dev --profile live --profile music)
cli=(npx --yes --package=@devcontainers/cli@0.89.0 devcontainer)
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" != "0" ]]; then
    cat "$output" >> "$log"
    "${compose[@]}" logs --no-color --tail=70 dev web migrate postgres redis lavalink >> "$log" 2>&1 || true
    python3 - "$log" <<'PYTHON'
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text(errors="replace")
tail = "\n".join(text.splitlines()[-100:])[-16000:]
escaped = tail.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
print(f"::error title=Dev Container startup or dashboard smoke failed::{escaped}")
PYTHON
  fi
  # Preserve volumes, and only touch this dedicated disposable CI project.
  "${compose[@]}" down --remove-orphans || true
  exit "$status"
}
trap cleanup EXIT

# Keep the runner's file ownership while allowing container UID 1000 to edit
# this disposable checkout, just as a Linux user's development ACL would.
if ! command -v setfacl >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends acl
fi
sudo setfacl -R -m u:1000:rwX .
find . -type d -not -path './.git/*' -exec sudo setfacl -m "d:u:1000:rwx,d:u:$(id -u):rwx" {} +

"${cli[@]}" up --workspace-folder . --log-level info > "$output"
cat "$output"
container_id="$(node --input-type=module - "$output" <<'JS'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const lines = fs.readFileSync(process.argv[2], 'utf8').trim().split('\n');
const report = JSON.parse(lines.findLast(line => line.startsWith('{')));
assert.equal(report.outcome, 'success');
assert.match(report.containerId, /^[a-f0-9]{12,64}$/);
console.log(report.containerId);
JS
)"
project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id")"
test "$project" = "$COMPOSE_PROJECT_NAME"
"${cli[@]}" exec --workspace-folder . node .devcontainer/check-workspace.mjs

# Verify the exact failure from the user report: a real host HTTP mapping on web,
# and no implicit bot/worker logins when opening the editor.
web_id="$("${compose[@]}" ps -q web)"
test -n "$web_id"
test "$(docker inspect --format '{{ (index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort }}' "$web_id")" = "3000"
for service in bot worker; do
  test -z "$(docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$service")"
done
node --input-type=module -e '
  import assert from "node:assert/strict";
  const response = await fetch("http://127.0.0.1:3000/api/healthz", { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", mode: "demo" });
  console.log("Host localhost:3000 dashboard mapping and no duplicate bot/worker: PASS");
'
