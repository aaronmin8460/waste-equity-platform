# Municipal Waste Cost Ingestion — Runbook

Status: **executed locally on 2026-08-06 against the development database.**
Not deployed. Every result quoted below was measured, not projected.

Related: [`METHODOLOGY.md`](METHODOLOGY.md),
[`STEP_2_BACKEND_IMPLEMENTATION.md`](STEP_2_BACKEND_IMPLEMENTATION.md),
[`STEP_1_SOURCE_AUDIT.md`](STEP_1_SOURCE_AUDIT.md).

---

## 1. Preconditions

| Requirement | Value |
| --- | --- |
| Alembic head (code) | `0021`, single head |
| Alembic version (dev DB) | `0021` |
| Source directory | `data/import/municipal-costs/2024/` (Git-ignored) |
| Network access | **none** — the job reads local files only |
| Credentials | **none** |
| Source mutation | none: workbooks are opened read-only and never resaved |

The raw workbooks, `data/raw/municipal-costs/`, and
`artifacts/municipal-costs/` are Git-ignored (see `.gitignore`). Never commit
them.

### Start only the database

The backend container runs `alembic upgrade head` on startup. Inspect the
migration state **before** starting it. When only database access is needed:

```bash
docker compose up -d database
docker compose exec -T database psql -U waste_equity -d waste_equity -c "select * from alembic_version;"
```

---

## 2. Backup before any migration

Use the repository's existing convention. It writes a timestamped custom-format
dump to the Git-ignored `backups/` directory and never overwrites an existing
file:

```bash
scripts/deployment/backup-local-database.sh
```

**Backup used for this release** (taken before `0021` was applied):

| Field | Value |
| --- | --- |
| Path | `backups/waste_equity_local_20260806_000014.dump` |
| Size | 4,798,493,083 bytes (4.5 GiB) |
| SHA-256 | `7c3ca73a60637961b19d1f174615c946899054f3eb0083bdf9178b9beaf3764e` |
| Archive header | `Format: CUSTOM`, `Dump Version: 1.15-0`, `Compression: gzip` |
| Created (per archive) | 2026-08-05 15:00:14 KST |

Verification performed:

```bash
/usr/local/opt/libpq/bin/pg_restore -l backups/waste_equity_local_20260806_000014.dump
```

- exit 0, **407 TOC entries** listed
- `landfill_inbound_monthly` present (20 TOC entries)
- **0** `municipal_cost*` / `municipal_waste*` entries — confirming it is a
  genuine *pre-0021* snapshot

> Piping the dump into the container's `pg_restore` via `/dev/stdin` fails with
> `did not find magic string in file header`. That is a seek limitation on pipes,
> not corruption — the file does begin with `PGDMP`. Verify with a `pg_restore`
> that can seek the file directly.

---

## 3. Migration

```bash
cd backend && ./.venv/bin/python -m alembic heads     # must print exactly one head
cd backend && ./.venv/bin/python -m alembic upgrade head
```

Migration `0021` (`20260805_0021_municipal_waste_costs.py`, revises `0020`) is
purely additive: six new tables plus one `data_sources` row. No existing table,
column, constraint, or row is altered.

**It has already been applied** to both the development database and the test
database. Do not create a second `0021`, do not create a competing head, and do
not apply an equivalent migration again.

---

## 4. Dry run — must write zero rows

```bash
cd ingestion
DATABASE_URL="postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity" \
  ./.venv/bin/waste-equity-probe municipal-costs-ingest \
    --dry-run \
    --source-dir ../data/import/municipal-costs/2024 \
    --report-path ../artifacts/municipal-costs/step2/dry_run.json
```

Measured result (2026-08-06): `status = DRY_RUN_OK`, exit 0.

Row counts immediately before and after were byte-identical, **including
`max(id)` on every table** — nothing was inserted and no sequence was advanced:

```
geographies|components|source_files|contracts|quantities|indicators|max(contract id)|max(quantity id)
before: 66|20|64|205|2701|66|205|2701
after:  66|20|64|205|2701|66|205|2701
```

---

## 5. Write

```bash
cd ingestion
DATABASE_URL="postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity" \
  ./.venv/bin/waste-equity-probe municipal-costs-ingest \
    --write \
    --source-dir ../data/import/municipal-costs/2024 \
    --report-path ../artifacts/municipal-costs/step2/write_1.json
```

The whole load runs in a single transaction; an interrupt rolls back cleanly.

**First write** (run 1245): `status = SUCCEEDED`, `idempotent_no_op = false`.

| Inserted | Count |
| --- | --- |
| source files | 64 |
| geographies | 66 |
| population components | 20 |
| contracts | 205 |
| quantity observations | 2,701 |
| indicator values | 66 |

---

## 6. Idempotency

Re-running `--write` unchanged must be a deterministic no-op — not merely
"uniqueness constraints rejected the duplicates".

