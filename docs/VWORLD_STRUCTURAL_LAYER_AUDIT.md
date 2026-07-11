# VWorld Structural Spatial Layer Feasibility Audit (Phase 2.5A)

Audit date: 2026-07-11.

Scope: official-source research and small live contract probes for the
structural spatial layers required by Phase 5.4 suitability analysis —
land use and zoning, protected and restricted areas, road and transportation
access, public land ownership, and sensitive facilities — for Seoul, Incheon,
and Gyeonggi-do.

This audit performed documentation research and live contract validation
only. No production ingestion, database migration, candidate generation,
exclusion mask, or suitability scoring was implemented.

## Method

- Only official sources were used as evidence: VWorld developer reference
  pages (`www.vworld.kr/dev/...`), the VWorld data catalog
  (`www.vworld.kr/dtmk/...`), VWorld National Core Data API reference pages
  (`www.vworld.kr/dtna/...`), Korean Public Data Portal listings
  (`www.data.go.kr`), and ministry/agency portals. Every claim below cites
  the page that documents it. Search-result titles were never treated as
  evidence.
- Live probes used the smallest possible requests (one feature per region
  bounding box, `maxFeatures`/`size` = 1) against officially documented layer
  identifiers only, in three small bounding boxes (one each in Seoul,
  Incheon, Gyeonggi-do), through the reusable probe command
  `python -m waste_equity_ingestion.cli vworld-structural-audit`
  (`ingestion/src/waste_equity_ingestion/probes/vworld_structural.py`).
  Layer-specific boxes target areas where the documented zone type can
  plausibly exist (greenbelt cannot be probed at Seoul City Hall); a region
  with no known occurrence keeps its box and the zero-feature result is
  recorded honestly.
- Sanitized samples for every live probe are stored under `data/samples/`
  (Git-ignored; metadata in `data/samples/README.md`). API keys and
  credential-bearing request URLs are never printed or saved.
- HTTP 200 alone was never treated as success; provider status semantics per
  service are recorded below.

## Official Sources Reviewed

