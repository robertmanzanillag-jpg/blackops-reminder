#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYCHAIN_DB_SERVICE="${RADIO_WORKER_DB_KEYCHAIN_SERVICE:-robert-radio-worker-database-url}"
KEYCHAIN_TG_SERVICE="${RADIO_WORKER_TELEGRAM_KEYCHAIN_SERVICE:-robert-radio-worker-telegram-bot-token}"
KEYCHAIN_GOOGLE_CLIENT_ID_SERVICE="${RADIO_WORKER_GOOGLE_CLIENT_ID_KEYCHAIN_SERVICE:-robert-radio-worker-google-client-id}"
KEYCHAIN_GOOGLE_CLIENT_SECRET_SERVICE="${RADIO_WORKER_GOOGLE_CLIENT_SECRET_KEYCHAIN_SERVICE:-robert-radio-worker-google-client-secret}"
KEYCHAIN_GOOGLE_REFRESH_TOKEN_SERVICE="${RADIO_WORKER_GOOGLE_REFRESH_TOKEN_KEYCHAIN_SERVICE:-robert-radio-worker-google-drive-refresh-token}"
NODE_BIN="${RADIO_WORKER_NODE_BIN:-/Users/robertmanzanilla/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
export YT_DLP_PATH="${YT_DLP_PATH:-/opt/homebrew/bin/yt-dlp}"
export FFMPEG_PATH="${FFMPEG_PATH:-/opt/homebrew/bin/ffmpeg}"
export FFPROBE_PATH="${FFPROBE_PATH:-/opt/homebrew/bin/ffprobe}"
export YT_DLP_JS_RUNTIMES="${YT_DLP_JS_RUNTIMES:-deno,node}"

read_keychain_secret() {
  local service="$1"
  /usr/bin/security find-generic-password -a "$USER" -s "$service" -w 2>/dev/null || true
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  DATABASE_URL="$(read_keychain_secret "$KEYCHAIN_DB_SERVICE")"
  export DATABASE_URL
fi

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  TELEGRAM_BOT_TOKEN="$(read_keychain_secret "$KEYCHAIN_TG_SERVICE")"
  export TELEGRAM_BOT_TOKEN
fi

if [[ -z "${GOOGLE_CLIENT_ID:-}" ]]; then
  GOOGLE_CLIENT_ID="$(read_keychain_secret "$KEYCHAIN_GOOGLE_CLIENT_ID_SERVICE")"
  export GOOGLE_CLIENT_ID
fi

if [[ -z "${GOOGLE_CLIENT_SECRET:-}" ]]; then
  GOOGLE_CLIENT_SECRET="$(read_keychain_secret "$KEYCHAIN_GOOGLE_CLIENT_SECRET_SERVICE")"
  export GOOGLE_CLIENT_SECRET
fi

if [[ -z "${GOOGLE_DRIVE_REFRESH_TOKEN:-}" ]]; then
  GOOGLE_DRIVE_REFRESH_TOKEN="$(read_keychain_secret "$KEYCHAIN_GOOGLE_REFRESH_TOKEN_SERVICE")"
  export GOOGLE_DRIVE_REFRESH_TOKEN
fi

cd "$APP_DIR"
WORKER_BUNDLE="$APP_DIR/dist/radio-local-youtube-worker.cjs"
if [[ -f "$WORKER_BUNDLE" ]]; then
  exec "$NODE_BIN" "$WORKER_BUNDLE"
fi

exec "$NODE_BIN" --import tsx script/radio-local-youtube-worker.ts
