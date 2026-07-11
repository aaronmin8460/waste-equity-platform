# Data Source Audit

Phase: Real Data Audit and API Feasibility Validation.

Audit date: 2026-07-07.

Scope: Seoul Metropolitan Area, covering Seoul, Incheon, and Gyeonggi-do.

This audit uses only official primary documentation from the required source families. Phase 0.5 added local live validation for SGIS and VWorld where credentials were configured. Phase 0.6 live-verified RCIS `wss/JsonApi/NTN001` for `YEAR=2024`.

## Source Status Summary

| Source | Feasibility | Live validation | Main risk |
| --- | --- | --- | --- |
| Korea Environment Corporation Resource Circulation Information System waste statistics API | Feasible | LIVE_VERIFIED for generation/treatment/facility PIDs at sigungu granularity (Phase 0.7, 2023 and 2024) | Region identifiers are Korean names without codes; aggregate `합계`/`소계` rows are embedded in data; origin-to-destination movement remains unavailable. |
| SGIS population and administrative boundary APIs | Feasible | LIVE_VERIFIED | Seoul district-level population probe returned 25 records; other regions and boundary endpoint still need live probes. |
| AirKorea real-time air-quality and station APIs | Feasible | CREDENTIAL_MISSING | Real-time observations are contextual and must not be used as permanent siting evidence. |
| Korea Meteorological Administration short-term forecast API | Feasible | CREDENTIAL_MISSING | Candidate sites must be converted to KMA forecast grid coordinates, and one request covers one grid/time query. |
| VWorld spatial-data services | Feasible with licensing review | LIVE_VERIFIED | Cadastral, geocoder, and (Phase 2.5A) 16 structural layers live-verified; storage-consent/NC-ND licensing conflict and bulk-download reproducibility remain (see `VWORLD_STRUCTURAL_LAYER_AUDIT.md`). |

## Official References

- Waste statistics API: https://www.data.go.kr/data/15106003/openapi.do
- Resource Circulation Information System API page: https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401
- Waste annual file data reference: https://www.data.go.kr/data/3070174/fileData.do
- SGIS OpenAPI data API: https://sgis.kostat.go.kr/developer/html/openApi/api/data.html
- SGIS new OpenAPI authentication reference: https://sgis.kostat.go.kr/developer/html/newOpenApi/api/dataApi/basics.html
- SGIS administrative boundary reference: https://sgis.mods.go.kr/developer/html/newOpenApi/api/dataApi/addressBoundary.html
- AirKorea air-pollution information API: https://www.data.go.kr/tcs/dss/selectApiDataDetailView.do?publicDataPk=15073861
- AirKorea station information API: https://www.data.go.kr/data/15073877/openapi.do
- AirKorea administrative-change notice, 2026-06-30: https://www.data.go.kr/bbs/ntc/selectNotice.do?originId=NOTICE_0000000004805
- KMA short-term forecast API: https://www.data.go.kr/data/15084084/openapi.do
- KMA grid guidance: https://data.kma.go.kr/community/nuriLovePopup.do
- VWorld WMS/WFS reference: https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do
- VWorld cadastral 2D data API: https://www.vworld.kr/dev/v4dv_2ddataguide2_s002.do?svcIde=cadastral
- VWorld continuous cadastral download page: https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30563
- VWorld land-use planning API listing through data.go.kr: https://www.data.go.kr/data/15123973/openapi.do
- VWorld land ownership API listing through data.go.kr: https://www.data.go.kr/data/15123976/openapi.do

## Waste Statistics Source

Required source: Korea Environment Corporation Resource Circulation Information System waste statistics API.

### Confirmed From Official Documentation

- The public data portal describes the API as providing major approved waste statistics, including national waste generation and treatment status and recycling performance/company status.
- The Resource Circulation Information System API page states that national waste generation and treatment statistics are provided for 2014-2018 and that the statistical form changed from 2019 onward.
- The same page lists other statistics with reference periods through 2023, including designated waste, recycling performance/company status, volume-based waste bag statistics, and agricultural waste.
- The public file dataset for `한국환경공단_폐기물배출및처리현황_20241231` says annual waste generation and treatment status, treatment methods, recycling rate, and treatment company status are included, with annual update frequency and next expected registration on 2027-01-31.

