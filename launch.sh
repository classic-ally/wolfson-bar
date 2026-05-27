#!/usr/bin/env bash
set -e

# Resolve repo root from this script's location so cwd doesn't matter.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
export DATABASE_PATH="${DATABASE_PATH:-$SCRIPT_DIR/wolfson_bar.db}"

RUNTIME=$(nix build .#runtime --no-link --print-out-paths)

PUBLIC_URL="https://laptop.hawk-bearded.ts.net" \
FRONTEND_PATH="$RUNTIME/frontend/dist" \
DATABASE_PATH="$DATABASE_PATH" \
  "$RUNTIME/backend"
