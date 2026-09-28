#!/usr/bin/env bash
# Start Tilt Kart on this machine, or apply changes to this folder: nginx, the
# online relay, the updater, and the 'moto' Cloudflare Tunnel, which serves it at
# https://moto.shelbyklein.com. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"

git pull --ff-only --quiet 2>/dev/null || echo "Couldn't pull the latest game; starting what's here."

# Append a line to .env (private to this user), starting a new line if needed.
add_env() {
  if [ -s .env ] && [ -n "$(tail -c1 .env)" ]; then echo >>.env; fi
  (umask 077 && printf '%s\n' "$1" >>.env)
}

if ! grep -qs '^TUNNEL_TOKEN=.' .env; then
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
  add_env "TUNNEL_TOKEN=$token"
fi

# The updater pulls as whoever owns the checkout, so the files it writes stay theirs.
grep -qs '^KART_USER=' .env || add_env "KART_USER=$(stat -c '%u:%g' ../..)"

docker compose up -d --remove-orphans
# Bind-mounted files (nginx.conf, relay.mjs, update.sh) keep their old contents
# inside a running container, so restart to pick up whatever git just pulled.
docker compose restart web relay updater
docker compose ps

echo "Checks (from inside the nginx container):"
docker compose exec -T web wget -qS --spider http://127.0.0.1/game.js 2>&1 | grep -E 'HTTP/|Content-Type' || true
for _ in 1 2 3 4 5; do
  docker compose exec -T web wget -qO- http://relay:8787/healthz 2>/dev/null && break
  sleep 1
done || echo "The relay isn't answering: docker compose logs relay"
echo "Live at https://moto.shelbyklein.com once the tunnel connects (a few seconds)."
