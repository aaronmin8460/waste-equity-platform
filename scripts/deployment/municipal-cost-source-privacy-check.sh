#!/usr/bin/env bash
#
# Prove the private municipal-cost source data is not exposed.
#
# The 2024 workbooks are information-disclosure responses, not open data. They
# are ingestion inputs only: never committed, never inside the Docker build
# context, never served, never named by an absolute path in an API payload. This
# script asserts all of that mechanically instead of trusting a checklist tick.
#
# Every check is read-only: `git ls-files`, `find`, `stat`, `docker inspect`,
# and GET requests. Nothing is deleted, moved, or chmod'ed — a wrong permission
# is reported for a human to fix deliberately.
#
# Usage:
#   scripts/deployment/municipal-cost-source-privacy-check.sh \
#     [--private-dir /home/ubuntu/private/municipal-costs/2024] \
#     [--base-url https://example] [--insecure] [--skip-docker]
#
# Exit codes: 0 nothing exposed, 1 an exposure or a wrong permission, 2 usage error.

set -euo pipefail

PRIVATE_DIR=""
BASE_URL="${PUBLIC_DOMAIN:+https://${PUBLIC_DOMAIN}}"
INSECURE=0
SKIP_DOCKER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --private-dir) PRIVATE_DIR="$2"; shift 2 ;;
    --base-url) BASE_URL="$2"; shift 2 ;;
    --insecure) INSECURE=1; shift ;;
    --skip-docker) SKIP_DOCKER=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
ok()  { echo "  ✓ $*"; }
bad() { echo "  ✗ $*" >&2; FAIL=1; }

echo "Municipal-cost source privacy check (repo: ${REPO_ROOT})"

# --- 1. nothing private is tracked by Git -----------------------------------
TRACKED="$(git ls-files | grep -icE '\.(xlsx|xls|zip|dump)$' || true)"
if [[ "$TRACKED" == "0" ]]; then
  ok "no workbook / archive / dump is tracked by Git"
else
  bad "${TRACKED} private-format file(s) are tracked by Git:"
  git ls-files | grep -iE '\.(xlsx|xls|zip|dump)$' | head -20 >&2
fi

TRACKED_MUNI="$(git ls-files | grep -c '^data/import/municipal-costs/\|^artifacts/municipal-costs/' || true)"
if [[ "$TRACKED_MUNI" == "0" ]]; then
  ok "no file under data/import/municipal-costs/ or artifacts/municipal-costs/ is tracked"
else
  bad "${TRACKED_MUNI} private municipal path(s) are tracked by Git"
fi

# --- 2. the ignore rules that keep it that way still exist -------------------
for path in data/import/municipal-costs/probe.xlsx artifacts/municipal-costs/probe.json \
            data/raw/municipal-costs/probe.xlsx backups/probe.dump; do
  if git check-ignore -q "$path"; then
    ok "${path%/*}/ is Git-ignored"
  else
    bad "${path%/*}/ is NOT Git-ignored — a workbook dropped there would be committable"
  fi
done

# --- 3. no private file is sitting inside the checkout ----------------------
STRAY="$(find . -path ./.git -prune -o -type f \
  \( -iname '*.xlsx' -o -iname '*.xls' -o -iname '*.zip' -o -iname '*.dump' \) -print 2>/dev/null \
  | grep -v '/node_modules/' | grep -v '/\.venv/' | head -20 || true)"
if [[ -z "$STRAY" ]]; then
  ok "no workbook / archive / dump exists anywhere in the checkout"
else
  bad "private-format file(s) present inside the checkout (also inside the Docker build context):"
  echo "$STRAY" >&2
fi

# --- 4. the reverse proxy serves no files -----------------------------------
if [[ -f deploy/Caddyfile ]]; then
  if grep -qE '^\s*(file_server|root)\b' deploy/Caddyfile; then
    bad "deploy/Caddyfile contains a file_server/root directive — static exposure is possible"
  else
    ok "deploy/Caddyfile defines no file_server and no root (reverse proxy only)"
  fi
fi

