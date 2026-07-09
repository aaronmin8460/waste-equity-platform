# Metric Feasibility Matrix

Classification definitions:

- `CONFIRMED_DIRECT`: directly available from an official source.
- `CONFIRMED_DERIVED`: calculable by combining official fields.
- `PROXY_ONLY`: only a defensible proxy is available.
- `UNVERIFIED`: official documentation is insufficient or live validation is still required.
- `UNAVAILABLE`: the necessary data is not publicly documented as available.

Classifications distinguish source feasibility from live validation. Phase 0.5 live-verified SGIS population and VWorld cadastral feature probes. Phase 0.6 live-verified RCIS `NTN001` for 2024. Phase 0.7 (2026-07-08) live-verified the RCIS generation/treatment/facility PIDs at sigungu granularity for 2023 and 2024; see `API_CONTRACTS/waste_statistics.md`. Phase 2.2 (2026-07-08) production-ingested the four regional generation PIDs (`NTN007`, `NTN008`, `NTN018`, `NTN022`) for 2024 into normalized `regional_waste_statistics` — region grand-total generation and treatment-by-method in 톤/년, accounting basis `ORIGIN_BASED_TREATMENT_OUTCOME`, mapped to SGIS canonical regions (Seoul 25/25, Incheon 10/10, Gyeonggi 24/44; seven multi-district cities excluded as city-vs-district mismatches). Generation reconciles exactly with the sum of the four disposition totals. Per-capita and disposition-mix metrics remain the derived analysis of later phases; this phase ingests the inputs only and does not compute the equity index. Phase 2.3 (2026-07-08) production-ingested the six facility PIDs (`NTN031`/`NTN032`/`NTN033` public, `NTN040`/`NTN043`/`NTN046` private) for 2024 into normalized `waste_treatment_facilities` — 651 capital-region facility lines with capacity (톤/일), throughput (톤/년), residue, and landfill volume/area; accounting basis `FACILITY_LOCATION_BASED_THROUGHPUT`. Facility coordinates are not provided; geocoding (VWorld) is deferred, so distance-based facility metrics remain future work. The `Reported Treatment-to-Generation Imbalance Ratio` can now draw its facility-location-based throughput numerator from these rows and its origin-based generation denominator from `regional_waste_statistics`, but the two accounting bases must stay labeled distinctly.

