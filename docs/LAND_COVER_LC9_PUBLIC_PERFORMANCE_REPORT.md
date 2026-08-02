# Land-Cover LC9 Public Performance Report — Phase 1B-LC9

**Deployment date:** 2026-08-02 (UTC)
**Public URL:** <https://waste-161-33-2-143.sslip.io/>
**Production host:** `ubuntu@161.33.2.143` (OCI, `waste-equity-vcn`) · project directory
`/home/ubuntu/waste-equity-platform` · compose project `waste-equity-prod`
**Caddy version:** `v2.10.2` (image `caddy:2.10-alpine`)
**Status:** **LC9 COMPLETE** — deployed and verified against the public origin.

Serving and rendering optimization only. No land-cover statistic, candidate identity,
suitability result, disclosure, or authorization status changed.

---

## 1. Git

| | |
| --- | --- |
| Branch | `perf/land-cover-lc9-mvt-performance-and-regression` (preserved, not deleted) |
| Starting commit | `aaaae293dd9863a2ab1a57abbad4a2b5083bfdda` |
| **Final commit** | **`656a2fbe6339e4552dc2c435986bf8d6819336ac`** |
| **Deployed commit** | **`656a2fbe6339e4552dc2c435986bf8d6819336ac`** |
| Local `main` == `origin/main` | **yes** — both `656a2fbe6339e4552dc2c435986bf8d6819336ac` |
| Production `git status` | clean, on `main`, at the deployed commit |
| `docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` | untouched, unstaged, still untracked |

The implementation rationale, rejected alternatives and local evidence are in
[LAND_COVER_MVT_PERFORMANCE_OPTIMIZATION.md](LAND_COVER_MVT_PERFORMANCE_OPTIMIZATION.md).
(A final documentation commit adding this report follows deployment; it changes
documentation only, no runtime code.)

## 2. What changed

### Application (`backend/src/waste_equity_backend/api/routes/land_cover_cells.py`)

* the tile CTE became `tile AS MATERIALIZED (…)`, so
  `ST_AsMVTGeom(ST_Transform(...))` is evaluated **once** per candidate instead of twice
  (PostgreSQL was inlining the single-reference CTE and pushing
  `WHERE tile.geom IS NOT NULL` into the scan as a filter);
* the tile handler issues `SET LOCAL jit = off` before the tile query. Transaction-local,
  discarded when the session closes; no server-, database- or role-wide setting touched.

### Caddy (`deploy/Caddyfile`)

One scoped `encode` inside the existing backend handler:

```caddyfile
@backend path /api/* /health
handle @backend {
	encode {
		zstd
		gzip
		match {
			header Content-Type application/vnd.mapbox-vector-tile*
		}
	}
	reverse_proxy backend:8000
}
```

The site-level `encode zstd gzip` was **not modified**, so every content type Caddy
already compressed keeps its stock behaviour. Caddy's default matcher lists
`application/x-protobuf*` but not the IANA vector-tile type this API actually serves,
which is why MVT shipped uncompressed while HTML, JSON and JS on the same origin did not.

### SQL

`MATERIALIZED` keyword only. No other clause changed: same joins, same version/grid/run
pins, same `ORDER BY candidate_key`, same twelve properties, same extent 4096, same
buffer 64, same clip flag.

### Database

| | |
| --- | --- |
| Migration | **none** — Alembic `0020` before and after, single head |
| Data write | **none** — LC9 issues no INSERT/UPDATE/DELETE |
| Import | **none** |
| Schema change | **none** |
| Volumes | untouched — no `down -v`, no volume removal, no prune |

## 3. Deployment steps actually performed

1. `git pull --ff-only origin main` on production: `aaaae29 → 656a2fb`, worktree clean.
2. New Caddyfile **validated before any reload** — `caddy validate` in a throwaway
   container: `Valid configuration`, exit 0.
3. `docker compose … build backend` (backend image only).
4. `docker compose … up -d --no-deps backend` — recreated; healthy in 27 s.
5. `docker exec … caddy reload` — succeeded, **but had no effect** (see §4).
6. `docker compose … up -d --no-deps --force-recreate caddy` — the actual fix.

Volumes, database, certificates and the public hostname were preserved throughout. No
`docker compose down -v`, no volume removal, no prune. The site stayed publicly
accessible with no Basic Authentication and no IP allowlist.