### Critical Questions

| Question | Audit result |
| --- | --- |
| City, county, district-level availability | LIVE_VERIFIED (Phase 0.7): `NTN007`, `NTN008`, `NTN018`, and `NTN022` return sigungu-level rows nationwide, including all Seoul autonomous districts, Incheon counties/districts, and Gyeonggi cities/counties, for 2023 and 2024. |
| Seoul district-level data | LIVE_VERIFIED: Seoul autonomous districts (`종로구`, `중구`, `용산구`, ...) observed on generation and facility PIDs. |
| Incheon county and district data | LIVE_VERIFIED: Incheon sigungu rows observed. Downstream mapping must still account for the 2026 Incheon administrative structure changes because 2023/2024 statistics use the pre-change names. |
| Gyeonggi city and county data | LIVE_VERIFIED: Gyeonggi sigungu rows observed. |
| Waste generation measured by origin region | LIVE_VERIFIED: `WSTE_QTY` per origin region and waste category on generation PIDs. |
| Treatment accounting basis | LIVE_VERIFIED (Phase 0.7): generation PIDs report `ORIGIN_BASED_TREATMENT_OUTCOME` (disposition of the origin region's generated waste, split public/self/consigned); facility PIDs report `FACILITY_LOCATION_BASED_THROUGHPUT`. The two bases must never be mixed without labeling. |
| Incineration, landfill, recycling, other treatment separation | LIVE_VERIFIED: `TOT_INCI_QTY`, `TOT_FILL_QTY`, `TOT_RECY_QTY` (with material/energy splits from 2023), and `TOT_ETC_QTY` on generation PIDs; facility-side equivalents on `NTN031`-`NTN048`. |
| Facility-level data availability | LIVE_VERIFIED: `NTN031`/`NTN032`/`NTN033` (public incineration/other/landfill) and `NTN040`/`NTN043`/`NTN046` (business disposal/recycling) return per-facility rows with name, sigungu, address, capacity, and annual throughput. No coordinates; geocoding required. `NTN044` returned one placeholder-like record and stays SCHEMA_UNVERIFIED. |
| Waste origin-to-destination flow availability | UNAVAILABLE, now confirmed against the complete official PID catalog in the utilization guide. Do not infer movement. |
| Available years | LIVE_VERIFIED: 2023 and 2024 for the target PIDs. The guide documents distinct schemas for `<=2018`, `2019`, and `>=2020`. |
| Units | LIVE_VERIFIED: statistics PIDs return `result[0].DUNIT = ( 단위 : 톤/년 )`. Facility PIDs have blank `DUNIT`; units are documented per field in the guide (`FAC_CAP` 톤/일, `TOT_FILL_CAP` ㎥, `FILL_QTY_TON` 톤/년). |
| Publication frequency | CONFIRMED_DIRECT for annual file dataset. API page metadata says real-time update, but the underlying statistical reference periods are annual. Latest year 2024 was already queryable in July 2026. |
| Latest available reference period | LIVE_VERIFIED: 2024, with values distinct from 2023. |
| Supports treatment/generation equity metric | Yes, as `Reported Treatment-to-Generation Imbalance Ratio` using facility-location-based throughput over origin-based generation, plus per-capita generation, disposition mix, and facility capacity burden. Responsibility-avoidance claims remain unsupported without origin-to-destination flows. |

### Phase 0.6 RCIS Authentication And USRID Contract

`RCIS_API_KEY` is the only required RCIS API secret in this repository. The user's RCIS website login ID must not be treated as an API credential, and no separate RCIS API ID secret should be invented.

If the official utilization guide documents a fixed API service code, statistics identifier, or operation name, it must be represented as endpoint metadata or normal request configuration, not as a credential.

The official utilization guide documents the request fields `KEY`, `USRID`, `PID`, and `YEAR`. For this project:

- `KEY` is the authentication credential and maps to `RCIS_API_KEY`.
- `PID` is a waste-statistics form code and belongs in endpoint metadata.
- `YEAR` is a normal reference-year query parameter.
- `USRID` is a required request parameter named "아이디" / user ID. It maps to `RCIS_USER_ID`, is non-secret request configuration, and must not be printed.

Phase 0.6 local state: `RCIS_API_KEY` and `RCIS_USER_ID` are configured. The `wss/JsonApi/NTN001` live request succeeded with provider code `E000`.

Remaining uncertainty: the inspected official pages document `USRID` as a required user ID request parameter, but do not prove whether it is always the normal RCIS website login ID or a separate OpenAPI account identifier. The configured value worked for `NTN001`; continue treating it as non-secret request configuration whose value must not be printed.

### Phase 0.6 Live RCIS Result

- Endpoint identifier: `wss/JsonApi/NTN001`.
- Reference year: `2024`.
- HTTP status: `200`.
- Content type: `application/json;charset=UTF-8`.
- Provider result: `ERR_CODE=E000`, message `데이터 전송이 완료되었습니다.`
- Top-level response fields: `data`, `dataHeader`, `result`, `searchOption`.
- Region field: `CITY_JIDT_CD_NM`.
- Records: `전국`, `서울`, `부산`, `대구`, `인천`, `광주`, `대전`, `울산`, `세종`, `경기`, `강원`, `충북`, `충남`, `전북`, `전남`, `경북`, `경남`, `제주`.
- Data fields: `CITY_JIDT_CD_NM`, `TOT_AREA`, `TOT_POP`, `TOT_DONG`, `TOT_HSHLD`, `LIFEWT_MNG_AREA`, `LIFEWT_MNG_POP`, `LIFEWT_MNG_DONG`, `LIFEWT_MNG_HSHLD`, `LIFEWT_MNGEXCPT_AREA`, `LIFEWT_MNGEXCPT_POP`, `LIFEWT_MNGEXCPT_DONG`, `LIFEWT_MNGEXCPT_HSHLD`, `MNGEXCPT_AREA_RATIO`, `MNGEXCPT_POP_RATIO`, `MNGEXCPT_DONG_RATIO`, `MNGEXCPT_HSHLD_RATIO`.
- Units: not verified; `DUNIT` was blank.
- Pagination: not present.
- Sample: `data/samples/waste-statistics.live.json`, ignored by Git.

### Waste Metric Feasibility Finding

The original proposed metric, `treatment quantity / generation quantity`, is not valid as a responsibility or burden metric unless the source explicitly defines treatment as the fate of waste generated by that same region or provides origin-to-destination flows.

The platform must not claim:

- A region avoids treatment responsibility.
- A region bears excess treatment burden.
- Waste generated in one region is treated in another region.

Without explicit origin-to-destination data, the defensible substitute name is:

`Reported Treatment-to-Generation Imbalance Ratio`

Definition: reported treatment quantity divided by reported generation quantity for the same region, waste category, source, and reference period.

Required warning: this metric identifies imbalance between reported generation and reported treatment quantities. It does not prove responsibility avoidance, imported treatment burden, facility throughput, or waste movement.

## SGIS

Required source: SGIS population and administrative boundary APIs.

### Confirmed From Official Documentation

- Authentication uses `consumer_key` and `consumer_secret` to obtain an `accessToken`.
- Administrative boundary endpoint: `https://sgisapi.kostat.go.kr/OpenAPI3/boundary/hadmarea.geojson`.
- Population endpoint: `https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json`.
- Administrative code depth is documented as 2-digit sido, 5-digit sigungu, and 7-digit eup/myeon/dong.
- Boundary years documented in the legacy API page include 2000-2021 for the boundary endpoint.
- Population years documented in the legacy API page include 2000, 2005, 2010, and 2015-2020 for total census indicators.
- Coordinate transformation API documents WGS84, UTM-K, Google Mercator, and Korean GRS80/BESSEL projected systems.
- Boundary response format is GeoJSON.

### Feasibility Findings

SGIS can support administrative boundaries, regional population, and population grids or census geography work, but reference-year alignment must be explicit. Boundary and population years must be selected together and recorded in metric metadata.

Seoul, Incheon, and Gyeonggi-do can be requested by SGIS administrative code after obtaining the correct sido code mapping. Direct filtering is feasible by `adm_cd`, but the platform must not assume SGIS codes equal legal dong codes, waste-statistics labels, or VWorld parcel codes.

Phase 0.5 live validation:

- Credential status: LIVE_VERIFIED.
- Endpoint: `OpenAPI3/stats/population.json`.
- Probe parameters: `year=2020`, `adm_cd=11`, `low_search=1`.
- Result: provider code `errCd=0`; schema validation LIVE_VERIFIED; 25 Seoul district-level records observed.
- Sample: `data/samples/sgis.live.json`, ignored by Git.
- Remaining issue: boundary endpoint plus Incheon and Gyeonggi-do regional probes are still pending.

## AirKorea

Required source: AirKorea real-time air-quality and station-information APIs.

### Confirmed From Official Documentation

- Air-pollution information API supports station-level real-time measurements and city/province-level real-time measurement lookup.
- Station information API supports station list, nearby station list, and TM reference-coordinate lookup.
- Data formats are JSON and XML.
- Development accounts are documented at 500 requests, with production traffic increase possible after use-case registration.
- Development-stage approval is automatic; production-stage approval requires review.
- Station list response includes station name, address, installation year, network name, measured items, and WGS84 coordinates `dmX` and `dmY`.
- Supported pollutant fields include SO2, CO, O3, NO2, PM10, and PM2.5 in the AirKorea service family.
- The 2026-06-30 official notice documents administrative naming changes and confirms Incheon administrative restructuring is reflected in AirKorea API behavior.

### Feasibility Findings

AirKorea can support real-time air-quality observations and station metadata. It cannot by itself support permanent facility-siting evidence. Any map layer must be labeled as real-time or near-real-time, include measurement timestamp, station metadata, and missing-value handling.

Station coordinates are directly available from the station information endpoint, so a separate geocoding step is not required for station list records. Nearby-station queries still require TM coordinate handling.

Open items for credentialed validation:

- Exact observation interval from the downloadable 2026-06-30 technical document.
- Missing-value conventions for pollutant readings and index values.
- Whether station identifiers are stable enough to use as durable primary keys or whether station name plus address/version metadata is required.

Phase 0.5 live validation: CREDENTIAL_MISSING. No live request attempted.

## Korea Meteorological Administration

Required source: KMA short-term forecast API.

### Confirmed From Official Documentation

- The short-term forecast service includes ultra-short observation, ultra-short forecast, village/short-term forecast, and forecast-version endpoints.
- Ultra-short observation endpoint: `getUltraSrtNcst`.
- Ultra-short forecast endpoint: `getUltraSrtFcst`.
- Service URL: `http://apis.data.go.kr/1360000/VilageFcstInfoService_2.0`.
- Required parameters include `ServiceKey`, `pageNo`, `numOfRows`, `dataType`, `base_date`, `base_time`, `nx`, and `ny`.
- The API provides nationwide coverage on a 5 km by 5 km grid.
- Ultra-short observation category examples include `RN1`, `T1H`, `UUU`, `VVV`, and `WSD`.
- Wind-speed field `WSD` is directly available. Wind vector components `UUU` and `VVV` are directly available; wind direction must be confirmed from endpoint category lists for the selected endpoint or derived from vector components with a documented formula.
- Development traffic is documented at 10,000 requests.

### Feasibility Findings

KMA can support weather observations, wind speed, and forecast context. Candidate-site latitude/longitude must be converted to the KMA grid (`nx`, `ny`) before requests. The official guide documents the grid basis; the exact conversion implementation must be validated against KMA's official guide before production use.

One API request covers one grid coordinate and one base date/time. Multiple candidate sites require batching by unique grid coordinate and base time; sites falling in the same grid cell can share one request.

Open items for credentialed validation:

- Exact publication schedule and safe request timing for each endpoint.
- Direct wind-direction category availability for each selected endpoint.
- Official grid conversion implementation details to use for production code.

Phase 0.5 live validation: CREDENTIAL_MISSING. No live request attempted.

## VWorld

Required source: VWorld spatial-data, zoning, cadastral, and land-use services.

### Confirmed From Official Documentation

- VWorld WMS/WFS supports authenticated requests with API keys.
- WMS request URL: `https://api.vworld.kr/req/wms`.
- WFS request URL: `https://api.vworld.kr/req/wfs`.
- VWorld WMS/WFS service categories include boundaries, road centerlines, road-name roads, land datasets, zoning/land-use districts, school-related layers, protected-area-like park layers, and other national spatial layers.
- VWorld 2D data API supports `https://api.vworld.kr/req/data` and `GetFeature`.
- Continuous cadastral map data is available through VWorld 2D data API as `LP_PA_CBND_BUBUN` and by SHP download.
- Continuous cadastral map metadata says the data are reference drawings, not surveying-grade cadastral survey data.
- Cadastral API supports GeoJSON or XML output, geometry and attribute toggles, attribute filters, geometry filters, and CRS selection.
- Cadastral API supports CRS values including EPSG:4326, EPSG:3857, EPSG:900913, EPSG:5179, EPSG:5180-5188, and EPSG:4019.
- Geometry filter requests have an area limit for polygon, multipolygon, and box filters.
- VWorld download metadata for continuous cadastral maps lists EPSG:5186.
- VWorld land-use planning API is listed as national coverage through data.go.kr and VWorld.
- VWorld land-ownership API is listed through data.go.kr as WMS/WFS/attribute information.

### Feasibility Findings

VWorld can support administrative/spatial context, zoning screening, cadastral parcel screening, land-use restriction overlays, road accessibility inputs, and public land ownership checks if license and endpoint access are approved.

Not every VWorld layer should be treated as an analytical dataset. WMS-only map layers are suitable for visualization but not enough for reproducible facility-site screening unless feature geometry and attributes are available through WFS, 2D data API, or downloadable source files.

Phase 0.5 live validation:

- Credential status: LIVE_VERIFIED.
- Endpoint: `req/data GetFeature LP_PA_CBND_BUBUN`.
- Probe parameters: one small Seoul bounding box in EPSG:4326.
- Result: provider status `OK`; schema validation LIVE_VERIFIED; one cadastral feature observed with PNU and parcel attributes.
- Sample: `data/samples/vworld.live.json`, ignored by Git.

Phase 2.5A structural-layer validation (2026-07-11): 14 officially documented
WFS/2D layers (용도지역 UQ111–UQ114, 개발제한구역, 상수원보호구역,
습지보호지역, 야생생물보호구역, 산림보호구역, 교육환경보호구역, 국가유산
보호구역, 도시자연공원 계열, 국립자연공원, 교통링크, 도로중심선) plus the NED
토지소유(dt_d160)/토지이용계획(dt_d154) WFS are LIVE_VERIFIED across small
Seoul/Incheon/Gyeonggi bounding boxes. Full findings, provider limits,
licensing conflicts, and the CONDITIONAL_GO recommendation are in
`docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`; suitability-input classification is
in `docs/SUITABILITY_DATA_REQUIREMENTS.md`. Remaining issues: per-dataset
storage/derivative licensing resolution, reproducible bulk-download workflow,
full-coverage completeness validation, and ownership-field completeness.

## Overall Build Feasibility

The platform appears feasible as a real-public-data decision-support platform for the full Seoul Metropolitan Area, with two major constraints:

1. Waste movement and treatment responsibility cannot be inferred from currently found official waste-statistics documentation.
2. Facility siting must separate durable structural datasets from real-time environmental readings.

The first implementation should therefore build a source registry, metadata model, and live API probes before implementing equity scoring or recommendations.
