# Suitability Data Requirements (Phase 5.4 Prerequisites)

Derived from the Phase 2.5A audit (`docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`,
2026-07-11). This document separates what data is technically available from
what remains a legal interpretation or a human policy decision. Nothing here
authorizes suitability scoring; Phase 5.4 stays blocked until the minimum
package below is production-ingested (complete Seoul/Incheon/Gyeonggi-do
coverage) and the listed policy decisions are made.

Authorization update (Phase 2.5B): the project owner has confirmed prior
government-project authorization for the use, local storage, transformation,
database ingestion, and analytical processing of the relevant VWorld and
government spatial datasets. The audit-time dataset-storage/licensing
uncertainty (VWorld 제19조 vs KOGL/CC BY-NC-ND) is therefore resolved for this
project and is no longer an open condition; the remaining open conditions are
the human policy decisions and completeness, not data-storage permission.
Phase 2.5B is in progress: subphase 2.5B-1 production-ingests the 용도지역
zoning family (UQ111–UQ114). Phase 5.4 nonetheless remains blocked until the
full mandatory package (zoning + protected/restricted + roads) is ingested
with complete coverage.

## Input Classification

### Mandatory exclusion/constraint inputs (official feature data confirmed)

| Input | Source (status) | Role |
| --- | --- | --- |
| 용도지역 polygons — 도시지역/관리지역/농림지역/자연환경보전지역 (`LT_C_UQ111`–`UQ114`, with `uname`/`ucode` down to 제2종일반주거지역-level classes) | VWorld WFS/2D + NA_24 bulk (LIVE_VERIFIED) | zoning context; identifies residential/commercial/industrial/green/management zones; exclusion or penalty per policy |
| 개발제한구역 (`LT_C_UD801`) | VWorld WFS/2D + dtmk bulk (LIVE_VERIFIED) | direct statutory exclusion candidate |
| 상수원보호구역 (`LT_C_UM710`, 수도법 근거) | VWorld WFS/2D + dtmk bulk (LIVE_VERIFIED) | direct statutory exclusion candidate |
| 습지보호지역 (`LT_C_UM901`) | VWorld WFS/2D + dtmk bulk (LIVE_VERIFIED) | statutory exclusion candidate / environmental screening |
| 산림보호구역 (`LT_C_UF151`) | VWorld WFS/2D + dtmk bulk (LIVE_VERIFIED) | statutory exclusion candidate / screening |
| 국립자연공원 (`LT_C_WGISNPGUG`) | VWorld WFS/2D (LIVE_VERIFIED; stale 2023-09; `park_name` only) | screening; promote only with `uma100` zone detail |
| 교육환경보호구역 절대/상대 (`LT_C_UO101`) | VWorld WFS/2D + dtmk bulk (LIVE_VERIFIED) | statutory sensitive-receptor zones around schools — used instead of invented school buffers |
| 국가유산 지정/보호구역 계열 (`LT_C_UO301`) | VWorld WFS/2D (LIVE_VERIFIED); 국가유산청 GIS authoritative (DOCUMENTED_NOT_TESTED) | screening + manual review |
| Road features — ITS 표준노드링크 (classification, topology, restriction fields) and/or NGII 도로중심선 (`LT_L_N3A0020000`, width attribute) | bulk downloads (DOCUMENTED_NOT_TESTED) + VWorld API layers (LIVE_VERIFIED) | distance-to-road and road-class access indicators only |
| SGIS administrative boundaries + population (2024) | already production-ingested (Phase 2.1) | denominators, aggregation geography |
| Existing waste-facility burden (RCIS facilities + throughput, Phase 2.3/2.4; burden indicator Phase 5.2) | already production-ingested | burden context; never merged across accounting bases |

### Optional scoring inputs

| Input | Source (status) | Note |
| --- | --- | --- |
| 야생생물보호구역 (`LT_C_UM221`) | LIVE_VERIFIED | municipal designations; completeness unverified → soft penalty/manual review |
| 도시자연공원/공원·녹지 계열 (`LT_C_UQ162`) | LIVE_VERIFIED | layer semantics unresolved (observed 공원/경관녹지/어린이공원 values); manual review before use |
| Public-land ownership (`dt_d160` `posesn_se_code`/`nation_instt_se_code`; bulk NA_12/NA_30) | LIVE_VERIFIED with caveat | classification fields null in 2 of 3 probed parcels; optional until field completeness is validated; ownership must never be inferred from zoning/PNU/address |
| Per-parcel 토지이용계획 (`dt_d154` zone/restriction lists) | LIVE_VERIFIED | candidate-parcel refinement only; not for full-region sweeps |
| Sensitive-facility points — schools (표준데이터 15021148), hospitals (HIRA 15001698), childcare (15013108), kindergartens (유치원알리미) | DOCUMENTED_NOT_TESTED | coordinates documented but EPSG undeclared → validate before distance use |
| Welfare/nursing facilities (15096296, 15059029) | DOCUMENTED_NOT_TESTED | address-only confirmed; requires geocoding (derived) |
| 생태자연도 (grades) | DOCUMENTED_NOT_TESTED | screening only; KOGL Type 3 (변경금지) license conflicts with derived analysis — needs review |

