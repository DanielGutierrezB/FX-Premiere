#!/usr/bin/env bash
# Builds a double-click macOS installer that drops FX Premiere into the editor's own CEP folder.
#
# Per user, not system-wide, and that is the whole point: the panel updates itself by unpacking a
# release over the folder it is running from, and the old /Library install belonged to root, so
# every editor who used the installer was stuck on the version they first got. Premiere reads
# ~/Library/Application Support/Adobe/CEP/extensions just as happily.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
RELEASE="$ROOT/release"
STAGE="$ROOT/build/pkgroot"
SCRIPTS="$ROOT/build/pkgscripts"
COMPONENTS="$ROOT/build/pkgcomponents"
DISTRIBUTION="$ROOT/build/pkgdistribution.xml"
BUNDLE_ID="com.fxpremiere.suite"
VERSION="$(node -p "require('$ROOT/package.json').version")"
PKG="$RELEASE/FX-Premiere-$VERSION.pkg"
COMPONENT="$COMPONENTS/FX-Premiere-extension.pkg"
# Relative, with no leading slash: the distribution below offers the current-user domain and
# nothing else, which makes the installer treat the home folder as the destination volume, so this
# path lands under $HOME.
CEP_DIR="Library/Application Support/Adobe/CEP/extensions"

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

rm -rf "$STAGE" "$SCRIPTS" "$COMPONENTS"
mkdir -p "$STAGE/$CEP_DIR/$BUNDLE_ID" "$SCRIPTS" "$COMPONENTS" "$RELEASE"
ditto "$DIST" "$STAGE/$CEP_DIR/$BUNDLE_ID"
rm -f "$STAGE/$CEP_DIR/$BUNDLE_ID/.debug"
chmod 755 "$STAGE/$CEP_DIR/$BUNDLE_ID/helper/mac/fxp-hotkey"

cat > "$SCRIPTS/preinstall" <<'PREINSTALL'
#!/bin/bash
# scripts/dev-install.sh points this path at the repository's dist folder with a symlink, and a
# package payload written onto a symlinked directory follows the link: the release would land inside
# somebody's working copy and the repository would quietly become the installed extension. The link
# is unhooked first so the payload creates a real directory instead.
#
# Only the link itself is removed. Never what it resolves to: that is a source tree.
TARGET_ROOT="$3"
case "$TARGET_ROOT" in
  "" | "/") TARGET_ROOT="$HOME" ;;
esac
BUNDLE="$TARGET_ROOT/Library/Application Support/Adobe/CEP/extensions/com.fxpremiere.suite"

if [ -L "$BUNDLE" ]; then
  echo "FX Premiere: removing the development symlink at $BUNDLE. Its target is left untouched."
  rm "$BUNDLE"
fi

exit 0
PREINSTALL

cat > "$SCRIPTS/postinstall" <<'POSTINSTALL'
#!/bin/bash
# A home-folder install runs as the editor, not as root, so the debug-mode preference lands in the
# right account with a plain defaults write; the old system-wide package had to guess who the
# console user was and reach them through sudo -u.
#
# The destination volume of a home-domain install is the home folder itself. $HOME covers an
# installer that hands us "/" instead.
TARGET_ROOT="$3"
case "$TARGET_ROOT" in
  "" | "/") TARGET_ROOT="$HOME" ;;
esac
BUNDLE="$TARGET_ROOT/Library/Application Support/Adobe/CEP/extensions/com.fxpremiere.suite"
HELPER="$BUNDLE/helper/mac/fxp-hotkey"

if [ -f "$HELPER" ]; then
  chmod 755 "$HELPER"
  xattr -dr com.apple.quarantine "$HELPER" 2>/dev/null || true
fi

# This payload carries no Adobe signature, so Premiere ignores the extension until debug mode is on.
for version in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$version" PlayerDebugMode 1 2>/dev/null || true
done

exit 0
POSTINSTALL

chmod +x "$SCRIPTS/preinstall" "$SCRIPTS/postinstall"

pkgbuild \
  --root "$STAGE" \
  --scripts "$SCRIPTS" \
  --identifier "$BUNDLE_ID" \
  --version "$VERSION" \
  --install-location "/" \
  "$COMPONENT"

# pkgbuild cannot aim a payload at a home folder on its own; only a distribution can, by way of the
# domains element. Leaving enable_localSystem on would put the /Library choice back in front of the
# editor, and choosing it recreates exactly the root-owned install that cannot self-update.
cat > "$DISTRIBUTION" <<DISTRIBUTION_XML
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
    <title>FX Premiere</title>
    <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
    <domains enable_anywhere="false" enable_currentUserHome="true" enable_localSystem="false"/>
    <choices-outline>
        <line choice="default"/>
    </choices-outline>
    <choice id="default" title="FX Premiere">
        <pkg-ref id="$BUNDLE_ID"/>
    </choice>
    <pkg-ref id="$BUNDLE_ID" version="$VERSION">$(basename "$COMPONENT")</pkg-ref>
</installer-gui-script>
DISTRIBUTION_XML

rm -f "$PKG"
productbuild \
  --distribution "$DISTRIBUTION" \
  --package-path "$COMPONENTS" \
  "$PKG"

echo
echo "Created $PKG"
echo "It installs into ~/Library/Application Support/Adobe/CEP/extensions/$BUNDLE_ID, so the panel"
echo "can update itself from the settings later without asking for a password."
echo "Unsigned installers need right click > Open the first time (Gatekeeper)."
