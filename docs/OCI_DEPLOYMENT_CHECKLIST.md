# OCI deployment checklist — facility cost release

**Status: NOT EXECUTED.** This is a manual, reviewed procedure. It contains **no
secrets** and must **not** be run as part of the development task. Run it only from
a maintainer's machine with confirmed OCI access, after the release PR is merged.

This checklist drives the deployment through the repository's **existing, reviewed
scripts** (`scripts/deployment/*.sh`) and the established Compose conventions from
`docs/OPERATIONS_RUNBOOK.md` — it does not hand-roll compose/`pg_dump`/`pg_restore`
invocations. The production Compose stack is the project **`waste-equity-prod`**,
file `docker-compose.prod.yml`, with `--env-file .env.production`; every raw
`docker compose` call below therefore uses that project and env file (via the `dcp`
alias). Omitting them would fail variable interpolation or, worse, silently target a
**different** project with **separate volumes** — not the live stack.

```bash
# Establish the runbook alias once per shell before any raw compose command below.
alias dcp='docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production'
```

## What this release adds

- Accessibility foundation (lang, skip link, live regions, fieldsets, map alternatives).
- Map & dashboard readability (region hover/tap tooltip, legend ranges, chart axes + table fallback).
- **Facility cost backend V1** — migration **0015** (`facility_standard_costs` + the
  idempotent `capex-standard-v2022dec` seed) and the read-only
  `/api/v1/facility-cost/{standards,options,calculate}` API.
- Citizen-facing facility cost lens (frontend).

**Migration 0015 is purely additive** (a new reference table + its seed); it does
not alter or drop any existing table, and existing row counts are unchanged. The
backend container runs `alembic upgrade head` on startup, so the migration and seed
apply automatically on the standard `deploy.sh` build+up — there is no manual
migration step and no data backfill.

## Preconditions

- The release PR is squash-merged; local `main == origin/main`.
- OCI host: `161.33.2.143`, public site `https://waste-161-33-2-143.sslip.io`
  (compose project `waste-equity-prod`, cloned from prod). SSH key: `~/.ssh/oci_waste_equity`.
- The AWS/EC2 environment is left as an untouched rollback and is **not** touched here.

## Steps (exact commands, non-executed)

### 1. Confirm a clean release on `main` (local)
```bash
git checkout main && git pull --ff-only origin main
git status                      # must be clean
git rev-parse main              # RECORD this release SHA
```

### 2. Back up the current database and environment (on OCI, before any change)
```bash
ssh -i ~/.ssh/oci_waste_equity <user>@161.33.2.143
cd <deploy-dir>
alias dcp='docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production'

# Custom-format logical backup into ./backups (Git-ignored). Custom format is what
# scripts/deployment/restore-production-database.sh consumes if a restore is needed.
mkdir -p backups
dcp exec -T database pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > backups/prod_$(date +%Y%m%d_%H%M%S).dump
# Keep a copy of the current env file aside (do NOT edit it):
cp .env.production ~/backups/.env.production.$(date +%Y%m%d_%H%M%S)
```
Copy the dump **off the instance** (per the runbook) and treat it as sensitive.

### 3. Fetch and inspect the release (on OCI)
```bash
git fetch --all --tags
git log --oneline -5 origin/main          # confirm the recorded release SHA is HEAD
git checkout main && git pull --ff-only origin main
git rev-parse main                         # must equal the SHA recorded in step 1
./scripts/deployment/check-production-env.sh .env.production   # validate env; secrets never printed
```

### 4. Deploy through the reviewed deploy script (build + migrate + health + smoke)
```bash
# deploy.sh targets project waste-equity-prod / --env-file .env.production by default,
# builds images, applies `alembic upgrade head` on backend start (migration 0015 +
# idempotent capex-standard-v2022dec seed), waits for health, and smoke-tests.
# It never ingests data and never restores a dump.
./scripts/deployment/deploy.sh --ref "$(git rev-parse main)" --env-file .env.production \
  --base-url https://waste-161-33-2-143.sslip.io --expect-data
# Record the deployed Git SHA that the script prints; it must equal step 1's SHA.
```

### 5. Verify the migration + seed applied (release-specific)
```bash
dcp exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version_num FROM alembic_version;"   # expect 0015
dcp exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM facility_standard_costs WHERE cost_version='capex-standard-v2022dec';"  # expect 15
# Spot-check a value survived: sorting_auto (30,40] → 3.45.
dcp exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT cost_per_capacity_bn FROM facility_standard_costs WHERE facility_type='sorting_auto' AND capacity_min_ton_per_day=30;"  # expect 3.450000
```

### 6. Verify the facility-cost endpoints (through the public origin)
```bash
curl -fsS https://waste-161-33-2-143.sslip.io/api/v1/facility-cost/standards | head -c 400   # count:15, capex-standard-v2022dec
curl -fsS https://waste-161-33-2-143.sslip.io/api/v1/facility-cost/options   | head -c 400
# A calculate over real service regions returns exact decimal strings + is_partial=true,
# or a structured 404/422 when the official inputs are missing (never fabricated 0s).
```

### 7. Verify the website + mobile behavior
- Load `https://waste-161-33-2-143.sslip.io`; exercise 형평성 · 후보지 점수 · **비용 살펴보기** · 수도권매립지.
- In the cost lens: pick a service region, run a calculation, confirm the standard-cost
  result + completeness (unavailable components shown, never 0; no 총비용).
- On a phone width: single-column controls, no horizontal scroll, map visible, charts + cost results readable.

### 8. Verify data + logs
```bash
./scripts/deployment/verify-production-data.sh --env-file .env.production   # expected initial dataset intact
dcp logs --since 10m backend | grep -iE "error|traceback" || echo "no errors"
dcp ps            # all services Up/healthy
```

## Rollback

Migration 0015 is additive, so an application rollback needs **no** DB change (the
extra reference table is harmless to older code). Roll the application back through
the reviewed script, which stops rather than auto-downgrading the schema:
```bash
./scripts/deployment/rollback-app.sh --ref <previous-release-SHA> --env-file .env.production
```
Only if the table itself must be removed (rare), downgrade one revision — decide
deliberately, never auto-downgrade:
```bash
dcp run --rm backend alembic downgrade 0014
```

## Restore (only if data is corrupted)

Use the reviewed restore path — it is destructive, requires an explicit dump and
`--confirm-production`, **takes its own safety backup first**, and restores through
`pg_restore --clean --if-exists` (a clean, fail-fast recovery — never a plain
`psql` replay into a populated DB, which would leave a half-applied mix on the first
conflict):
```bash
./scripts/deployment/restore-production-database.sh \
  --dump backups/prod_<timestamp>.dump --confirm-production --env-file .env.production
./scripts/deployment/verify-production-data.sh --env-file .env.production
```

## Hard prohibitions
- Never `docker compose down -v`; never delete/recreate the `pgdata`, `caddy_data`,
  `caddy_config` volumes or the internal network.
- Never modify production secrets or `.env.production`.
- Never run destructive production database commands outside the reviewed
  `restore-production-database.sh` path above.
- Never force-push to `main` or use an administrator merge override.