### Informational inputs (display only, never analytical exclusion)

- 국립공원공단 공원경계 file (official “법적 효력이 없음” disclaimer).
- All VWorld WMS imagery; 토지피복지도/환경주제도 WMS.
- Continuous cadastral drawings (reference drawings, not surveying-grade).

### Unavailable inputs

- 생태·경관보전지역 as a dedicated official feature layer (not located;
  possibly inside the 환경 기타용도지역지구 bulk set, unverified).
- Waste origin-to-destination movement (unchanged from earlier audits).
- Operational truck accessibility: restriction fields exist on
  표준노드링크/`lt_l_moctlink` (`REST_VEH`/`REST_W`/`REST_H`) but their
  population rates are unvalidated; geometric proximity never proves truck
  access.
- Officially declared CRS for sensitive-facility 위도/경도 columns.

### Requires policy approval (human decisions — not data questions)

1. Which confirmed layers act as **hard exclusions** versus **soft
   penalties** versus **display**: the audit only records what each dataset
   officially represents; designating (for example) 상대보호구역 or
   역사문화환경보존지역 as a hard exclusion is a policy/legal choice.
2. Any buffer or setback distance around sensitive receptors, water bodies,
   or residential zones. No statutory distance was found in the audited
   documentation, and none may be invented; adopting one requires a cited
   legal basis or an explicitly labeled policy assumption.
3. Weighting of any composite suitability score (governed by the adoption
   requirements in `docs/ANALYTICAL_METHODS.md`).
4. Candidate-site geometry (grid cell size vs parcel-based candidates).
5. License posture — RESOLVED for this project: prior government-project
   authorization for use, storage, transformation, and analytical processing
   of the relevant VWorld/government datasets has been confirmed by the
   project owner, addressing the VWorld 제19조 storage-consent and CC BY-NC-ND
   questions for this project's derived-analysis use.

### Legal interpretation still required

- Statutory effect (act and article) per layer, confirmed against current
  law — the official layer pages cite law names (수도법, 습지보전법,
  산림보호법, 국토계획법) but not articles, and waste-facility permitting
  criteria (폐기물처리시설 설치 관련 법령) were not part of any audited
  dataset.
- Whether 역사문화환경보존지역/현상변경 허용기준 zones (graded permission
  standards) restrict waste facilities at all.
- Whether zone drawings (LSMD continuous theme maps) may be used as the
  legal boundary for exclusion at parcel precision, or only as screening
  with parcel-level confirmation via 토지이음/`dt_d154`.

## Minimum Package Required To Unblock Phase 5.4

Phase 5.4 may begin only when ALL of the following are production-ingested
with provenance, versioning, and license notes, per
`docs/DATA_REFRESH_STRATEGY.md`:

1. 용도지역 polygons (UQ111–UQ114 family or NA_24 bulk equivalent) for all
   of Seoul, Incheon, Gyeonggi-do, with completeness validation per 시도.
2. Protected/restricted polygons: 개발제한구역, 상수원보호구역,
   습지보호지역, 산림보호구역, 국립자연공원, 교육환경보호구역,
   국가유산 보호구역 계열.
3. Road features supporting distance-to-road and road-class filtering
   (표준노드링크 and/or NGII 도로중심선), CRS validated.
4. The already-ingested SGIS boundaries/population and RCIS facility burden
   at compatible reference periods.

And when ALL of the following decisions are recorded:

5. License/storage-consent posture — RESOLVED for this project by the
   confirmed prior government-project authorization (see the authorization
   update above); no longer an open condition.
6. Reviewed exclusion/penalty/display classification per layer (policy
   sign-off, recorded in `docs/ANALYTICAL_METHODS.md` review workflow).

Ownership, sensitive-facility points, per-parcel land-use, and ecological
grades are explicitly **not** part of the minimum package; they extend
scoring later without blocking it.

If any mandatory item above cannot be obtained for the full Seoul
Metropolitan Area, Phase 5.4 remains blocked. As of 2026-07-11 the audit
found no data-availability blocker for the mandatory items; with dataset
licensing/storage now resolved for this project by the confirmed prior
authorization, the remaining open conditions are bulk-workflow reproducibility,
per-시도 completeness validation, and the human policy decisions listed above.
Phase 2.5B-1 delivers the versioned schema and the first mandatory item
(용도지역 zoning); the protected/restricted and road layers remain to be
ingested before Phase 5.4 can be unblocked.
