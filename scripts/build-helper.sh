#!/usr/bin/env bash
# Builds only the native hotkey helper for the current platform into dist/helper.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$(uname -s)" in
  Darwin)
    OUT="$ROOT/dist/helper/mac"
    mkdir -p "$OUT"
    swiftc -O -framework AppKit -framework Carbon "$ROOT/helper/mac/Hotkey.swift" -o "$OUT/fxp-hotkey"
    chmod 755 "$OUT/fxp-hotkey"
    echo "Built $OUT/fxp-hotkey"
    ;;
  MINGW* | MSYS* | CYGWIN*)
    OUT="$ROOT/dist/helper/win"
    mkdir -p "$OUT"
    if command -v g++ >/dev/null 2>&1; then
      g++ -O2 -std=c++17 -static "$ROOT/helper/win/hotkey.cpp" -o "$OUT/fxp-hotkey.exe" -luser32
    else
      cl /EHsc /O2 /std:c++17 "$ROOT/helper/win/hotkey.cpp" "/Fe:$OUT/fxp-hotkey.exe" user32.lib
    fi
    echo "Built $OUT/fxp-hotkey.exe"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    exit 1
    ;;
esac
