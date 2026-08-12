#!/usr/bin/env bash
# Packages dist/ into a signed ZXP that installs on both macOS and Windows.
# A self-signed certificate is generated on first run; ZXP installers accept it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist"
RELEASE="$ROOT/release"
CERTS="$ROOT/certs"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZXP="$RELEASE/FX-Premiere-$VERSION.zxp"

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

echo
echo "Created $ZXP"
echo "Install it with any ZXP installer (aescripts ZXP Installer, Anastasiy's, or Adobe's UPIA)."
