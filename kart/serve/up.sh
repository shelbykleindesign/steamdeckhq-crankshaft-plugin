#!/usr/bin/env bash
# Start (or update) Tilt Kart on this machine: nginx + the 'moto' Cloudflare
# Tunnel, which serves it at https://moto.shelbyklein.com. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only --quiet 2>/dev/null || echo "Couldn't pull the latest game; starting what's here."

if [ ! -s .env ]; then
  echo "Fetching the token for tunnel 'moto'..."
  fetch() {
    if command -v cloudflared >/dev/null 2>&1; then
      cloudflared tunnel token moto
    else
      # Same thing via the cloudflared image, using this user's cloudflared login.
      docker run --rm --user "$(id -u)" -v "$HOME/.cloudflared:/cert:ro" \
        -e TUNNEL_ORIGIN_CERT=/cert/cert.pem cloudflare/cloudflared:latest tunnel token moto
    fi
  }
  if ! token=$(fetch 2>/dev/null) || [ -z "$token" ]; then
    echo "Couldn't read the tunnel token: cloudflared isn't logged in on this machine."
    echo "Either run 'cloudflared tunnel login', approve the link it prints (any browser), and run this again;"
    echo "or copy the token from Cloudflare Zero Trust > Networks > Tunnels > moto into"
    echo "  $(pwd)/.env  as  TUNNEL_TOKEN=<token>  and run this again."
    exit 1
  fi
  (umask 077 && printf 'TUNNEL_TOKEN=%s\n' "$token" > .env)
fi

docker compose up -d --remove-orphans
docker compose ps
echo "Serving check (from inside the nginx container):"
docker compose exec -T web wget -qS --spider http://127.0.0.1/game.js 2>&1 | grep -E 'HTTP/|Content-Type' || true
echo "Live at https://moto.shelbyklein.com once the tunnel connects (a few seconds)."
