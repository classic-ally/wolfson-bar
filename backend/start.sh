#!/usr/bin/env bash
set -e

echo "🦀 Starting Wolfson Bar Backend..."
echo ""

# Create database if it doesn't exist
if [ ! -f wolfson_bar.db ]; then
    echo "📦 Creating database..."
    nix-shell -p sqlite --run "sqlite3 wolfson_bar.db < migrations/001_init.sql"
    echo "✅ Database created!"
else
    echo "✅ Database exists"
fi

echo ""
echo "🚀 Starting server on http://localhost:3000"
echo "   Press Ctrl+C to stop"
echo ""

nix-shell --run "cargo run --release"
