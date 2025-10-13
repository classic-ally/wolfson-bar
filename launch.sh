#!/usr/bin/env bash
set -e

# Stop and remove any existing container
podman rm -f wolfson-bar 2>/dev/null || true

# Run the container with the database mounted - using laptop Tailscale address for testing
podman run -d \
  --name wolfson-bar \
  -p 3000:3000 \
  -v "$(pwd)/backend/wolfson_bar.db:/app/wolfson_bar.db:Z" \
  -e PUBLIC_URL="https://laptop.hawk-bearded.ts.net" \
  wolfson-bar

echo "✅ Container started!"
echo "📊 View logs with: podman logs -f wolfson-bar"