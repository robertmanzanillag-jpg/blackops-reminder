#!/bin/zsh
set -euo pipefail
umask 077

PROJECT_DIR="${CLIPPERS_PROJECT_DIR:-$(pwd)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.blackops.clippers-free-worker.plist"
LOG_DIR="$PROJECT_DIR/clippers_workspace/reports/free-local-worker"
NPM_PATH="$(command -v npm)"
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
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(escape_xml "$PATH")</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>StandardOutPath</key><string>$(escape_xml "$LOG_DIR")/worker.log</string>
  <key>StandardErrorPath</key><string>$(escape_xml "$LOG_DIR")/worker.error.log</string>
</dict></plist>
PLIST

chmod 600 "$PLIST_PATH"
plutil -lint "$PLIST_PATH"
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.blackops.clippers-free-worker"
echo "Clippers free local worker installed: hourly, no Codex or paid AI calls."
