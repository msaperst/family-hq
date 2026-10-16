#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# This checks the manifest, without building/running containers or touching persistent storage.
docker compose --env-file .env.production.example -f compose.prod.yaml config --quiet
rendered="$(docker compose --env-file .env.production.example -f compose.prod.yaml config)"
printf '%s\n' "$rendered" | grep -q '127.0.0.1:3080'
printf '%s\n' "$rendered" | grep -q 'family-hq-data'
printf '%s\n' "$rendered" | grep -q 'external: true'
echo "Production Compose config validated"
