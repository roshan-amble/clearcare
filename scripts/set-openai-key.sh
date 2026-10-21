#!/usr/bin/env bash
# Saves your OpenAI API key in the macOS Keychain for ClearCare, then restarts ClearCare.
# Run it in a Terminal window: scripts/set-openai-key.sh
# Get a key at https://platform.openai.com/api-keys. It starts with "sk-". This is not your Mac password.
set -euo pipefail

printf "Paste your OpenAI API key (it starts with sk-), then press Enter: "
IFS= read -rs key || true
echo
key="$(printf '%s' "$key" | tr -d '[:space:]')"

case "$key" in
  sk-*) ;;
  *)
    echo "That isn't an OpenAI API key: those start with sk-. Nothing was saved." >&2
    exit 1
    ;;
esac
if ! printf '%s' "$key" | grep -Eq '^[A-Za-z0-9_-]+$'; then
  echo "The key has unexpected characters. Nothing was saved." >&2
  exit 1
fi

# The key goes to the Keychain on stdin, so it never appears in the process list.
printf 'add-generic-password -U -a "%s" -s clearcare-openai -w "%s"\n' "$USER" "$key" | /usr/bin/security -i >/dev/null
unset key
echo "Saved in your Keychain as clearcare-openai."

if [ "${SKIP_RESTART:-}" != "1" ]; then
  "$(dirname "$0")/mac-service.sh" restart
fi