## 4. Operational finding: `git pull` breaks a single-file bind mount

Worth recording because it silently produced a *successful-looking* no-op.

`docker-compose.prod.yml` mounts `./deploy/Caddyfile:/etc/caddy/Caddyfile:ro` — a
**single-file** bind mount, which binds the file's **inode**. `git pull` does not edit
the file in place; it writes a new file and renames it over the path, creating a new
inode. The running container therefore kept serving the **old** Caddyfile:

```
container /etc/caddy/Caddyfile : c88b294d48169e2a1cd701f52427271bb7bc2424915411edfc93b90c4c352a2f  (old)
host      deploy/Caddyfile     : 02069f3b63e62c7de4b1436352cb38c15d2034d1e566d7df46f1d67dbf7dacc3  (new)
```

`caddy reload` reported success and exit 0 because it faithfully reloaded the file it
could see — the old one. The first public verification correctly showed **no**
compression, which is how the problem was caught rather than assumed away.

**A `deploy/Caddyfile` change requires recreating the Caddy container**, not reloading
it. `--force-recreate caddy` preserves the `caddy_data` / `caddy_config` named volumes;
the certificate directory was verified byte-for-byte present before and after (7 files,
same `waste-161-33-2-143.sslip.io.crt`). Recorded in
[OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md), [DEPLOYMENT.md](DEPLOYMENT.md) and
[OCI_DEPLOYMENT_CHECKLIST.md](OCI_DEPLOYMENT_CHECKLIST.md).

## 5. Backup

Per the phase's own conditions, a new full `pg_dump` was **not** required, and each
condition was verified rather than assumed:

| Condition | Verified |
| --- | --- |
| no migration | Alembic `0020` → `0020`; the commit adds no file under `backend/alembic/` |
| no data write | LC9 issues no writing SQL; production checksums identical (§8) |
| no import | none performed |
| no database configuration change | `SET LOCAL` is per-transaction, not a server setting |
| existing recent verified backup present | `~/deployment-backups/lc8-20260802T103903Z/waste_equity-pre-lc8-20260802T103903Z.dump`, 865,298,623 B, `sha256sum -c` → **OK** |
| rollback needs only app + Caddy | yes (§12) |

**Caddy configuration backup (taken before modifying it), outside Git:**

| | |
| --- | --- |
| Directory | `/home/ubuntu/deployment-backups/lc9-caddy-20260802T132434Z/` |
| Files | `Caddyfile.pre-lc9`, `Caddyfile.in-container.pre-lc9`, `SHA256SUM` |
| SHA-256 (both, identical) | `c88b294d48169e2a1cd701f52427271bb7bc2424915411edfc93b90c4c352a2f` |

No credentials appear in any filename or in the backup contents.

## 6. Production tile measurements — before and after

Same script (`scripts/qa/land-cover-mvt-performance.sh`), same fixed version-pinned URLs,
same statistics version 1, same origin. "Transferred" is what the client actually
downloads; "raw" is the decompressed MVT.

| Tile | z | Features | Raw bytes | Transferred BEFORE | Transferred AFTER | Ratio | TTFB before → after (s) | Warm total before → after (s) | 304 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| z7/108/49 (default view) | 7 | 2,765 | 216,084 | 216,084 | **35,109** | 0.162 | 0.217 → 0.229 | 0.344 → **0.292** | 304 |
| z7/109/49 (worst case) | 7 | 45,180 | 3,711,118 | 3,711,118 | **552,276** | 0.149 | 1.442 → **0.744** | 2.778 → **1.417** | 304 |
| z8/218/99 | 8 | 31,431 | 2,609,329 | 2,609,329 | **421,248** | 0.161 | 1.254 → **0.583** | 1.871 → **1.331** | 304 |
| z9/436/198 | 9 | 14,547 | 1,197,621 | 1,197,621 | **204,048** | 0.170 | 0.410 → 0.366 | 1.072 → **0.690** | 304 |
| z10/873/396 (Seoul) | 10 | 3,960 | 344,227 | 344,227 | **63,723** | 0.185 | 0.268 → 0.265 | 0.408 → **0.318** | 304 |
| z10/872/396 (Incheon) | 10 | 3,746 | 318,600 | 318,600 | **61,354** | 0.193 | 0.251 → 0.227 | 0.712 → **0.299** | 304 |
| z10/873/397 (Gyeonggi) | 10 | 3,989 | 344,581 | 344,581 | **62,857** | 0.182 | 0.234 → 0.242 | 0.456 → **0.355** | 304 |
| z13/6985/3174 | 13 | 72 | 7,032 | 7,032 | **2,153** | 0.306 | 0.160 → 0.192 | 0.193 → 0.272 | 304 |
| z10/868/397 (Yellow Sea) | 10 | 0 | 0 | 0 | 0 | n/a | 0.161 → 0.156 | 0.154 → 0.170 | 304 |
| z10/879/404 (outside grid) | 10 | 0 | 0 | 0 | 0 | n/a | 0.203 → 0.147 | 0.363 → 0.166 | 304 |

