#!/usr/bin/env bash
# Saves an Epic client secret in the macOS Keychain for ClearCare's MyChart connection.
# Run it in a Terminal window:
#   scripts/set-epic-secret.sh sandbox        the non-production secret, for Epic's test sandbox
#   scripts/set-epic-secret.sh santa-clara    the production secret you generated for that health system
# Copy the secret from your app's page on fhir.epic.com. It is not your Mac password and not a MyChart password.
set -euo pipefail

name="${1:-}"
if ! printf '%s' "$name" | grep -Eq '^[a-z0-9][a-z0-9-]{1,40}$'; then
  echo "Say which secret this is, for example: scripts/set-epic-secret.sh sandbox" >&2
  exit 1
fi

printf "Paste the Epic client secret for %s, then press Enter: " "$name"
IFS= read -rs secret || true
echo
secret="$(printf '%s' "$secret" | tr -d '[:space:]')"

if [ "${#secret}" -lt 20 ]; then
  echo "That is too short to be an Epic client secret. Nothing was saved." >&2
  exit 1
fi
if ! printf '%s' "$secret" | grep -Eq '^[A-Za-z0-9+/=_.~-]+$'; then
  echo "The secret has unexpected characters. Nothing was saved." >&2
  exit 1
fi

# The secret goes to the Keychain on stdin, so it never appears in the process list.
printf 'add-generic-password -U -a "%s" -s clearcare-epic -w "%s"\n' "$name" "$secret" | /usr/bin/security -i >/dev/null
unset secret
echo "Saved in your Keychain as clearcare-epic ($name)."
