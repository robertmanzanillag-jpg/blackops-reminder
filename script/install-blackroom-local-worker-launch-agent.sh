#!/bin/zsh
set -euo pipefail

PROJECT_DIR="${BLACKROOM_PROJECT_DIR:-$(pwd)}"
PLIST_PATH="$HOME/Library/LaunchAgents/com.blackroom.content-agent.plist"
LOG_DIR="$PROJECT_DIR/clippers_workspace/blackroom/agent"
NPM_PATH="$(command -v npm)"
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.blackroom.content-agent</string>
  <key>ProgramArguments</key><array><string>${NPM_PATH}</string><string>run</string><string>blackroom:control</string></array>
  <key>WorkingDirectory</key><string>${PROJECT_DIR}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${PATH}</string><key>BLACKROOM_NPM_PATH</key><string>${NPM_PATH}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG_DIR}/control.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/control.error.log</string>
</dict></plist>
PLIST

plutil -lint "$PLIST_PATH"
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl kickstart -k "gui/$(id -u)/com.blackroom.content-agent"
echo "BlackRoom local agent: http://127.0.0.1:5020/blackroom"
