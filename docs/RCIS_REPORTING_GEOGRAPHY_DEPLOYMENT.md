# RCIS Reporting Geography — Production Deployment Handoff

Handoff for deploying the source-compatible RCIS waste reporting geography to the
existing production stack. Follows `docs/DEPLOYMENT.md`, the
`docs/OPERATIONS_RUNBOOK.md` `dcp` alias, and the existing
backup / deploy / smoke-test / verify scripts. Uses the existing production
architecture unchanged (Caddy the only public service; 5432/8000/3000 private).

## 1. What is being deployed

- **Merged Git SHA**: `<MERGED_MAIN_SHA>` (the merge of
  `fix/rcis-reporting-geography` into `main`).
- **Required Alembic revision**: **`0012`** (`add RCIS metric reporting
  geography`). Purely additive — three new tables, no change to any existing
  table. If production is behind `main`, `alembic upgrade head` also applies any
  intervening additive revision (e.g. `0011` `is_active`); both are forward-safe.
- **New data**: 7 `waste_reporting_regions`, 20 `waste_reporting_region_members`,
  28 `reporting_region_waste_statistics` rows. Nothing else changes.

## 2. Deployment method — METHOD 2 (migration + in-place backfill)

**Recommended: application deploy + additive migration + in-place backfill.**
Not application-only (a backfill is required to populate the reporting tables);
not a full dump restore (that would also carry unrelated local-only data such as a
newer suitability run, which is out of scope for this change).

**Why**: migration `0012` is additive and forward-safe. The backfill
(`rcis-reporting-geography --write`) reads **only data already present in
production** — the SGIS child boundaries (`regions.geometry`) and the stored
sanitized raw RCIS responses (`raw_api_responses`) — to build the derived
`ST_Union` geometries and write the source-native city waste values. It performs
**no live external ingestion** and is idempotent (a second run writes nothing).

**Precondition (stop condition)**: production must contain the four PIDs' stored
raw RCIS responses (`raw_api_responses` where `endpoint_identifier LIKE
'wss/JsonApi/NTN0%'`) — 28 rows across NTN007/008/018/022 for 2024. Confirm in
preflight:

```bash
dcp exec -T database psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc \
  "SELECT count(*) FROM raw_api_responses WHERE source_id='waste_statistics' AND endpoint_identifier LIKE 'wss/JsonApi/NTN0%';"
```

If this is **not** ≥ 28, **stop** — do not deploy the empty reporting tables and
do not improvise a live production ingestion; record the blocker instead.

## 3. Pre-deployment production backup (mandatory)

On the production host, before any code, migration, or backfill:

```bash
alias dcp='docker compose -p waste-equity-prod -f docker-compose.prod.yml --env-file .env.production'
set -a; source .env.production; set +a
TS="$(date +%Y%m%d_%H%M%S)"
OUT="backups/pre_rcis_reporting_geography_prod_${TS}.dump"
dcp exec -T database pg_dump --format=custom --no-owner --no-privileges \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "$OUT"
dcp exec -T database pg_restore --list < "$OUT" | grep -c 'TABLE DATA'   # non-destructive verify
sha256sum "$OUT" 2>/dev/null || shasum -a 256 "$OUT"
du -h "$OUT"
```

Record the path and SHA-256. **Do not delete this backup.** If the dump or its
`pg_restore --list` verification fails, **stop** before deploying.

## 4. Deploy the merged SHA

```bash
cd ~/waste-equity-platform
git fetch --all --tags
./scripts/deployment/deploy.sh \
  --ref <MERGED_MAIN_SHA> \
  --env-file .env.production \
  --base-url https://waste-54-180-221-119.sslip.io \
  --expect-data
```

`deploy.sh` builds images, brings up the database, then brings up
backend/frontend/caddy. `alembic upgrade head` runs inside the backend container
start command (applies `0012`), then the backend serves. Do not bypass a
migration failure; do not modify `.env.production`, DNS, or ports.

## 5. In-place backfill (populates the reporting tables)

After the backend is healthy, run the idempotent offline backfill through the
existing `ingestion` compose profile:

```bash
dcp --profile ingestion run --rm ingestion \
  python -m waste_equity_ingestion.cli rcis-reporting-geography --year 2024 --write
```

Expected report: `regions_inserted=7, members_present=20, stats_rows_inserted=28,
missing_city_records=[]`. Run it a **second time** to confirm idempotency
(`regions_inserted=0, stats_rows_inserted=0, regions_unchanged=7,
stats_rows_unchanged=28`). This writes **no** value to any child district
`region_id` and calls **no** external API.

