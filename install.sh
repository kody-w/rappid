#!/usr/bin/env bash
set -euo pipefail

REPOSITORY="${RAPP_ZOO_REPOSITORY:-kody-w/rapp-zoo-v2}"
REQUESTED_REF="${RAPP_ZOO_REF:-main}"
INSTALL_ROOT="${RAPP_ZOO_INSTALL_ROOT:-$HOME/.local/share/rapp-zoo-v2}"
BIN_DIR="${RAPP_ZOO_BIN_DIR:-$HOME/.local/bin}"
SOURCE="${RAPP_ZOO_SOURCE:-}"
STAGE="${INSTALL_ROOT}.stage.$$"
BACKUP="${INSTALL_ROOT}.previous.$$"

fail() {
  printf 'rapp-zoo-v2 install: %s\n' "$*" >&2
  exit 1
}

case "$INSTALL_ROOT" in
  ""|"/"|"$HOME") fail "refusing unsafe install root" ;;
esac
case "$BIN_DIR" in
  ""|"/"|"$HOME") fail "refusing unsafe bin directory" ;;
esac

command -v node >/dev/null 2>&1 || fail "Node.js 24.19-26.x is required for this developer prototype"
command -v npm >/dev/null 2>&1 || fail "npm 11.6+ is required"
NODE_EXE="$(command -v node)"
node -e '
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24 || major >= 27) process.exit(1);
' || fail "Node.js must be >=24.19.0 and <27"

mkdir -p "$(dirname "$INSTALL_ROOT")" "$BIN_DIR"
if [ -e "$STAGE" ]; then
  fail "staging path already exists: $STAGE"
fi
mkdir -m 700 "$STAGE"

cleanup() {
  if [ -d "$STAGE" ]; then
    rm -rf -- "$STAGE"
  fi
}
trap cleanup EXIT

if [ -n "$SOURCE" ]; then
  [ -f "$SOURCE/package.json" ] || fail "RAPP_ZOO_SOURCE is not a source checkout"
  (
    cd "$SOURCE"
    tar \
      --exclude .git \
      --exclude node_modules \
      --exclude proof \
      --exclude release \
      -cf - .
  ) | (
    cd "$STAGE"
    tar -xf -
  )
  RESOLVED_REF="local-source"
else
  command -v curl >/dev/null 2>&1 || fail "curl is required"
  if printf '%s' "$REQUESTED_REF" | grep -Eq '^[0-9a-f]{40}$'; then
    RESOLVED_REF="$REQUESTED_REF"
  else
    RESOLVED_REF="$(
      curl -fsSL \
        -H 'Accept: application/vnd.github+json' \
        "https://api.github.com/repos/$REPOSITORY/commits/$REQUESTED_REF" \
      | sed -n 's/^[[:space:]]*"sha":[[:space:]]*"\([0-9a-f]\{40\}\)",*$/\1/p' \
      | head -n 1
    )"
    printf '%s' "$RESOLVED_REF" | grep -Eq '^[0-9a-f]{40}$' \
      || fail "could not resolve $REPOSITORY@$REQUESTED_REF to an immutable commit"
  fi
  curl -fsSL "https://github.com/$REPOSITORY/archive/$RESOLVED_REF.tar.gz" \
    | tar -xz -C "$STAGE" --strip-components=1
fi

(
  cd "$STAGE"
  npm ci --no-audit --no-fund
  npm run check
  npm run test:unit
)

if [ -e "$INSTALL_ROOT" ]; then
  mv "$INSTALL_ROOT" "$BACKUP"
fi
if ! mv "$STAGE" "$INSTALL_ROOT"; then
  if [ -e "$BACKUP" ]; then mv "$BACKUP" "$INSTALL_ROOT"; fi
  fail "atomic install replacement failed"
fi
if [ -e "$BACKUP" ]; then rm -rf -- "$BACKUP"; fi

cat > "$BIN_DIR/rapp-zoo-v2" <<EOF
#!/bin/sh
exec "$NODE_EXE" "$INSTALL_ROOT/bin/rapp-zoo-v2.mjs" "\$@"
EOF
chmod 755 "$BIN_DIR/rapp-zoo-v2"
chmod 755 "$INSTALL_ROOT/bin/rapp-zoo-v2.mjs"

cat > "$INSTALL_ROOT/INSTALLATION.json" <<EOF
{
  "schema": "rapp-zoo-installation/2.0",
  "repository": "$REPOSITORY",
  "resolved_ref": "$RESOLVED_REF",
  "installed_utc": "$(date -u '+%Y-%m-%dT%H:%M:%S.000Z')",
  "data_root": "\$HOME/.rapp-zoo-v2"
}
EOF
chmod 600 "$INSTALL_ROOT/INSTALLATION.json"

if [ "${RAPP_ZOO_AUTOSTART:-0}" = "1" ] && [ "$(uname -s)" = "Darwin" ]; then
  LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
  LAUNCH_AGENT="$LAUNCH_AGENTS/io.github.kody-w.rapp-zoo-v2.plist"
  mkdir -p "$LAUNCH_AGENTS"
  cat > "$LAUNCH_AGENT" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>io.github.kody-w.rapp-zoo-v2</string>
  <key>ProgramArguments</key>
  <array>
    <string>$INSTALL_ROOT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron</string>
    <string>$INSTALL_ROOT</string>
    <string>--rapp-zoo-estate-home=$HOME/.rapp-zoo-v2/estates/primary</string>
    <string>--user-data-dir=$HOME/.rapp-zoo-v2/estates/primary/electron-user-data</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>RAPP_ZOO_ROOT</key>
    <string>$HOME/.rapp-zoo-v2</string>
    <key>RAPP_ZOO_ESTATE_HOME</key>
    <string>$HOME/.rapp-zoo-v2/estates/primary</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/rapp-zoo-v2.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/rapp-zoo-v2.log</string>
</dict>
</plist>
EOF
  chmod 600 "$LAUNCH_AGENT"
  launchctl bootout "gui/$(id -u)" "$LAUNCH_AGENT" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCH_AGENT"
fi

trap - EXIT
printf 'RAPP Zoo v2 installed.\n'
printf 'CLI: %s/rapp-zoo-v2\n' "$BIN_DIR"
printf 'Start: %s/rapp-zoo-v2 start\n' "$BIN_DIR"
printf 'Semantic state: %s/rapp-zoo-v2 snapshot\n' "$BIN_DIR"