**Total across the ten tiles: 8,748,592 B → 1,402,768 B (0.160).**

Negotiated encoding after deployment: **zstd** on the seven non-empty tiles at z7–z10,
**gzip** on the small z13 tile, **identity** on the two zero-byte tiles (nothing to
compress — correct, not a failure). Sub-second differences at the small tiles are network
noise, not regressions; the byte counts are exact.

### Nothing about the tile content changed

For every one of the ten tiles, before and after:

* **decompressed SHA-256 identical**;
* uncompressed byte count identical;
* decoded feature count identical;
* decoded property-key set identical;
* ETag identical;
* `If-None-Match` → **304 with a zero-length body**.

The gzip and zstd bodies both decompress to exactly the identity body's SHA-256.

### Query-plan comparison (production database, `EXPLAIN ANALYZE`, z7/109/49, 5 runs)

| Variant | Median execution | JIT time |
| --- | ---: | ---: |
| before — inlined CTE, JIT on | **1281.9 ms** | 1.39–1.57 s (summed across workers) |
| `MATERIALIZED` only | 630.0 ms | ~43 ms |
| `SET LOCAL jit = off` only | 761.9 ms | 0 |
| **after — both** | **579.6 ms** | **0** |

**2.21× faster**, from `Inlining true, Optimization true` LLVM compilation of a tree of
PostGIS C calls that ran once, plus a doubled `ST_AsMVTGeom` evaluation.

## 7. Production browser measurements

Chrome, 1440 × 900, against the public origin.

| | Value |
| --- | ---: |
| Navigation TTFB | 222 ms |
| DOMContentLoaded | 419 ms |
| Load event | 542 ms |
| Map canvas visible | 3,152 ms |
| **Layer enable → legend rows** | **202 ms** |
| **Layer enable → network settled** | **2,258 ms** |
| Tile requests | 6 |
| Total transferred MVT bytes | 619,895 |
| Largest transferred tile | 421,553 |
| Status distribution | `200` × 6 |
| Content-Encoding distribution | zstd × 4, identity × 2 (both zero-byte empty tiles) |
| Console errors | **0** |
| Page errors | **0** |
| Failed requests | **0** |

Compared with LC8's browser run (4,125 ms enable→settled, 1 tile of 216,084 B): settling
is **45 % faster while loading six tiles instead of one**. The two runs used different
window sizes, so this is a same-origin improvement rather than a controlled
tile-for-tile comparison — the controlled comparison is the tile table in §6.

## 8. Target achievement

| Target | Result | Met |
| --- | --- | :---: |
| typical low-zoom transferred tile < 500 KB | 35,109 B (z7/108/49) | ✅ |
| worst representative z7 transferred tile < 1.5 MB | **552,276 B** | ✅ |
| warm production response < 1.5 s for the worst tile | **1.417 s** | ✅ |
| typical production response < 750 ms | 0.299–0.355 s (z10 warm) | ✅ |
| layer enable → legend < 1 s | **202 ms** | ✅ |
| enable → settled materially improved | 4,125 ms → **2,258 ms** (−45 %) | ✅ |
| no failed MVT requests | 0 | ✅ |
| no frontend console errors | 0 | ✅ |
| no visible tile seams | adjacent tiles agree on every shared cell, 0 mismatches | ✅ |
| no missing candidate cells at normal zooms | feature counts identical to baseline at every zoom | ✅ |

Every target was measured **after** production deployment, on the public origin.

## 9. Production data — unchanged

