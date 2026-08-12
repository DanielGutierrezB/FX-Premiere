#!/usr/bin/env bash
# Builds a double-click macOS installer that drops FX Premiere into the system CEP folder.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
RELEASE="$ROOT/release"
STAGE="$ROOT/build/pkgroot"
SCRIPTS="$ROOT/build/pkgscripts"
BUNDLE_ID="com.fxpremiere.suite"
VERSION="$(node -p "require('$ROOT/package.json').version")"
PKG="$RELEASE/FX-Premiere-$VERSION.pkg"
CEP_DIR="/Library/Application Support/Adobe/CEP/extensions"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "make-pkg.sh only runs on macOS" >&2
  exit 1
fi

if [[ ! -d "$DIST" ]]; then
  echo "dist/ not found. Run: npm run build" >&2
  exit 1
fi

if [[ ! -f "$DIST/helper/mac/fxp-hotkey" ]]; then
  echo "Hotkey helper missing. Run scripts/build-helper.sh first." >&2
  exit 1
fi

rm -rf "$STAGE" "$SCRIPTS"
mkdir -p "$STAGE$CEP_DIR/$BUNDLE_ID" "$SCRIPTS" "$RELEASE"
ditto "$DIST" "$STAGE$CEP_DIR/$BUNDLE_ID"
rm -f "$STAGE$CEP_DIR/$BUNDLE_ID/.debug"
chmod 755 "$STAGE$CEP_DIR/$BUNDLE_ID/helper/mac/fxp-hotkey"

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/bash
# Unsigned extensions need CEP debug mode, and the helper needs the executable bit.
BUNDLE="/Library/Application Support/Adobe/CEP/extensions/com.fxpremiere.suite"
HELPER="$BUNDLE/helper/mac/fxp-hotkey"

if [ -f "$HELPER" ]; then
  chmod 755 "$HELPER"
  xattr -dr com.apple.quarantine "$HELPER" 2>/dev/null || true
fi

TARGET_USER="${USER:-$(stat -f "%Su" /dev/console)}"
for version in 9 10 11 12 13; do
  sudo -u "$TARGET_USER" defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
done

exit 0
POSTINSTALL
chmod +x "$SCRIPTS/postinstall"

rm -f "$PKG"
pkgbuild \
  --root "$STAGE" \
  --scripts "$SCRIPTS" \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$PKG"

echo
echo "Created $PKG"
echo "Unsigned installers need right click > Open the first time (Gatekeeper)."
