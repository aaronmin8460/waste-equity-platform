#!/usr/bin/env bash
# Deploy (or update) the production application stack.
#
# Order: validate env -> optionally checkout a Git ref -> build images -> start
# database and wait healthy -> start backend (runs `alembic upgrade head`),
# frontend, caddy -> wait for health -> smoke test -> print deployed Git SHA.
#
# This script NEVER ingests public data and NEVER restores a database dump (use
# restore-production-database.sh explicitly for a one-time data load).
#
# Usage:
#   scripts/deployment/deploy.sh [--ref GIT_REF] [--env-file .env.production] \
#     [--compose-file docker-compose.prod.yml] [--project waste-equity-prod] \
#     [--base-url URL] [--insecure] [--expect-data]
set -euo pipefail
cd "$(dirname "$0")/../.."

REF="" ; ENV_FILE=".env.production" ; COMPOSE_FILE="docker-compose.prod.yml"
PROJECT="waste-equity-prod" ; SMOKE_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ref) REF="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --base-url) SMOKE_ARGS+=(--base-url "$2"); shift 2 ;;
    --insecure) SMOKE_ARGS+=(--insecure); shift ;;
    --expect-data) SMOKE_ARGS+=(--expect-data); shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

echo "== 1/7 validate production environment =="
scripts/deployment/check-production-env.sh "${ENV_FILE}"

if [[ -n "${REF}" ]]; then
  echo "== checkout ${REF} =="
  git fetch --all --tags
  git checkout "${REF}"
fi
DEPLOY_SHA="$(git rev-parse HEAD)"

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")

echo "== 2/7 build production images =="
"${COMPOSE[@]}" build

echo "== 3/7 start database and wait for health =="
"${COMPOSE[@]}" up -d database
for _ in $(seq 1 30); do
  state="$("${COMPOSE[@]}" ps database --format '{{.Health}}' 2>/dev/null || true)"
  [[ "${state}" == "healthy" ]] && break
  sleep 3
done
[[ "$("${COMPOSE[@]}" ps database --format '{{.Health}}')" == "healthy" ]] \
  || { echo "✗ database did not become healthy" >&2; exit 1; }

echo "== 4/7 start backend (migrations run on start), frontend, caddy =="
"${COMPOSE[@]}" up -d backend frontend caddy

echo "== 5/7 wait for backend health =="
for _ in $(seq 1 40); do
  state="$("${COMPOSE[@]}" ps backend --format '{{.Health}}' 2>/dev/null || true)"
  [[ "${state}" == "healthy" ]] && break
  sleep 3
done
[[ "$("${COMPOSE[@]}" ps backend --format '{{.Health}}')" == "healthy" ]] \
  || { echo "✗ backend did not become healthy" >&2; "${COMPOSE[@]}" logs --tail 40 backend; exit 1; }

echo "== 6/7 smoke test =="
# shellcheck disable=SC1090
set -a; source "${ENV_FILE}"; set +a
scripts/deployment/smoke-test.sh "${SMOKE_ARGS[@]}"

echo "== 7/7 done =="
echo "Deployed Git SHA: ${DEPLOY_SHA}"
"${COMPOSE[@]}" ps