| Key | Before deployment | After deployment |
| --- | --- | --- |
| Alembic revision | `0020` | **`0020`** |
| Suitability score+rank+status+exclusion+review md5 | `66c454c2fe3cbed1093eb977f5a6ff99` | **`66c454c2fe3cbed1093eb977f5a6ff99`** |
| Suitability runs / candidates | 3 / 143,679 | **3 / 143,679** |
| Cell-statistics rows | 47,893 | **47,893** |
| Class-area rows | 1,142,780 | **1,142,780** |
| `COMPLETE_EXACT` / `PARTIAL` / `NO_COVERAGE` | 35,902 / 4,604 / 7,387 | **35,902 / 4,604 / 7,387** |
| Failed cells | 0 | **0** |
| Cell content md5 | `421be51cad458841001c001f62c74ad5` | **`421be51cad458841001c001f62c74ad5`** |
| Candidate-grid version / fingerprint | `capital-grid-500m-v1` / `dd327d5a…c3e29` | **identical** |
| **Raw land-cover features / map sheets** | **0 / 0** | **0 / 0** |
| PostgreSQL extensions | `fuzzystrmatch, plpgsql, postgis, postgis_tiger_geocoder, postgis_topology` | **identical** |

The local development database was likewise verified byte-identical before and after all
LC9 work (`scripts/qa/land-cover-db-baseline.sh`, 53 keys, empty `diff`), and its cell
checksum `421be51cad458841001c001f62c74ad5` matches production exactly.

### One unintended production side effect, made good

During benchmarking, `CREATE EXTENSION IF NOT EXISTS pgcrypto` was run on production to
obtain a `digest()` function for hashing tile bytes; the extension had not been
installed. It changed no data, table, row, checksum or application behaviour, and nothing
depended on it (0 dependent objects verified). It was **dropped with the project owner's
approval**, and the extension set was confirmed restored to exactly its prior contents.
Later hashing used built-in `md5()` and client-side `sha256`, which need no extension.

## 10. Public verification (from outside the server)

### HTTP and API — all 200 unless noted

`/` · `/health` · land-cover `release` · `summary` · `cells` · candidate-cell `detail` ·
`classes` · MVT low zoom · MVT high zoom — **200**.

Existing-feature regression, all **200**: suitability latest run, wetlands metadata,
facility-cost `standards` and `options`, regions, data sources, population, waste
statistics, landfill summary.

Raw-surface probes — all **404**: `…/land-cover/features`, `…/land-cover/map-sheets`,
`…/land-cover/download`, `…/cell-statistics/export.csv`, `…/land-cover/shapefile`.

**No `WWW-Authenticate` header on `/`. No Basic Authentication, no IP allowlist.**

### MVT negotiation, cache and ETag (worst-case tile z7/109/49)

| Request | Status | `content-encoding` | `Content-Type` | ETag | `Vary` |
| --- | --- | --- | --- | --- | --- |
| `Accept-Encoding: identity` | 200 | *(none)* | `application/vnd.mapbox-vector-tile` | `"lc-cells-1-1-7-109-49"` | *(none)* |
| `Accept-Encoding: gzip` | 200 | **gzip** | `application/vnd.mapbox-vector-tile` | `"…-gzip"` | `Accept-Encoding` |
| `Accept-Encoding: zstd` | 200 | **zstd** | `application/vnd.mapbox-vector-tile` | `"…-zstd"` | `Accept-Encoding` |
| `gzip, deflate, br, zstd` (browser) | 200 | **zstd** | `application/vnd.mapbox-vector-tile` | `"…-zstd"` | `Accept-Encoding` |
| no `Accept-Encoding` header | 200 | *(none)* | `application/vnd.mapbox-vector-tile` | stem | *(none)* |
| `If-None-Match:` stem | **304** | — | — | stem | `Accept-Encoding` |
| `If-None-Match:` `…-gzip` | **304** | — | — | stem | `Accept-Encoding` |
| `If-None-Match:` `…-zstd` | **304** | — | — | stem | `Accept-Encoding` |
| `If-None-Match:` a wrong tag | 200 | — | tile | stem | — |

`Cache-Control: public, max-age=31536000, immutable` on every 200 and 304.

Caddy gives each encoding its own entity tag (`…-gzip`, `…-zstd`) as RFC 9110 requires —
two representations must not share a validator — and strips its own suffix from an
inbound `If-None-Match`, so revalidating a compressed variant still returns 304. The
version-pinned stem is preserved in every variant, so a statistics-version change still
mints a different URL and a different ETag.