| Source | URL | What it documents |
| --- | --- | --- |
| VWorld WMS/WFS API 2.0 reference (169-layer catalog) | https://www.vworld.kr/dev/v4dv_wmsguide2_s001.do | WFS endpoint/params/limits and the official `lt_c_*`/`lt_l_*` layer catalog |
| VWorld WFS column workbook | https://www.vworld.kr/contents/브이월드_WFS_컬럼정보.xlsx | Per-layer WFS attribute schemas |
| VWorld 2D Data API 2.0 reference (158 services) | https://www.vworld.kr/dev/v4dv_2ddataguide2_s001.do and `.../v4dv_2ddataguide2_s002.do?svcIde=<id>` | 2D Data API contract and per-layer docs (uq111, uq112, ud801, um710, um901, um221, uo101, uo301, uq162, uf151, wgisnpgug, moctlink, n3a0020000) |
| VWorld National Core Data API — 토지소유정보 WFS | https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=46 | `getPossessionWFS`, typename `dt_d160`, params, fields, error codes |
| VWorld National Core Data API — 토지소유정보 속성 | https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=47 | `getPossessionAttr`, `posesnSeCode`/`nationInsttSeCode` ownership classification |
| VWorld National Core Data API — 토지이용계획 WFS | https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=50 | `getLandUseWFS`, typename `dt_d154`, per-parcel 용도지역지구 lists |
| VWorld National Core Data API — 토지이용계획 속성 | https://www.vworld.kr/dtna/dtna_apiSvcFc_s001.do?apiNum=51 | `getLandUseAttr` |
| VWorld data catalog (bulk downloads) | https://www.vworld.kr/dtmk/dtmk_ntads_s001.do | LSMD SHP downloads per layer/시도, CRS, update cycles, per-dataset licenses |
| VWorld terms of use | https://www.vworld.kr/v4po_prcint_a001.do | Quotas (제13조), storage-consent clause (제19조) |
| VWorld FAQ (usage limits) | https://www.vworld.kr/v4po_brdfaq_s001.do | Geocoder-only fixed daily quota; other APIs load-based |
| VWorld/NSDI merger notice (2023-12-27) | https://www.vworld.kr/v4po_brdnotice_s002.do?brdIde=24630 | nsdi.go.kr services moved into VWorld on 2024-01-01 |
| data.go.kr 공간정보오픈플랫폼(WMS/WFS) | https://www.data.go.kr/data/15058805/openapi.do | Umbrella listing, KOGL Type 1 + CC-BY |
| data.go.kr 용도지역지구도(WMS/WFS) | https://www.data.go.kr/data/15058773/openapi.do | Zoning layer family listing |
| data.go.kr 국가교통정보도(WMS/WFS) | https://www.data.go.kr/data/15056863/openapi.do | Transport link/node layer family listing |
| data.go.kr 상수원보호 | https://www.data.go.kr/data/15101075/openapi.do | Water-source protection layer listing (nationwide, 제한 없음) |
| data.go.kr 토지소유정보(WMS/WFS/속성) | https://www.data.go.kr/data/15123976/openapi.do | Ownership API listing (제한 없음) |
| data.go.kr 토지이용계획정보(WMS/WFS/속성) | https://www.data.go.kr/data/15123973/openapi.do | Per-parcel land-use planning API listing |
| data.go.kr 토지이용규제정보서비스 | https://www.data.go.kr/data/15058410/openapi.do | LURIS-lineage act-restriction lookup API |
| 국립공원공단 공원경계 | https://www.data.go.kr/data/15017313/fileData.do | SHP+GeoJSON EPSG:4326 park boundaries; “법적 효력이 없음” disclaimer |
| 국가유산청 국가유산 공간정보 API | http://gis-heritage.go.kr/helpAPI.do and https://www.data.go.kr/data/3070426/openapi.do | Heritage zone WMS/WFS (8 polygon datasets incl. 보호구역, 역사문화환경 허용기준) |
| 국립생태원 생태자연도 | https://www.data.go.kr/data/15050229/fileData.do (EcoBank http://www.nie-ecobank.kr/opn/file/list.do?svcId=101) | Ecological screening map SHP, KOGL Type 3 |
| 기후에너지환경부 환경공간정보(구 egis) | https://aid.mcee.go.kr/ and https://www.data.go.kr/data/15038059/openapi.do | Land-cover / environmental theme WMS |
| 산림청 FGIS 자료유통 | https://www.forest.go.kr/newkfsweb/kfi/kfs/fgis/selectAvailMapList.do?mn=KFS_02_04_02_02&orgId=fgis | Forest map SHP distribution (EPSG:5179) |
| 토지이음 | https://www.eum.go.kr/web/am/amMain.jsp and https://www.eum.go.kr/web/op/sv/svItemList.jsp | Statutory per-parcel confirmation; 국토이용정보체계 data-opening list |
| ITS 표준노드링크 | https://www.its.go.kr/nodelink/intro (schema), https://www.its.go.kr/nodelink/nodelinkRef (download), https://www.data.go.kr/data/15025526/fileData.do | Node/link schema (도로등급, 차로수, 통행제한차량/하중/높이, 회전제한), nationwide SHP bulk, license 제한 없음 |
| 도로명주소 전자지도 | https://www.data.go.kr/data/15050413/fileData.do | 도로구간 layer, KOGL Type 1, ITRF2000/GRS80/UTM, approval-mediated download |
| NGII 도로중심선 bulk | https://www.vworld.kr/dtmk/dtmk_ntads_s002.do?dsId=30182 | Per-시도 SHP, EPSG:5179, 연간, CC BY |
| Sensitive-facility standard datasets | see Category E below | Schools/hospitals/childcare/kindergarten/welfare |

## Audit Table

Statuses: `LIVE_VERIFIED` (documented + live contract probe passed),
`DOCUMENTED_NOT_TESTED` (official documentation confirmed, no live probe in
this phase), `PROXY_ONLY`, `UNAVAILABLE`, `UNSUITABLE_FOR_ANALYSIS`.

