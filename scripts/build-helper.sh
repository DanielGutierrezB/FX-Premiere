#!/usr/bin/env bash
# Builds only the native hotkey helper for the current platform into dist/helper.
#
# The compilers, targets and libraries live in scripts/build.mjs and are used from there: a second
# copy of them here is how a helper built by hand ends up linked differently from the one that ships.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

exec node "$ROOT/scripts/build.mjs" --helper-only
