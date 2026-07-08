# Phase 0 Findings

Audit date: 2026-07-07.

Local validation date: 2026-07-07.

Phase 0.6 validation date: 2026-07-07.

Phase 0.7 validation date: 2026-07-08.

## Decision

The Waste Equity Platform is feasible as a real public-data decision-support platform for Seoul, Incheon, and Gyeonggi-do. Phase 0.7 removed the last data blocker: RCIS provides sigungu-level waste generation and treatment quantities and facility-level records through live-verified PIDs for 2023 and 2024. The originally implied waste-responsibility metric remains not feasible: no origin-to-destination flow data exists in the official PID catalog, so only the approved imbalance/burden metrics may be built.

Phase 1 (infrastructure) may proceed without waste-metric conditions, provided the region-name crosswalk is built before metric loading.

## Key Findings

1. SGIS and VWorld were live-verified locally with configured credentials.
2. AirKorea and KMA credentials were missing locally, so live probes were not attempted for those sources.
3. RCIS waste-statistics `wss/JsonApi/NTN001` was live-verified for `YEAR=2024`; it returns sido-level 생활폐기물관리구역현황 records, not district-level waste generation or treatment quantities.
4. SGIS, AirKorea, KMA, and VWorld have documented official APIs that can support population, boundaries, real-time air quality, weather/wind context, parcels, zoning, and structural spatial screening.
5. The Resource Circulation Information System documents waste generation/treatment statistics and annual waste file data, but the live `NTN001` response does not confirm district-level coverage or treatment accounting basis.
6. No required-source documentation found in this audit provides waste origin-to-destination movement.
7. Real-time air-quality and weather data are useful current-context layers only. They must not be used as permanent facility-siting evidence without separate historical analysis sources.
8. VWorld structural data can support screening only where feature geometry, attributes, license, and reference dates are available. WMS-only visualization is not enough for reproducible analysis.
9. Incheon administrative changes are current and source-specific. AirKorea's 2026-06-30 notice says Incheon restructuring is reflected in relevant APIs.

## Phase 0.5 Validation Status

| Source | Credential status | Live probe status | Schema validation status | Geographic coverage | Latest reference period observed | Sample file | Remaining issue |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Waste statistics | SUPERSEDED_BY_PHASE_0.6 | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | Phase 0.5 was blocked before live RCIS validation. Current Phase 0.6 status is LIVE_VERIFIED for `NTN001`; generation/treatment quantities remain unverified. |
| SGIS | LIVE_VERIFIED | LIVE_VERIFIED | LIVE_VERIFIED | Seoul probe returned 25 district-level records for `adm_cd=11`; Incheon and Gyeonggi-do require separate code probes. | 2020 | `data/samples/sgis.live.json` | Boundary endpoint, Incheon, and Gyeonggi-do probes still need live validation. |
| AirKorea | CREDENTIAL_MISSING | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | Credential required before real-time observation and station schemas can be live-verified. |
| KMA | CREDENTIAL_MISSING | NOT_APPLICABLE | NOT_APPLICABLE | SCHEMA_UNVERIFIED | SCHEMA_UNVERIFIED | NOT_APPLICABLE | Credential required before weather/wind observation schemas can be live-verified. |
| VWorld | LIVE_VERIFIED | LIVE_VERIFIED | LIVE_VERIFIED | Small Seoul cadastral bounding-box probe returned one feature; broader Seoul/Incheon/Gyeonggi coverage requires tiled or download validation. | SCHEMA_UNVERIFIED | `data/samples/vworld.live.json` | Zoning, public-land ownership, protected-area, road, and sensitive-facility layers still require layer-specific validation. |

Phase 2.1 follow-up note: the Phase 0.5 SGIS gaps for the administrative
boundary endpoint and Incheon/Gyeonggi-do coverage were resolved later during
Phase 2.1 production-ingestion validation. SGIS canonical geography and total
population were live verified for Seoul, Incheon, and Gyeonggi-do using
reference year `2024`. This note is a follow-up to the historical Phase 0.5
status, not a rewrite of the Phase 0 findings.

## Phase 0.6 RCIS Validation Status

| Source | Credential status | Configuration status | Live probe status | Schema validation status | Sample file | Remaining issue |
| --- | --- | --- | --- | --- | --- | --- |
| Waste statistics | CONFIGURED | CONFIGURED | LIVE_VERIFIED | LIVE_VERIFIED for `NTN001` | `data/samples/waste-statistics.live.json` | `NTN001` returned 18 sido/province-level management-area records, including `서울`, `인천`, and `경기`; it did not return district/city/county waste generation or treatment quantities. |

## Phase 0.7 RCIS PID Discovery Status

The official `폐기물통계 OpenAPI 활용가이드` PDF (linked from the RCIS OpenAPI page) documents the complete PID catalog, per-PID field specifications, format-era rules, and provider error codes. Fourteen target PIDs were live-probed with `YEAR=2023`; the ten platform-relevant PIDs were re-verified with `YEAR=2024`. Full results: `docs/API_CONTRACTS/waste_statistics.md`.