| Category | Provider | Dataset | Layer id | Service | Status | Geometry | CRS | SMA coverage | Analytical use | Update | Limits | Acquisition | Unresolved issue |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A zoning | 국토교통부 | 용도지역도 도시지역 | `lt_c_uq111` / `LT_C_UQ111` | WFS + 2D Data API | LIVE_VERIFIED | MultiPolygon | 4326 requested/returned; bulk 5186/2097 | Seoul+Incheon+Gyeonggi verified | zoning screening/scoring; exclusion after policy sign-off | 2D doc 갱신일 2026-05-20; bulk 변경발생시/매월 | WFS ≤1000 features; 2D size ≤1000 | bulk SHP (dtmk 30300 or NA_24) + API spot-checks | API-storage consent; CC BY-NC-ND on LSMD bulk |
| A zoning | 국토교통부 | 용도지역도 관리지역 | `lt_c_uq112` / `LT_C_UQ112` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Incheon+Gyeonggi features; Seoul honest 0 (no 관리지역) | same | same | same | NA_24 bulk (no per-layer dtmk set) | same |
| A zoning | 국토교통부 | 용도지역도 농림지역 | `lt_c_uq113` / `LT_C_UQ113` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Incheon+Gyeonggi features; Seoul honest 0 | same | same | same | NA_24 bulk | same |
| A zoning | 국토교통부 | 용도지역도 자연환경보전지역 | `lt_c_uq114` / `LT_C_UQ114` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Gyeonggi features; Seoul/Incheon honest 0 in probed boxes | same | same | same | NA_24 bulk | same |
| A parcel land-use | 국토교통부 국가공간정보센터 | 토지이용계획공간정보 | `dt_d154` | NED WFS (`getLandUseWFS`) | LIVE_VERIFIED | MultiPolygon | 4326 requested/returned | all three regions verified | per-parcel zone/restriction lists; candidate refinement | data.go.kr 실시간; layer 기준일 2026-04-12 | maxFeatures ≤1000; quota 999,999,999/day | PNU/bbox API for candidates; bulk (dtmk NA_24/12) for area sweeps | parcel volume; code-list interpretation |
| B protected | 국토교통부 | 용도구역도 개발제한구역 | `lt_c_ud801` / `LT_C_UD801` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | 4326; bulk 5186/2097 | all three regions verified (greenbelt areas) | direct statutory exclusion candidate (policy sign-off required) | 2026-05-20; bulk 변경발생시 | WFS ≤1000; 2D ≤1000 | bulk SHP (dtmk 30261) + API checks | licensing as above |
| B protected | 국토교통부 (수도법 근거) | 상수원보호구역 | `lt_c_um710` / `LT_C_UM710` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Seoul+Gyeonggi features; Incheon honest 0 in probed box | direct statutory exclusion candidate | 2026-05-20; bulk 변경발생시 | same | bulk SHP (dtmk 30372) | Incheon coverage to confirm during full load |
| B protected | 국토교통부 (습지보전법) | 습지보호지역 | `lt_c_um901` / `LT_C_UM901` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Incheon(송도)+Gyeonggi(한강하구) features; Seoul 0 in probed box | statutory exclusion candidate / environmental screening | 2026-05-20; bulk 변경발생시 | same | bulk SHP (dtmk 30380) | marine variant `lt_c_wgisarwet` untested |
| B protected | 국토교통부 (지자체 지정) | 야생생물보호구역 | `lt_c_um221` / `LT_C_UM221` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Incheon+Gyeonggi features; Seoul 0 in probed box | environmental screening + manual review (municipal designations) | 2026-05-20 | same | NA_24/환경 기타용도지역지구 bulk | municipal completeness unverified |
| B protected | 국토교통부 (산림보호법) | 산림보호구역 | `lt_c_uf151` / `LT_C_UF151` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | same | Gyeonggi features; Seoul/Incheon 0 in probed boxes | statutory exclusion candidate / screening | 2026-05-20; bulk 변경발생시 | same | bulk SHP (dtmk 30355) | FGIS does not distribute this map to general public |
| B protected | 해양수산부-listed (환경부장관 지정 설명) | 국립자연공원 | `lt_c_wgisnpgug` / `LT_C_WGISNPGUG` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | 4326 | Seoul(북한산)+Gyeonggi features; Incheon honest 0 (no national park) | screening/display; exclusion needs `uma100` zone detail | 2D doc 갱신일 2023-09-19 (stale) | attributes: `park_name` only | KNPS boundary file (EPSG:4326, 2025-11-21) as cross-check | provenance field conflict; `lt_c_uma100` doc page unavailable |
| B protected | 국립공원공단 | 국립공원 공원경계 (SHP/GeoJSON) | n/a | file download | DOCUMENTED_NOT_TESTED | Polygon | EPSG:4326 | nationwide | informational display / cross-check only | 2025-11-21 | none documented | data.go.kr 15017313 download | official page: “법적 효력이 없음” |
| B protected | 국토교통부 | 도시자연공원구역/공원·녹지 계열 | `lt_c_uq162` / `LT_C_UQ162` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | 4326 | all three regions verified | planning restriction / screening | 2026-05-21 | same | NA_24 bulk | observed `uname` values (공원, 경관녹지, 어린이공원) look like 도시공원 categories, not only 도시자연공원구역 — semantics need confirmation |
| B heritage | 국토교통부 (serving) | 국가유산 지정/보호구역 | `lt_c_uo301` / `LT_C_UO301` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | 4326 | all three regions verified (문화재보호구역, 국가지정문화재구역, 역사문화환경보존지역 observed) | screening + manual review (graded permission zones are not flat exclusions) | 2026-05-20 | same | 시도별 ZI002 bulk sets | 국가유산청 WFS not live-tested; “EPSG:9020203” in its docs nonstandard |
| B heritage | 국가유산청 | 국가유산 공간정보 (지정/보호구역, 허용기준 등 8종) | service typenames at gis-heritage.go.kr | WMS/WFS | DOCUMENTED_NOT_TESTED | Polygon | UTM-K documented | nationwide | authoritative heritage source; manual review | 실시간 (listing) | key + domain check | API after key issuance | file-download menu not crawlable; CRS code anomaly |
| B sensitive-zone | 국토교통부 (교육환경법 계열) | 교육환경보호구역 | `lt_c_uo101` / `LT_C_UO101` | WFS + 2D | LIVE_VERIFIED | MultiPolygon | 4326 | all three regions verified (절대/상대보호구역 observed) | statutory screening zones around schools — replaces invented school buffers | 2026-05-20; bulk 변경발생시 | same | bulk SHP (dtmk 30442) | exclusion vs screening is a policy/legal decision |
| B screening | 국립생태원 | 생태자연도 | n/a | SHP download (EcoBank) | DOCUMENTED_NOT_TESTED | Polygon | not stated on listing | nationwide | environmental screening input (grades, not designations) | periodic | login required | EcoBank download | KOGL Type 3 (변경금지) conflicts with derived analysis |
| B screening | 환경부(기후에너지환경부) | 토지피복지도/환경주제도 | n/a | WMS API | DOCUMENTED_NOT_TESTED | raster/imagery | n/a | nationwide | display only unless vector access confirmed | periodic | key | aid.mcee.go.kr API | WMS-only → not analytical evidence |
| C roads | 국토교통부 | 국가교통정보도 교통링크 | `lt_l_moctlink` / `LT_L_MOCTLINK` | WFS + 2D | LIVE_VERIFIED | MultiLineString | 4326 | all three regions verified | road class/lane attributes; distance-to-road; network topology via `f_node`/`t_node` | 2D doc 갱신일 2026-05-21 | WFS ≤1000; no dtmk bulk found | ITS 표준노드링크 bulk (source dataset) + API checks | attribute semantics (`rest_veh/rest_w/rest_h`) need the official node-link spec; truck access must not be claimed from geometry |
| C roads | 국토지리정보원 | 연속수치지형도 도로중심선 | `lt_l_n3a0020000` / `LT_L_N3A0020000` | WFS + 2D + bulk | LIVE_VERIFIED | MultiLineString | 4326 API; bulk EPSG:5179 | all three regions verified | distance-to-road analysis; width (`rvwd`)/lanes (`rdln`) attributes | bulk 연간 | WFS ≤1000 | bulk SHP (dtmk 30182, CC BY) | annual cadence; no truck-access claims |
| C roads | 국토교통부 국가교통정보센터 | 표준노드링크 (nationwide SHP, current file 2026-07-01, 245 MB) | n/a | bulk download | DOCUMENTED_NOT_TESTED | LineString links + Point nodes | not declared on official pages (verify from shipped `.prj`) | nationwide | road classification (`ROAD_RANK`,`LANES`,`MAX_SPD`), true network topology (`F_NODE`/`T_NODE`, turn restrictions), only official carrier of `REST_VEH`/`REST_W`/`REST_H` | 수시(자동); snapshot files posted periodically | browser-mediated download | www.its.go.kr/nodelink 자료실 (license 제한 없음, data.go.kr 15025526) | CRS undeclared; restriction-field population rates unvalidated (samples show `모두통행가능`, 0 values) |
| C roads | 행정안전부 | 도로명주소 전자지도 (도로구간) | n/a | bulk download (approval-mediated) | DOCUMENTED_NOT_TESTED | LineString | ITRF2000/GRS80/UTM per listing | nationwide | supplementary road centerline | 월전체/월변동 | application/approval via juso.go.kr | data.go.kr 15050413 (KOGL Type 1) | current approval workflow and 도로구간 attribute schema unverified |
| D ownership | 국토교통부 국가공간정보센터 | 토지소유공간정보 | `dt_d160` | NED WFS (`getPossessionWFS`) | LIVE_VERIFIED | MultiPolygon | 4326 requested/returned | all three regions verified | public-land candidate identification via `posesn_se_code`/`nation_instt_se_code` | data.go.kr 실시간; bulk 매년(전체)/매월(월변동) | maxFeatures ≤1000; quota 999,999,999/day | bulk CSV+공간정보 (dtmk NA_12/NA_30) or PNU joins | classification fields observed null in 2 of 3 probed parcels; full code table only in downloadable 컬럼정의서 |
| E sensitive | 한국교육시설안전원 | 전국초중등학교위치표준데이터 | n/a | file + API | DOCUMENTED_NOT_TESTED | Point (위도/경도 columns) | decimal degrees (EPSG not declared) | nationwide | sensitive-receptor points; scoring input | 반기 | 50,000 rows/file download | data.go.kr 15021148 | CRS not officially declared |
| E sensitive | 건강보험심사평가원 | 병원정보서비스 (`getHospBasisList`) | n/a | REST API | DOCUMENTED_NOT_TESTED | Point (`xPos`,`yPos`) | decimal degrees (EPSG not declared) | nationwide | sensitive-receptor points | 매일/실시간 | dev 10,000/day | data.go.kr 15001698 | CRS not officially declared |
| E sensitive | 한국사회보장정보원 | 전국어린이집표준데이터 | n/a | file + portal API | DOCUMENTED_NOT_TESTED | Point (위도/경도) | decimal degrees (EPSG not declared) | nationwide | sensitive-receptor points | 수시 | portal key | data.go.kr 15013108 / info.childcare.go.kr | CRS not officially declared |
| E sensitive | 교육부 유치원알리미 | 유치원 일반현황 | n/a | REST API | DOCUMENTED_NOT_TESTED | Point (위도/경도) | decimal degrees (EPSG not declared) | nationwide | sensitive-receptor points | 수시 | key via portal | e-childschoolinfo.moe.go.kr | data.go.kr wrapper lists stricter KOGL Type 3 |
| E sensitive | 한국사회보장정보원/국민건강보험공단 | 사회복지시설/장기요양기관 | n/a | REST API | DOCUMENTED_NOT_TESTED | address-only (no coordinates confirmed) | n/a | nationwide | sensitive receptors after geocoding (CONFIRMED_DERIVED path) | 실시간 | dev 10,000/day | data.go.kr 15096296 / 15059029 | coordinates unconfirmed; geocoding required |
| — | 환경부 계열 | 생태·경관보전지역 (dedicated layer) | none found | — | UNAVAILABLE | — | — | — | — | — | — | possibly inside 환경/기타용도지역지구 bulk (MK_30451, unverified) | dedicated official feature source not located |
| — | VWorld | WMS map layers (all) | various | WMS | UNSUITABLE_FOR_ANALYSIS | imagery | n/a | n/a | visualization only | n/a | 5 layers/request | n/a | never use map images for exclusion |

