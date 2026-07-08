# API Contract: SGIS

Source: SGIS OpenAPI.

Official references:

- https://sgis.kostat.go.kr/developer/html/openApi/api/data.html
- https://sgis.kostat.go.kr/developer/html/newOpenApi/api/dataApi/basics.html
- https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html

Live validation status: LIVE_VERIFIED for authentication, population, and
administrative-boundary endpoints for Seoul, Incheon, and Gyeonggi-do.

Phase 2.1 selected reference year: `2024`.

Reason: live validation showed `2025` boundaries were available but `2025`
population returned provider error `errCd=-100`. `2024` was the latest
mutually compatible year across Seoul, Incheon, and Gyeonggi-do for both
population and boundaries.

## Authentication

Endpoint:

`https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json`

Required environment variables:

- `SGIS_CONSUMER_KEY`
- `SGIS_CONSUMER_SECRET`

Success criteria:

- HTTP status 200.
- JSON body has `errCd` equal to `0`.
- `result.accessToken` is present.
- `result.accessTimeout` is present when provided by SGIS.

Handling rules:

- Access tokens are used only in memory for the current request sequence.
- Access tokens, consumer keys, and consumer secrets must not be stored,
  printed, or logged.
- Credential-bearing URLs must not be stored as raw-response metadata.

## Boundary Endpoint

Endpoint:

`https://sgisapi.kostat.go.kr/OpenAPI3/boundary/hadmarea.geojson`

Expected parameters:

- `accessToken`
- `year`
- `adm_cd`
- `low_search`

Expected response:

- GeoJSON feature collection.
- `features[*].properties.adm_cd` contains the SGIS administrative code.
- `features[*].properties.adm_nm` contains the official Korean name.
- `features[*].geometry` contains polygonal administrative-boundary geometry.

Phase 2.1 observed coverage for `year=2024`:

| Scope | SIDO code | SIDO record | Child records with `low_search=1` |
| --- | --- | --- | --- |
| Seoul | `11` | 1 | 25 autonomous districts |
| Incheon | `23` | 1 | 10 counties/districts for the 2024 reference period |
| Gyeonggi-do | `31` | 1 | 44 SGIS-native child regions |

Validation rules:

- Pseudo-regions, totals, summaries, and provider metadata are not inserted as
  canonical regions.
- Boundary features are joined to population records by exact SGIS `adm_cd`.
- Duplicate boundary features for the same SGIS code block ingestion.
- Empty or non-polygonal geometries block ingestion.
- Invalid geometries are repaired only with the documented deterministic
  `shapely.make_valid` polygonal repair path, and only when the repaired
  geometry is valid and non-empty.
- Polygon geometries are normalized to MultiPolygon for PostGIS storage.

## Population Endpoint

Endpoint:

`https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json`

Expected parameters:

- `accessToken`
- `year`
- `adm_cd`
- `low_search`

Success criteria:

- HTTP status 200.
- JSON body has `errCd` equal to `0`.
- `result[*].adm_cd` contains the SGIS administrative code.
- `result[*].adm_nm` contains the official Korean name.
- `result[*].tot_ppltn` contains total population.
- Population records include the requested reference year.

Phase 2.1 observed coverage for `year=2024`:

| Scope | SIDO code | SIDO record | Child records with `low_search=1` |
| --- | --- | --- | --- |
| Seoul | `11` | 1 | 25 autonomous districts |
| Incheon | `23` | 1 | 10 counties/districts for the 2024 reference period |
| Gyeonggi-do | `31` | 1 | 44 SGIS-native child regions |

Validation rules:

- Population is stored as numeric non-negative persons.
- Zero population and null or blank population are distinct. Zero is accepted;
  null or blank values block ingestion.
- Duplicate population records for the same SGIS code block ingestion.
- Unexpected administrative-code depth for the requested level blocks
  ingestion.
- Population and boundary records must use the same selected reference year
  unless a future phase explicitly documents a mismatch and warning.

## Coordinate Systems

SGIS documents coordinate transformation support for WGS84, Google Mercator,
UTM-K, and Korean projected coordinate systems.

Phase 2.1 boundary responses did not include a GeoJSON `crs` member. Observed
boundary coordinates were meter-scale coordinates, and SGIS documentation lists
UTM-K (GRS80) as EPSG:5179. A live SGIS coordinate-conversion check on an
observed Seoul boundary coordinate converted EPSG:5179 to plausible WGS84
longitude/latitude near Seoul.

Production ingestion therefore records:

- Source CRS: `EPSG:5179`.
- Target storage CRS: `EPSG:4326`.
- Storage geometry type: `MULTIPOLYGON`.
- Storage SRID: `4326`.

If SGIS changes boundary CRS metadata or coordinate conventions, ingestion must
fail closed until the source CRS is revalidated.

## Phase 2.1 Production Ingestion Contract

The production command is explicit and credentialed through environment
variables:

```bash
python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 \
  --scope capital-region \
  --dry-run

python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 \
  --scope capital-region \
  --write
```

The CLI stores sanitized raw official responses in `raw_api_responses`, creates
visible `ingestion_runs`, upserts canonical SGIS-backed regions, upserts
normalized population records, and updates `dataset_freshness` only after a
successful write.

Raw response policy:

- Authentication responses and access tokens are not stored.
- Official data responses are stored after token and credential redaction.
- SGIS data responses are retained by exact sanitized response hash, endpoint,
  reference period, and transformation version.
- Because SGIS may include provider transaction metadata, repeated live writes
  can add raw response rows while normalized region and population rows remain
  idempotent.

Only SGIS canonical geography and total population ingestion are implemented in
Phase 2.1. RCIS, VWorld, AirKorea, KMA, metrics, scheduling, frontend work, and
facility recommendation logic remain out of scope.

## Phase 0.5 Result

Live probe:

- Endpoint: `OpenAPI3/stats/population.json`.
- Parameters: `year=2020`, `adm_cd=11`, `low_search=1`.
- Provider result: `errCd=0`.
- Schema validation: LIVE_VERIFIED for `result`.
- Observed coverage: 25 Seoul district-level population records.
- Sample: `data/samples/sgis.live.json`.

Remaining validation:

- Population-grid endpoint selection.

## Phase 2.1 Follow-Up

The earlier Phase 0.5 gaps for administrative boundaries, Incheon coverage, and
Gyeonggi-do coverage are resolved for the Phase 2.1 SGIS canonical geography
scope by the `2024` live contract validation above.
