# Region Code Strategy

The platform must cover Seoul, Incheon, and Gyeonggi-do from the first implementation scope. It must not assume all official sources use the same region codes.

## Canonical Region Model

Use an internal canonical region table with the following minimum fields:

| Field | Purpose |
| --- | --- |
| `canonical_region_id` | Stable platform identifier. |
| `region_level` | `sido`, `sigungu`, `administrative_district`, or `eup_myeon_dong`. |
| `official_korean_name` | Source-preserved official name. |
| `normalized_korean_name` | Name normalized only for matching. |
| `english_name` | Optional display label. |
| `parent_canonical_region_id` | Parent administrative area. |
| `valid_from` | Start date for this code/name. |
| `valid_to` | End date, nullable. |
| `sgis_adm_cd` | SGIS administrative code where mapped. |
| `korean_admin_code` | Korean administrative/legal code where mapped. |
| `vworld_code` | VWorld or parcel-code prefix where mapped. |
| `waste_region_label` | Source-preserved waste-statistics label. |
| `airkorea_sido_name` | AirKorea `sidoName` value where used. |
| `mapping_status` | `confirmed`, `needs_review`, or `retired`. |
| `mapping_source` | Source and reference period for the mapping. |

## Source Code Systems

### SGIS

SGIS documents administrative code depth as:

- 2 digits: sido
- 5 digits: sigungu
- 7 digits: eup/myeon/dong

SGIS codes should be stored separately from Korean legal-dong codes and VWorld parcel codes.

Phase 2.1 canonical geography ingestion uses SGIS as the first platform
canonical geography source:

- Canonical region codes are derived as `KR-SGIS-{adm_cd}`.
- The native SGIS code is preserved separately in `source_administrative_code`
  and in `region_code_map`.
- SGIS-confirmed mappings are marked with SGIS provenance for the selected
  source reference period.
- Cross-source mappings to RCIS, VWorld, legal-dong codes, administrative-dong
  codes, AirKorea names, and KMA grids remain review-required until each source
  is explicitly validated.
- SGIS codes must not be treated as RCIS codes, VWorld PNU values, Korean
  legal-dong codes, or Korean administrative-dong codes.

### Korean Administrative Codes

Use Korean administrative/legal code systems as a separate mapping axis. Do not collapse legal dong, administrative dong, sigungu, and local administrative district codes into one field.

### Waste Statistics Region Labels Or Codes

The live `NTN001` response uses `CITY_JIDT_CD_NM` as the region-name field and does not expose a region code. Preserve source labels exactly. Add normalized matching only after each endpoint's official fields are confirmed.

Required matching checks:

- Seoul autonomous districts
- Incheon counties and districts
- Gyeonggi cities and counties
- Gyeonggi city administrative districts where applicable, such as districts inside large cities

### VWorld

VWorld parcel identifiers and layer attributes may use PNU and administrative-code prefixes. PNU must be treated as parcel-level identification, not as a direct replacement for SGIS `adm_cd`.

## Regional Coverage Strategy

### Seoul

Map Seoul as:

- Seoul special city
- 25 autonomous districts
- Optional lower administrative units only when needed for boundary, population, or parcel joins

### Incheon

Map Incheon as:

- Incheon metropolitan city
- Counties and districts in the current source reference period

Important current-date note: AirKorea's official 2026-06-30 notice says Incheon administrative restructuring is reflected in AirKorea, changing from 2 counties and 8 districts to 2 counties and 9 districts. The notice lists 강화군, 옹진군, 영종구, 검단구, 서해구, 계양구, 부평구, 미추홀구, 제물포구, 남동구, and 연수구. Each source's reference period must determine which structure is valid for that dataset.

### Gyeonggi-do

Map Gyeonggi-do as:

- Province
- Cities and counties
- Administrative districts inside cities where the source reports them separately

Do not assume city-level, county-level, and district-level reporting are interchangeable.

## Mismatch Risks

