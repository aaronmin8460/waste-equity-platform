# API Contract: Waste Statistics

Source: Korea Environment Corporation Resource Circulation Information System.

Official references:

- https://www.data.go.kr/data/15106003/openapi.do
- https://www.recycling-info.or.kr/rrs/viewPage.do?menuNo=M130401
- https://www.data.go.kr/data/3070174/fileData.do

Live validation status: LIVE_VERIFIED for `wss/JsonApi/NTN001`, `YEAR=2024`.

## Authentication

Expected credentials:

- `RCIS_API_KEY`

Expected non-secret request configuration:

- `RCIS_USER_ID`, mapped to the documented `USRID` request parameter.

The RCIS API application confirmation and management page has fields for an ID and an authentication key, but the official utilization guide separates `USRID={아이디}` from `KEY={API인증키}`. The implementation therefore treats `RCIS_API_KEY` as the only required secret and `RCIS_USER_ID` as non-secret request configuration.

Do not use the user's RCIS website login ID as an API credential. Do not invent a separate RCIS API ID secret.

If the official utilization guide or endpoint-specific schema requires a fixed service code, statistics identifier, or operation name, represent that value as endpoint metadata or normal request configuration rather than as a secret.

## Authentication Evidence And Parameter Classification

Official evidence used:

- The official RCIS OpenAPI page describes the waste-statistics service as JSON REST and links the `폐기물통계 OpenAPI 활용가이드`.
- The official RCIS API application confirmation and management page says the ID and authentication key are used for application confirmation and management.
- The official utilization guide documents the REST URL shape as `.../sds/JsonApi.do?PID={API서식번호}&YEAR={조회년도}&USRID={아이디}&KEY={API인증키}`.
- The official utilization guide's request-message table marks `KEY`, `USRID`, `PID`, and `YEAR` as required.
- The current RCIS account management page issued only one API credential to the user: an API key.

Classification:

- Authentication credential: `RCIS_API_KEY`.
- Endpoint-specific service identifier: `PID`, the waste-statistics form code. Store it as endpoint metadata, not as a secret.
- Normal request parameters: `YEAR` and `USRID`. `USRID` is documented as required user/account ID configuration and maps to `RCIS_USER_ID`; it is not an API credential and must not be printed.
- Not an API credential: the user's RCIS website login ID.

## Known Official Coverage

- National waste generation and treatment status.
- Recycling performance and company status.
- Volume-based waste bag statistics.
- Other waste-statistics categories listed on the RCIS API page.

## Required Contract Validation

Before implementation, validate:

- Endpoint URLs and methods.
- Required request parameters: `KEY`, `USRID`, `PID`, and `YEAR`.
- Exact source of the required `USRID` value if RCIS distinguishes it from the OpenAPI account ID shown in the utilization guide.
- Parameters for region, waste category, and result format if supported.
- City/county/district granularity.
- Seoul autonomous district availability.
- Incheon county/district availability.
- Gyeonggi city/county availability.
- Units.
- Treatment accounting definition.
- Facility/company fields.
- Provider-level result-code field and success value.

## Provider Result Validation

Provider-level result-code validation is UNVERIFIED until a real endpoint response is obtained.

## Phase 0.5 Result

No live request was attempted because the authentication contract needed correction. This historical status is superseded by the Phase 0.6 live result below.

## Phase 0.6 Result

USRID contract: official documentation identifies `USRID` as the required `아이디` / user ID request parameter. It is not a fixed service identifier, not the `PID`, and not a secret API credential. The implementation maps it to `RCIS_USER_ID` as non-secret request configuration.

The live RCIS request succeeded after `RCIS_API_KEY` and `RCIS_USER_ID` were configured locally. Neither value was printed or saved.

- Endpoint identifier: `wss/JsonApi/NTN001`.
- Endpoint path: `/sds/JsonApi.do`.
- Request fields: `KEY`, `USRID`, `PID`, and `YEAR`.
- PID: `NTN001`, documented as `(시도) 생활폐기물관리구역현황` in the 2019 onward national waste generation/treatment form list.
- YEAR: `2024`.

Live response validation:

- HTTP status: `200`.
- Content type: `application/json;charset=UTF-8`.
- Top-level structure: `data`, `dataHeader`, `result`, and `searchOption`.
- Provider-level result code: `result[0].ERR_CODE = E000`.
- Provider-level result message: `데이터 전송이 완료되었습니다.`
- Pagination metadata: not present in the response.
- Reference period: `result[0].YEAR = 2024`.
- Unit metadata: `result[0].DUNIT` is blank; no measurement unit was verified from this response.
- Null/missing conventions observed: `searchOption` was `null`; blank unit metadata appeared as a blank string.
- Sanitized sample: `data/samples/waste-statistics.live.json`, ignored by Git.

Live data fields for `NTN001`:

