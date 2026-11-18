#!/data/data/com.termux/files/usr/bin/bash
# Sends the last local-model test draft (as a text file) and its image to your Telegram chat with the
# LinkedIn bot, for when Telegram isn't installed on this phone. Only sendDocument is used, which doesn't
# clash with the running bot (only two copies reading messages would).
# Usage:  bash ~/linkedin-poster/deploy/termux/send-local-draft.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
TMP="${TMPDIR:-$PREFIX/tmp}"
STATE="$TMP/linkedin-local-test/state.json"
OUTPUT="$TMP/local-draft-output.txt"
TEXT="$TMP/local-draft.txt"
IMAGE="$HOME/storage/downloads/local-draft.png"
[ -f "$IMAGE" ] || IMAGE="$TMP/local-draft.png"

[ -f "$STATE" ] || { echo "No test draft found. Run local-draft-test.sh first." >&2; exit 1; }
cd "$APP_DIR"
setting() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- || true; }
TOKEN="$(setting TELEGRAM_BOT_TOKEN)"
CHAT="$(setting TELEGRAM_OWNER_CHAT_ID)"
[ -n "$TOKEN" ] && [ -n "$CHAT" ] || { echo "TELEGRAM_BOT_TOKEN or TELEGRAM_OWNER_CHAT_ID missing in .env" >&2; exit 1; }

node - "$STATE" >"$TEXT" <<'EOF'
const fs = require('node:fs');
const d = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).drafts.at(-1);
console.log(`Draft ${d.id} (${d.provider})\nCategory: ${d.category}\nTopic: ${d.subtopic}\nFormat: ${d.format}\n`);
console.log(`${d.text}\n\n${d.hashtags.join(' ')}\n`);
console.log(`IMAGE PROMPT\n${d.imagePrompt}\n`);
console.log(`IMAGE TEXT\n${d.infographic ? JSON.stringify(d.infographic, null, 2) : '(not usable)'}`);
EOF
# The timing line, when the test saved its screen output (runs after this script was added).
[ -f "$OUTPUT" ] && grep -h -E "Written in|Warning:" "$OUTPUT" >>"$TEXT" || true

# -s keeps curl quiet so the token, which is part of the address, never shows on screen.
send() {
  if curl -sf -F chat_id="$CHAT" -F caption="$2" -F document=@"$1" "https://api.telegram.org/bot$TOKEN/sendDocument" >/dev/null; then
    echo "Sent $(basename "$1")"
  else
    echo "Could not send $(basename "$1")" >&2
  fi
}
send "$TEXT" "Local model test: the draft"
[ -f "$IMAGE" ] && send "$IMAGE" "Local model test: the image"