| Capability | Status | Evidence |
| --- | --- | --- |
| Sigungu-level waste generation by category | LIVE_VERIFIED | `NTN007` (household), `NTN008` (non-emission business), `NTN018` (emission-facility business), `NTN022` (construction); `WSTE_QTY`, unit 톤/년; Seoul districts, Incheon, Gyeonggi observed. |
| Sigungu-level treatment disposition (recycling/incineration/landfill/other) | LIVE_VERIFIED | Same PIDs; `TOT_RECY_QTY` (+material/energy splits), `TOT_INCI_QTY`, `TOT_FILL_QTY`, `TOT_ETC_QTY`, with public/self/consigned actor splits. Accounting basis: `ORIGIN_BASED_TREATMENT_OUTCOME`. |
| Facility-level records with capacity and throughput | LIVE_VERIFIED | `NTN031`/`NTN032`/`NTN033` (public), `NTN040`/`NTN043`/`NTN046` (business); name, sigungu, address, `FAC_CAP`/`TOT_FILL_CAP`/`ABILITY_QTY`, `DISP_QTY`/`FILL_QTY_TON`. Basis: `FACILITY_LOCATION_BASED_THROUGHPUT`. No coordinates; geocoding required. |
| Sigungu denominators (population, area, households) | LIVE_VERIFIED | `NTN002`. |
| Origin-to-destination waste flows | UNAVAILABLE | Absent from the complete official PID catalog. |
| Latest reference year | LIVE_VERIFIED: 2024 | `YEAR=2024` returned `result[0].YEAR = 2024` with values distinct from 2023. |
| Known data-quality caveats | DOCUMENTED | Embedded `합계`/`소계`/`전국` aggregate rows; Korean region names without codes; `NTN044` placeholder record; quantities as strings with possible blanks; era-dependent schemas (`<=2018`, `2019`, `>=2020`). |

## Metric Finding

The metric `treatment quantity / generation quantity` must not be presented as a treatment responsibility or burden metric.

Approved substitute name:

`Reported Treatment-to-Generation Imbalance Ratio`

Allowed claim:

- The reported generation and reported treatment quantities for the same region, waste category, source, and reference period are imbalanced.

Disallowed claims unless explicit source data is obtained:

- A region avoids treatment responsibility.
- A region bears excess treatment burden.
- Waste moved from one region to another.
- Reported regional treatment equals physical facility throughput in that region.

## Implementation Gates For The Next Phase

- Obtain credentials for data.go.kr services and any remaining source-specific APIs (AirKorea, KMA). For RCIS, use only `RCIS_API_KEY` as the required secret and configure documented `USRID` as non-secret `RCIS_USER_ID`.
- Run live probes and save sanitized `LIVE_VERIFIED` samples for AirKorea and KMA.
- ~~Confirm waste generation/treatment PIDs, units, district/city/county regional granularity, and treatment accounting definitions.~~ Done in Phase 0.7.
- Build a versioned region-name-to-code crosswalk before loading metrics; RCIS returns Korean region names only.
- Filter or separately store embedded `합계`/`소계`/`전국` aggregate rows during RCIS ingestion.
- Geocode facility addresses with recorded provenance before facility mapping.
- Document any unavailable or unverified input in the source registry.
- Keep all fixture data marked `FIXTURE_ONLY`.

## Current Validation Status

| Item | Status |
| --- | --- |
| Official documentation audit | Complete for Phase 0, including the full RCIS PID catalog (Phase 0.7). |
| Live API probes | SGIS, VWorld, and RCIS generation/treatment/facility PIDs LIVE_VERIFIED; AirKorea and KMA CREDENTIAL_MISSING. |
| Fixture contract tests | Passing (includes PID-discovery classification tests). |
| Application frontend/backend | Not created. |
| Production database/Docker infrastructure | Not created. |
| Facility recommendation engine | Not created. |

## Phase 0.6 Recommendation

Recommendation: `CONDITIONAL_GO`.

Reason: SGIS, an essential geographic/population source, is live verified for a Seoul district-level population request, VWorld is live verified for a cadastral feature request, and RCIS is live verified for the `NTN001` management-area endpoint. However, `NTN001` does not provide district/city/county waste generation or treatment quantities, so Phase 1 may proceed only for repository/tooling architecture that preserves data provenance and leaves waste metrics blocked until generation/treatment PIDs are live validated.

## Phase 0.7 Recommendation

Recommendation: `GO`.

Reason: the Phase 0.6 condition is resolved. Sigungu-level waste generation and treatment quantities, facility-level capacity/throughput records, documented units, and the treatment accounting basis are live verified for 2023 and 2024. Phase 1 infrastructure and Phase 2 RCIS ingestion may proceed. Remaining blockers are scoped, not structural: AirKorea/KMA credentials (real-time layer only), the region-name crosswalk, aggregate-row filtering, and facility geocoding. Waste-responsibility claims stay out of scope permanently unless origin-to-destination data is ever published.