`CITY_JIDT_CD_NM`, `TOT_AREA`, `TOT_POP`, `TOT_DONG`, `TOT_HSHLD`, `LIFEWT_MNG_AREA`, `LIFEWT_MNG_POP`, `LIFEWT_MNG_DONG`, `LIFEWT_MNG_HSHLD`, `LIFEWT_MNGEXCPT_AREA`, `LIFEWT_MNGEXCPT_POP`, `LIFEWT_MNGEXCPT_DONG`, `LIFEWT_MNGEXCPT_HSHLD`, `MNGEXCPT_AREA_RATIO`, `MNGEXCPT_POP_RATIO`, `MNGEXCPT_DONG_RATIO`, `MNGEXCPT_HSHLD_RATIO`.

Live geographic coverage:

- `CITY_JIDT_CD_NM` is the observed region-name field.
- Records returned: `전국`, `서울`, `부산`, `대구`, `인천`, `광주`, `대전`, `울산`, `세종`, `경기`, `강원`, `충북`, `충남`, `전북`, `전남`, `경북`, `경남`, `제주`.
- The response verifies Seoul, Incheon, and Gyeonggi at the sido/province level only.
- The response does not include Seoul autonomous districts, Incheon counties/districts, or Gyeonggi-do cities/counties.
- No RCIS region code was observed in this PID; do not assume RCIS labels match SGIS codes.

Treatment accounting basis for this PID: `NOT_AVAILABLE`. `NTN001` is a 생활폐기물관리구역현황 table and does not directly provide waste generation quantity, total treatment quantity, incineration, landfill, recycling, other treatment, treatment facility name/location/capacity, waste origin region, or treatment destination region.

## Phase 0.7 Result: PID Discovery

Discovery date: 2026-07-08.

Official PID catalog source: `폐기물통계 OpenAPI 활용가이드` (PDF), downloadable from the RCIS OpenAPI page at document path `/statDoc/폐기물통계_OpenAPI활용가이드.pdf`. The guide documents every PID, its form name, its `dataHeader`/`data` field specification, sample values, and provider error codes.

### Format-Era Rule

The same PID is reused across statistical-format eras. The requested `YEAR` selects which response schema is returned:

- `YEAR <= 2018`: 2018-and-earlier forms.
- `YEAR = 2019`: 2019 transitional forms.
- `YEAR >= 2020`: 2020-onward forms (the schemas below).

Ingestion must validate schema per era and must not assume one schema for all years.

### Provider Error Codes (documented)

`E000` success; `E001` invalid call; `E002` expired key; `E003` key mismatch; `E004` unregistered user; `E005` per-minute quota exceeded (100 calls/minute); `E006` daily quota exceeded (3,000 calls/day); `E099` no data for the requested condition; `E888` missing required parameter; `E999` query error.

`E099` must be classified as `NO_DATA_FOR_CONDITION`, not as a connector failure.

### Live-Verified PIDs (2020-onward era)

All PIDs below were live-verified with `YEAR=2023` and the key PIDs re-verified with `YEAR=2024` on 2026-07-08. Sanitized samples (record lists truncated to 20 records) are stored as `data/samples/waste-statistics.<PID>.<YEAR>.live.json`, ignored by Git.

Regional statistics PIDs (unit metadata: `( 단위 : 톤/년 )`):

| PID | Official form name | Granularity | Records (2023) | Key fields |
| --- | --- | --- | --- | --- |
| `NTN002` | 1-나. (시군구) 생활폐기물관리구역현황 | Sigungu | 247 | `TOT_POP`, `TOT_AREA`, `TOT_HSHLD`, management-area splits |
| `NTN004` | 2-가-1). (시도) 생활(가정)폐기물 발생량 | Sido | 756 | Same quantity block as `NTN007` |
| `NTN007` | 2-나-1). (시군구) 생활(가정)폐기물 발생량 | Sigungu | 10,374 | `WSTE_QTY`, `TOT_RECY_QTY` (+`_M_`/`_E_` splits), `TOT_INCI_QTY`, `TOT_FILL_QTY`, `TOT_ETC_QTY`, and `PUB_`/`SELF_`/`COM_` treatment-actor splits per waste category |
| `NTN008` | 2-나-2). (시군구) 사업장비(非)배출시설계폐기물 | Sigungu | 10,374 | Same quantity block |
| `NTN017` | 1-가. (시도) 사업장배출시설계폐기물 발생량 | Sido | 594 | Same quantity block |
| `NTN018` | 1-나. (시군구) 사업장배출시설계폐기물 발생량 | Sigungu | 8,151 | Same quantity block |
| `NTN022` | 1-나. (시군구) 건설폐기물 발생량 | Sigungu | 4,693 | Same quantity block |

