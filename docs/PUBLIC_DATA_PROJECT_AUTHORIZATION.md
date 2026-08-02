# Public-Data Project Authorization (Waste Equity Platform)

**Authorization status:** `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION`
**Public deployment status:** `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER`
**Confirmed on:** 2026-08-02 (by the project owner)
**Phase:** 1B-LC8 — government-partner-authorized full public deployment
**Supersedes (operationally):** the LC7 deployment block recorded in
[LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md)

---

## 1. What was confirmed

On **2026-08-02** the project owner confirmed that the Waste Equity Platform is being
conducted **in cooperation with a government institution**, and that this cooperating
government institution has **authorized the project to use and publicly present the
relevant government public datasets**.

This is the same class of authorization the project already relies on elsewhere: prior
government-project authorization for the use, local storage, transformation, database
ingestion, and analytical processing of the relevant VWorld and other government spatial
datasets was recorded for Phase 2.5B (see `docs/DEVELOPMENT_PHASES.md` §2.5B and
`docs/SUITABILITY_DATA_REQUIREMENTS.md`). LC8 extends the same confirmed basis to the
**public presentation** of the derived land-cover services.

This document records the authorization **operationally**, as the project-level basis for
public deployment. It is the authoritative internal statement of that basis.

## 2. What this authorization is — and is not

| | |
| --- | --- |
| **It is** | a project-level authorization, confirmed by the project owner, from the **cooperating government institution** with which this project is conducted |
| **It is** | the operational basis on which the platform's **derived** land-cover services are publicly deployed |
| **It is** | sufficient, for this project, to lift the LC7 *operational* deployment block |
| **It is NOT** | a dataset-specific **written reply from EGIS** about the 세분류 [2025] 전국 토지피복지도 download |
| **It is NOT** | an assignment of any **KOGL type** (Type 1 or otherwise) to the EGIS vector land-cover dataset |
| **It is NOT** | an EGIS licence confirmation, licence number, or licence upgrade |
| **It is NOT** | permission to **redistribute raw data** |
| **It is NOT** | commercial sublicensing permission |

**No EGIS-specific KOGL type is asserted anywhere in this project.** LC7's finding stands
as a historical evidence review: from the public evidence available on 2026-08-02, a
dataset-specific EGIS licence for the *vector* download could not be established, and the
KOGL Type 1 mark that exists applies to the separate WMS map service and to the ministry's
own tabular statistics — not to the SHP download. LC8 does not overturn that finding; it
proceeds on a **different and separately confirmed basis**: authorization from the
project's own cooperating government institution.

The two must not be conflated:

1. **dataset-specific public evidence** — `UNRESOLVED_PENDING_WRITTEN_RESPONSE` (LC7);
2. **project-level government-partner authorization** — `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` (LC8, this document).

## 3. Relationship to LC7

LC7 (`research/land-cover-lc7-licence-public-scope`, merged as `7c53970`) concluded:

* the EGIS copyright policy grants free use only for works carrying an **attached** 공공누리
  (KOGL) mark, and no such mark is published on the downloaded vector 토지피복지도;
* the KOGL Type 1 designation observed on 공공데이터포털 belongs to the **WMS map service**
  (data.go.kr listing 3045398), not to the SHP download;
* no official inquiry e-mail address is published; the written channels are the EGIS
  질문과 답변 board and a formal 공문;
* therefore deployment eligibility was **BLOCKED** and the runtime state stayed
  `LOCAL_USE_ONLY_PENDING_CLARIFICATION`.

Every one of those findings remains **factually recorded and unmodified** in the LC7
documents. LC8 adds a dated superseding *operational* note to each of them. LC7A (submit
the written EGIS inquiry) is no longer the blocking next phase; it remains available as
optional future work should a dataset-specific written EGIS position ever be wanted.

## 4. Publication boundary

Full public deployment covers **all currently implemented user-facing and machine-readable
derived land-cover functionality**. It does **not** create any new raw-data redistribution
functionality.

**Publicly exposed (derived products of this platform):**

* the platform's own 500 m candidate-cell geometry (`capital-grid-500m-v1`), already
  belonging to the Waste Equity Platform;
* coverage status, coverage ratio, evaluated area, uncovered area;
* dominant L1/L2/L3 codes and official Korean names;
* complete per-cell class-area distributions;
* regional aggregate summaries;
* JSON API responses, public MVT tiles, the browser map layer, legend, filters, and the
  candidate-detail land-cover section.

**Not created and not exposed:**

* original SHP file download;
* raw source-polygon API (raw or transformed);
* raw per-feature source attributes;
* original map-sheet download;
* database dump download;
* unrestricted administrative SQL endpoint.

**Original SHP files and raw source polygons are not redistributed.** All public
land-cover outputs are **derived 500 m candidate-grid statistics** or services rendered
from them. This was verified directly from the source code and SQL before any production
data was moved: the public router
(`backend/src/waste_equity_backend/api/routes/land_cover_cells.py`) reads only
`environmental_land_cover_cell_stat_versions`, `environmental_land_cover_cell_statistics`,
`environmental_land_cover_cell_class_areas`, `environmental_dataset_versions`, and the
existing `suitability_candidates` / `suitability_analysis_runs` geometry. It never queries
`environmental_land_cover_features` (6,901,309 rows) or
`environmental_land_cover_map_sheets` (2,013 rows), and neither table was deployed.