## Live Contract Findings (2026-07-11)

Probes: 14 `req/wfs` + 14 `req/data` layer probes across the three regional
boxes, plus pagination probes, one deliberate provider-error probe, and the
two NED layers. All layer identifiers came from the official catalog/docs
above; no guessed identifiers were tested.

### WFS (`https://api.vworld.kr/req/wfs`, version 1.1.0, `output=application/json`)

- Requested `srsname=EPSG:4326` with lat-first bbox
  (`bbox=ymin,xmin,ymax,xmax,EPSG:4326` per the official axis-order note);
  non-empty responses returned `crs.properties.name =
  urn:ogc:def:crs:EPSG::4326` and lon-lat GeoJSON coordinates.
- Response is a GeoJSON FeatureCollection with `totalFeatures`,
  `numberMatched`, `numberReturned`, `timeStamp`, per-feature `id`
  (`<layer>.<n>`) and `properties`. There is no separate provider status
  field; contract validation must reject non-FeatureCollection bodies.
- `maxFeatures=1` honored; `totalFeatures` still reports the full bbox count.
- **Pagination defect:** `startindex=0` and `startindex=1` returned the same
  feature id under version 1.1.0 (the parameter is documented for 2.0.0
  only). WFS paging is therefore unverified/unreliable; area coverage must
  not assume WFS `startindex` works.
