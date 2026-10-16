#!/bin/sh
# Static guardrails for the image-only Container Station manifest.
set -eu
file="deployment/container-station.compose.yaml"
test -f "$file"
grep -q 'image: ghcr.io/msaperst/family-hq:sha-' "$file"
grep -q '127.0.0.1:3080:3080' "$file"
grep -q 'family-hq-data:/app/data' "$file"
grep -q 'external: true' "$file"
grep -q '/share/Container/family-hq/.env.production' "$file"
if grep -Eq '^[[:space:]]*(build:|privileged:)' "$file"; then
  echo "Container Station manifest must use a prebuilt nonprivileged image" >&2
  exit 1
fi
docker compose -f "$file" config --quiet