**Non-regression of the default matcher:** `/` still `content-encoding: gzip`
(`text/html`), and the land-cover `release` endpoint still `gzip` (`application/json`).

### MVT decoding

* decodes successfully at every zoom;
* source layer is **`land_cover_cells`**, and only that layer;
* extent **4096**;
* property keys are exactly the twelve: `candidate_key`, `coverage_ratio`,
  `coverage_status`, `dominant_l1_code/name`, `dominant_l2_code/name`,
  `dominant_l3_code/name`, `sido_region_code`, `sigungu_region_code`,
  `statistics_version_id` — **no raw source property, no suitability property**;
* **0 duplicate candidate keys** in a decoded tile;
* gzip, zstd and identity all decompress to the **same SHA-256**;
* adjacent tiles agree on every shared boundary cell — `z10/872/396`↔`z10/873/396`
  (62 shared, 0 mismatched), `z10/873/396`↔`z10/873/397` (65 shared, 0 mismatched),
  `z9/436/198`↔`z9/437/198` (125 shared, 0 mismatched). No gaps, no contradictory
  attributes.

### Browser — `frontend/e2e/publicRelease.spec.ts`, **8/8 passed, exit code 0**

Equity mode · Suitability mode · land-cover **OFF by default** · layer enable · coverage
mode · dominant **L1/L2/L3** · class filters · legend appears exactly once · candidate
click opens the land-cover detail · desktop · mobile 390 × 844 with no horizontal
overflow · authorization disclosure · source attribution · scoring non-use · **no**
request to any raw land-cover feature/geometry/download URL · no authentication prompt.

### Disclosures still served, verbatim

```
used_in_suitability_scoring = false
license_status              = PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER
authorization_basis         = GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION
lifecycle.scoring_integration    = NOT_IMPLEMENTED
lifecycle.production_deployment  = PUBLIC_DEPLOYED
provider   = 기후에너지환경부 환경공간정보서비스(EGIS)
dataset    = 세분류 [2025] 전국 토지피복지도
source_url = https://aid.mcee.go.kr/intro/land.do
raw_source_not_returned_ko = 원본 SHP 파일, 원본 토지피복 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.
```

No EGIS-specific KOGL **type** is asserted anywhere. The two strings in the payload that
contain "KOGL" are (a) the verbatim stored source `license_note`, which itself records
that written reconfirmation is still needed, and (b) the LC8 sentence explicitly stating
that the operational authorization *does not* assert a dataset-specific EGIS KOGL type.
LC9 changed no disclosure text.

## 11. Test results

| Gate | Result | Exit |
| --- | --- | ---: |
| Ruff format `--check` | 113 formatted; 1 pre-existing (`…0016_suitability_critic_stability.py`, unmodified by LC9) | — |
| Ruff lint | All checks passed | 0 |
| mypy (strict) | no issues in 54 source files | 0 |
| Backend, non-PostGIS | passed (PostGIS tier skips by design) | 0 |
| Backend, full PostGIS | **601 passed**, 8 failed, 3 errors | 1 |
| Backend, LC9 guards only | **18 passed** | 0 |
| Reverse-proxy compression (`scripts/qa/verify-mvt-compression.sh`) | **52 checks, 0 failures** | 0 |
| Frontend ESLint | clean | 0 |
| Frontend typecheck | clean | 0 |
| Frontend Vitest | **949 passed**, 7 skipped, 0 failed | 0 |
| Frontend production build | compiled, 4/4 static pages | 0 |
| Playwright — `landCoverLayer.spec.ts` | **10 passed** | **0** |
| Playwright — `landCoverIntegratedQa.spec.ts` (LC6) | **13 passed** | **0** |
| Playwright — `landCoverPerformance.spec.ts` (LC9) | **3 passed** | **0** |
| Playwright — `publicRelease.spec.ts` (production) | **8 passed** | **0** |

Every Playwright run above exited **0** — no hung workers, no "tests pass but the command
fails". Configuration: `--workers=1 --reporter=line --trace=on-first-retry`, explicit
backend URL, port 3000, and a stale project dev server (PID from a 5-hour-old session)
stopped by PID before the runs so Playwright's `reuseExistingServer` could not silently
attach the tests to a server pointing at the wrong backend. No unrelated Chrome or Node
process was killed.

### Pre-existing backend failures — reproduced on clean `main`

