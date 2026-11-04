#!/usr/bin/env bash
# Copies local content (dev-content/) to the Neo server over SSH. Content never goes through GitHub.
#
#   scripts/push-content.sh <ssh-host> [appdata]
#   e.g. scripts/push-content.sh homeserver@neo.local
#
# Uploads into a staging folder next to the live content; Hermes (DEPLOY.md §4) swaps it in,
# fixes ownership and restarts the site. The live content is never overwritten by this script.
set -euo pipefail

host="${1:?usage: push-content.sh <ssh-host> [appdata]}"
appdata="${2:-/var/neo/DATA/AppData}"
src="$(cd "$(dirname "$0")/.." && pwd)/dev-content/"
stage="$appdata/hofchilbi/content.incoming"

[ -f "$src/site.yaml" ] || { echo "No content in $src (run: npm run import)"; exit 1; }

echo "Uploading $src → $host:$stage"
rsync -az --delete --exclude .git --exclude .DS_Store "$src" "$host:$stage/"
ssh "$host" "du -sh '$stage' && ls '$stage'"
echo
echo "Done. Ask Hermes to run DEPLOY.md section 4 (\"content.incoming\" is ready)."
