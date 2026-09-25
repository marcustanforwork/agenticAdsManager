#!/bin/sh
# Picks the process to run, and wraps it in `doppler run` when a Doppler service token is present.
# Each service gets its own token (worker config / gateway config), so the gateway's write key
# never reaches the worker. Without a token (dev smoke test, CI) the process runs with no secrets.
set -eu
case "${1:-worker}" in
  worker) shift || true; set -- node /app/worker/dist/main.js "$@" ;;
  gateway) shift || true; set -- node /app/gateway/dist/main.js "$@" ;;
  ads) shift; set -- node /app/worker/dist/cli.js "$@" ;;
  ads-gw) shift; set -- node /app/gateway/dist/cli.js "$@" ;;
esac
if [ -n "${DOPPLER_TOKEN:-}" ]; then
  exec doppler run --forward-signals --no-fallback -- "$@"
fi
exec "$@"
