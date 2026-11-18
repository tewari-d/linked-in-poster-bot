#!/data/data/com.termux/files/usr/bin/bash
# Installs a new code bundle copied to the phone's Download folder, keeping the phone's own .env and state.
# Usage:  bash ~/linkedin-poster/deploy/termux/update.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE=linkedin-bot
BUNDLE="$HOME/storage/downloads/linkedin-poster.tgz"

[ -f "$BUNDLE" ] || { echo "No bundle at $BUNDLE. Copy linkedin-poster.tgz to the phone's Download folder first (and run termux-setup-storage once)." >&2; exit 1; }
if tar -tzf "$BUNDLE" | grep -qxE '\.env|data/state\.json'; then
  echo "This bundle contains .env or data/state.json and would overwrite the phone's own copies." >&2
  echo "Make an update bundle on the laptop with: npm run phone:bundle   (without --with-secrets)" >&2
  exit 1
fi

echo "== Stopping the bot"
sv down "$SERVICE" || true

echo "== Unpacking"
tar -xzf "$BUNDLE" -C "$APP_DIR"
rm -f "$BUNDLE"

echo "== Installing dependencies and running the tests"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund
TEST_LOG="${TMPDIR:-$PREFIX/tmp}/linkedin-bot-tests.log"
if ! npm test >"$TEST_LOG" 2>&1; then
  tail -30 "$TEST_LOG"
  echo "Tests failed: the bot stays stopped. Fix on the laptop and copy a new bundle." >&2
  exit 1
fi

echo "== Starting the bot"
sv up "$SERVICE"
echo "Updated. Watch it start with: tail -f \$PREFIX/var/log/sv/$SERVICE/current"
