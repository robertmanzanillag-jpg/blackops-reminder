#!/bin/zsh
set -euo pipefail
umask 077

SCRIPT_DIR="${0:A:h}"
SCRIPT_CHECKOUT="${SCRIPT_DIR:h}"
if [[ -n "${CLIPPERS_PROJECT_DIR:-}" ]]; then
  PROJECT_DIR="$CLIPPERS_PROJECT_DIR"
else
  GIT_COMMON_DIR="$(git -C "$SCRIPT_CHECKOUT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [[ "$GIT_COMMON_DIR" == */.git ]]; then
    PROJECT_DIR="${GIT_COMMON_DIR:h}"
  else
    PROJECT_DIR="$SCRIPT_CHECKOUT"
  fi
fi
PROJECT_DIR="$(cd "$PROJECT_DIR" && pwd -P)"
PLIST_PATH="$HOME/Library/LaunchAgents/com.blackops.clippers-free-worker.plist"
WORKSPACE_ROOT="${CLIPPERS_WORKSPACE_ROOT:-$PROJECT_DIR/clippers_workspace}"
[[ "$WORKSPACE_ROOT" == /* ]] || WORKSPACE_ROOT="$PROJECT_DIR/$WORKSPACE_ROOT"
LOG_DIR="$WORKSPACE_ROOT/reports/free-local-worker"
NODE_PATH="$(command -v node)"
DRY_RUN="${CLIPPERS_LAUNCH_AGENT_DRY_RUN:-true}"

[[ "$DRY_RUN" == "true" || "$DRY_RUN" == "false" ]] || {
  echo "CLIPPERS_LAUNCH_AGENT_DRY_RUN must be true or false." >&2
  exit 1
}
[[ -f "$PROJECT_DIR/package.json" && -f "$PROJECT_DIR/script/clippers-free-local-worker.mjs" ]] || {
  echo "CLIPPERS_PROJECT_DIR is not a valid Clippers checkout: $PROJECT_DIR" >&2
  exit 1
}
mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

escape_xml() {
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

PLIST_TMP="$PLIST_PATH.tmp.$$"
trap 'rm -f "$PLIST_TMP"' EXIT
cat > "$PLIST_TMP" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.blackops.clippers-free-worker</string>
  <key>ProgramArguments</key><array><string>$(escape_xml "$NODE_PATH")</string><string>$(escape_xml "$PROJECT_DIR/script/clippers-free-local-worker.mjs")</string></array>
  <key>WorkingDirectory</key><string>$(escape_xml "$PROJECT_DIR")</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$(escape_xml "$PATH")</string>
    <key>CLIPPERS_WORKSPACE_ROOT</key><string>$(escape_xml "$WORKSPACE_ROOT")</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>3600</integer>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$(escape_xml "$LOG_DIR")/worker.log</string>
  <key>StandardErrorPath</key><string>$(escape_xml "$LOG_DIR")/worker.error.log</string>
</dict></plist>
PLIST

chmod 600 "$PLIST_TMP"
plutil -lint "$PLIST_TMP"
mv -f "$PLIST_TMP" "$PLIST_PATH"
if [[ "$DRY_RUN" != "true" ]]; then
  launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
  launchctl kickstart -k "gui/$(id -u)/com.blackops.clippers-free-worker"
  echo "Clippers free local worker installed: hourly, no Codex or paid AI calls."
else
  echo "Clippers free local worker plist validated without installation: $PROJECT_DIR"
fi
