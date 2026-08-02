# Operations Runbook (Phase 5.5)

Day-2 operations for the single-server production deployment. See
`docs/DEPLOYMENT.md` for the first-time server bootstrap.

Conventions: all commands run from the repo root on the server. The compose
project is `waste-equity-prod` and the file is `docker-compose.prod.yml` with
`--env-file .env.production`. A shell alias helps:

```bash
alias dcp='docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production'
```

## Health & status

```bash
dcp ps                         # container + health status
dcp logs --tail 100 backend    # backend logs
dcp logs --tail 100 caddy      # proxy / TLS logs
curl -fsS https://${PUBLIC_DOMAIN}/health   # {"status":"ok","database":"ok",...}
./scripts/deployment/smoke-test.sh --base-url https://${PUBLIC_DOMAIN} --expect-data
./scripts/deployment/verify-production-data.sh --env-file .env.production
```

## Deploy an update (new commit/tag)

```bash
git fetch --all --tags
./scripts/deployment/deploy.sh --ref <git-sha-or-tag> --env-file .env.production \
  --base-url https://${PUBLIC_DOMAIN} --expect-data
```

`deploy.sh` validates the env, builds images, applies migrations on backend
start (`alembic upgrade head`), waits for health, and smoke-tests. It never
ingests data and never restores a dump. Record the printed deployed Git SHA.

## Roll the application back

Rolls back **application images/commit only** — never the database schema.

```bash
./scripts/deployment/rollback-app.sh --ref <previous-git-sha> --env-file .env.production
```

If the target revision predates a migration already applied to the live
database, the script **stops** rather than downgrading the schema. In that case,
either roll the schema forward (deploy a compatible newer app) or restore from a
pre-change backup (below) — decide deliberately, do not auto-downgrade.

## Backups

### On-server database backup (before any risky change)

```bash
# custom-format dump into ./backups (Git-ignored)
dcp exec -T database pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > backups/prod_$(date +%Y%m%d_%H%M%S).dump
```

Copy the dump **off the instance** (e.g. `scp` to a workstation or a private S3
bucket). Prune per `BACKUP_RETENTION_DAYS`. Backups may contain the full dataset
— treat them as sensitive; store encrypted at rest where possible. Never commit
a dump.

### Instance snapshots

Enable Lightsail automatic snapshots (whole-instance point-in-time recovery) in
addition to logical `pg_dump` backups.

## Restore the database

Destructive; requires explicit flags and takes a safety backup first:

```bash
./scripts/deployment/restore-production-database.sh \
  --dump backups/prod_YYYYMMDD_HHMMSS.dump --confirm-production --env-file .env.production
./scripts/deployment/verify-production-data.sh --env-file .env.production
```

## Land-cover derived statistics (Phase 1B-LC8)

The public land-cover services are served from **derived** data only. The raw
source-feature tables (`environmental_land_cover_features`,
`environmental_land_cover_map_sheets`) are intentionally **empty in production** and must
stay that way: no public runtime path reads them, and original SHP files and raw source
polygons are not redistributed.

Publication rests on `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` — a project-level
authorization from the cooperating government institution, **not** an EGIS licence
confirmation or a KOGL type. See
[PUBLIC_DATA_PROJECT_AUTHORIZATION.md](PUBLIC_DATA_PROJECT_AUTHORIZATION.md).

```bash
# What is live right now
dcp exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select id, derivation_version, is_active, expected_cell_count, class_row_count
     from environmental_land_cover_cell_stat_versions order by id"

# These two MUST be 0 in production
dcp exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "select (select count(*) from environmental_land_cover_features),
          (select count(*) from environmental_land_cover_map_sheets)"
```

**Loading or re-loading a release** (idempotent; safe to re-run — it inserts zero logical
rows when the package is already present):

```bash
COMPOSE_PROJECT=waste-equity-prod DB_USER="$POSTGRES_USER" DB_NAME="$POSTGRES_DB" \
  scripts/deploy/import-land-cover-derived-package.sh ~/lc8-package
```

The importer runs in ONE transaction and refuses — rolling everything back — if the
production candidate-grid fingerprint, the candidate-key set, the per-cell geometry
fingerprints, the row counts, the coverage-state counts, or the content checksums differ
from the package, or if any raw source row is present.

**Turning the public land-cover feature off** without touching anything else (every
land-cover endpoint then returns a structured 404 and the map layer disables itself):

```bash
dcp exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -c \
  "UPDATE environmental_land_cover_cell_stat_versions SET is_active = false WHERE id = 1;"
```

Re-enable with `is_active = true`. Never delete the rows to disable the feature.

**Known performance caveat.** The worst-case zoom-7 tile (the one covering most of the
capital region) is ~3.7 MB and takes ~2 s; it is version-pinned and cached one year
immutable, and `If-None-Match` revalidation returns 304. MVT responses are currently sent
uncompressed. Measured, documented, and deliberately not changed during deployment — see
[LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md](LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md) §13.

## Data refresh (future)

Public-data ingestion is **not** part of this phase and is not automated here.
When a refresh is intentionally performed later, run the appropriate ingestion /
`suitability-build` command via the `ingestion` profile against the database,
back up first, and re-verify with `--allow-drift` (counts will change):

```bash
dcp --profile ingestion run --rm ingestion \
  python -m waste_equity_ingestion.cli suitability-build \
  --reference-year 2024 --profile baseline --scope capital-region --write
```

Do not do this during the demonstration deployment unless explicitly requested.

## Logs & rotation

Container stdout/stderr use the Docker `json-file` driver with `max-size=10m`,
`max-file=5` (configured in `docker-compose.prod.yml`) — bounded disk use. Caddy
writes JSON access logs to stdout (captured the same way). Inspect with
`dcp logs <service>`.

## Security updates

```bash
sudo apt update && sudo apt upgrade -y          # OS packages
docker compose -p waste-equity-prod -f docker-compose.prod.yml pull   # base images (caddy, postgis)
./scripts/deployment/deploy.sh --env-file .env.production              # rebuild app images + restart
```

Rebuild the app images periodically to pick up base-image (Node/Python) security
fixes. Rotate `POSTGRES_PASSWORD` on a schedule: back up, change it in
`.env.production` and in the database role, then redeploy.

## TLS / certificate

Caddy renews Let's Encrypt certificates automatically (persisted in the
`caddy_data` volume). If issuance fails, check that DNS points at the server and
ports 80/443 are open, then `dcp logs caddy`.

## Restart / recover

```bash
dcp restart backend            # restart a single service
dcp up -d                      # reconcile the stack to the compose file
```

Never run `docker compose down -v` against the production project — it would
delete the database volume. Use `dcp stop` / `dcp start` to pause/resume.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| 502 from the domain | `dcp ps` (backend/frontend healthy?), `dcp logs backend` |
| No HTTPS / cert error | DNS A record → server IP? ports 80/443 open? `dcp logs caddy` |
| `/health` shows `database: unavailable` | `dcp logs database`; is the volume intact? |
| Wrong data counts | `verify-production-data.sh`; restore from backup if needed |
| Suitability empty | run/candidates present? `verify-production-data.sh`; restore the dump |
| Migrations failed on deploy | `dcp logs backend`; a bad migration → restore + fix forward |

## Incident stop conditions

Stop and investigate (do not auto-repair data) if: the DB volume is missing or
corrupt, a migration fails mid-deploy, a restore reports mismatched counts, or
5432/8000/3000 are found published. Preserve the current state and take a
backup/snapshot before any destructive action.