## 6. Production verification

```bash
curl -fsS https://waste-54-180-221-119.sslip.io/health
./scripts/deployment/smoke-test.sh --base-url https://waste-54-180-221-119.sslip.io --expect-data
./scripts/deployment/verify-production-data.sh --env-file .env.production
dcp config | grep -E '5432|8000|3000' || echo "no private port published (expected)"
```

`verify-production-data.sh` checks the native/suitability counts (unchanged by
this additive change) **and** the new reporting-geography block.

### Expected post-deployment counts

Native and suitability counts are **unchanged** from the current production
baseline (this change does not touch them). If production is at the phase-5.5
baseline, all rows below are exact; if production carries later intentional drift,
run the script with `--allow-drift` (the reporting integrity checks stay exact
regardless).

| metric | expected |
| --- | --- |
| regions | 82 (unchanged) |
| population | 82 (unchanged) |
| waste_statistics | 234 (unchanged) |
| facilities | 651 (unchanged) |
| suitability_candidates / runs | unchanged (no rebuild is run) |
| waste_reporting_regions | 7 |
| waste_reporting_region_members | 20 |
| reporting_region_waste_statistics | 28 (7 per NTN007/008/018/022) |
| ntn018_native_omissions | 2 (인천 옹진군, 경기 연천군 — SOURCE_NOT_REPORTED) |
| dup_city_stats / city_stats_on_child / invalid_derived_geom / child_in_two_cities | 0 |

### Expected API behavior

- `/api/v1/regions/boundaries?level=SIGUNGU` still returns the 79 native SIGUNGU
  (incl. the 20 child districts).
- `/api/v1/waste-reporting/boundaries` returns 66 features (59 native + 7 derived
  cities); child districts are not separate features.
- `/api/v1/waste-reporting/statistics?waste_stream=INDUSTRIAL_FACILITY` lists
  옹진군/연천군 in `unavailable_regions` with `SOURCE_NOT_REPORTED`.
- `/api/v1/waste-reporting/per-capita` returns each city once with
  `population_is_derived=true` and the child lineage.

### Expected frontend behavior

- Population and facility-burden maps: native SGIS districts (unchanged).
- Waste-generation and per-capita maps: the seven Gyeonggi cities render once each
  as a derived-union polygon; the popup shows city reporting level, RCIS source,
  reference year, derived-union boundary, and "구별 공식 폐기물 값은 제공되지 않습니다".
- Suitability mode unchanged.
- No browser request to a Korean government API, `localhost`, or `:8000`.

### Manual seven-city check

For each of 고양시, 부천시, 성남시, 수원시, 안산시, 안양시, 용인시: the waste map shows
exactly one city polygon (not its child districts), with the official RCIS value.

## 7. Rollback

- **If deploy fails before any DB change** (build/health): the migration is
  additive and idempotent — re-run `deploy.sh`, or roll the app back to the
  previous SHA with `./scripts/deployment/rollback-app.sh --ref <PREV_PROD_SHA>
  ...` (it refuses to cross a schema revision).
- **If the DB changed and verification fails**: restore the pre-deployment
  production dump with the guarded script, then redeploy the previous SHA:

```bash
./scripts/deployment/restore-production-database.sh \
  --dump backups/pre_rcis_reporting_geography_prod_<TS>.dump --confirm-production
./scripts/deployment/deploy.sh --ref <PREV_PROD_SHA> --env-file .env.production \
  --base-url https://waste-54-180-221-119.sslip.io --expect-data
```

Because the change is additive, a lighter rollback is also valid: the reporting
tables can be emptied without touching native data — but prefer the verified dump
restore when in doubt. **Never** run an independent schema downgrade and **never**
`docker compose down -v`.

## 8. Stop conditions

Stop and leave production unchanged if any of: SSH requires interactive input; the
production working tree is dirty or a precondition fails; the raw RCIS responses
are absent (§2); the pre-deployment backup or its verification fails; the
migration fails; a public port other than Caddy 80/443 appears; a smoke or data
check fails after backfill and cannot be explained.

## 9. Non-negotiable production constraints

- `.env.production` is never modified or printed; no DNS change; no new public
  ports (5432/8000/3000 stay private, only Caddy 80/443/443udp public).
- No `docker compose down -v`; no Docker volume deletion.
- No improvised live production ingestion — the backfill is offline (from stored
  raw responses), not a live RCIS fetch.
- The post-change local dump used for a Method-3 fallback would carry unrelated
  local-only data and is **not** the recommended path for this change.
