#!/usr/bin/env bash
# Packages dist/ into a signed ZXP that installs on both macOS and Windows.
# A self-signed certificate is generated on first run. ZXP installers accept it, but Premiere only
# loads a self-signed extension where CEP debug mode is on, so this also packages the enablers from
# tools/ that turn it on. Both files belong in the release.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
RELEASE="$ROOT/release"
CERTS="$ROOT/certs"
TOOLS="$ROOT/tools"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZXP="$RELEASE/FX-Premiere-$VERSION.zxp"
ENABLER="$RELEASE/FX-Premiere-$VERSION-activar-modo-depuracion.zip"

# Not a secret: it locks a throwaway self-signed certificate that this script creates locally.
# Set FXP_CERT_PASSWORD if you sign with a certificate of your own.
CERT_PASSWORD="${FXP_CERT_PASSWORD:-fxpremiere}"
CERT_FILE="$CERTS/fxpremiere.p12"
SIGN_TOOL="${FXP_ZXPSIGNCMD:-$CERTS/ZXPSignCmd}"
SIGN_VERSION="4.1.3"

if [[ ! -d "$DIST" ]]; then
  echo "dist/ not found. Run: npm run build" >&2
  exit 1
fi

# The ZXP is the one artifact both platforms install, so it has to carry both hotkey helpers.
# Without this check a Mac-only build signs happily and every Windows editor who installs it is
# told the helper is missing, with no shortcut and no clue why.
for HELPER in "$DIST/helper/mac/fxp-hotkey" "$DIST/helper/win/fxp-hotkey.exe"; do
  if [[ ! -s "$HELPER" ]]; then
    echo "Refusing to sign: $HELPER is missing or empty." >&2
    echo "The ZXP must carry both helpers. Put the other platform's binary in prebuilt/mac or" >&2
    echo "prebuilt/win and rebuild; CI does this by downloading the helper job's artifact." >&2
    exit 1
  fi
done

# The ZXP is useless on a machine without CEP debug mode, so the enablers are not optional extras:
# a release that ships the ZXP without them is a release that silently does not load for anybody
# who has never developed a CEP extension.
for ENABLER_FILE in \
  "$TOOLS/activar-modo-depuracion-mac.command" \
  "$TOOLS/activar-modo-depuracion-windows.bat" \
  "$TOOLS/LEEME.txt"; do
  if [[ ! -s "$ENABLER_FILE" ]]; then
    echo "Refusing to sign: $ENABLER_FILE is missing or empty." >&2
    echo "The ZXP only loads where CEP debug mode is on, and that file is how an editor turns it" >&2
    echo "on, so it has to be in the release next to the ZXP." >&2
    exit 1
  fi
done

if ! command -v zip >/dev/null 2>&1; then
  echo "Refusing to sign: zip is missing, so the debug-mode enablers cannot be packaged." >&2
  exit 1
fi

mkdir -p "$RELEASE" "$CERTS"

if [[ ! -x "$SIGN_TOOL" ]]; then
  case "$(uname -s)" in
    Darwin) URL="https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/$SIGN_VERSION/macOS/ZXPSignCmd" ;;
    *) URL="https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/$SIGN_VERSION/x64/ZXPSignCmd.exe" ;;
  esac
  echo "Downloading ZXPSignCmd $SIGN_VERSION"
  curl -fsSL "$URL" -o "$SIGN_TOOL"
  chmod +x "$SIGN_TOOL"
  xattr -dr com.apple.quarantine "$SIGN_TOOL" 2>/dev/null || true
fi

if [[ ! -f "$CERT_FILE" ]]; then
  echo "Creating self-signed certificate at $CERT_FILE"
  "$SIGN_TOOL" -selfSignedCert US CO "FX Premiere" "FX Premiere" "$CERT_PASSWORD" "$CERT_FILE"
fi

STAGE="$ROOT/build/zxproot"
rm -rf "$STAGE"
mkdir -p "$STAGE"
cp -R "$DIST/." "$STAGE/"
# Remote debugging must never ship inside a released package.
rm -f "$STAGE/.debug"

rm -f "$ZXP"
echo "Signing $ZXP"
"$SIGN_TOOL" -sign "$STAGE" "$ZXP" "$CERT_FILE" "$CERT_PASSWORD" -tsa http://timestamp.digicert.com

# Zipped rather than attached loose because a .command file that arrives without its executable bit
# cannot be double-clicked, and neither GitHub's artifact upload nor a browser download preserves
# permissions on individual files.
rm -f "$ENABLER"
echo "Packaging the debug-mode enablers into $ENABLER"
(
  cd "$TOOLS"
  chmod 755 activar-modo-depuracion-mac.command
  zip -q "$ENABLER" activar-modo-depuracion-mac.command activar-modo-depuracion-windows.bat LEEME.txt
)

echo
echo "Created $ZXP"
echo "Install it with any ZXP installer (aescripts ZXP Installer, Anastasiy's, or Adobe's UPIA)."
echo
echo "The certificate above is self-signed, not Adobe's, so Premiere will refuse to load this ZXP"
echo "on any machine where CEP debug mode has never been switched on: the panel simply never shows"
echo "up under Window > Extensions. Ship $ENABLER alongside it; the editor runs the .command on"
echo "macOS or the .bat on Windows once and restarts Premiere. The .pkg and the .exe installers set"
echo "debug mode themselves, so only the ZXP route needs it."