- Zone-layer attribute schema (WFS): `mnum, uname, ucode, dyear(고시년도),
  dnum(고시번호), sido_cd, sigungu_cd, admin_cd, std_sggcd, sido_name,
  sigg_name, bon_bun, bu_bun, remark, alias`. Observed `uname`/`ucode`
  examples: `제2종일반주거지역`/`UQA122`, `중심상업지역`/`UQA210` (uq111),
  `계획관리지역`/`UQB100` (uq112), `농림지역`/`UQC001` (uq113),
  `자연환경보전지역`/`UQD001` (uq114), `개발제한구역`/`UDV100` (ud801),
  `상수원보호구역`/`UMI100` (um710), `습지보호지역`/`UMQ100` (um901),
  `야생동·식물보호구역`/`UMS220` (um221), `산림보호구역`/`UFR100` (uf151),
  `상대보호구역`/`UOA120` (uo101), `문화재보호구역`/`UOC100`,
  `국가지정문화재구역`/`UOC510`, `역사문화환경보존지역`/`UOC800` (uo301).
- Road layers: `lt_l_moctlink` WFS carries `link_id, f_node, t_node, lanes,
  road_rank, road_name, road_no, road_type, road_use, max_spd, rest_veh,
  rest_w, rest_h, connect_cd, ...`; `lt_l_n3a0020000` carries `ufid, rdnu,
  name, rddv, pvqt, dvyn, rdln(차로수), rvwd(도로폭), onsd(일방통행), rdnm,
  scls`.

