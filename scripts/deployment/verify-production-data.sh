#!/usr/bin/env bash
# Verify the production database contains the expected initial deployment data.
#
# The EXPECTED values are the exact counts for the FIRST deployment (the local
# Phase 5 dataset). A future public-data refresh will legitimately change some of
# them: run with --allow-drift to WARN on mismatches instead of failing.
#
# Portable to bash 3.2 (macOS) and bash 5 (Ubuntu) — no associative arrays.
#
# Usage:
#   scripts/deployment/verify-production-data.sh \
#     [--compose-file docker-compose.prod.yml] [--project waste-equity-prod] \
#     [--env-file .env.production] [--allow-drift]
set -euo pipefail
cd "$(dirname "$0")/../.."

COMPOSE_FILE="docker-compose.prod.yml"
PROJECT="waste-equity-prod"
ENV_FILE=".env.production"
ALLOW_DRIFT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    --project) PROJECT="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --allow-drift) ALLOW_DRIFT=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Parallel arrays (bash-3.2 compatible): metric | expected | SQL.
METRICS=(regions population waste_statistics facilities zoning protected roads \
         suitability_candidates eligible review excluded)
EXPECTED=(82 82 234 651 88252 20892 2971494 47893 1099 34534 12260)
QUERIES=(
  "SELECT count(*) FROM regions;"
  "SELECT count(*) FROM regional_population;"
  "SELECT count(*) FROM regional_waste_statistics;"
  "SELECT count(*) FROM waste_treatment_facilities;"
  "SELECT count(*) FROM structural_features;"
  "SELECT count(*) FROM structural_protected_features;"
  "SELECT count(*) FROM structural_line_features;"
  "SELECT count(*) FROM suitability_candidates;"
  "SELECT count(*) FROM suitability_candidates WHERE status='ELIGIBLE';"
  "SELECT count(*) FROM suitability_candidates WHERE status='REVIEW_REQUIRED';"
  "SELECT count(*) FROM suitability_candidates WHERE status='EXCLUDED';"
)

COMPOSE=(docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}")
[[ -f "${ENV_FILE}" ]] && COMPOSE+=(--env-file "${ENV_FILE}")
DB_USER="waste_equity"; DB_NAME="waste_equity"
if [[ -f "${ENV_FILE}" ]]; then
  set -a; # shellcheck disable=SC1090
  source "${ENV_FILE}"; set +a
  DB_USER="${POSTGRES_USER:-${DB_USER}}"; DB_NAME="${POSTGRES_DB:-${DB_NAME}}"
fi

q() { "${COMPOSE[@]}" exec -T database psql -U "${DB_USER}" -d "${DB_NAME}" -tA -c "$1" 2>/dev/null | tr -d '[:space:]'; }

echo "Production data verification (project '${PROJECT}', db '${DB_NAME}')"
printf "  %-24s %-12s %-12s %s\n" "metric" "expected" "actual" "status"
FAIL=0
i=0
while [[ $i -lt ${#METRICS[@]} ]]; do
  key="${METRICS[$i]}"; exp="${EXPECTED[$i]}"
  act="$(q "${QUERIES[$i]}")"; act="${act:-MISSING}"
  if [[ "${act}" == "${exp}" ]]; then st="OK";
  else st="DIFF"; [[ "${ALLOW_DRIFT}" -eq 1 ]] || FAIL=1; fi
  printf "  %-24s %-12s %-12s %s\n" "${key}" "${exp}" "${act}" "${st}"
  i=$((i + 1))
done

# suitability_analysis_runs >= 1
SUIT_RUNS="$(q 'SELECT count(*) FROM suitability_analysis_runs;')"
if [[ "${SUIT_RUNS:-0}" =~ ^[0-9]+$ && "${SUIT_RUNS}" -ge 1 ]]; then
  printf "  %-24s %-12s %-12s %s\n" "suitability_runs" ">=1" "${SUIT_RUNS}" "OK"
else
  printf "  %-24s %-12s %-12s %s\n" "suitability_runs" ">=1" "${SUIT_RUNS:-0}" "DIFF"
  [[ "${ALLOW_DRIFT}" -eq 1 ]] || FAIL=1
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo "✗ data verification found mismatches (use --allow-drift after an intentional refresh)." >&2
  exit 1
fi
echo "✓ all expected counts match the initial deployment dataset."
