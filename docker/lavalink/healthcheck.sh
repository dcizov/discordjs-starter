#!/bin/sh
# One header, no secret in argv/output. Ignore inherited proxy/config/redirects.
[ -n "${LAVALINK_SERVER_PASSWORD:-}" ] || exit 1
case "$LAVALINK_SERVER_PASSWORD" in
  *"$(printf '\r')"*|*"
"*) exit 1 ;;
esac
status="$(printf 'Authorization: %s\n' "$LAVALINK_SERVER_PASSWORD" |
  curl --disable --silent --noproxy '*' --proto '=http' \
    --connect-timeout 2 --max-time 4 --max-redirs 0 --header @- \
    --output /dev/null --write-out '%{http_code}' \
    http://127.0.0.1:2333/v4/info)" || exit 1
[ "$status" = 200 ]