# --- 5. the private directory is outside Git and unreadable to others -------
if [[ -n "$PRIVATE_DIR" ]]; then
  if [[ ! -d "$PRIVATE_DIR" ]]; then
    bad "private directory not found: ${PRIVATE_DIR}"
  else
    ABS_PRIVATE="$(cd "$PRIVATE_DIR" && pwd -P)"
    case "$ABS_PRIVATE/" in
      "$REPO_ROOT"/*) bad "private directory ${ABS_PRIVATE} is INSIDE the Git checkout" ;;
      *) ok "private directory is outside the Git checkout" ;;
    esac

    # stat(1) differs between GNU and BSD; try GNU first.
    mode_of() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

    BAD_DIRS="$(find "$ABS_PRIVATE" -type d ! -perm 700 2>/dev/null | head -5)"
    if [[ -z "$BAD_DIRS" ]]; then ok "every directory under the private root is mode 700"
    else bad "directories not mode 700:"; echo "$BAD_DIRS" >&2; fi

    BAD_FILES="$(find "$ABS_PRIVATE" -type f ! -perm 600 2>/dev/null | head -5)"
    if [[ -z "$BAD_FILES" ]]; then ok "every file under the private root is mode 600"
    else bad "files not mode 600:"; echo "$BAD_FILES" >&2; fi

    echo "  · private root mode: $(mode_of "$ABS_PRIVATE"), owner: $(ls -ld "$ABS_PRIVATE" | awk '{print $3}')"
    echo "  · workbook count: $(find "$ABS_PRIVATE" -type f -iname '*.xlsx' | wc -l | tr -d ' ')"
  fi
fi

# --- 6. no long-lived container keeps the private data mounted --------------
if [[ "$SKIP_DOCKER" -eq 0 ]] && command -v docker >/dev/null 2>&1 && [[ -n "$PRIVATE_DIR" ]]; then
  MOUNTED=""
  for container in $(docker ps -q); do
    if docker inspect -f '{{range .Mounts}}{{.Source}} {{end}}' "$container" 2>/dev/null \
         | grep -q "$PRIVATE_DIR"; then
      MOUNTED="${MOUNTED} $(docker inspect -f '{{.Name}}' "$container")"
    fi
  done
  if [[ -z "$MOUNTED" ]]; then
    ok "no running container mounts the private source directory"
  else
    bad "running container(s) still mount the private source:${MOUNTED}"
  fi
fi

# --- 7. nothing private is reachable over HTTP ------------------------------
if [[ -n "$BASE_URL" ]]; then
  CURL=(curl -sS --max-time 20)
  [[ "$INSECURE" -eq 1 ]] && CURL+=(-k)
  for path in /data/ /data/import/municipal-costs/2024/ /municipal-costs/ \
              /private/municipal-costs/2024/ /backups/ /artifacts/municipal-costs/; do
    CODE="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "${BASE_URL}${path}" || echo 000)"
    CTYPE="$("${CURL[@]}" -o /dev/null -w '%{content_type}' "${BASE_URL}${path}" || echo unknown)"
    if [[ "$CODE" == "404" || "$CODE" == "403" ]]; then
      ok "${path} → ${CODE} (not served)"
    else
      bad "${path} → ${CODE} content-type=${CTYPE} — expected 404/403"
    fi
    case "$CTYPE" in
      *spreadsheetml*|*application/zip*|*octet-stream*)
        bad "${path} returned a file content-type (${CTYPE})" ;;
    esac
  done

  # The citizen-facing payload may name a workbook as provenance, but must never
  # disclose where it lives on disk.
  BODY="$("${CURL[@]}" "${BASE_URL}/api/v1/landfill/municipal-costs?year=2024" || true)"
  if [[ -n "$BODY" ]]; then
    if echo "$BODY" | grep -qE '/home/|/Users/|/srv/|/root/'; then
      bad "the municipal-cost payload discloses an absolute filesystem path"
    else
      ok "the municipal-cost payload discloses no absolute filesystem path"
    fi
  fi
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo "✗ source privacy check FAILED — treat every finding above as a hard no-go." >&2
  exit 1
fi
echo "✓ private municipal source is untracked, unmounted, and unreachable."
