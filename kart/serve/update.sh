#!/bin/sh
# The updater service's loop (see docker-compose.yml): fast-forward the checkout
# to the branch on GitHub every minute. nginx serves ../public straight from the
# checkout, so a pulled change is live on the next page load.
echo "Following $(git rev-parse --abbrev-ref HEAD) at $(git log -1 --format='%h %s')"
last=''
while :; do
  before=$(git rev-parse HEAD)
  if out=$(git pull --ff-only -q 2>&1); then
    after=$(git rev-parse HEAD)
    [ "$before" = "$after" ] || echo "$(date -u '+%F %T') now serving $(git log -1 --format='%h %s')"
    last=''
  elif [ "$out" != "$last" ]; then
    # Say it once, not every minute.
    echo "$(date -u '+%F %T') pull failed: $out"
    last=$out
  fi
  sleep 60
done