Run on a clean worktree at `aaaae29…` with the same database and interpreter. The failure
sets are **identical**; `diff` of the sorted `FAILED`/`ERROR` lines is empty.

| | clean `main` | LC9 |
| --- | ---: | ---: |
| passed | 583 | **601** (+18 LC9 guards) |
| failed | 8 | 8 |
| errors | 3 | 3 |

| Test(s) | Class | Cause |
| --- | --- | --- |
| `test_facility_mapping_transparency_integration.py::test_migration_head_is_0016` | pre-existing on main | asserts head `0016`; head is `0020` since migrations 0017–0020 landed |
| `test_suitability_scenario_routes_integration.py::test_migration_head_is_0016_and_no_new_migration` | pre-existing on main | same stale assertion |
| `test_migration_population_monthly_integration.py` (6) | test-database state | needs seeded `regions` / `ingestion_runs`; the test database is empty (`AssertionError: a regions row is required by the FK`, `ForeignKeyViolation`) |
| `test_reporting_routes_integration.py` (3 errors) | test-database state | same missing rows, surfaced in the fixture |

**None introduced by LC9. No unrelated test was modified to obtain green output.**

### Failures observed but not defects

* **Vitest, 2 failures** in `src/app/page.phase7.test.tsx` on one run — `waitFor` timeouts
  while the full PostGIS suite and Docker were saturating the machine. Passes in isolation
  on both `main` and LC9, and the full suite passes 949/949 on a quiet machine. Flaky
  under contention.
* **Playwright, 2 failures** (`landCoverIntegratedQa.spec.ts:192`,
  `landCoverLayer.spec.ts:359`) during one 26-test run — the **local development**
  PostgreSQL container hit an out-of-memory crash mid-run while serving concurrent
  multi-megabyte low-zoom tiles, then crash-recovered cleanly. Both specs pass with exit 0
  on the recovered database, and the local database's contents are byte-identical to the
  pre-LC9 baseline. **Production was never involved.**

### Environment limitation (pre-existing, not caused by LC9)

Playwright's bundled Chromium is not installed on this machine
(`~/Library/Caches/ms-playwright/` does not exist), so only the four specs that declare
`test.use({ channel: "chrome" })` can run here — which is exactly the land-cover set plus
the production release spec, all of which were run and passed. The other 23 specs cannot
execute in this environment; that is a long-standing condition recorded since LC5A, and
`frontend/playwright.config.ts` is unmodified by LC9. Existing-feature regression was
therefore covered by the public API smoke (§10), the production browser spec, and the 949
Vitest component tests rather than by those 23 specs.

## 12. Rollback

Nothing here requires a database restore: LC9 wrote no data and added no migration.

| | |
| --- | --- |
| Previous production commit | `aaaae293dd9863a2ab1a57abbad4a2b5083bfdda` |
| Previous backend image | `waste-equity-prod-backend:latest` id `5f7b3aed1a1d` (built 2026-08-02 10:42:19 UTC) |
| Previous frontend image | `waste-equity-prod-frontend:latest` id `fd97b73de934` (built 2026-08-02 10:42:54 UTC) — **not rebuilt by LC9** |
| Caddy image | `caddy:2.10-alpine` id `4c6e91c6ed0e` — unchanged |
| Caddy config backup | `~/deployment-backups/lc9-caddy-20260802T132434Z/Caddyfile.pre-lc9` |
| Caddy backup SHA-256 | `c88b294d48169e2a1cd701f52427271bb7bc2424915411edfc93b90c4c352a2f` |
| Database backup (unused, still valid) | `~/deployment-backups/lc8-20260802T103903Z/…dump`, `sha256sum -c` **OK** |

### (a) Caddy configuration only — restores uncompressed MVT, keeps the query fix

```bash
cd /home/ubuntu/waste-equity-platform
cp ~/deployment-backups/lc9-caddy-20260802T132434Z/Caddyfile.pre-lc9 deploy/Caddyfile
sha256sum deploy/Caddyfile   # must be c88b294d…a2a2f
docker run --rm -e PUBLIC_DOMAIN=validate.invalid -e CADDY_ACME_EMAIL=noreply@invalid \
  -v /home/ubuntu/waste-equity-platform/deploy/Caddyfile:/etc/caddy/Caddyfile:ro \
  caddy:2.10-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
# RECREATE, do not reload — see §4
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  up -d --no-deps --force-recreate caddy
```