## 5. Mandatory source attribution

Source attribution remains **mandatory project policy** on every public surface — the
land-cover layer control, the candidate-detail land-cover section, the data/source
information area, the public API metadata, and the API documentation:

```
출처: 기후에너지환경부 환경공간정보서비스(EGIS), 「세분류 [2025] 전국 토지피복지도」.
Waste Equity Platform이 서울·인천·경기 500 m 후보격자 단위로 가공한 파생 통계입니다.
```

Accompanying machine-readable attribution fields:

| Field | Value |
| --- | --- |
| Provider | 기후에너지환경부 환경공간정보서비스(EGIS) |
| Official dataset | 세분류 [2025] 전국 토지피복지도 |
| Reference period | 2025 |
| Official source URL | <https://aid.mcee.go.kr/intro/land.do> (revalidated live on 2026-08-02; the historic `egis.me.go.kr` host still resolves and redirects here) |
| Transformation version | `land-cover-v1` |
| Candidate grid | `capital-grid-500m-v1` |
| Statistics derivation version | `land-cover-cell-stats-v1` |
| Raw source geometry | not returned by any endpoint |
| Authorization status | `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` |

## 6. Analytical status — unchanged by this authorization

Public deployment authorization changes **nothing** about how the data is used
analytically. All of the following remain exactly as they were:

* `used_in_suitability_scoring = false`;
* land-cover statistics are **descriptive only**;
* no suitability **total score**, **rank**, **candidate status**, **exclusion**, **review
  reason**, **weight**, **policy version**, or **derivation version** reads them;
* **no legal eligibility, legal prohibition, construction feasibility, or environmental
  approval** is inferred from the land-cover statistics;
* the recorded coverage limitations stand: coastal and island coverage may be incomplete,
  `NO_COVERAGE` never means the real world has no land cover, and dominant L1/L2/L3 values
  are calculated independently per level and need not form a nested path.

Suitability scoring was **not** changed merely because public deployment became
authorized.

## 7. Authorization record placeholder

A reference to the government-partner authorization record may be attached here later.

```
Government partner .......... 협력 정부기관  (no specific institution name is documented
                              in tracked project material; the neutral term is used)
Authorization record ........ (not attached)
Document number ............. (not recorded)
Official contact ............ (not recorded)
Date of the underlying record (not recorded)
Signatory ................... (not recorded)
```

**Nothing above is invented.** No document number, official name, e-mail address, letter,
underlying date, or signatory is fabricated. The only confirmed, recorded fact is that the
**project owner confirmed government-partner authorization on 2026-08-02**. If an
authorization record is later attached, it must be stored **outside** this repository if it
contains any private or personal information; only a non-sensitive reference belongs here.

## 8. Where this status appears at runtime

| Surface | Value |
| --- | --- |
| API disclosures `license_status` | `PUBLIC_DEPLOYMENT_AUTHORIZED_BY_PROJECT_GOVERNMENT_PARTNER` |
| API disclosures `authorization_basis` | `GOVERNMENT_PARTNER_PROJECT_AUTHORIZATION` |
| API disclosures `license_statement` | English statement (§9) |
| API disclosures `public_statement_ko` | Korean statement (§9) |
| API disclosures `attribution` | the block in §5 |
| API lifecycle `production_deployment` | `PUBLIC_DEPLOYED` |
| Land-cover layer control | Korean statement + attribution |
| Candidate-detail land-cover section | Korean statement + attribution |
| Data/source information area (데이터·출처) | Korean statement + attribution |

## 9. Canonical public statements

**English**

> Public deployment of the derived land-cover services is authorized for the Waste Equity
> Platform under project-level authorization from its cooperating government institution.
> This operational authorization does not assert a dataset-specific EGIS KOGL type.
> Original SHP files, raw source polygons, and raw per-feature source records are not
> redistributed.

**Korean**

> 본 플랫폼은 협력 정부기관이 확인한 프로젝트 차원의 공공데이터 활용 범위에 따라 공개
> 운영됩니다. 토지피복 정보는 EGIS 「세분류 [2025] 전국 토지피복지도」를 Waste Equity
> Platform의 500 m 후보격자 단위로 가공한 파생 통계입니다. 원본 SHP 파일, 원본 토지피복
> 도형 및 원본 개별 피처 레코드는 제공하지 않습니다.

---

**Related documents:** [LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md](LAND_COVER_PUBLIC_DEPLOYMENT_REPORT.md) ·
[LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md](LAND_COVER_LICENCE_PUBLIC_SCOPE_DECISION.md) ·
[LAND_COVER_PUBLICATION_SURFACE_MATRIX.md](LAND_COVER_PUBLICATION_SURFACE_MATRIX.md) ·
[EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md](EGIS_LAND_COVER_LICENCE_INQUIRY_KO.md)
