#!/data/data/com.termux/files/usr/bin/bash
# One-time setup of the bot as a Termux service on the phone. Safe to run again.
# Run from anywhere:  bash ~/linkedin-poster/deploy/termux/setup.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
SERVICE=linkedin-bot
SVC_DIR="$PREFIX/var/service/$SERVICE"
BOOT_DIR="$HOME/.termux/boot"

step() { printf '\n== %s\n' "$1"; }

step "Installing Node.js and the service manager"
pkg install -y nodejs-lts termux-services
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node $(node -v) is too old; the bot needs 22 or newer. Try: pkg upgrade" >&2
  exit 1
fi
echo "Node $(node -v)"

step "Installing the bot's dependencies"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

step "Running the tests (offline, nothing is sent)"
# Termux has no /tmp; it provides its own temp folder.
TEST_LOG="${TMPDIR:-$PREFIX/tmp}/linkedin-bot-tests.log"
npm test >"$TEST_LOG" 2>&1 || { tail -30 "$TEST_LOG"; echo "Tests failed, stopping." >&2; exit 1; }
grep -E '(pass|fail) [0-9]+$' "$TEST_LOG" || tail -5 "$TEST_LOG"

step "Checking keys and state"
# A .env edited on Windows may have CRLF line endings; normalise them so every value reads cleanly.
[ -f .env ] && sed -i 's/\r$//' .env
[ -f .env ] && echo ".env found" || echo "WARNING: .env missing. Copy it into $APP_DIR before starting the bot."
[ -f data/state.json ] && echo "data/state.json found (LinkedIn token and drafts)" || echo "No data/state.json: after starting, send /linkedin in Telegram to connect LinkedIn."

step "Registering the service '$SERVICE' (left switched OFF)"
mkdir -p "$SVC_DIR/log"
# The 'down' file keeps runit from starting it until you run sv-enable, so it can't clash with the laptop bot.
touch "$SVC_DIR/down"
cat > "$SVC_DIR/run" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
# runit runs this and starts it again whenever the bot exits. The pause keeps a restart loop
# (no Wi-Fi yet, or another copy of the bot polling Telegram) gentle instead of once a second.
sleep 20
cd "$APP_DIR" || exit 1
exec /data/data/com.termux/files/usr/bin/node src/app.js 2>&1
EOF
chmod +x "$SVC_DIR/run"
ln -sf "$PREFIX/share/termux-services/svlogger" "$SVC_DIR/log/run"

step "Installing the Termux:Boot script"
mkdir -p "$BOOT_DIR"
cp "$APP_DIR/deploy/termux/start-services" "$BOOT_DIR/start-services"
chmod +x "$BOOT_DIR/start-services"

step "Starting the service manager and holding a wake lock"
termux-wake-lock || true
# shellcheck disable=SC1091
. "$PREFIX/etc/profile.d/start-services.sh"

cat <<EOF

Setup done. Next:
  1. Make sure the bot is NOT running on the laptop (Ctrl+C there).
  2. Close Termux completely (type: exit), open it again, then run:
       sv-enable $SERVICE
  3. Watch it start (about 20 seconds):
       tail -f \$PREFIX/var/log/sv/$SERVICE/current
     Ctrl+C stops watching; the bot keeps running.
EOF