### (b) Application commit

```bash
cd /home/ubuntu/waste-equity-platform
git fetch origin
git checkout aaaae293dd9863a2ab1a57abbad4a2b5083bfdda
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  build backend
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  up -d --no-deps backend
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  up -d --no-deps --force-recreate caddy    # the Caddyfile moves with the commit
```

No migration downgrade is involved — LC9 added none.

### (c) Feature-level (unchanged from LC8)

Deactivating the statistics release makes every land-cover endpoint return a structured
404 and disables the map layer, leaving everything else untouched.

### Health checks after any rollback

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://waste-161-33-2-143.sslip.io/
curl -s -o /dev/null -w "%{http_code}\n" https://waste-161-33-2-143.sslip.io/health
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' \
  https://waste-161-33-2-143.sslip.io/api/v1/environment/land-cover/cell-statistics/tiles/1/13/6985/3174.mvt
# suitability integrity — must still be 66c454c2fe3cbed1093eb977f5a6ff99
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  exec -T database psql -U waste_equity_prod -d waste_equity -tAc \
  "select md5(string_agg(coalesce(total_score::text,'N')||':'||coalesce(rank::text,'N')||':'||status||':'||coalesce(exclusion_reasons::text,'N')||':'||coalesce(review_reasons::text,'N'), '|' order by analysis_run_id, candidate_key)) from suitability_candidates"
```

**Rollback was not executed** — deployment verification passed.

## 13. Remaining limitations

1. **The worst low-zoom tile is still ~45,180 real features.** Compression makes it cheap
   to transfer and the query fix makes it 2.21× cheaper to build, but it remains the
   largest object the public API serves. It is version-pinned, cached one year immutable,
   the layer is off by default, and revalidation returns 304 — so the cost is paid at most
   once per tile per client.
2. **`Vary` is absent on the identity (uncompressed) response.** Caddy's behaviour. Safe in
   the only direction that matters — an uncompressed MVT is valid for every client — and
   the unsafe direction is prevented by the `Vary` on the compressed variants and verified
   directly. A shared intermediary could cache the uncompressed representation and serve
   it to a compression-capable client: a larger transfer, never wrong content.
3. **The suitability and wetland tile endpoints were not changed.** They share the query
   shape and would benefit from the same two fixes, and additionally lack the deterministic
   `ORDER BY` the land-cover tile has. Out of LC9's scope because changing them alters
   their served bytes. Recommended follow-up.
4. **Two stale `test_migration_head_is_0016*` assertions** and **nine test-database-dependent
   tests** should be fixed in a separate change (§11).
5. **Map canvas visible at 3,152 ms** on the public origin is dominated by MapLibre
   initialisation and the OpenStreetMap basemap, not by land cover. Untouched by LC9.

## 14. Confirmations

* ✅ **Raw source tables remain absent from production** — `environmental_land_cover_features`
  and `environmental_land_cover_map_sheets` hold **0 rows**, and no endpoint reads them.
  No raw SHP file, raw polygon or per-feature source record was deployed or exposed.
* ✅ **No land-cover data changed** — cell count, class-row count, coverage-state counts,
  failed cells, cell content checksum, candidate-grid version and fingerprint all identical
  before and after (§9).
* ✅ **No suitability result changed** — md5 `66c454c2fe3cbed1093eb977f5a6ff99` before and
  after; 3 runs / 143,679 candidates unchanged.
* ✅ **Land cover remains excluded from scoring** — `used_in_suitability_scoring = false`,
  `lifecycle.scoring_integration = NOT_IMPLEMENTED`.
* ✅ **Source attribution and authorization disclosures remain visible** in the API, the
  layer control, the candidate detail and the 데이터·출처 page (§10).
* ✅ **No Basic Authentication and no IP allowlist were added.**
* ✅ **No database migration, no schema change, no database write.**
* ✅ **Tiles are byte-identical** before and after, by SHA-256, at both the SQL and HTTP
  layers, in both environments.
* ✅ **Docker volumes, the production database, Caddy certificates and storage, networks
  and DNS were preserved.** No `down -v`, no volume removal, no prune, no destructive SQL.
* ✅ **`docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` remained untouched, unstaged and untracked.**

---

**Exact public URL:** <https://waste-161-33-2-143.sslip.io/>
