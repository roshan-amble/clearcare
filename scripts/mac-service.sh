#!/usr/bin/env bash
# Runs ClearCare as a macOS login service: it starts when you log in and restarts if it stops.
#   scripts/mac-service.sh install     build the app and start the service
#   scripts/mac-service.sh uninstall   stop it and remove it
#   scripts/mac-service.sh restart     restart after pulling changes (rebuilds the app)
#   scripts/mac-service.sh status      is it running and answering?
#   scripts/mac-service.sh logs        follow the log
# The app is at http://127.0.0.1:8090 on this Mac. Port 8092 is the door only Tailscale Serve uses.
# Engine settings such as CLEARCARE_AI=openai are kept across restarts. No API key is ever written into the service:
# the OpenAI key is read from the Keychain at start.
set -euo pipefail

LABEL="com.clearcare"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/ClearCare"
PORT=8090
TAILNET_PORT=8092
DOMAIN="gui/$(id -u)"

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  if command -v mise >/dev/null 2>&1; then mise which node 2>/dev/null && return; fi
  local candidate
  candidate="$(ls -d "$HOME"/.local/share/mise/installs/node/22*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$candidate" ]; then echo "$candidate"; return; fi
  echo "Node 22 was not found. Run 'mise install' in $REPO first." >&2
  exit 1
}

answering() {
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/api/state" 2>/dev/null
}

wait_until_answering() {
  for _ in $(seq 1 30); do
    if answering; then return 0; fi
    sleep 1
  done
  echo "ClearCare did not answer on port $PORT. See $LOGDIR/server.log" >&2
  tail -20 "$LOGDIR/server.log" >&2 || true
  return 1
}

build() {
  local node_dir="$1"
  echo "Building the app…"
  (cd "$REPO" && PATH="$node_dir:$PATH" "$node_dir/npm" run -s build -w @clearcare/web >/dev/null)
}

# Engine settings carried into the service. Never a key: keys stay in the Keychain or your shell.
SETTINGS=(CLEARCARE_AI CLEARCARE_CODEX_MODEL CLEARCARE_CODEX_EFFORT CLEARCARE_CODEX_EXTRACT_EFFORT CLEARCARE_OPENAI_MODEL CLEARCARE_OPENAI_EFFORT CLEARCARE_OPENAI_EXTRACT_EFFORT CLEARCARE_OPENAI_MODE CLEARCARE_MODEL CLEARCARE_EFFORT)

# A setting from the environment wins; otherwise the value the installed service already has is kept.
settings_xml() {
  local name value
  for name in "${SETTINGS[@]}"; do
    value="${!name:-}"
    if [ -z "$value" ] && [ -f "$PLIST" ]; then
      value="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:$name" "$PLIST" 2>/dev/null || true)"
    fi
    if [ -n "$value" ]; then printf '    <key>%s</key><string>%s</string>\n' "$name" "$value"; fi
  done
}

write_plist() {
  local node="$1" node_dir="$2"
  local settings
  settings="$(settings_xml)"
  mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$node</string>
    <string>$REPO/node_modules/tsx/dist/cli.mjs</string>
    <string>apps/server/src/main.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>PORT</key><string>$PORT</string>
    <key>CLEARCARE_TAILNET_PORT</key><string>$TAILNET_PORT</string>
$settings
  </dict>
  <key>ProcessType</key><string>Interactive</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$LOGDIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/server.log</string>
</dict>
</plist>
PLIST
}

case "${1:-}" in
  install|restart)
    node="$(find_node)"
    node_dir="$(dirname "$node")"
    build "$node_dir"
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    # Stopping is asynchronous; give the old process a moment to let go of the port.
    for _ in $(seq 1 15); do
      lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break
      sleep 1
    done
    if lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Port $PORT is in use, probably by 'npm run dev'. Stop that first (Ctrl+C), then run this again." >&2
      exit 1
    fi
    write_plist "$node" "$node_dir"
    launchctl bootstrap "$DOMAIN" "$PLIST"
    wait_until_answering
    echo "ClearCare is running at http://127.0.0.1:$PORT and will start again at login."
    echo "Next: share it with your mom with scripts/tailscale-share.sh"
    ;;
  uninstall)
    launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "ClearCare's service is stopped and removed. Your record in data/ is untouched."
    ;;
  status)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then echo "Service: installed"; else echo "Service: not installed"; fi
    if answering; then echo "App: answering at http://127.0.0.1:$PORT"; else echo "App: not answering"; fi
    ;;
  logs)
    tail -f "$LOGDIR/server.log"
    ;;
  *)
    sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
