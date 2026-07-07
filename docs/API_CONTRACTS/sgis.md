# API Contract: SGIS

Source: SGIS OpenAPI.

Official references:

- https://sgis.kostat.go.kr/developer/html/openApi/api/data.html
- https://sgis.kostat.go.kr/developer/html/newOpenApi/api/dataApi/basics.html
- https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html

Live validation status: LIVE_VERIFIED for the population endpoint; boundary endpoint remains SCHEMA_UNVERIFIED.

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
- Feature properties include administrative code and name fields.

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
- Population records include administrative code and reference year.

## Coordinate Systems

SGIS documents coordinate transformation support for WGS84, Google Mercator, UTM-K, and Korean projected coordinate systems. The platform must store source CRS and transformed CRS for every spatial operation.

## Phase 0.5 Result

Live probe:

- Endpoint: `OpenAPI3/stats/population.json`.
- Parameters: `year=2020`, `adm_cd=11`, `low_search=1`.
- Provider result: `errCd=0`.
- Schema validation: LIVE_VERIFIED for `result`.
- Observed coverage: 25 Seoul district-level population records.
- Sample: `data/samples/sgis.live.json`.

Remaining validation:

- Seoul boundary endpoint.
- Incheon population and boundary codes.
- Gyeonggi-do population and boundary codes.
- Population-grid endpoint selection.