### 2D Data API (`https://api.vworld.kr/req/data`, version 2.0)

- `response.status` semantics observed: `OK` (features), `NOT_FOUND` (empty
  result — not an error), `ERROR` with `response.error{level,code,text}`.
- Pagination metadata verified: `page{current,total,size}` and
  `record{total,current}`; `page=2` returned the next distinct feature id.
  2D API paging works and is the reliable API-side paging mechanism.
- `geomFilter=BOX(minx,miny,maxx,maxy)` is lon-first even when
  `crs=EPSG:4326` (opposite of the WFS bbox axis order).
- The 2D API returns a reduced attribute subset for some zone layers (uq111:
  `uname, dyear, dnum, sido_name, sigg_name` only) versus the full WFS
  schema; attribute-complete acquisition should prefer WFS or bulk files.
- No explicit CRS metadata is returned in the JSON body
  (`returned_crs_metadata: null` recorded); coordinates are in the requested
  CRS per documentation. Store the requested CRS in metadata.
- **Provider error-body defect (live-observed):** a deliberate GetFeature
  without `geomFilter`/`attrFilter` returned HTTP 200 with
  `status=ERROR, code=INVALID_RANGE` — but the JSON body was **invalid**
  (unescaped double quotes inside `error.text`: `단일검색="Y"`). Error
  handling must never assume the ERROR body parses as JSON; the probe module
  records this with a tolerant parser
  (`parse_provider_error_text`).

### NED National Core Data WFS (`/ned/wfs/getPossessionWFS`, `/ned/wfs/getLandUseWFS`)

- GeoJSON FeatureCollection with `totalFeatures`, `numberMatched`,
  `numberReturned`, EPSG:4326 CRS metadata; documented `maxFeatures` max
  1000; documented daily quota 999,999,999 (effectively unlimited);
  documented error codes include `INVALID_KEY`, `OVER_REQUEST_LIMIT`.
- `dt_d160` (토지소유공간정보): 19 attribute fields observed incl. `pnu`,
  `posesn_se_code`(소유구분), `nation_instt_se_code`(국가기관구분),
  `lndcgr_code`(지목), `lndpcl_ar`(면적). **Caveat:** `posesn_se_code` was
  non-null in the Seoul probe (`06`, `nation_instt_se_code='ZZ'`) but null in
  the Incheon and Gyeonggi probed parcels; the full code table is only in the
  downloadable 국가중점데이터 컬럼정의서. Ownership screening is possible in
  principle but field completeness must be validated on a larger sample
  before any public-land claim.
