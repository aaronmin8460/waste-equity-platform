# Land-Cover Public Deployment Report — Phase 1B-LC8

**Deployment date:** 2026-08-02 (UTC)
**Public URL:** <https://waste-161-33-2-143.sslip.io/>
**Production host:** `ubuntu@161.33.2.143` (OCI) · project directory `/home/ubuntu/waste-equity-platform` · compose project `waste-equity-prod`
**Authorization basis:** `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`
**Public deployment status:** `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER`

---

## 1. Authorization basis, and what it is not

On **2026-08-02** the project owner confirmed that the Waste Equity Platform is conducted
in cooperation with a government institution, and that this **cooperating government
institution has authorized the project to use and publicly present the relevant government
public datasets**. That project-level authorization is the operational basis for this
deployment. It is recorded in
[PUBLIC_DATA_PROJECT_AUTHORIZATION.md](PUBLIC_DATA_PROJECT_AUTHORIZATION.md).

**Distinction from dataset-specific EGIS permission.** This is **not** an EGIS written
reply, **not** an EGIS licence confirmation, and **not** a KOGL type designation. Phase
1B-LC7's finding — that from the public evidence available on 2026-08-02 a dataset-specific
EGIS licence for the *vector* 「세분류 [2025] 전국 토지피복지도」 could not be established,
and that the KOGL Type 1 mark belongs to the separate WMS map service — **stands unmodified
as a historical evidence review**. Each LC7 document carries a dated superseding
*operational* note rather than an edit. The two facts are kept distinct throughout:

| | Status |
| --- | --- |
| Dataset-specific public evidence (LC7) | `UNRESOLVED_PENDING_WRITTEN_RESPONSE` |
| Project-level government-partner authorization (LC8) | `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` |

No document number, official name, e-mail address, letter, date, or signatory has been
fabricated anywhere. The government partner is referred to by the neutral term
**협력 정부기관**, because no specific institution name is documented in tracked project
material.

## 2. Git

| | |
| --- | --- |
| Branch | `deploy/land-cover-lc8-government-authorized-public-release` |
| Starting commit | `7c53970ac7aedc81b9176426e278b1aabb906c77` |
| Implementation commit | `a5b1427f79e95f0c92862d02330a455ca56f758a` |
| Portability fix (import wrapper `mktemp`) | `64ebfcbde5ca878baffa8f7d85cc08d8e5ab0a37` |
| **Public deployment commit (application code)** | **`64ebfcbde5ca878baffa8f7d85cc08d8e5ab0a37`** |
| Local `main` == `origin/main` | yes, verified after each push |
| LC8 branch | preserved (not deleted) |
| `docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` | untouched, unstaged, still untracked |

The final documentation commit for this report is applied after deployment and pulled onto
production so `HEAD` matches `origin/main`; it changes documentation only, no runtime code.

## 3. Production state before deployment

Recorded 2026-08-02 10:38:35 UTC on `waste-equity-vcn`.

| | |
| --- | --- |
| Disk | 193 G total, 19 G used, **175 G available** (10%) |
| Memory | 11 GiB total, 8.0 GiB available |
| Containers | `waste-equity-prod-{frontend,backend,caddy,database}-1`, all healthy |
| Images | `waste-equity-prod-frontend`, `waste-equity-prod-backend`, `caddy:2.10-alpine`, `postgis/postgis:16-3.4` |
| Deployed commit | `39413a3570d62c58298ed63a52e1754142579259` |
| Alembic revision | `0018` |
| Database size | 4608 MB |
| Public site | HTTP 200 |
| Suitability runs / candidates | 3 / 143,679 |
| Suitability score+rank+status+exclusion+review md5 | `66c454c2fe3cbed1093eb977f5a6ff99` |
| Land-cover tables | **absent** (created by migration 0019/0020) |
| Wetland features | 2,704 |

## 4. Backup

