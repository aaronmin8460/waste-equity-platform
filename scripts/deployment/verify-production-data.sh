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

# --- RCIS waste reporting geography (migration 0012) ---------------------------
# Additive tables. The native region/waste/suitability counts above are the same
# as before this change; these are the new expected values, derived from the
# verified local post-change database. NTN018 legitimately omits the two counties
# 인천 옹진군 and 경기 연천군 for the industrial-facility stream (SOURCE_NOT_REPORTED);
# every other check must be exact regardless of a data refresh.
RG_METRICS=(reporting_regions reporting_members reporting_waste \
            reporting_ntn007 reporting_ntn008 reporting_ntn018 reporting_ntn022 \
            ntn018_native_omissions dup_city_stats city_stats_on_child \
            invalid_derived_geom child_in_two_cities)
RG_EXPECTED=(7 20 28 7 7 7 7 2 0 0 0 0)
RG_QUERIES=(
  "SELECT count(*) FROM waste_reporting_regions;"
  "SELECT count(*) FROM waste_reporting_region_members;"
  "SELECT count(*) FROM reporting_region_waste_statistics;"
  "SELECT count(*) FROM reporting_region_waste_statistics WHERE source_pid='NTN007';"
  "SELECT count(*) FROM reporting_region_waste_statistics WHERE source_pid='NTN008';"
  "SELECT count(*) FROM reporting_region_waste_statistics WHERE source_pid='NTN018';"
  "SELECT count(*) FROM reporting_region_waste_statistics WHERE source_pid='NTN022';"
  "SELECT count(*) FROM regions r WHERE r.id IN (SELECT region_id FROM regional_waste_statistics WHERE source_pid='NTN007') AND r.id NOT IN (SELECT region_id FROM regional_waste_statistics WHERE source_pid='NTN018');"
  "SELECT count(*) FROM (SELECT reporting_region_id, reference_year, source_pid, waste_category_name FROM reporting_region_waste_statistics GROUP BY 1,2,3,4 HAVING count(*)>1) d;"
  "SELECT count(*) FROM regional_waste_statistics WHERE region_id IN (SELECT child_region_id FROM waste_reporting_region_members);"
  "SELECT count(*) FROM waste_reporting_regions WHERE NOT ST_IsValid(geometry) OR ST_IsEmpty(geometry) OR ST_SRID(geometry)<>4326 OR GeometryType(geometry)<>'MULTIPOLYGON';"
  "SELECT count(*) FROM (SELECT child_region_id FROM waste_reporting_region_members GROUP BY child_region_id HAVING count(*)>1) d;"
)
j=0
while [[ $j -lt ${#RG_METRICS[@]} ]]; do
  key="${RG_METRICS[$j]}"; exp="${RG_EXPECTED[$j]}"
  act="$(q "${RG_QUERIES[$j]}")"; act="${act:-MISSING}"
  # The integrity checks (0-valued) are exact regardless of --allow-drift; the
  # count checks may drift on an intentional refresh.
  strict=0
  case "${key}" in
    dup_city_stats|city_stats_on_child|invalid_derived_geom|child_in_two_cities) strict=1 ;;
  esac
  if [[ "${act}" == "${exp}" ]]; then st="OK";
  else st="DIFF"; { [[ "${ALLOW_DRIFT}" -eq 1 && "${strict}" -eq 0 ]]; } || FAIL=1; fi
  printf "  %-24s %-12s %-12s %s\n" "${key}" "${exp}" "${act}" "${st}"
  j=$((j + 1))
done

if [[ "${FAIL}" -ne 0 ]]; then
  echo "✗ data verification found mismatches (use --allow-drift after an intentional refresh)." >&2
  exit 1
fi
echo "✓ all expected counts match the initial deployment dataset."