- `dt_d154` (토지이용계획공간정보): per-parcel
  `prpos_area_dstrc_code_list`/`prpos_area_dstrc_nm_list` (comma-joined zone
  codes/names) with `cnflc_at_list` (포함/저촉/접함). A Seoul City Hall
  parcel returned ten zone entries incl. `일반상업지역`, `가축사육제한구역`,
  `정비구역`, `중점경관관리구역` — direct per-parcel restriction evidence for
  candidate refinement.

### Regional coverage observed

Every probed layer is LIVE_VERIFIED in at least one region, and every
zero-feature result matches documented geography (no national park polygon in
mainland Incheon; no 관리지역/농림지역 inside urban Seoul; greenbelt absent
from the Seoul City Hall box but present in Seocho/Gyeyang/Gwacheon boxes).
Full-region completeness (every polygon of every layer for all of Seoul,
Incheon, Gyeonggi-do) is **not** proven by these probes and remains a
production-ingestion validation task.

## Provider Limits, Quotas, and Licensing

- **Quotas:** only the Geocoder has a documented fixed daily quota (40,000).
  Other VWorld APIs have no published fixed daily count; the terms (제13조)
  allow the operator to throttle any key, and `OVER_REQUEST_LIMIT` exists as
  an error code. NED APIs document a 999,999,999/day quota. Production jobs
  must pace requests and treat `OVER_REQUEST_LIMIT` as non-retryable within
  the same window.
- **Hard caps:** WFS `maxFeatures` ≤ 1000 and ≤ 4 typenames/request; 2D Data
  API `size` ≤ 1000 per page; WMS ≤ 5 layers/request. No geomFilter area
  limit is documented on current 2.0 reference pages (the Phase 0.5 note
  about an area limit could not be re-verified; treat any live area cap as
  undocumented behavior).
- **Licensing (unresolved — material):** VWorld portal terms 제19조 state
  data obtained through the service must not be stored without prior consent
  (“오픈플랫폼에서 제공되는 데이터는 사전 승낙 없이 데이터를 무단으로
  저장하지 못합니다”), while the data.go.kr umbrella listings for the same
  services state KOGL Type 1/“이용허락범위 제한 없음”, and dtmk bulk-download
  cards carry per-dataset licenses — several relevant LSMD zone datasets are
  marked CC BY-NC-ND (비영리, 변경금지), while NGII 도로중심선 bulk is CC BY
  and the NED API listings are 제한 없음. These signals conflict.
  **Production ingestion must not begin until the storage/derivative-use
  terms are resolved per dataset (provider confirmation or documented legal
  review).**

## Coordinate Systems

| Source | Source/native CRS | API-requested CRS | Returned CRS | Proposed storage | Transformation |
| --- | --- | --- | --- | --- | --- |
| VWorld WFS/2D layers | provider-internal; documented request CRS list: EPSG:4326, 4019, 3857/900913, 5179, 5180–5188 | EPSG:4326 | 4326 (WFS explicit; 2D implicit per docs) | EPSG:4326 | none for API path |
| LSMD bulk SHP (zoning/protected) | EPSG:5186 (일부 2097) per dtmk cards | n/a | n/a | EPSG:4326 (display) | 5186→4326 required; record both |
| NGII 도로중심선 bulk | EPSG:5179 | n/a | n/a | EPSG:4326 | 5179→4326 required |
| NED dt_d160/dt_d154 | served in requested CRS | EPSG:4326 | 4326 explicit | EPSG:4326 | none |
| Sensitive-facility point sets | 위도/경도 decimal degrees; EPSG not declared | n/a | n/a | EPSG:4326 with `crs_assumed_wgs84` flag | validation vs geocoded addresses required |

Distance/area must never be measured in decimal degrees: reuse the existing
geodesic method (`ST_DWithin` on `geography`, documented in
`docs/ANALYTICAL_METHODS.md`) or a validated projected CRS (EPSG:5179/5186)
for planar operations. Geodesic measurement is appropriate at these latitudes
and is already the platform standard.

## Recommended Coverage Strategy (future Phase 2.5B — not implemented)

1. **Primary: official bulk downloads** for area-complete polygon layers —
   LSMD per-시도 SHP archives from the VWorld data catalog (서울/인천/경기
   files only) and the NA_24 용도지역지구정보 set (전체분 매월, 변동분 매일).
   Rationale: WFS caps at 1000 features with unreliable paging; bulk files
   are versioned, reproducible, and avoid tile-boundary duplicates.