| | |
| --- | --- |
| File | `waste_equity-pre-lc8-20260802T103903Z.dump` |
| Location | `~/deployment-backups/lc8-20260802T103903Z/` on the production host (**outside Git**) |
| Method | `pg_dump -Fc --no-owner --no-privileges` inside the database container |
| Exit code | **0** |
| Size | 865,298,623 bytes (825 MB) |
| Validation | `pg_restore --list` → exit 0, 350 lines, **340 TOC entries**, format CUSTOM |
| SHA-256 | `bd76c9143a495cd3378dbb6ba12358f8c5bba3e8e14984c7271ebd61a49232c6` |
| Free space after | 174 G |

The backup was taken **before** any migration or import. No credentials appear in the
filename. The existing database was preserved; nothing was dropped or recreated.

## 5. Architectural verification — no raw data is required

Verified **from the source code and its SQL** before any production data was moved.
`backend/src/waste_equity_backend/api/routes/land_cover_cells.py` reads exactly:

* `environmental_land_cover_cell_stat_versions`
* `environmental_land_cover_cell_statistics`
* `environmental_land_cover_cell_class_areas`
* `environmental_dataset_versions` (release provenance)
* `suitability_candidates` / `suitability_analysis_runs` (already in production; the tile
  query joins the platform's own candidate geometry in place)

It **never** queries `environmental_land_cover_features` (6,901,309 rows) or
`environmental_land_cover_map_sheets` (2,013 rows). No public endpoint reads a raw
source-feature table, so **no raw data was migrated** and none was invented as a dependency.

## 6. Data-package manifest

Produced by `scripts/deploy/export-land-cover-derived-package.sh` (read-only session).
Surrogate ids (`id`, `statistics_version_id`, `land_cover_dataset_version_id`,
`cell_statistics_id`, `ingestion_run_id`) are deliberately **not** exported.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `dataset_version.json` | 1,699 | `b2770afc5c0222d2839a5d5650c507c932d7f615bf2c6297467e26fa58f22ffe` |
| `stat_version.json` | 3,087 | `38bc0780c11c3b01917b0d7e6f2fc65ab7ba710f23f490e1cf8053dbd4bb99ee` |
| `cell_statistics.csv` | 25,016,784 | `21172af92631a79180d51a2de930cae75a5d15a03603d8fe79c3ad4eca20621d` |
| `class_areas.csv` | 178,237,671 | `4092cdb104388dfb96370465bb0caa6eb58835e5a002c8bc22109c881f36a437` |
| `expected_state.json` | 612 | `6e5f1a9abd805263c9b27eedb1e9cf3fa11273b88cefa23d9dae38650de3410e` |

Transferred over SSH and re-verified with `sha256sum -c SHA256SUMS` on the server: all OK.
The package lives at `~/lc8-package` on the host and is **not** in Git.

### Tables transferred

| Table | Rows |
| --- | ---: |
| `environmental_dataset_versions` (land-cover release) | 1 |
| `environmental_land_cover_cell_stat_versions` | 1 |
| `environmental_land_cover_cell_statistics` | 47,893 |
| `environmental_land_cover_cell_class_areas` | 1,142,780 |
| `ingestion_runs` (one row recording **this import**) | 1 |

### Tables deliberately NOT transferred

| Table | Local rows | Why |
| --- | ---: | --- |
| `environmental_land_cover_features` | 6,901,309 | raw source polygons; no public runtime path reads them |
| `environmental_land_cover_map_sheets` | 2,013 | raw source map-sheet inventory; not read by any public path |

`data_sources.egis_land_cover` was created by **migration 0019**, not by the import.

## 7. Production identity mapping

Local surrogate ids were never trusted. Production identity was resolved from stable
natural keys.

| Entity | Natural key used | Local id | **Production id** |
| --- | --- | ---: | ---: |
| Land-cover dataset release | `(layer_name, provider_dataset_identifier, reference_period, source_checksum, transformation_version)` | 212 | **2** |
| Statistics release | `input_signature` = `a2abd8217d4ee69ca564aa6ade5a7562b2fa17f934b7f12fcb4c911d6f1e300f` (UNIQUE) | 1 | **1** |
| Cell statistics | `(statistics_version_id, candidate_grid_version, candidate_key)` | — | re-resolved |
| Class areas | `(cell_statistics_id, class_level, class_code)` | — | re-resolved from `candidate_key` |
| Import ingestion run | created once, on first import | 1243 (local derivation) | **600** (this import) |

`environmental_dataset_versions.ingestion_run_id` is **NULL** in production: the raw
ingestion happened only on the local development database, and naming a production run for
it would be false.

## 8. Migration

| | |
| --- | --- |
| Before | `0018` |
| Applied | `0018 → 0019` (land-cover PostGIS foundation), `0019 → 0020` (candidate-cell statistics) |
| After | `0020` |
| Heads | single head `0020` |
| Volumes | untouched — no `down -v`, no volume removal, no database recreation |

## 9. Import result and integrity gates

`scripts/deploy/import-land-cover-derived-package.sql`, one transaction, all gates inside
it so any failure rolls the whole import back.

| Gate | Result |
| --- | --- |
| 0 — target holds no raw land-cover source rows | **OK** (0 features, 0 map sheets) |
| 1 — package internally whole (counts, no orphan keys, no class row on a `NO_COVERAGE` cell) | **OK** — 47,893 cells, 1,142,780 class rows |
| 2 — production candidate-grid fingerprint recomputed and compared | **OK** — `dd327d5acb382fc725f916e63131c07ef9099d245a990f37431d85229c6c3e29`, identical to the package, 47,893 cells, zero key-set difference, zero per-cell geometry-fingerprint difference |
| 3 — canonical run for the tile endpoint is servable | **OK** — run 1, `SUCCEEDED`, 47,893 candidates |
| post — exactly one active release | **OK** (1) |
| post — cell / class row counts | **OK** — 47,893 / 1,142,780 |
| post — coverage-state counts | **OK** — `COMPLETE_EXACT` 35,902 · `PARTIAL` 4,604 · `NO_COVERAGE` 7,387 |
| post — content checksums equal the package, digit for digit | **OK** |
| post — orphan class rows / cells without a production candidate | **0 / 0** |
| post — raw source tables still empty | **OK** |

**Idempotency.** The identical package was re-imported immediately afterwards:

```
reusing existing production dataset release id 2
reusing existing production statistics release id 1
INSERT 0 0      (cell statistics)
INSERT 0 0      (class areas)
import_ingestion_run_id = (reused, none created)
COMMIT
```

Zero duplicate logical rows, no new ingestion run, no material change.

## 10. Production state after deployment

| | |
| --- | --- |
| Alembic | `0020` |
| Active land-cover statistics releases | **1** |
| Cell-statistics rows | **47,893** |
| Class-area rows | **1,142,780** |
| Failed cells | **0** |
| `COMPLETE_EXACT` / `PARTIAL` / `NO_COVERAGE` | **35,902 / 4,604 / 7,387** |
| Cell content checksum | `421be51cad458841001c001f62c74ad5` — **identical to the local baseline** |
| Raw features / map sheets | **0 / 0** |
| Orphan class rows · cells without a candidate · duplicate cells · duplicate class rows | **0 · 0 · 0 · 0** |
| Suitability runs / candidates | 3 / 143,679 — **unchanged** |
| Suitability score+rank+status+exclusion+review md5 | `66c454c2fe3cbed1093eb977f5a6ff99` — **identical to pre-deployment** |
| Database size | 4608 MB → 4883 MB |

### Unrelated data — full table-count diff

Only the intended additions appear; **every other table is unchanged**:

```
data_sources                                 10 → 11    (egis_land_cover, from migration 0019)
environmental_dataset_versions                1 →  2    (the land-cover release)
environmental_land_cover_cell_stat_versions   – →  1
environmental_land_cover_cell_statistics      – →  47893
environmental_land_cover_cell_class_areas     – →  1142780
ingestion_runs                               67 → 68    (the one import run)
```

`dataset_freshness`, `regions`, `regional_population`, `regional_waste_statistics`,
`waste_treatment_facilities`, `landfill_inbound_monthly`, `structural_*`,
`environmental_wetland_inventory_features`, `facility_standard_costs`, and all remaining
tables kept their exact pre-deployment counts.

## 11. Public routes and Caddy

The Caddyfile was **inspected and left unchanged** — it already routes everything this
release needs:

* `@backend path /api/* /health` → `backend:8000` (this covers every land-cover JSON
  endpoint **and** the MVT path, which lives under `/api/*`)
* everything else → `frontend:3000`
* automatic HTTPS with Let's Encrypt; existing certificates and Caddy storage preserved
* **no `basicauth` / `basic_auth` directive, no `remote_ip` restriction** — verified by
  reading the configuration and by the absence of any `WWW-Authenticate` header on `/`,
  the release endpoint, an MVT tile, and a suitability endpoint

**No Basic Authentication was added. No IP allowlist was added.** The public URL is the
normal, listed origin.

Interactive API docs (`/docs`, `/redoc`, `/openapi.json`) return 404 on the public origin.
That is a **pre-existing, deliberate security control** recorded in
`docs/PRODUCTION_SECURITY.md` (disabled in the app when `APP_ENV=production` and not routed
by Caddy) — it is **not** authentication, and it was deliberately left as it was. The
project's public API documentation is the versioned Markdown in `docs/`
([LAND_COVER_CELL_STATISTICS_API.md](LAND_COVER_CELL_STATISTICS_API.md) and the
`docs/API_CONTRACTS/` set), which is public in the repository.

## 12. Public verification (from outside the server)

All checks were run against `https://waste-161-33-2-143.sslip.io/` from a client machine.

### HTTPS

Valid certificate: `CN=waste-161-33-2-143.sslip.io`, issuer `Let's Encrypt YE2`, valid
`2026-07-18` → `2026-10-16`.

### API

All **28** existing public GET endpoints (`/health`, data sources/freshness, regions,
boundaries, population, waste statistics, facilities, mapping transparency, equity,
waste-reporting, landfill, facility cost, suitability, ingestion runs, wetlands) return
**200** — no regression.

Land-cover endpoints:

| Check | Result |
| --- | --- |
| Release endpoint | 200 · version 1 · `SUCCEEDED` · active · 47,893/47,893, 0 failed |
| Summary endpoint | 200 · 47,893 cells · aggregate coverage ratio 0.837036 · 7,387 cells without a dominant class · 7 L1 rows |
| Cells list | 200 |
| Candidate-cell detail | 200 · dominant L1/L2/L3 = 300/320/321 on the probed cell |
| Candidate-cell classes | 200 · 20 rows across all three levels |
| `used_in_suitability_scoring` | **false** on release, detail and classes |
| `license_status` | `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER` |
| `authorization_basis` | `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` |
| `lifecycle.production_deployment` | `PUBLIC_DEPLOYED` |
| `lifecycle.scoring_integration` | `NOT_IMPLEMENTED` |
| Attribution block | provider 기후에너지환경부 환경공간정보서비스(EGIS) · 「세분류 [2025] 전국 토지피복지도」 · 2025 · <https://aid.mcee.go.kr/intro/land.do> · `land-cover-v1` · `capital-grid-500m-v1` · statistics version 1 |
| Direct API access without credentials | **works** |

### MVT

| Tile | Status | Content-Type | Bytes | Features |
| --- | --- | --- | ---: | ---: |
| z=7 / 108 / 49 (default view) | 200 | `application/vnd.mapbox-vector-tile` | 216,084 | — |
| z=7 / 109 / 49 (capital region) | 200 | `application/vnd.mapbox-vector-tile` | 3,711,118 | 45,180 |
| z=10 / 873 / 396 | 200 | `application/vnd.mapbox-vector-tile` | 344,227 | 3,960 |
| z=13 / 6985 / 3174 | 200 | `application/vnd.mapbox-vector-tile` | 7,032 | 72 |

* Decoded source layer is **`land_cover_cells`** at every zoom, extent 4096.
* Property keys are exactly the 12 intended ones: `candidate_key`, `coverage_status`,
  `coverage_ratio`, `dominant_l1_code/name`, `dominant_l2_code/name`,
  `dominant_l3_code/name`, `sido_region_code`, `sigungu_region_code`,
  `statistics_version_id`. **No suitability field and no raw source field.**
* Production tiles are **byte-identical to the local tiles** at all three zooms
  (SHA-256 match), which independently confirms the imported data and the deterministic
  `ORDER BY candidate_key` in `ST_AsMVT`.
* One-year immutable cache preserved: `cache-control: public, max-age=31536000, immutable`,
  `etag: "lc-cells-1-1-7-109-50"`-style version-pinned ETags, and `If-None-Match` returns
  **304** with 0 bytes. **Unchanged from the implemented behaviour.**
* Direct public MVT access without credentials **works**.

### Browser QA (`frontend/e2e/publicRelease.spec.ts`, 8/8 passed)

Read-only navigation against the public origin — no failure injection, no writes.

1. Frontend serves; equity mode works; suitability mode works.
2. Land-cover layer **defaults OFF**; the legend appears exactly once when enabled.
3. Coverage mode renders with all three status filters.
4. Dominant **L1**, **L2** and **L3** all render with non-empty legends.
5. Class filters operate.
6. Layer control shows the authorization disclosure (협력 정부기관, 원본 SHP 파일 non-provision,
   scoring non-use) and the attribution with an `https://` source link — and contains **no**
   KOGL / 공공누리 / 제1유형 / 서면 승인 claim.
7. Candidate click opens the land-cover detail section showing
   `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER`,
   `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`, the attribution, and
   `used_in_suitability_scoring: false`.
8. The 데이터·출처 page carries the attribution, the status, the basis, the raw-data
   non-provision statement, scoring 미반영, and the preserved limitations
   (해안·도서 incompleteness, `NO_COVERAGE` ≠ no land cover, dominant classes computed
   independently per level).
9. The browser issues **no** request to any raw land-cover feature, map-sheet, download,
   shapefile, or CSV URL.

### Mobile QA

390 × 844 viewport: the layer control opens, the layer enables, the legend renders, the
attribution is present, and the page body does **not** scroll horizontally (overflow ≤ 1 px).

### Raw-data surface

Every probed raw/administrative path returns **404**: `…/land-cover/features`,
`…/cell-statistics/features`, `…/land-cover/map-sheets`, `…/land-cover/download`,
`…/cell-statistics/export.csv`, `…/cell-statistics/cells.csv`, `…/land-cover/shapefile`,
`/api/v1/admin/sql`, `/api/v1/db/dump`. **No CSV or SHP download endpoint exists.**

## 13. Performance (measured in production)

API, three runs each, seconds:

| Endpoint | Runs | Bytes |
| --- | --- | ---: |
| `/release` | 0.158 · 0.167 · 0.610 | 8,860 |
| `/summary` | 0.323 · 0.301 · 0.350 | 6,979 |
| `/summary?sido_code=…` | 0.196 · 0.380 · 0.177 | 6,973 |
| `/cells?limit=50` | 0.173 · 0.182 · 0.178 | 30,659 |
| candidate-cell detail | 0.132 · 0.136 · 0.161 | 6,612 |
| class distribution | 0.169 · 0.161 · 0.165 | 9,625 |

MVT, three runs each:

| Tile | Runs (s) | Bytes |
| --- | --- | ---: |
| z=7 / 108 / 49 (the default view's tile) | 0.35 | 216,084 |
| z=7 / 109 / 49 (worst case, capital region) | 5.22 · 1.95 · 1.86 | 3,711,118 |
| z=10 / 873 / 396 | 0.384 · 0.387 · 0.375 | 344,227 |
| z=13 / 6985 / 3174 | 0.135 · 0.134 · 0.132 | 7,032 |
| z=7 revalidation with `If-None-Match` | 0.170 → **304**, 0 bytes | 0 |

Browser, real production:

* **Initial page load** — TTFB 183 ms, DOMContentLoaded 314 ms, load event 459 ms, map
  canvas visible 2,458 ms.
* **Layer activation at the default view** — 1 tile (z=7/108/49), 216,084 bytes, slowest
  tile 527 ms, enable→legend **114 ms**, enable→settled **4,125 ms**.

> **Superseded by Phase 1B-LC9 (2026-08-02).** The measurements in §13 below remain a
> correct record of what LC8 deployed and measured; they are **not** the current
> production behaviour. LC9 enabled zstd/gzip for the vector-tile media type and removed
> the JIT-compilation and double-`ST_AsMVTGeom` cost from the tile query, without changing
> one byte of tile content. Current figures: the z7/109/49 worst case transfers
> **552,276 B** (was 3,711,118 B), warm total **1.417 s** (was 2.778 s), TTFB **0.744 s**
> (was 1.442 s), and layer enable→settled is **2,258 ms** (was 4,125 ms). See
> [LAND_COVER_LC9_PUBLIC_PERFORMANCE_REPORT.md](LAND_COVER_LC9_PUBLIC_PERFORMANCE_REPORT.md).

### The low-zoom tile problem is NOT solved

LC6 flagged a large low-zoom tile and slow settlement locally. In production:

* the **default view is fine** — one 216 KB tile, legend in ~114 ms;
* the **worst-case low-zoom tile is genuinely large**: z=7/109/49 carries 45,180 of the
  47,893 cells at **3.71 MB** and takes **~1.9–5.2 s**. A user who pans east at zoom 7 will
  fetch it;
* **settling still takes ~4.1 s** after enabling the layer at the default view, versus
  ~8.1 s measured locally — better, but not fast;
* **the MVT responses are not compressed in transit.** Verified: Caddy gzips the HTML
  (`content-encoding: gzip`) but sends `application/vnd.mapbox-vector-tile` uncompressed, so
  the full 3.71 MB is transferred.

**No optimization was applied in this phase, deliberately.** The candidate fixes are either
content changes (geometry simplification, property dropping, a source `minzoom`) — which
would alter the served tile and amount to redesigning the derivation during a deployment —
or a Caddy change, which this phase's constraints reserve for exposing an otherwise
unreachable route. The layer is **off by default**, every tile is version-pinned and cached
one year immutable, and revalidation returns 304 in 170 ms, so the cost is paid at most once
per tile per client. Enabling compression for the MVT content type is the obvious next
step and is recorded here as measured, not as done.

## 14. Public attribution and disclosures shown

Displayed on the land-cover layer control, the candidate-detail land-cover section, the
데이터·출처 page, and in every API response:

```
출처: 기후에너지환경부 환경공간정보서비스(EGIS), 「세분류 [2025] 전국 토지피복지도」.
Waste Equity Platform이 서울·인천·경기 500 m 후보격자 단위로 가공한 파생 통계입니다.
```

```
본 플랫폼은 협력 정부기관이 확인한 프로젝트 차원의 공공데이터 활용 범위에 따라 공개
운영됩니다. 토지피복 정보는 EGIS 「세분류 [2025] 전국 토지피복지도」를 Waste Equity
Platform의 500 m 후보격자 단위로 가공한 파생 통계입니다. 원본 SHP 파일, 원본 토지피복
도형 및 원본 개별 피처 레코드는 제공하지 않습니다.
```

> Public deployment of the derived land-cover services is authorized for the Waste Equity
> Platform under project-level authorization from its cooperating government institution.
> This operational authorization does not assert a dataset-specific EGIS KOGL type. Original
> SHP files, raw source polygons, and raw per-feature source records are not redistributed.

Machine-readable: provider · dataset title · reference period 2025 · official source URL
<https://aid.mcee.go.kr/intro/land.do> (revalidated live on 2026-08-02; the historic
`egis.me.go.kr` host still resolves and redirects here) · transformation version
`land-cover-v1` · candidate grid `capital-grid-500m-v1` · statistics derivation version
`land-cover-cell-stats-v1` · statistics version id · raw-source-not-returned statement ·
authorization status and basis.

**Preserved limitations** (publication did not hide them): coastal and island coverage may
be incomplete; `NO_COVERAGE` means only that the acquired extent does not evaluate the cell,
never that the real world has no land cover; dominant L1/L2/L3 are computed independently
per level and need not form a nested path; land cover is descriptive, not a legal
determination; land cover is not used in suitability scoring.

## 15. Land-cover scoring status — unchanged

`used_in_suitability_scoring = false`. `lifecycle.scoring_integration = NOT_IMPLEMENTED`.
No suitability total score, rank, candidate status, exclusion, review reason, weight, policy
version, or derivation version reads the land-cover statistics. **No land-cover scoring
integration is part of LC8.** The production suitability checksum is identical before and
after deployment.

## 16. Confirmations

* ✅ **Original SHP files were not deployed.** None left the local machine.
* ✅ **Raw source polygons are not publicly exposed.** `environmental_land_cover_features`
  and `environmental_land_cover_map_sheets` hold **0 rows** in production, and no endpoint
  reads them.
* ✅ **Land cover remains excluded from suitability scoring.**
* ✅ **Suitability scores, ranks, statuses, exclusions, and review reasons did not change**
  (md5 `66c454c2fe3cbed1093eb977f5a6ff99` before and after).
* ✅ **Unrelated datasets did not change** (full table-count diff in §10).
* ✅ **No Basic Authentication and no IP allowlist were added.**
* ✅ **All existing LC3–LC6 public functionality is active.**
* ✅ **`docs/SUITABILITY_SITE_CLUSTERS_SPEC.md` remained untouched and unstaged.**
* ✅ Production Docker volumes, database, Caddy certificates and storage, networks, and DNS
  were preserved. No `down -v`, no volume removal, no prune, no destructive SQL.

## 17. Known, honestly-recorded caveats

1. **Low-zoom tile cost** — see §13. Measured, not solved *in LC8*. **Resolved in Phase
   1B-LC9** (2026-08-02): the worst tile now transfers 552,276 B instead of 3,711,118 B
   and its query runs in 579.6 ms instead of 1281.9 ms, with byte-identical content.
2. **MVT responses are transferred uncompressed** — measured (§13). Not changed in LC8.
   **Resolved in Phase 1B-LC9**: a scoped Caddy `encode` now serves zstd/gzip for
   `application/vnd.mapbox-vector-tile`, with `Vary: Accept-Encoding`, per-encoding ETags
   and a working 304 path.
3. **Derivation-time audit fields describe the local run set.** The release's
   `candidate_row_count` (95,786) and the per-cell `candidate_occurrence_count` /
   `representation_variant_count` describe the runs that existed when LC3 derived the
   statistics (2 runs locally). Production holds **3** runs of the same grid version, so its
   occurrence count is 143,679. The release is an immutable derived artifact and was
   transferred verbatim rather than re-derived; the canonical geometry is identical in both
   (fingerprint `dd327d5a…`, canonical run 1), which is what every measurement was taken on.
4. **`derivation_metadata.numerical_guard` contains one stale sentence** ("COMPLETE_EXACT is
   decided by ST_Covers alone") that the adjacent `coverage_semantics` key corrects. This is
   a **pre-existing** LC3 artifact, transferred verbatim rather than edited.
5. **Interactive API docs are not on the public origin** — a pre-existing deliberate
   security control, not authentication (§11).
6. **LC7's dataset-specific licence question remains unresolved** as a matter of public
   evidence. Publication rests on the project-level authorization, and no EGIS KOGL type is
   asserted anywhere.

## 18. Rollback

Prefer, in order: (a) feature-level rollback, (b) application-commit rollback, (c) database
restore. **Do not delete the production Docker volume in any of them.**

### (a) Feature-level — disable only the public land-cover feature

Deactivating the release makes every land-cover endpoint return a structured 404
(`NO_ACTIVE_STATISTICS_RELEASE`) and disables the map layer; everything else is untouched.

```bash
cd /home/ubuntu/waste-equity-platform
docker compose -p waste-equity-prod exec -T database \
  psql -U waste_equity_prod -d waste_equity -v ON_ERROR_STOP=1 -c \
  "UPDATE environmental_land_cover_cell_stat_versions SET is_active = false WHERE id = 1;"
```

Re-enable by setting `is_active = true` for id 1. Reversible, no data loss.

### (b) Application-commit rollback

```bash
cd /home/ubuntu/waste-equity-platform
git fetch origin
git checkout 39413a3570d62c58298ed63a52e1754142579259   # previous deployed commit
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  build backend frontend
docker compose -p waste-equity-prod --env-file .env.production -f docker-compose.prod.yml \
  up -d --no-deps backend frontend
```

Previous images: `waste-equity-prod-backend` / `waste-equity-prod-frontend` built from
`39413a3`. The current images are tagged `:latest`; if the previous image ids are still
present locally (`docker images`), they can be retagged instead of rebuilt. Migrations
0019/0020 are additive — the older application code simply ignores the new tables, so no
downgrade is required for a code-only rollback.

### (c) Database restore (last resort)

```bash
cd /home/ubuntu/deployment-backups/lc8-20260802T103903Z
sha256sum -c SHA256SUM      # must print OK for bd76c914…32c6
CID=$(docker compose -p waste-equity-prod -f /home/ubuntu/waste-equity-platform/docker-compose.prod.yml ps -q database)
docker cp waste_equity-pre-lc8-20260802T103903Z.dump "$CID:/tmp/restore.dump"
docker exec "$CID" pg_restore --list /tmp/restore.dump | head    # validate before restoring
# Restore into a NEW database first and verify, rather than overwriting in place:
docker exec "$CID" createdb -U waste_equity_prod waste_equity_restore
docker exec "$CID" pg_restore -U waste_equity_prod -d waste_equity_restore \
  --no-owner --no-privileges /tmp/restore.dump
```

Then verify the restored copy and only afterwards repoint the application. **Never** run
`docker compose down -v`, `docker volume rm`, or `DROP DATABASE waste_equity`.

### Verifying any rollback

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://waste-161-33-2-143.sslip.io/
curl -s https://waste-161-33-2-143.sslip.io/api/v1/suitability/runs/latest | head -c 200
# Suitability integrity — must still be 66c454c2fe3cbed1093eb977f5a6ff99
docker compose -p waste-equity-prod exec -T database psql -U waste_equity_prod -d waste_equity -tAc \
  "select md5(string_agg(coalesce(total_score::text,'N')||':'||coalesce(rank::text,'N')||':'||status||':'||coalesce(exclusion_reasons::text,'N')||':'||coalesce(review_reasons::text,'N'), '|' order by analysis_run_id, candidate_key)) from suitability_candidates"
```

---

**Exact public URL:** <https://waste-161-33-2-143.sslip.io/>