| Mismatch | Risk | Required handling |
| --- | --- | --- |
| SGIS `adm_cd` vs legal/administrative codes | Boundary and population joins may attach to the wrong geography. | Maintain separate fields and versioned crosswalks. |
| Waste labels vs SGIS codes | Waste statistics may use names, changed labels, or reporting regions. | Match by reviewed crosswalk only; never fuzzy-match silently. |
| VWorld parcel/PNU prefixes vs administrative boundaries | Parcel prefixes can differ from analytical boundary versions. | Join via validated geometry or explicit code crosswalk. |
| Incheon administrative changes | Time-series metrics may mix old and new districts. | Add validity dates and reference-period warnings. |
| Gyeonggi administrative districts | City subdistricts may be absent in some sources. | Preserve native granularity and aggregate only with documented rules. |

## Phase 0.6 Region-Code Validation Notes

- SGIS live population probe used `adm_cd=11` for Seoul and returned 25 district-level records for `year=2020`.
- SGIS Incheon and Gyeonggi-do codes were not live-probed in Phase 0.5.
- VWorld live cadastral probe returned parcel attributes including `pnu`; PNU must remain separate from SGIS `adm_cd`.
- RCIS `NTN001` live response returned `CITY_JIDT_CD_NM` values for `전국`, all major sido/province labels, including `서울`, `인천`, and `경기`.
- RCIS `NTN001` did not return Seoul autonomous districts, Incheon counties/districts, Gyeonggi cities/counties, Gyeonggi city administrative districts, or RCIS region codes.
- AirKorea region names and KMA grid coordinates remain unvalidated locally because credentials were missing.

## Phase 0.7 Region-Code Validation Notes

- RCIS sigungu-level PIDs (`NTN002`, `NTN007`, `NTN008`, `NTN018`, `NTN022`, and the facility PIDs) return `CITY_JIDT_CD_NM` (sido) and `CTS_JIDT_CD_NM` (sigungu) as Korean names only. Despite the `_CD_NM` suffix, no numeric region code is present anywhere in the response.
- The crosswalk must therefore map RCIS Korean region-name pairs (sido name, sigungu name) to canonical codes, versioned by reference year.
- RCIS data embeds pseudo-region rows: `CTS_JIDT_CD_NM` values `합계` and `소계`, and `CITY_JIDT_CD_NM` value `전국`. These must be excluded from the crosswalk and from regional aggregation.
- 2023/2024 RCIS statistics use pre-2026 Incheon administrative names; the crosswalk validity dates must handle the 2026 Incheon restructuring explicitly.

## Phase 2.1 SGIS Canonical Geography Notes

- SGIS population and administrative boundaries are live verified for Seoul,
  Incheon, and Gyeonggi-do using reference year `2024`.
- The selected `2024` SGIS geography preserves the pre-2026 Incheon structure
  observed for that reference period: one Incheon SIDO record and 10
  county/district child records. The platform must not force the 2026 Incheon
  administrative structure onto this data.
- Seoul coverage is one SIDO record and 25 autonomous districts.
- Gyeonggi-do coverage is one SIDO record and 44 SGIS-native child regions for
  `2024`. These are preserved at the granularity SGIS returns; city, county,
  and city administrative district levels must not be treated as
  interchangeable.
- Phase 2.1 does not create RCIS mappings. RCIS region-name mapping remains a
  later reviewed crosswalk task because RCIS live responses provide Korean
  region names, not numeric region codes.
- Phase 2.1 does not create VWorld mappings. VWorld parcel and spatial-layer
  joins remain future work and must use validated code or geometry crosswalks.
- Any unmatched or cross-source mapping remains publication-blocking for
  metrics until manually reviewed.

## Initial Crosswalk Workflow

1. Load SGIS boundary codes for the chosen boundary year.
2. Load Korean administrative/legal code reference for the same or nearest valid date.
3. Load VWorld parcel and spatial layer attributes for the same reference period where possible.
4. Load waste-statistics region labels from live API or official files.
5. Build exact-name candidate matches.
6. Review mismatches manually.
7. Store mapping provenance and validity dates.
8. Block metric publication for any region whose mapping status is not confirmed.
