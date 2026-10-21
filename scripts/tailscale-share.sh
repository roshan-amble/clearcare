#!/usr/bin/env bash
# Shares ClearCare on your private Tailscale network with Tailscale Serve.
#   scripts/tailscale-share.sh         share it and print the link
#   scripts/tailscale-share.sh status  show what Tailscale is serving
#   scripts/tailscale-share.sh off     stop sharing
# Serve forwards only to port 8092, the door that checks each person's Tailscale login against the list on
# Settings. This never uses Funnel, so nothing is exposed to the public internet.
set -euo pipefail

TAILNET_PORT=8092

find_tailscale() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale; return; fi
  local app="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  if [ -x "$app" ]; then echo "$app"; return; fi
  echo "Tailscale is not installed. Get it from https://tailscale.com/download/mac and sign in, then run this again." >&2
  exit 1
}

TS="$(find_tailscale)"

if ! status_output="$("$TS" status 2>&1)"; then
  echo "Tailscale is installed but not connected. Tailscale says:" >&2
  echo "$status_output" | sed 's/^/  /' >&2
  echo "Sign in from the Tailscale icon in the menu bar, then run this again." >&2
  exit 1
fi

case "${1:-share}" in
  share)
    # Any answer, even a refusal, means the door is up.
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$TAILNET_PORT/" || true)"
    if [ "$code" = "000" ]; then
      echo "ClearCare's Tailscale door (port $TAILNET_PORT) is not running. Run scripts/mac-service.sh install first." >&2
      exit 1
    fi
    "$TS" serve --bg "http://127.0.0.1:$TAILNET_PORT"
    host="$("$TS" status --json | /usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
    echo
    echo "ClearCare is shared at: https://$host"
    echo "Only people on the list in Settings get in. Add your mom's Tailscale login there."
    ;;
  status)
    "$TS" serve status
    ;;
  off)
    "$TS" serve --https=443 off
    echo "Stopped sharing ClearCare."
    ;;
  *)
    sed -n '2,7p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
