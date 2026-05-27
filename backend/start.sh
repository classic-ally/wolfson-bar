#!/usr/bin/env bash
set -e

# Resolve repo root from this script's location so cwd doesn't matter.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)"
export DATABASE_PATH="${DATABASE_PATH:-$REPO_ROOT/wolfson_bar.db}"

echo "🦀 Starting Wolfson Bar Backend..."
echo "📂 DATABASE_PATH=$DATABASE_PATH"
echo ""

# Create the DB file if missing — the backend will run all migrations on boot.
if [ ! -f "$DATABASE_PATH" ]; then
    echo "📦 Creating empty database (migrations apply on first boot)..."
    nix-shell -p sqlite --run "sqlite3 '$DATABASE_PATH' 'VACUUM;'"
    echo "✅ Database file created at $DATABASE_PATH"
else
    echo "✅ Database exists"
fi

echo ""
echo "🚀 Starting server on http://localhost:3000"
echo "   Press Ctrl+C to stop"
echo ""

cd "$SCRIPT_DIR"
nix-shell --run "cargo run --release"