2. **Secondary: 2D Data API paginated requests** (verified `page`/`record`
   metadata) over administrative-area filters or a fixed tile grid for
   change detection and small-area refresh; deduplicate across tiles by
   feature id, and treat feature-id stability across provider refreshes as
   unverified — update detection should use geometry hash + attributes as
   documented in `docs/DATA_REFRESH_STRATEGY.md`.
3. **NED parcel APIs** (`dt_d154`, `dt_d160`) only for candidate-parcel
   refinement by PNU or small bbox, never for full-region parcel sweeps
   (parcel volume for the capital region makes API sweeps impractical:
   the national ownership CSV is documented at 68.5M records / 10.7 GB).
4. **Roads:** ITS 표준노드링크 bulk (nationwide SHP, license 제한 없음) as
   the backbone for classification and network topology once its shipped CRS
   is validated; NGII 도로중심선 bulk (annual, CC BY, EPSG:5179, per-시도
   including 서울/인천/경기) where road width (`rvwd`) is needed;
   `lt_l_moctlink` API for spot checks only (no bulk download exists for it).
5. Raw responses/files must be preserved sanitized, loads versioned by
   dataset reference date, and every load must record source CRS, target
   CRS, license note, and retrieval time (existing refresh-strategy rules).
6. Estimated scale (order-of-magnitude, to be refined in 2.5B): tens of
   SHP archives (3 시도 × ~10 layer families) per refresh cycle; API-side
   validation at hundreds of requests/cycle — well inside documented limits.

## Legal And Analytical Interpretation (unresolved items separated)

Technically available ≠ legally exclusionary. This audit records what each
official page says the data represents; it does **not** assign legal effect.

- Defensible now, as *screening inputs with policy sign-off pending*:
  개발제한구역, 상수원보호구역, 습지보호지역, 산림보호구역, 국립자연공원,
  교육환경보호구역(절대/상대), 야생생물보호구역, 용도지역 (도시/관리/농림/
  자연환경보전), 국가유산 보호구역 계열.
- Manual review only: 역사문화환경보존지역/현상변경 허용기준 (graded
  permission standards, not flat exclusions), municipal wildlife zones,
  `lt_c_uq162` until its semantics are confirmed.
- Informational display only: KNPS park-boundary file (official “no legal
  force” disclaimer), WMS imagery, 토지피복지도.
- No defensible analytical use: inferring truck accessibility from geometry;
  inferring ownership from zoning/PNU/address; treating continuous cadastral
  or LSMD drawings as surveying-grade legal evidence.
- Not invented in this audit: legal buffer/setback distances (school,
  hospital, childcare), construction eligibility, permitting eligibility,
  environmental-impact outcomes. These are statutory/policy questions listed
  in `docs/SUITABILITY_DATA_REQUIREMENTS.md` as human decisions.

## Recommendation

**CONDITIONAL_GO** for Phase 2.5B (production structural-layer ingestion).

The mandatory categories (zoning, protected/restricted areas, roads) are
covered by official, analytically interpretable, feature-based, reproducible
sources live-verified across Seoul, Incheon, and Gyeonggi-do. The conditions
that must be resolved before or during Phase 2.5B:

1. **License/storage-consent resolution per dataset** (VWorld terms 제19조 vs
   KOGL 제한없음 listings vs CC BY-NC-ND bulk cards) — blocking for
   production storage of API-fetched features and for derivative analysis of
   NC-ND bulk files.
2. **Bulk-download workflow** (dtmk archives are browser/솔루션-mediated;
   automated, reproducible acquisition needs a documented manual-download
   procedure with checksums, or provider-approved automation).
3. **Full-coverage completeness validation** per layer per 시도 (probes
   verified contracts, not completeness).
4. **WFS paging unreliability** — coverage must use bulk files or 2D API
   paging.
5. **Ownership field completeness** (`posesn_se_code` nulls) before Category
   D is promoted beyond optional.
6. **Legal/policy sign-off** on which layers act as hard exclusions versus
   soft penalties versus display (see SUITABILITY_DATA_REQUIREMENTS).

**Phase 5.4 remains blocked** until the minimum mandatory package is
production-ingested and the above conditions are resolved.
