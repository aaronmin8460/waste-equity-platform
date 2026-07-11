# API Contract: VWorld

Source: VWorld spatial-data services.

Official references:

- https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do
- https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do
- https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral
- https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30563
- https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=46 (토지소유정보 WFS)
- https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=50 (토지이용계획 WFS)
- https://www.data.go.kr/data/15123973/openapi.do
- https://www.data.go.kr/data/15123976/openapi.do

Live validation status: LIVE_VERIFIED for a cadastral 2D Data API feature
request (Phase 0.5), the geocoder (Phase 2.4), and the Phase 2.5A structural
layers below.

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

Documented hard caps (re-verified 2026-07-11): WFS `maxFeatures` ≤ 1000 and
≤ 4 typenames per request; 2D Data API `size` ≤ 1000 per page; WMS ≤ 5 layers
per request; NED APIs `maxFeatures` ≤ 1000. Only the geocoder has a fixed
documented daily quota (40,000); other APIs are load-throttled at the
operator's discretion (terms 제13조, error code `OVER_REQUEST_LIMIT`). The
Phase 0.5 note about a documented geomFilter area limit could not be
re-verified on the current 2.0 reference pages; treat any live area cap as
undocumented behavior. Large-area data should use official downloads or
tiled/batched requests that respect provider limits.

Licensing caveat: the VWorld portal terms (제19조) state service data must
not be stored without prior consent, while data.go.kr listings for the same
services state KOGL Type 1/제한 없음 and dtmk bulk datasets carry per-dataset
licenses (several LSMD zone sets CC BY-NC-ND). Resolution is a Phase 2.5B
precondition; see `docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`.

## Phase 0.5 Result

Live probe:

- Endpoint: `req/data GetFeature LP_PA_CBND_BUBUN`.
- Parameters: small Seoul bounding box, `format=json`, `crs=EPSG:4326`, `size=1`.
- Provider result: `response.status=OK`.
- Schema validation: LIVE_VERIFIED for `response.result.featureCollection`.
- Observed fields: `pnu`, `jibun`, `bonbun`, `bubun`, `addr`, `gosi_year`, `gosi_month`, and `jiga`.
- Sample: `data/samples/vworld.live.json`.

Remaining validation after Phase 0.5 (zoning, land-use restriction, public
land ownership, protected-area, and road layers) was completed by the Phase
2.5A structural-layer audit below. Full Seoul/Incheon/Gyeonggi coverage
completeness remains a Phase 2.5B production-ingestion task.

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

## Structural Spatial Layers (Phase 2.5A Contract)

Live validation date: 2026-07-11. Status: LIVE_VERIFIED for the 14 structural
layers (WFS and 2D Data API) and the 2 NED layers listed in
`docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`. Probe command:

```bash
PYTHONPATH=backend/src:ingestion/src \
  python -m waste_equity_ingestion.cli vworld-structural-audit --save-sample
```

### WFS (`req/wfs`, version 1.1.0, `output=application/json`)

- `bbox` is lat-first for EPSG:4326 (`ymin,xmin,ymax,xmax,EPSG:4326`);
  request `srsname=EPSG:4326` explicitly (documented default is EPSG:900913).
- Success is a GeoJSON FeatureCollection (`totalFeatures`, `numberMatched`,
  `numberReturned`, per-feature `id`, `crs` on non-empty responses). There is
  no separate provider status field; reject any non-FeatureCollection body.
- `maxFeatures` ≤ 1000. **`startindex` did not page under version 1.1.0**
  (identical feature at index 0 and 1; the parameter is documented for
  2.0.0 only) — do not build coverage on WFS paging.

### 2D Data API (`req/data`, version 2.0)

- `response.status`: `OK` | `NOT_FOUND` (empty result, not an error) |
  `ERROR` with `response.error{level,code,text}`.
- Pagination verified: `page{current,total,size}` + `record{total,current}`;
  `size` ≤ 1000; `page=2` returns the next distinct feature.
- `geomFilter=BOX(minx,miny,maxx,maxy)` is lon-first even for EPSG:4326
  (opposite of the WFS bbox axis order).
- Some layers return a reduced attribute subset versus WFS (e.g.
  `LT_C_UQ111`: 5 fields vs 15 over WFS).
- **Error-body defect (live-observed):** an ERROR response can be invalid
  JSON (unescaped quotes inside `error.text`). Error handling must not
  assume the ERROR body parses; see
  `waste_equity_ingestion.probes.vworld_structural.parse_provider_error_text`.

### NED National Core Data WFS (`/ned/wfs/getPossessionWFS`, `/ned/wfs/getLandUseWFS`)

- `typename=dt_d160` (토지소유공간정보) and `typename=dt_d154`
  (토지이용계획공간정보); GeoJSON FeatureCollection with explicit EPSG:4326
  CRS; `maxFeatures` ≤ 1000; documented quota 999,999,999/day.
- `dt_d160` ownership classification fields (`posesn_se_code`,
  `nation_instt_se_code`) were null in 2 of 3 probed parcels — completeness
  unvalidated.

### Phase 2.4 Live Run Result (2026-07-09)

- 651 facilities considered; 547 geocoded to EPSG:4326 points (all inside the
  Korea bounding box, SRID 4326 verified).
- 97 of 99 `REQUIRES_GEOCODE` multi-district-city facilities resolved to
  `GEOCODED_MATCH` via point-in-polygon with sido/city/`level4AC` cross-checks;
  the remaining 2 had non-geocodable addresses.
- 104 addresses returned provider `NOT_FOUND` across the full attempt ladder
  (site names such as `자원순환센터`, island facilities, building names).
  They keep `geometry` NULL with `geocode_status = 'FAILED'` and are the
  documented review queue; no coordinate was fabricated.
- Zero point-in-polygon disagreements against the 450 geocoded `EXACT_MATCH`
  facilities, independently confirming the Phase 2.3 name-based mapping.
- Identical second run: zero API calls, zero row changes (live-verified).
