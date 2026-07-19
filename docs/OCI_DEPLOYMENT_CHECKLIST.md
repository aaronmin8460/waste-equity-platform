# OCI deployment checklist — facility cost release

**Status: NOT EXECUTED.** This is a manual, reviewed procedure. It contains **no
secrets** and must **not** be run as part of the development task. Run it only from
a maintainer's machine with confirmed OCI access, after the release PR is merged.

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
apply automatically on the standard build+up — there is no manual migration step
and no data backfill.

## Preconditions

- The release PR is squash-merged; local `main == origin/main`.
- OCI host: `161.33.2.143`, public site `https://waste-161-33-2-143.sslip.io`
  (compose project cloned from prod). SSH key: `~/.ssh/oci_waste_equity`.
- The AWS/EC2 environment is left as an untouched rollback and is **not** touched here.

## Steps (exact commands, non-executed)

### 1. Confirm a clean release on `main` (local)
```
git checkout main && git pull --ff-only origin main
git status                      # must be clean
git rev-parse main              # RECORD this release SHA
```

### 2. Back up the current database and environment (on OCI, before any change)
```
ssh -i ~/.ssh/oci_waste_equity <user>@161.33.2.143
cd <deploy-dir>
# Timestamped logical backup of the current DB (never overwrite an existing file):
docker compose -f docker-compose.prod.yml exec -T database \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > ~/backups/waste_equity_$(date +%Y%m%d_%H%M%S).sql
# Keep a copy of the current env file aside (do NOT edit it):
cp .env.production ~/backups/.env.production.$(date +%Y%m%d_%H%M%S)
```

### 3. Fetch and inspect the release (on OCI)
```
git fetch origin
git log --oneline -5 origin/main          # confirm the recorded release SHA is HEAD
git checkout main && git pull --ff-only origin main
git rev-parse main                         # must equal the SHA recorded in step 1
cat .env.production >/dev/null             # confirm present; do NOT modify secrets/env
```

### 4. Build images
```
docker compose -f docker-compose.prod.yml build
```

### 5. Restart services WITHOUT deleting volumes (applies the migration + seed)
```
# The backend command runs `alembic upgrade head` on startup, which applies
# migration 0015 and idempotently seeds capex-standard-v2022dec.
# NEVER use `down -v`; never delete/recreate the pgdata / caddy_data / caddy_config
# volumes or the internal network.
docker compose -f docker-compose.prod.yml up -d --build
```

### 6. Verify the migration + seed applied
```
docker compose -f docker-compose.prod.yml exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version_num FROM alembic_version;"   # expect 0015
docker compose -f docker-compose.prod.yml exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM facility_standard_costs WHERE cost_version='capex-standard-v2022dec';"  # expect 15
# Spot-check a value survived: sorting_auto (30,40] → 3.45.
docker compose -f docker-compose.prod.yml exec -T database \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT cost_per_capacity_bn FROM facility_standard_costs WHERE facility_type='sorting_auto' AND capacity_min_ton_per_day=30;"  # expect 3.450000
```

### 7. Verify health (the app exposes `/health`; there is no separate `/ready`)
```
docker compose -f docker-compose.prod.yml exec -T backend \
  python -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8000/health').status)"   # expect 200
```

### 8. Verify the facility-cost endpoints (through the public origin)
```
curl -fsS https://waste-161-33-2-143.sslip.io/api/v1/facility-cost/standards | head -c 400   # count:15, capex-standard-v2022dec
curl -fsS https://waste-161-33-2-143.sslip.io/api/v1/facility-cost/options   | head -c 400
# A calculate over real service regions returns exact decimal strings + is_partial=true,
# or a structured 404/422 when the official inputs are missing (never fabricated 0s).
```

### 9. Verify the website + mobile behavior
- Load `https://waste-161-33-2-143.sslip.io`; exercise 형평성 · 적합성 점수 · **비용 렌즈** · 수도권매립지.
- In the cost lens: pick a service region, run a calculation, confirm the standard-cost
  result + completeness (unavailable components shown, never 0; no 총비용).
- On a phone width: single-column controls, no horizontal scroll, map visible, charts + cost results readable.

### 10. Verify logs
```
docker compose -f docker-compose.prod.yml logs --since 10m backend | grep -iE "error|traceback" || echo "no errors"
docker compose -f docker-compose.prod.yml ps            # all services Up/healthy
```

## Rollback

Migration 0015 is additive, so a code rollback needs no DB change (the extra table
is harmless to older code). To roll the code back:
```
git checkout <previous-release-SHA>
docker compose -f docker-compose.prod.yml up -d --build
```
Only if the table itself must be removed (rare):
```
docker compose -f docker-compose.prod.yml run --rm backend alembic downgrade 0014
```

## Restore (from the step-2 backup, only if data is corrupted)
```
# Restart services WITHOUT deleting volumes first; then restore into the running DB:
cat ~/backups/waste_equity_<timestamp>.sql | \
  docker compose -f docker-compose.prod.yml exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
```

## Hard prohibitions
- Never `docker compose down -v`; never delete/recreate the `pgdata`, `caddy_data`,
  `caddy_config` volumes or the internal network.
- Never modify production secrets or `.env.production`.
- Never run destructive production database commands.
- Never force-push to `main` or use an administrator merge override.
