#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
# Validate without starting containers, exposing secrets, or touching any volume.
docker compose --env-file .env.production.example -f compose.prod.yaml config --quiet
docker compose --env-file .env.production.example -f compose.prod.yaml config --format json |
python3 -c '
import json
import sys
config = json.load(sys.stdin)
service = config["services"]["family-hq"]
assert any(
    p.get("host_ip") == "127.0.0.1"
    and str(p.get("published")) == "3080"
    and p.get("target") == 3080
    for p in service["ports"]
), "Production service must only bind HTTP on NAS loopback"
assert service["volumes"][0]["source"] == "family-hq-data"
assert config["volumes"]["family-hq-data"]["external"] is True
print("Production Compose config validated")
'
