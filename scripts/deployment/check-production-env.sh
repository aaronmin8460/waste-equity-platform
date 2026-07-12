#!/usr/bin/env bash
# Validate a production env file before deployment.
#
# Fails (non-zero) on missing required variables, a development-default or
# placeholder database password, a weak password, a non-production APP_ENV, or a
# non-same-origin frontend API base. Never prints secret values.
#
# Usage: scripts/deployment/check-production-env.sh [path/to/.env.production]
set -euo pipefail

ENV_FILE="${1:-.env.production}"
FAIL=0
err() { echo "  ✗ $*" >&2; FAIL=1; }
ok()  { echo "  ✓ $*"; }

echo "Checking production environment: ${ENV_FILE}"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "  ✗ env file not found: ${ENV_FILE}" >&2
  echo "    Create it from .env.production.example." >&2
  exit 1
fi

# Load without exporting to the surrounding shell/log.
set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

# --- required variables present and non-empty ---
for var in PUBLIC_DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB APP_ENV; do
  if [[ -z "${!var:-}" ]]; then
    err "${var} is required but empty/unset"
  else
    ok "${var} is set"
  fi
done

# --- APP_ENV must be production ---
if [[ "${APP_ENV:-}" != "production" ]]; then
  err "APP_ENV must be 'production' (got '${APP_ENV:-}')"
fi

# --- reject weak / default / placeholder database password (value never printed) ---
WEAK_PASSWORDS=("waste_equity" "REPLACE_WITH_STRONG_PASSWORD" "postgres" "password" "changeme" "CHANGE_ME")
for weak in "${WEAK_PASSWORDS[@]}"; do
  if [[ "${POSTGRES_PASSWORD:-}" == "${weak}" ]]; then
    err "POSTGRES_PASSWORD is a development-default/placeholder value — generate one: openssl rand -base64 36"
    break
  fi
done
if [[ -n "${POSTGRES_PASSWORD:-}" && ${#POSTGRES_PASSWORD} -lt 16 ]]; then
  err "POSTGRES_PASSWORD is too short (< 16 chars); generate a strong one: openssl rand -base64 36"
fi

# --- discourage the dev database user in production ---
if [[ "${POSTGRES_USER:-}" == "waste_equity" ]]; then
  echo "  ! POSTGRES_USER is the development default 'waste_equity'; a dedicated prod user is recommended." >&2
fi

# --- frontend API base must be same-origin (empty), never an internal host or localhost ---
BASE="${NEXT_PUBLIC_API_BASE_URL:-}"
if [[ -n "${BASE}" ]]; then
  if [[ "${BASE}" == *"localhost"* || "${BASE}" == *"backend:"* || "${BASE}" == *"127.0.0.1"* ]]; then
    err "NEXT_PUBLIC_API_BASE_URL must be empty (same-origin) in production, not '${BASE}'"
  fi
else
  ok "NEXT_PUBLIC_API_BASE_URL is empty (same-origin)"
fi

# --- PostgreSQL must not be published in the production compose ---
if grep -qE '^\s*-\s*"?5432:5432' docker-compose.prod.yml 2>/dev/null; then
  err "docker-compose.prod.yml publishes 5432 — PostgreSQL must never be exposed publicly"
else
  ok "docker-compose.prod.yml does not publish 5432"
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo "Production environment check FAILED." >&2
  exit 1
fi
echo "Production environment check passed."
