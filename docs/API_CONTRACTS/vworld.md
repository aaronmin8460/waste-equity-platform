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