**Second write** (run 1246): `idempotent_no_op = true`, everything reported
`*_unchanged` (64 source files, 66 geographies, 20 components, 2,906
observations, 66 indicator values), zero inserts.

**Third write** (run 1247, re-run during this session with the final code):
`idempotent_no_op = true`. Verified against a snapshot including `max(id)` and
`sum(value)`:

```
g|c|f|k|q|i|max(qty id)|sum(indicator value)
before: 66|20|64|205|2701|66|2701|1455186.6612
after:  66|20|64|205|2701|66|2701|1455186.6612
```

No inserts, no sequence advance, no value drift.

**Fifth write** (run 1249), after the reason-code correction described below —
snapshot extended with an MD5 over all `reason_codes`:

```
before: 66|20|64|205|2701|66|2701|1455186.6612|dcf24be7ff481a17dba23b9db64b4dc5
after:  66|20|64|205|2701|66|2701|1455186.6612|dcf24be7ff481a17dba23b9db64b4dc5
```

### Reconciliation is content-based, not blind-insert

The loader compares stored content and updates only what actually changed. When
the 남동구 resolution reason was corrected (see §4 of `METHODOLOGY.md`), the
**fourth write** (run 1248) reported:

```json
{"components_unchanged": 20, "geographies_unchanged": 66,
 "indicator_values_unchanged": 65, "indicator_values_updated": 1,
 "observations_unchanged": 2906, "source_files_unchanged": 64}
```

Exactly one row updated, everything else untouched, numerator and status counts
unchanged. The next run returned to `idempotent_no_op = true`.

Each run still appends an `ingestion_runs` row for auditability — that is the
run log, not a data change.

---

## 7. Verification queries

```sql
-- 66 municipalities, correct split
select metropolitan_code, count(*) from municipal_cost_geographies
where reference_year = 2024 group by 1 order by 1;
--  11 | 25
--  28 | 10
--  41 | 31

-- indicator distribution; UNAVAILABLE must be NULL, never 0
select status, count(*) total, count(value) non_null,
       count(*) filter (where value = 0) zeros
from municipal_cost_indicator_values group by 1 order by 1;
--  AVAILABLE   | 20 | 20 | 0
--  PARTIAL     |  5 |  5 | 0
--  UNAVAILABLE | 41 |  0 | 0

-- the seven derived city populations must equal their component sums exactly
select g.display_name, g.population, sum(c.component_population),
       g.population = sum(c.component_population) as exact
from municipal_cost_geographies g
join municipal_cost_geography_components c on c.geography_id = g.id
where g.population_method = 'DERIVED_SUM_OF_CONSTITUENT_WARDS'
group by g.id, g.display_name, g.population;
-- all seven: exact = t

-- missing is never zero
select value_state, count(*), count(quantity_value) from municipal_waste_quantities group by 1;

-- the official landfill table must contain no municipal rows
select accounting_basis, count(*) from landfill_inbound_monthly group by 1;
--  VERIFIED_METROPOLITAN_ORIGIN_TO_DESTINATION_FLOW | 9212
```

---

## 8. Serving and checking the API

The backend container re-runs `alembic upgrade head` at startup. To avoid an
unreviewed automatic migration, serve locally instead:

```bash
cd backend
DATABASE_URL="postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity" \
  ./.venv/bin/python -m uvicorn waste_equity_backend.api.app:app --host 127.0.0.1 --port 8011
```

```bash
curl -s "http://127.0.0.1:8011/api/v1/landfill/municipal-costs?year=2024" | jq '.municipalities | length'   # 66
curl -s "http://127.0.0.1:8011/api/v1/landfill/municipal-costs?year=2024&sido=28" | jq '.municipalities | length'  # 10
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:8011/api/v1/landfill/municipal-costs?year=2023"  # 422
```

---

## 9. Gotchas

- **Unicode NFC.** macOS returns Korean path and filename components in NFD.
  Every path and matching string is normalised to NFC via `nfc()`; skipping it
  makes every Korean name silently fail to match.
- **Do not resave workbooks.** They are opened read-only with `openpyxl`. No
  OCR, no LibreOffice, no rewriting.
- **`Literal[int]` breaks FastAPI query parameters.** Query values always arrive
  as strings and Pydantic does not coerce `"2024"` into an `int` literal, so
  `Literal[2024]` rejects the one year this release publishes. Use a bounded
  `int` (`Query(ge=…, le=…)`), matching `land_cover_cells.py`.
- **Metropolitan code crosswalk.** Dashboard codes 11/28/41 are not the SGIS
  parent codes 11/23/31. Only Seoul coincides.
- **Test database.** The PostGIS tier is skipped entirely unless
  `TEST_DATABASE_URL` is set. Locally:
  `TEST_DATABASE_URL="postgresql+psycopg://test:test@localhost:5433/test"`
  (container `wep-testdb`).
- **`test_loaded_registry_has_exactly_66_rows_for_2024` skips by design** when
  the test database has no ingested registry. That is a clean skip, not a
  failure; the 66-row assertion is verified directly against the development
  database.