Facility-level PIDs (blank `DUNIT`; units are embedded in the guide's field definitions, e.g. `FAC_CAP` 톤/일, `FILL_QTY_TON` 톤/년, `TOT_FILL_CAP` ㎥):

| PID | Official form name | Records (2023) | Key fields |
| --- | --- | --- | --- |
| `NTN031` | 1-가. 공공소각 | 203 | `FAC_NM`, `ADDR`, `FAC_CAP`, `DISP_QTY`, energy-recovery fields |
| `NTN032` | 1-나. 공공기타 | 370 | `FAC_NM`, `ADDR`, `FAC_CAP`, `DISP_QTY` |
| `NTN033` | 1-다. 공공매립 | 229 | `FAC_NM`, `ADDR`, `TOT_FILL_CAP`, `RMN_FILL_CAP`, `FILL_QTY_TON`, `USE_YYYY` |
| `NTN040` | 4-가. 중간처분(소각) | 98 | `COM_NM`, `ADDR`, `FAC_CAP`, `DISP_QTY` |
| `NTN043` | 5. 최종처분 | 72 | `COM_NM`, `ADDR`, `TOT_FILL_CAP`, `RMN_FILL_CAP`, `FILL_QTY_TON` |
| `NTN044` | 6. 종합처분 | 1 | See data-quality caveats |
| `NTN046` | 8-가. 재활용처리(중간) | 1,427 | `COM_NM`, `ADDR`, `ABILITY_QTY`, `DISP_QTY` |

All facility PIDs carry `CITY_JIDT_CD_NM` (sido) and `CTS_JIDT_CD_NM` (sigungu) plus per-facility rows (`SEQ`).

### Geographic Coverage

- `서울`, `인천`, and `경기` sigungu rows were observed live for `NTN002`, `NTN007`, `NTN008`, `NTN018`, `NTN022`, `NTN031`, `NTN032`, and `NTN046`, including Seoul autonomous districts (`종로구`, `중구`, `용산구`, ...).
- `NTN033` (public landfill) and `NTN040` (business incineration) returned no Seoul rows for 2023; Incheon and Gyeonggi rows are present. Treat the absence as reported data, not as an error.
- `NTN043` (final disposal companies) returned only Gyeonggi rows inside the metropolitan area for 2023.

### Latest Available Reference Period

`YEAR=2024` returned `E000` with `result[0].YEAR = 2024` and values distinct from 2023 (verified for `NTN007`, Seoul `종로구`: generation sum 256,850.2 in 2023 vs 261,339.2 in 2024; landfill sum 22,574.5 vs 15,474.4). The latest available reference year is therefore 2024.

### Treatment Accounting Basis

The 2020-onward generation PIDs report, per region and waste category: annual generation (`WSTE_QTY`) and how that generated waste was treated, split by disposition (`TOT_RECY_QTY`, `TOT_INCI_QTY`, `TOT_FILL_QTY`, `TOT_ETC_QTY`) and by treatment actor (`PUB_` public, `SELF_` self, `COM_` consigned). Classification: `ORIGIN_BASED_TREATMENT_OUTCOME`.

The facility PIDs report per-facility annual throughput (`DISP_QTY`, `FILL_QTY_TON`) at the facility's location. Classification: `FACILITY_LOCATION_BASED_THROUGHPUT`.

No PID in the official catalog provides origin-to-destination waste flows. Classification: `NOT_AVAILABLE`. The platform must not claim interregional movement from these tables.

### Data-Quality Caveats

- Aggregate pseudo-region rows are embedded in `data`: `CTS_JIDT_CD_NM` values `합계` (national total) and `소계` (sido subtotal), and `CITY_JIDT_CD_NM` value `전국`. Ingestion must exclude or separately store these rows before regional aggregation.
- Region identifiers are Korean names only. Despite the `_CD_NM` suffix, no numeric region code is returned; a versioned name-to-code crosswalk (REGION_CODE_STRATEGY) is mandatory before loading.
- `NTN044` (종합처분) returned a single placeholder-looking record for 2023 (region values such as `VARCHAR2`). Status: `SCHEMA_UNVERIFIED`; exclude until the provider publishes real rows.
- Statistics PIDs return the full national matrix (region × waste-category); Seoul/Incheon/Gyeonggi filtering happens client-side.
- Quantity fields arrive as strings and may be blank; blank must be handled explicitly, not coerced to zero silently.
- `TOT_RECY_M_QTY`/`TOT_RECY_E_QTY` (material/energy recycling splits) exist only for `YEAR >= 2023` per the guide.

## Sample Policy

- If credentials are absent, connector status is `CREDENTIAL_MISSING`.
- If required non-secret request configuration is absent, connector status is `CONFIGURATION_MISSING`.
- Fixture tests may validate local parser behavior only.
- No fixture may be labeled as official public data.
- Discovery samples truncate record lists to 20 records; the true record count is preserved in `request_metadata.record_count`.
