#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.robert.radio-local-youtube-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/robert-radio-worker"
SUPPORT_DIR="$HOME/Library/Application Support/RobertRadioWorker"
RUNNER="$SUPPORT_DIR/run-radio-local-worker.sh"
NODE_BIN="${RADIO_WORKER_NODE_BIN:-/Users/robertmanzanilla/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node}"

mkdir -p "$(dirname "$PLIST")" "$LOG_DIR" "$SUPPORT_DIR"

if [[ ! -f "$APP_DIR/package.json" ]]; then
  echo "No package.json found in $APP_DIR" >&2
  exit 1
fi

cat > "$RUNNER" <<RUNNER
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$APP_DIR"
KEYCHAIN_DB_SERVICE="\${RADIO_WORKER_DB_KEYCHAIN_SERVICE:-robert-radio-worker-database-url}"
KEYCHAIN_TG_SERVICE="\${RADIO_WORKER_TELEGRAM_KEYCHAIN_SERVICE:-robert-radio-worker-telegram-bot-token}"
KEYCHAIN_GOOGLE_CLIENT_ID_SERVICE="\${RADIO_WORKER_GOOGLE_CLIENT_ID_KEYCHAIN_SERVICE:-robert-radio-worker-google-client-id}"
KEYCHAIN_GOOGLE_CLIENT_SECRET_SERVICE="\${RADIO_WORKER_GOOGLE_CLIENT_SECRET_KEYCHAIN_SERVICE:-robert-radio-worker-google-client-secret}"
KEYCHAIN_GOOGLE_REFRESH_TOKEN_SERVICE="\${RADIO_WORKER_GOOGLE_REFRESH_TOKEN_KEYCHAIN_SERVICE:-robert-radio-worker-google-drive-refresh-token}"
NODE_BIN="\${RADIO_WORKER_NODE_BIN:-$NODE_BIN}"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"
export YT_DLP_PATH="\${YT_DLP_PATH:-/opt/homebrew/bin/yt-dlp}"
export FFMPEG_PATH="\${FFMPEG_PATH:-/opt/homebrew/bin/ffmpeg}"
export FFPROBE_PATH="\${FFPROBE_PATH:-/opt/homebrew/bin/ffprobe}"
export YT_DLP_JS_RUNTIMES="\${YT_DLP_JS_RUNTIMES:-deno,node}"

read_keychain_secret() {
  local service="\$1"
  /usr/bin/security find-generic-password -a "\$USER" -s "\$service" -w 2>/dev/null || true
}

if [[ -z "\${DATABASE_URL:-}" ]]; then
  DATABASE_URL="\$(read_keychain_secret "\$KEYCHAIN_DB_SERVICE")"
  export DATABASE_URL
fi

if [[ -z "\${TELEGRAM_BOT_TOKEN:-}" ]]; then
  TELEGRAM_BOT_TOKEN="\$(read_keychain_secret "\$KEYCHAIN_TG_SERVICE")"
  export TELEGRAM_BOT_TOKEN
fi

if [[ -z "\${GOOGLE_CLIENT_ID:-}" ]]; then
  GOOGLE_CLIENT_ID="\$(read_keychain_secret "\$KEYCHAIN_GOOGLE_CLIENT_ID_SERVICE")"
  export GOOGLE_CLIENT_ID
fi

if [[ -z "\${GOOGLE_CLIENT_SECRET:-}" ]]; then
  GOOGLE_CLIENT_SECRET="\$(read_keychain_secret "\$KEYCHAIN_GOOGLE_CLIENT_SECRET_SERVICE")"
  export GOOGLE_CLIENT_SECRET
fi

if [[ -z "\${GOOGLE_DRIVE_REFRESH_TOKEN:-}" ]]; then
  GOOGLE_DRIVE_REFRESH_TOKEN="\$(read_keychain_secret "\$KEYCHAIN_GOOGLE_REFRESH_TOKEN_SERVICE")"
  export GOOGLE_DRIVE_REFRESH_TOKEN
fi

cd "\$APP_DIR"
WORKER_BUNDLE="\$APP_DIR/dist/radio-local-youtube-worker.cjs"
if [[ -f "\$WORKER_BUNDLE" ]]; then
  exec "\$NODE_BIN" "\$WORKER_BUNDLE"
fi

exec "\$NODE_BIN" --import tsx script/radio-local-youtube-worker.ts
RUNNER
chmod +x "$RUNNER"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>bash "$RUNNER"</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/out.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/error.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

echo "Installed and started $LABEL"
echo "Plist: $PLIST"
echo "Runner: $RUNNER"
echo "Logs: $LOG_DIR/out.log and $LOG_DIR/error.log"
