# API Contract: VWorld

Source: VWorld spatial-data services.

Official references:

- https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do
- https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral
- https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30563
- https://www.data.go.kr/data/15123973/openapi.do
- https://www.data.go.kr/data/15123976/openapi.do

Live validation status: LIVE_VERIFIED for a cadastral 2D Data API feature request.

## Authentication

Required environment variable:

- `VWORLD_API_KEY`

Optional environment variable:

- `VWORLD_API_DOMAIN`

Request parameter:

- `key`
- `domain` when required for the registered key/request context

## WMS/WFS

WMS endpoint:

`https://api.vworld.kr/req/wms`

WFS endpoint:

`https://api.vworld.kr/req/wfs`

Use WFS or 2D Data API for analytical screening whenever feature geometry and attributes are required. WMS-only layers are visualization inputs unless source feature data are separately available.

## 2D Data API

Endpoint:

`https://api.vworld.kr/req/data`

Example operation:

- `request=GetFeature`
- `data=LP_PA_CBND_BUBUN` for continuous cadastral map

Success criteria:

- HTTP status 200.
- Response `status` is `OK`.

## Cadastral Fields

Official cadastral reference documents fields including:

- `pnu`
- `jibun`
- `bonbun`
- `bubun`
- `ag_geom`
- `addr`
- `gosi_year`
- `gosi_month`
- `jiga`

Continuous cadastral maps are reference drawings and must not be treated as surveying-grade cadastral evidence.

## Coordinate Systems

VWorld 2D Data API supports CRS values including EPSG:4326, EPSG:3857, EPSG:900913, EPSG:5179, EPSG:5180-5188, and EPSG:4019. Store requested CRS and source CRS in metadata.

## Query Limits

VWorld documents area limits for polygon, multipolygon, and box geometry filters. Large-area data should use official downloads or tiled/batched requests that respect provider limits.

## Phase 0.5 Result

Live probe:

- Endpoint: `req/data GetFeature LP_PA_CBND_BUBUN`.
- Parameters: small Seoul bounding box, `format=json`, `crs=EPSG:4326`, `size=1`.
- Provider result: `response.status=OK`.
- Schema validation: LIVE_VERIFIED for `response.result.featureCollection`.
- Observed fields: `pnu`, `jibun`, `bonbun`, `bubun`, `addr`, `gosi_year`, `gosi_month`, and `jiga`.
- Sample: `data/samples/vworld.live.json`.

Remaining validation:

- Full Seoul/Incheon/Gyeonggi coverage strategy.
- Zoning and land-use restriction layers.
- Public land ownership layers.
- Protected-area layers.
- Road accessibility layers.
- Sensitive-facility layers.

## Geocoder (Phase 2.4 Contract)

Live validation date: 2026-07-09. Status: LIVE_VERIFIED.

- Endpoint: `https://api.vworld.kr/req/address`.
- Operation: `service=address`, `request=getcoord`, `version=2.0`, `format=json`.
- Authentication: `key` query parameter mapped from `VWORLD_API_KEY` (never logged; strip from any stored URL or sample).
- Request fields: `address` (free-text Korean address), `type` (`ROAD` or `PARCEL`), `crs` (request `epsg:4326`), `refine=true`, `simple=false`.
- Provider status field: `response.status` with observed values `OK`, `NOT_FOUND`, `ERROR`. Only `OK` carries a coordinate.
- Coordinate: `response.result.point.{x,y}` as strings in the requested CRS; `response.result.crs` echoes `EPSG:4326`.
- Refined address: `response.refined.text` plus `response.refined.structure.level1` (sido), `level2` (sigungu, including multi-district form such as `고양시 일산동구`), `level4AC` (legal-dong code; its 5-digit prefix identifies the sigungu), `level4A`/`level3` (dong).

Live-verified request shapes using real `waste_treatment_facilities` addresses:

| Shape | `type` | Example input | Result |
| --- | --- | --- | --- |
| Sigungu-prefixed road address with district | `ROAD` | `고양시 일산동구 견달산로225번길 26-16` | `OK`, point returned, refined resolves `경기도 고양시 일산동구 ... (식사동)`, `level4AC=4128551000` |
| Parcel (지번) address | `PARCEL` | `경기도 용인시 처인구 남사읍 완장리 498-1` | `OK`, point returned |
| Bare RCIS road address prefixed with RCIS sido+sigungu | `ROAD` | `인천 남동구 고잔로 61` | `OK`, refined resolves `인천광역시 남동구 고잔로 61 (고잔동)` |

Sanitized sample: `data/samples/vworld-geocoder.live.json` (ignored by Git).

Phase 2.4 usage rules:

- Build the query address as RCIS `sido name + sigungu name + ADDR` unless `ADDR` already embeds them; strip trailing parenthetical dong hints only if the geocoder rejects the raw form.
- Try `ROAD` first, fall back to `PARCEL` on `NOT_FOUND` (RCIS mixes both styles).
- `NOT_FOUND`/`ERROR` results must keep `geometry` NULL with an explicit failure status; coordinates must never be fabricated or approximated.
- Region resolution uses point-in-polygon against SGIS region geometry as the primary signal, with the `level4AC` sigungu prefix and RCIS sido name as independent cross-checks; disagreements are flagged for review, not silently accepted.
- Respect provider quotas with an inter-request delay; the documented daily quota for the address API is provider-controlled and request pacing must be configurable.
