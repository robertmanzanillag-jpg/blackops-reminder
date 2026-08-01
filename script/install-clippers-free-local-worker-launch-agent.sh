#!/bin/zsh
set -euo pipefail
umask 077

PROJECT_DIR="${CLIPPERS_PROJECT_DIR:-$(pwd)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.blackops.clippers-free-worker.plist"
CONFIG_ROOT="${CLIPPERS_CONFIG_ROOT:-$PROJECT_DIR}"
WORKSPACE_ROOT="${CLIPPERS_WORKSPACE_ROOT:-$PROJECT_DIR/clippers_workspace}"
[[ "$CONFIG_ROOT" == /* ]] || CONFIG_ROOT="$PROJECT_DIR/$CONFIG_ROOT"
[[ "$WORKSPACE_ROOT" == /* ]] || WORKSPACE_ROOT="$PROJECT_DIR/$WORKSPACE_ROOT"
LOG_DIR="$WORKSPACE_ROOT/reports/free-local-worker"
NPM_PATH="$(command -v npm)"
PUBLISHING_AUTHORIZED="${CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED:-false}"
MEDIA_UPLOAD_AUTHORIZED="${CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED:-false}"
METRICOOL_BLOG_ID="${CLIPPERS_METRICOOL_BLOG_ID:-}"
TIKTOK_ACCOUNT="${CLIPPERS_TIKTOK_ACCOUNT:-streamersclipusa}"
TARGET_DAILY_CLIPS="${CLIPPERS_TARGET_DAILY_CLIPS:-5}"
MEDIA_PROVIDER="${CLIPPERS_PUBLIC_MEDIA_PROVIDER:-google_drive}"
CLEANUP_EXECUTE="${CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE:-false}"
DRY_RUN="${CLIPPERS_LAUNCH_AGENT_DRY_RUN:-true}"

for value in "$PUBLISHING_AUTHORIZED" "$MEDIA_UPLOAD_AUTHORIZED" "$CLEANUP_EXECUTE" "$DRY_RUN"; do
  [[ "$value" == "true" || "$value" == "false" ]] || {
    echo "Boolean Clippers controls must be true or false." >&2
    exit 1
  }
done
[[ "$TARGET_DAILY_CLIPS" == <-> ]] && (( TARGET_DAILY_CLIPS >= 2 && TARGET_DAILY_CLIPS <= 8 )) || {
  echo "CLIPPERS_TARGET_DAILY_CLIPS must be an integer from 2 to 8." >&2
  exit 1
}
if [[ "$PUBLISHING_AUTHORIZED" == "true" || "$MEDIA_UPLOAD_AUTHORIZED" == "true" ]]; then
  [[ "$METRICOOL_BLOG_ID" == <-> ]] && (( METRICOOL_BLOG_ID > 0 )) || {
    echo "CLIPPERS_METRICOOL_BLOG_ID is required when upload or publishing is enabled." >&2
    exit 1
  }
fi
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.blackops.clippers-free-worker</string>
  <key>ProgramArguments</key><array><string>$(escape_xml "$NPM_PATH")</string><string>run</string><string>clippers:free-local-worker</string></array>
  <key>WorkingDirectory</key><string>$(escape_xml "$PROJECT_DIR")</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(escape_xml "$PATH")</string>
    <key>CLIPPERS_CONFIG_ROOT</key><string>$(escape_xml "$CONFIG_ROOT")</string>
    <key>CLIPPERS_METRICOOL_AUTOPUBLISH_AUTHORIZED</key><string>$(escape_xml "$PUBLISHING_AUTHORIZED")</string>
    <key>CLIPPERS_WORKSPACE_ROOT</key><string>$(escape_xml "$WORKSPACE_ROOT")</string>
    <key>CLIPPERS_PUBLIC_MEDIA_UPLOAD_AUTHORIZED</key><string>$(escape_xml "$MEDIA_UPLOAD_AUTHORIZED")</string>
    <key>CLIPPERS_METRICOOL_BLOG_ID</key><string>$(escape_xml "$METRICOOL_BLOG_ID")</string>
    <key>CLIPPERS_TIKTOK_ACCOUNT</key><string>$(escape_xml "$TIKTOK_ACCOUNT")</string>
    <key>CLIPPERS_TARGET_DAILY_CLIPS</key><string>$(escape_xml "$TARGET_DAILY_CLIPS")</string>
    <key>CLIPPERS_PUBLIC_MEDIA_PROVIDER</key><string>$(escape_xml "$MEDIA_PROVIDER")</string>
    <key>CLIPPERS_FREE_WORKER_CLEANUP_EXECUTE</key><string>$(escape_xml "$CLEANUP_EXECUTE")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$(escape_xml "$LOG_DIR")/worker.log</string>
  <key>StandardErrorPath</key><string>$(escape_xml "$LOG_DIR")/worker.error.log</string>
</dict></plist>
PLIST

chmod 600 "$PLIST_PATH"
plutil -lint "$PLIST_PATH"
if [[ "$DRY_RUN" != "true" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl kickstart -k "gui/$(id -u)/com.blackops.clippers-free-worker"
  echo "Clippers free local worker installed: hourly, no Codex or paid AI calls."
else
  echo "Clippers free local worker plist validated without installation."
fi
