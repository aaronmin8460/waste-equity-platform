# Waste Equity Ingestion

This directory contains API probes and explicit one-shot production ingestion
jobs. Phase 2.1 implements only SGIS canonical geography and total population
ingestion.

Current constraints:

- Do not create fake official datasets.
- Do not silently fall back to fixtures after live API failure.
- Do not print or save credentials.
- Do not print the RCIS `USRID` value configured as `RCIS_USER_ID`.
- Do not print or store SGIS access-token values.
- Save only sanitized samples under `data/samples/`.
- Production ingestion runs only through an explicit CLI command; there is no
  scheduler in this phase.

## Package Dependency Direction

Production ingestion imports the backend package's SQLAlchemy models and
database settings. This keeps one database model layer in the repository. Local
development should install both packages into the same Python 3.11+ environment
or set `PYTHONPATH=backend/src:ingestion/src`.

## Environment Variables

See [API Authentication](../docs/API_AUTHENTICATION.md).

The package loads `.env` with `python-dotenv` from the current directory or a
parent project directory when the file exists. Credential values are never
printed or saved.

SGIS production ingestion requires:

- `SGIS_CONSUMER_KEY`
- `SGIS_CONSUMER_SECRET`
- `DATABASE_URL` for write mode

## Probe Semantics

- Missing credentials exit distinctly from remote API failure.
- HTTP status and provider-level result codes are both validated.
- Samples are marked `LIVE_VERIFIED` or `FIXTURE_ONLY`.
- Fixture tests validate response-shape handling only and must not be presented as real public data.

## SGIS Production Ingestion

Selected reference year: `2024`.

Reason: live validation found 2025 boundaries are available, but 2025 SGIS
population returns provider `errCd=-100` for Seoul, Incheon, and Gyeonggi-do.
2024 is the latest year where population and administrative boundaries both
return successful responses across the full 수도권 scope.

Official endpoints:

- Authentication: `OpenAPI3/auth/authentication.json`
- Population: `OpenAPI3/stats/population.json`
- Administrative boundary: `OpenAPI3/boundary/hadmarea.geojson`

Coordinate handling:

- Source CRS: EPSG:5179, SGIS UTM-K meter coordinates.
- Target CRS: EPSG:4326 in PostGIS.
- Geometry is normalized to MultiPolygon.
- Invalid polygonal geometry is repaired only with deterministic
  `shapely.make_valid` polygonal extraction; unrepaired invalid or empty
  geometry fails the run.

Coverage:

- Seoul special city plus 25 autonomous districts.
- Incheon metropolitan city plus the 10 counties/districts valid in SGIS 2024
  data. The 2026 Incheon administrative restructuring is not forced onto 2024
  data.
- Gyeonggi-do plus 44 SGIS-native 5-digit child areas. Some large-city
  administrative districts appear because SGIS natively returns them at this
  level; they are preserved as SGIS `SIGUNGU` level and are not collapsed into
  city/county records.

Dry run:

```bash
PYTHONPATH=../backend/src:src \
  python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 --scope capital-region --dry-run
```

Write against a local database:

```bash
PYTHONPATH=../backend/src:src \
DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
  python -m waste_equity_ingestion.cli sgis-ingest \
  --year 2024 --scope capital-region --write
```

Write through Docker Compose:

```bash
docker compose --profile ingestion run --rm ingestion \
  sgis-ingest --year 2024 --scope capital-region --write
```

Idempotency policy:

- `regions` is unique by canonical region code and validity start date.
- `regional_population` is unique by region, reference year, source, and
  population definition.
- `region_code_map` is unique by canonical region code and validity start date.
- Raw responses are append-only by exact sanitized response hash and endpoint.
  SGIS includes fresh transaction metadata in each live data response, so
  identical normalized data can still create new raw response rows. Normalized
  regions and population rows must not duplicate.
- Existing normalized rows may be updated with the latest ingestion-run
  provenance.

SGIS region codes are stored as SGIS codes only. Later RCIS and VWorld phases
must build reviewed cross-source mappings; Phase 2.1 leaves cross-source review
status as `NEEDS_REVIEW`.

## Probe Commands

Probe commands remain available for Phase 0 source validation:

```bash
python -m waste_equity_ingestion.cli airkorea --save-sample
python -m waste_equity_ingestion.cli sgis --save-sample
python -m waste_equity_ingestion.cli kma --save-sample
python -m waste_equity_ingestion.cli vworld --save-sample
python -m waste_equity_ingestion.cli waste-statistics

# Phase 0.7 RCIS PID discovery: probe the documented target PIDs (default)
# or an explicit list, and save sanitized truncated samples per PID/year.
python -m waste_equity_ingestion.cli waste-statistics-discovery --year 2023 --save-sample
python -m waste_equity_ingestion.cli waste-statistics-discovery --pids NTN007,NTN018 --year 2024
```

Discovery respects the documented provider quota (100 calls/minute, 3,000 calls/day) with an inter-request delay, and classifies each PID as `LIVE_VERIFIED`, `NO_DATA_FOR_CONDITION` (`E099`), `PROVIDER_ERROR`, `SCHEMA_UNVERIFIED`, or `HTTP_ERROR`.

Run tests after dependencies are installed:

```bash
PYTHONPATH=../backend/src:src pytest tests
TEST_DATABASE_URL=postgresql+psycopg://waste_equity:waste_equity@localhost:5432/waste_equity \
RUN_LIVE_SGIS=1 \
  PYTHONPATH=../backend/src:src pytest tests/test_sgis_integration.py
```

Phase 0.5 live result:

- SGIS: LIVE_VERIFIED, sample saved to `data/samples/sgis.live.json`.
- VWorld: LIVE_VERIFIED, sample saved to `data/samples/vworld.live.json`.
- Waste statistics: LIVE_VERIFIED for `wss/JsonApi/NTN001`, `YEAR=2024`; sanitized sample saved to `data/samples/waste-statistics.live.json`. This PID verifies the management-area table only, not waste generation or treatment quantities.
- AirKorea, KMA: CREDENTIAL_MISSING.

Phase 0.7 live result (2026-07-08):

- RCIS generation/treatment PIDs (`NTN007`, `NTN008`, `NTN018`, `NTN022`) and facility PIDs (`NTN031`, `NTN032`, `NTN033`, `NTN040`, `NTN043`, `NTN046`): LIVE_VERIFIED at sigungu granularity for 2023 and 2024; sanitized truncated samples saved as `data/samples/waste-statistics.<PID>.<YEAR>.live.json`.
- `NTN044`: SCHEMA_UNVERIFIED (single placeholder-like record).
- See `docs/API_CONTRACTS/waste_statistics.md` for the full PID contract.
