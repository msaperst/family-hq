#!/bin/sh
set -eu
# Only uses a disposable volume with a unique name; no production mounts.
IMAGE="family-hq:persistence-test"
VOLUME="family-hq-test-$$"
CONTAINER="family-hq-test-$$"
cleanup() {
  docker container rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker build -t "$IMAGE" .
docker volume create "$VOLUME" >/dev/null
start() {
  docker run -d --name "$CONTAINER" -v "$VOLUME:/app/data" -e FAMILY_HQ_DB_PATH=/app/data/family-hq.sqlite "$IMAGE" >/dev/null
  attempt=0
  until docker exec "$CONTAINER" node -e "fetch('http://127.0.0.1:3080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 30 ]; then docker logs "$CONTAINER"; exit 1; fi
    sleep 1
  done
}
start
docker exec "$CONTAINER" node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/app/data/family-hq.sqlite");if(d.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n!==2)process.exit(1);d.prepare("INSERT INTO children (id,name) VALUES (?,?)").run("probe","Probe");d.close()'
docker container rm -f "$CONTAINER" >/dev/null
start
docker exec "$CONTAINER" node -e 'const {DatabaseSync}=require("node:sqlite");const d=new DatabaseSync("/app/data/family-hq.sqlite");if(d.prepare("SELECT name FROM children WHERE id=?").get("probe")?.name!=="Probe")process.exit(1);if(d.prepare("PRAGMA integrity_check").get().integrity_check!=="ok")process.exit(2);d.close()'
echo "Docker persistence checks passed."