| Platform input | Classification | Primary source family | Notes |
| --- | --- | --- | --- |
| Regional waste generation | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED: `NTN007`/`NTN008`/`NTN018`/`NTN022` provide `WSTE_QTY` (톤/년) per sigungu and waste category for household, non-emission business, emission-facility business, and construction waste; 2023 and 2024 verified. Aggregate `합계`/`소계` rows must be excluded. |
| Regional waste treatment | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED on the same PIDs: recycling/incineration/landfill/other quantities with public/self/consigned splits. Accounting basis is `ORIGIN_BASED_TREATMENT_OUTCOME` — treatment of the origin region's generated waste, not physical facility throughput in that region. |
| Incineration quantity | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED: `TOT_INCI_QTY` on generation PIDs (origin-based) and `DISP_QTY` on `NTN031`/`NTN040` (facility-location-based). Both bases exist and must be labeled distinctly. |
| Landfill quantity | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED: `TOT_FILL_QTY` (origin-based) and `FILL_QTY_TON` on `NTN033`/`NTN043` (facility-location-based). |
| Recycling quantity | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED: `TOT_RECY_QTY` with material/energy splits (2023 onward) and `NTN046`-`NTN048` facility-side records. |
| Treatment-facility locations | CONFIRMED_DERIVED | Resource Circulation Information System | LIVE_VERIFIED: facility PIDs give facility/company name, sigungu, and street address, but no coordinates. Geocoding (e.g. VWorld geocoder) is required for map placement and must preserve provenance. |
| Treatment-facility capacity | CONFIRMED_DIRECT | Resource Circulation Information System | LIVE_VERIFIED: `FAC_CAP` (톤/일), `ABILITY_QTY` (톤/일), `TOT_FILL_CAP`/`RMN_FILL_CAP` (㎥) per facility. |
| Waste origin-to-destination movement | UNAVAILABLE | Resource Circulation Information System | Confirmed against the full official PID catalog in the utilization guide: no origin-to-destination flow table exists. Do not infer movement. |
| Regional population | CONFIRMED_DIRECT | SGIS | Population endpoint exists by administrative code and reference year. Phase 0.5 live probe returned 25 Seoul district-level records for 2020. |
| Administrative boundaries | CONFIRMED_DIRECT | SGIS, VWorld | SGIS boundary GeoJSON endpoint exists; VWorld also provides boundary layers. Boundary endpoint remains live-unverified. |
| Population grids | UNVERIFIED | SGIS | SGIS provides population/geostatistical services, but the exact grid endpoint for this platform must be selected and validated. |
| Air-quality observations | CONFIRMED_DIRECT | AirKorea | Real-time station and city/province observations are documented. |
| Weather observations | CONFIRMED_DIRECT | KMA | Ultra-short observation endpoint is documented. |
| Wind speed | CONFIRMED_DIRECT | KMA | `WSD` is documented for ultra-short observations. |
| Wind direction | CONFIRMED_DERIVED | KMA | Wind vector components are documented; direct wind-direction category must be confirmed per endpoint or derived with documented formula. |
| Zoning | CONFIRMED_DIRECT | VWorld | Zoning/land-use district services and downloads are documented. Must verify feature-layer availability for each layer before screening use. |
| Cadastral parcels | CONFIRMED_DIRECT | VWorld | Continuous cadastral map API and SHP downloads are documented. Phase 0.5 live probe returned one Seoul cadastral feature. Not surveying-grade. |
| Public land ownership | CONFIRMED_DIRECT | VWorld | Land-ownership WMS/WFS/attribute service is officially listed through data.go.kr/VWorld; access and fields need live validation. |
| Protected areas | PROXY_ONLY | VWorld | VWorld lists park/protection-like layers. A legally complete protected-area model requires explicit layer selection and legal review. |
| Sensitive facilities such as schools and hospitals | UNVERIFIED | VWorld | VWorld lists some school-related layers, but schools/hospitals as sensitive facility points are not confirmed from the required sources. |
| Road accessibility | CONFIRMED_DERIVED | VWorld | Road centerline/road-name layers can support proximity or network proxies; true travel-time accessibility requires additional routing data or assumptions. |

## Proposed Initial Metrics

| Metric | Feasibility | Required warning |
| --- | --- | --- |
| Reported Treatment-to-Generation Imbalance Ratio | CONFIRMED_DERIVED | Numerator must be facility-location-based throughput (facility PIDs); denominator is origin-based generation. Does not prove waste movement or responsibility avoidance. Origin-based treatment splits cannot be used as the numerator because they approximately equal generation by construction. |
| Waste generation per capita | CONFIRMED_DERIVED | Generation fields live-verified (Phase 0.7). Requires aligned waste reference period, population reference year, and geography via the region-name crosswalk. |
| Disposition mix (incineration/landfill/recycling share of generated waste) | CONFIRMED_DERIVED | Origin-based accounting; label as treatment of the region's generated waste, not activity at facilities in the region. |
| Facility capacity burden per capita | CONFIRMED_DERIVED | Facility capacity live-verified; requires geocoded facility locations for distance-based variants. |
| Existing treatment-facility proximity | CONFIRMED_DERIVED after geocoding | Facility addresses live-verified but coordinates are not provided; geocoding accuracy must be validated and recorded. |
| Air-quality current context | CONFIRMED_DIRECT | Real-time context only; not permanent siting evidence. |
| Wind-aware current context | CONFIRMED_DERIVED | Current/forecast context only; not permanent siting evidence. |
| Parcel/zoning exclusion screen | CONFIRMED_DERIVED | Requires explicit legal layers, dates, and geometry validity checks. |

## Metric Not Approved

`Treatment responsibility ratio = regional treatment quantity / regional generation quantity`

Status: not approved.

Reason: Phase 0.7 confirmed the accounting bases. The regional treatment splits on the generation PIDs are origin-based outcomes (how the region's own generated waste was treated), so dividing them by generation is close to 1 by construction and carries no responsibility meaning. Facility throughput divided by generation compares different accounting bases and does not prove cross-region responsibility either, because no origin-to-destination flow table exists in the official PID catalog. Use `Reported Treatment-to-Generation Imbalance Ratio` (facility-location-based throughput over origin-based generation) with the warning above, and never present it as responsibility avoidance or burden transfer.
