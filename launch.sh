#!/usr/bin/env bash
set -e

RUNTIME=$(nix build .#runtime --no-link --print-out-paths)

PUBLIC_URL="https://laptop.hawk-bearded.ts.net" \
FRONTEND_PATH="$RUNTIME/frontend/dist" \
  "$RUNTIME/backend"
