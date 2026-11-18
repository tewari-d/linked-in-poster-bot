#!/data/data/com.termux/files/usr/bin/bash
# Test only: writes one LinkedIn draft with the phone's own model (llama.cpp + Qwen3 1.7B, installed by the
# Gita project) instead of Gemini, so the two can be compared. Sends nothing to Telegram or LinkedIn, and
# keeps the draft in a temporary folder, away from the bot's own data.
# Usage:  bash ~/linkedin-poster/deploy/termux/local-draft-test.sh [YYYY-MM-DD]
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MODEL="${MODEL:-$HOME/models/Qwen3-1.7B-Q4_K_M.gguf}"
PORT=8081
TMP="${TMPDIR:-$PREFIX/tmp}"
LOG="$TMP/linkedin-local-llm.log"
IMAGE_DIR="$HOME/storage/downloads"
[ -d "$IMAGE_DIR" ] || IMAGE_DIR="$TMP"

[ -s "$MODEL" ] || { echo "Model not found: $MODEL (the Gita project's setup.sh downloads it)." >&2; exit 1; }
command -v llama-server >/dev/null || { echo "llama-server is missing. Install it with: pkg install llama-cpp" >&2; exit 1; }
# The Gita bot's server holds the same model with a 2,048-token context, too small for this prompt
# (about 1,700 tokens in, 1,100 out), and a second copy next to it doesn't fit in 3 GB.
if curl -sf "http://127.0.0.1:8080/health" >/dev/null 2>&1; then
  echo "The Gita bot's model is running. Stop it first: Ctrl+C in its Termux tab." >&2
  echo "Afterwards start it again with: cd ~/phone-hosted-llm/phone-chat && bash start.sh" >&2
  exit 1
fi

echo "Loading $(basename "$MODEL") with a 4,096-token context (up to a minute)..."
llama-server -m "$MODEL" -c 4096 -t 4 --jinja -np 1 --host 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
LLM=$!
trap 'kill $LLM 2>/dev/null || true' EXIT

for _ in $(seq 1 90); do
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$LLM" 2>/dev/null || break
  sleep 2
done
if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  tail -20 "$LOG"
  echo "The model did not load. Usually that's too little free memory: close other apps, or pause the" >&2
  echo "LinkedIn bot during the test (sv down linkedin-bot, then sv up linkedin-bot afterwards)." >&2
  exit 1
fi

echo "Writing the draft: 5 to 10 minutes on this phone. A token count appears once the model starts"
echo "writing (a draft is about 1,100 tokens). The screen may turn off meanwhile."
cd "$APP_DIR"
# The screen output is also saved, so send-local-draft.sh can include the timing line.
DATA_DIR="$TMP/linkedin-local-test" LOCAL_LLM_URL="http://127.0.0.1:$PORT" \
  node src/cli/draft.js --local ${1:+--date "$1"} --image "$IMAGE_DIR/local-draft.png" 2>&1 | tee "$TMP/local-draft-output.txt"
echo "To read it in Telegram: bash $APP_DIR/deploy/termux/send-local-draft.sh"
