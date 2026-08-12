#!/usr/bin/env bash
# Installs the freshly built dist/ folder as a live CEP extension for development.
# macOS uses a symlink so a rebuild is picked up by simply reopening the panel.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="com.fxpremiere.suite"
DIST="$ROOT/dist"

if [[ ! -d "$DIST" ]]; then
  echo "dist/ not found. Run: npm run build" >&2
  exit 1
fi

case "$(uname -s)" in
  Darwin)
    TARGET="$HOME/Library/Application Support/Adobe/CEP/extensions/$BUNDLE_ID"
    echo "Enabling CEP debug mode (unsigned extensions)"
    for version in 9 10 11 12 13; do
      defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
      defaults write "com.adobe.CSXS.$version" LogLevel 1 2>/dev/null || true
    done
    mkdir -p "$(dirname "$TARGET")"
    rm -rf "$TARGET"
    ln -s "$DIST" "$TARGET"
    echo "Linked $TARGET -> $DIST"
    HELPER="$DIST/helper/mac/fxp-hotkey"
    if [[ -f "$HELPER" ]]; then
      chmod 755 "$HELPER"
      xattr -dr com.apple.quarantine "$HELPER" 2>/dev/null || true
      echo "Hotkey helper ready: $HELPER"
    else
      echo "Warning: hotkey helper missing. Run scripts/build-helper.sh" >&2
    fi
    ;;
  MINGW* | MSYS* | CYGWIN*)
    TARGET="$APPDATA/Adobe/CEP/extensions/$BUNDLE_ID"
    for version in 9 10 11 12 13; do
      reg add "HKCU\\Software\\Adobe\\CSXS.$version" /v PlayerDebugMode /t REG_SZ /d 1 /f >/dev/null 2>&1 || true
    done
    mkdir -p "$(dirname "$TARGET")"
    rm -rf "$TARGET"
    cp -R "$DIST" "$TARGET"
    echo "Copied dist/ to $TARGET (re-run after each build on Windows)"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac

echo
echo "Restart Premiere Pro, then open Window > Extensions > FX Premiere."
echo "The invisible service starts with Premiere and owns the global shortcut."
