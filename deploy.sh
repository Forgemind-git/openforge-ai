#!/usr/bin/env bash
# OpenForge AI — deploy with Docker in one command.
#
#   ./deploy.sh            build and start (first run creates .env from .env.example)
#   ./deploy.sh update     pull the latest code, rebuild, restart (data is kept)
#   ./deploy.sh logs       follow the server log
#   ./deploy.sh stop       stop the container (data is kept)
#
# First run only, you can pass settings inline:
#   PUBLIC_URL=https://assistant.example.com OPENFORGE_PORT=8080 ./deploy.sh
#
# Your data (database + generated secrets) lives in the Docker volume
# "openforge-data". This script never deletes it.
set -euo pipefail
cd "$(dirname "$0")"

say()  { printf '\033[1;31m▸\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed. Get it from https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || fail "Docker is installed but not running (or you need sudo / the docker group)."
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is missing ('docker compose'). Update Docker."

# Read one KEY's value from .env.
env_get() { sed -n "s/^$1=//p" .env 2>/dev/null | tail -n1; }

ensure_env() {
  [ -f .env ] && return
  say "Creating .env from .env.example"
  cp .env.example .env
  # Inline overrides on the first run, e.g. PUBLIC_URL=... ./deploy.sh
  for key in PUBLIC_URL OPENFORGE_PORT; do
    val="${!key:-}"
    [ -n "$val" ] && sed -i.bak "s|^$key=.*|$key=$val|" .env && rm -f .env.bak
  done
  # localhost default follows the chosen port
  port="$(env_get OPENFORGE_PORT)"
  [ -z "${PUBLIC_URL:-}" ] && [ -n "$port" ] && sed -i.bak "s|^PUBLIC_URL=http://localhost:.*|PUBLIC_URL=http://localhost:$port|" .env && rm -f .env.bak
  chmod 600 .env
}

wait_healthy() {
  say "Waiting for OpenForge AI to start…"
  for _ in $(seq 1 60); do
    state="$(docker inspect -f '{{.State.Health.Status}}' openforge 2>/dev/null || echo starting)"
    [ "$state" = healthy ] && return 0
    [ "$state" = unhealthy ] && break
    sleep 2
  done
  docker compose logs --tail 40 openforge || true
  fail "The container did not become healthy. The log is above; './deploy.sh logs' follows it."
}

up() {
  ensure_env
  say "Building and starting (the first build takes a few minutes)…"
  docker compose up -d --build
  wait_healthy
  url="$(env_get PUBLIC_URL)"; url="${url:-http://localhost:$(env_get OPENFORGE_PORT)}"
  cat <<EOF

  OpenForge AI is running → $url

  1. Open it and create the admin account (the first visitor becomes admin).
  2. Look around in Demo mode, then add your own keys under Settings.
  3. Real integrations (WhatsApp, Telegram, Google sign-in, voice) need HTTPS:
     see docs/DEPLOY.md for Traefik / Caddy / nginx.
  4. Make it yours: docs/EXTEND.md shows how to add tools and integrations.

EOF
}

case "${1:-up}" in
  up|start|"") up ;;
  update)
    if [ -d .git ]; then say "Pulling the latest code"; git pull --ff-only; fi
    up ;;
  logs) docker compose logs -f openforge ;;
  stop) docker compose stop && say "Stopped. Your data is kept; './deploy.sh' starts it again." ;;
  *) fail "Unknown command '$1'. Use: ./deploy.sh [up|update|logs|stop]" ;;
esac
