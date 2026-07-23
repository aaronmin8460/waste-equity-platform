"""Environmental-layer catalogue (Suitability Phase 1A) — single source of truth.

This module declares every environmental/physical layer the future suitability
phase may add, as immutable :class:`EnvironmentalLayerSpec` records. It is a
**catalogue of future datasets**, not data: no geometry, no score, no ingestion.
Each spec carries an explicit :class:`LayerLifecycle` so a planned or
experimental layer is never presented as implemented.

The DB-relevant projection (:func:`registry_seed_rows`) seeds the
``environmental_layer_registry`` table (migration 0017). A unit test asserts the
migration's inlined seed never diverges from this constant, exactly as the
facility standard-cost seed is cross-checked.

The four ``IMPLEMENTED`` layers (admin boundary, zoning, road centreline,
protected areas) are already production-ingested and are catalogued here only to
make the "already reused vs newly planned" boundary explicit; Phase 1B reuses
them through the existing schema rather than re-ingesting.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class LayerLifecycle(StrEnum):
    """Where a layer stands in this codebase today (never overstated)."""

    IMPLEMENTED = "IMPLEMENTED"
    PLANNED = "PLANNED"
    FUTURE = "FUTURE"
    EXPERIMENTAL = "EXPERIMENTAL"


class LayerModality(StrEnum):
    """Physical form of a layer's source data."""

    VECTOR_POLYGON = "vector_polygon"
    VECTOR_LINE = "vector_line"
    RASTER = "raster"
    POINT_AND_POLYGON = "point_and_polygon"
    RASTER_OR_POLYGON = "raster_or_polygon"


class ReadinessRecommendation(StrEnum):
    """Phase 1B *ingestion*-readiness recommendation (never a scoring decision)."""

    GO = "GO"
    CONDITIONAL_GO = "CONDITIONAL_GO"
    NO_GO = "NO_GO"


class VerificationStatus(StrEnum):
    """Contract-verification status, reused from the Phase 2.5A vocabulary."""

    LIVE_VERIFIED = "LIVE_VERIFIED"
    DOCUMENTED_NOT_TESTED = "DOCUMENTED_NOT_TESTED"
    PROXY_ONLY = "PROXY_ONLY"
    UNAVAILABLE = "UNAVAILABLE"


# ``target_phase`` allowed values. "reuse" = already implemented, plugged in as-is;
# "1B"/"1C" = the future subphase a new layer is scoped for. These are roadmap
# labels only and gate nothing in Phase 1A.
PHASE_REUSE = "reuse"
PHASE_1B = "1B"
PHASE_1C = "1C"


@dataclass(frozen=True)
class EnvironmentalLayerSpec:
    """Immutable catalogue record for one environmental layer.

    A declaration only — it holds *metadata about* a dataset, never the dataset.
    The richer descriptive fields (provider/license/CRS/resolution/difficulty)
    back the future ``GET /api/v1/environment/layers`` API; the DB-persisted
    subset is projected by :func:`registry_seed_rows`.
    """

    layer_name: str
    korean_label: str
    modality: LayerModality
    lifecycle: LayerLifecycle
    target_phase: str
    verification: VerificationStatus
    recommendation: ReadinessRecommendation
    # Human-readable descriptive metadata (served by the future API; mirrors the
    # audit). Not persisted to the lean registry table.
    provider: str
    official_source: str
    license_note: str
    update_cycle: str
    source_crs: str
    storage_crs: str
    geometry_or_raster_type: str
    spatial_resolution: str
    suitability_role: str
    implementation_difficulty: str
    # Short catalogue note (persisted). Never a fabricated score or completion %.
    notes: str


# Storage CRS is EPSG:4326 for every layer (platform standard); metric operations
# use a validated projected CRS or geodesic ``geography`` at build time.
_STORAGE_CRS = "EPSG:4326"


ENVIRONMENTAL_LAYER_REGISTRY: tuple[EnvironmentalLayerSpec, ...] = (
    # --- Already implemented (reuse; never re-ingested) --------------------- #
    EnvironmentalLayerSpec(
        layer_name="admin_boundary",
        korean_label="행정구역 경계",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.IMPLEMENTED,
        target_phase=PHASE_REUSE,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.GO,
        provider="통계청 SGIS",
        official_source="SGIS 행정구역 경계 (Phase 2.1), reference year 2024",
        license_note="KOGL / SGIS terms (cleared for this project)",
        update_cycle="Periodic / versioned (annual boundary vintage)",
        source_crs="EPSG:5179",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (sido/sigungu/adm-dong polygons)",
        suitability_role="Denominators, aggregation geography, 500 m grid base, clipping mask",
        implementation_difficulty="Low (done)",
        notes="Reused via the existing regions table; boundary vintage travels with each run.",
    ),
    EnvironmentalLayerSpec(
        layer_name="zoning",
        korean_label="용도지역",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.IMPLEMENTED,
        target_phase=PHASE_REUSE,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.GO,
        provider="국토교통부",
        official_source="용도지역도 LT_C_UQ111–UQ114 + NA_24 bulk (Phase 2.5B)",
        license_note="Prior government-project authorization confirmed for this project",
        update_cycle="전체분 매월 / 변동분 매일",
        source_crs="EPSG:5186/2097 or EPSG:4326",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (parcel-precision zone polygons)",
        suitability_role="용도지역 호환성 (Z component) — already scored today",
        implementation_difficulty="Low (대분류 done); Medium for subclass detail",
        notes="Reused via structural_features; subclass re-ingestion is a documented follow-on.",
    ),
    EnvironmentalLayerSpec(
        layer_name="road_centerline",
        korean_label="도로중심선",
        modality=LayerModality.VECTOR_LINE,
        lifecycle=LayerLifecycle.IMPLEMENTED,
        target_phase=PHASE_REUSE,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.GO,
        provider="국토지리정보원 / ITS",
        official_source="연속수치지형도 도로중심선 LT_L_N3A0020000 + 표준노드링크 (Phase 2.5B)",
        license_note="NGII CC BY; 표준노드링크 제한 없음; project authorization confirmed",
        update_cycle="연간 (NGII) / 수시 (표준노드링크)",
        source_crs="EPSG:5179 or EPSG:4326",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiLineString",
        spatial_resolution="Vector (road centreline lines)",
        suitability_role="도로 근접성 대리지표 (R) — already scored; truck access not claimed",
        implementation_difficulty="Low (done)",
        notes="Reused via structural_line_features; truck-restriction modelling out of scope.",
    ),
    EnvironmentalLayerSpec(
        layer_name="protected_area",
        korean_label="보호·규제구역",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.IMPLEMENTED,
        target_phase=PHASE_REUSE,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.GO,
        provider="국토교통부 (VWorld 보호구역 계열)",
        official_source="UD801/UM710/UM901/UF151/WGISNPGUG/UO101/UO301 (Phase 2.5B)",
        license_note="Prior government-project authorization confirmed for this project",
        update_cycle="변경발생시 (bulk) / 매일-매월 (API)",
        source_crs="EPSG:5186/2097 or EPSG:4326",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (statutory-zone polygons)",
        suitability_role="Hard-exclusion / review screening (existing policy v1/v2)",
        implementation_difficulty="Low (done)",
        notes="Reused via structural_protected_features; backbone of the exclusion/review screen.",
    ),
    # --- Planned for Phase 1B ingestion ------------------------------------- #
    EnvironmentalLayerSpec(
        layer_name="dem_slope",
        korean_label="수치표고·경사",
        modality=LayerModality.RASTER,
        lifecycle=LayerLifecycle.PLANNED,
        target_phase=PHASE_1B,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국토지리정보원(NGII)",
        official_source="수치표고모델(DEM) via 국토정보플랫폼 (map.ngii.go.kr); 5 m / 30 m grid",
        license_note="KOGL / NGII 성과 활용 신청 — verify per grid (not live-tested)",
        update_cycle="부정기 (multi-year national DEM refresh)",
        source_crs="EPSG:5186 (UTM-K)",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="Raster (GeoTIFF); slope derived, sampled to 500 m grid",
        spatial_resolution="5 m (preferred) or 30 m grid cell",
        suitability_role="경사 (slope) — top unmodelled factor; steep-slope penalty/review context",
        implementation_difficulty="High (raster pipeline is new to the platform)",
        notes="Resolve NGII download/approval + stand up raster→cell-statistic pipeline first.",
    ),
    EnvironmentalLayerSpec(
        layer_name="land_cover",
        korean_label="토지피복",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.PLANNED,
        target_phase=PHASE_1B,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="환경부 (기후에너지환경부)",
        official_source="환경공간정보서비스(EGIS) 토지피복지도 대/중/세분류 (egis.me.go.kr)",
        license_note="KOGL (SHP) vs WMS-only for some layers — verify vector availability",
        update_cycle="부정기 (권역별 갱신)",
        source_crs="EPSG:5186 (UTM-K)",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon (세분류 vector)",
        spatial_resolution="Vector polygons (세분류 ~1:5,000)",
        suitability_role="실제 토지 이용 상태 (built-up/forest/water/cropland) beyond zoning",
        implementation_difficulty="Medium (large; class-code normalization)",
        notes="Confirm vector (not WMS-only) download; WMS is display-only, not analysis.",
    ),
    EnvironmentalLayerSpec(
        layer_name="river_network",
        korean_label="하천망",
        modality=LayerModality.VECTOR_LINE,
        lifecycle=LayerLifecycle.PLANNED,
        target_phase=PHASE_1B,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국토지리정보원 / 환경부",
        official_source="연속수치지형도 하천 계열; 하천망분석도(RIMGIS)/WAMIS as alternates",
        license_note="NGII CC BY / KOGL (per product) — not live-tested",
        update_cycle="연간 (NGII)",
        source_crs="EPSG:5179",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiLineString and/or MultiPolygon",
        spatial_resolution="Vector (river centrelines + water-body polygons)",
        suitability_role="Distance-to-water context; no statutory buffer may be invented",
        implementation_difficulty="Medium",
        notes="Distance context once CRS/coverage validated; setbacks need a cited legal basis.",
    ),
    EnvironmentalLayerSpec(
        layer_name="geology",
        korean_label="지질",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.PLANNED,
        target_phase=PHASE_1B,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="한국지질자원연구원(KIGAM)",
        official_source="1:50,000 수치지질도 via 지질정보시스템 (mgeo.kigam.re.kr)",
        license_note="KOGL / KIGAM 이용 신청 — verify derivative-use terms",
        update_cycle="부정기 (map-sheet revisions)",
        source_crs="EPSG:5186",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (1:50,000 geological-unit polygons)",
        suitability_role="상세 지질 — bedrock/lithology screening context (advisory only)",
        implementation_difficulty="Medium (domain code normalization)",
        notes="Screening context, never a geotechnical/site-survey substitute.",
    ),
    EnvironmentalLayerSpec(
        layer_name="wetland_inventory",
        korean_label="내륙습지 목록",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.PLANNED,
        target_phase=PHASE_1B,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국립습지센터 / 환경부",
        official_source="전국내륙습지 조사목록 + 습지보호지역(existing UM901); 생태자연도 adjunct",
        license_note="KOGL; 생태자연도 KOGL Type 3 (변경금지) conflicts with derived analysis",
        update_cycle="부정기 (조사 주기)",
        source_crs="EPSG:5186/5179",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (wetland-inventory polygons)",
        suitability_role="Environmental sensitivity screening beyond designated protected wetlands",
        implementation_difficulty="Medium",
        notes="Dedupe against existing UM901; review 생태자연도 Type 3 licence before derived use.",
    ),
    # --- Future (lower priority) -------------------------------------------- #
    EnvironmentalLayerSpec(
        layer_name="building_footprint",
        korean_label="건축물",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.FUTURE,
        target_phase=PHASE_1C,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국토교통부 / 행정안전부",
        official_source="GIS건물통합정보 / 도로명주소 건물 전자지도 (juso.go.kr)",
        license_note="KOGL Type 1 (도로명주소) — approval-mediated download",
        update_cycle="월전체/월변동",
        source_crs="ITRF2000/GRS80/UTM or EPSG:5186",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (building outline polygons)",
        suitability_role="건축물 점유·밀도 context (a densely built cell is less usable)",
        implementation_difficulty="High (very large; approval download)",
        notes="Density-aggregate use is feasible; per-building demolition claims are not.",
    ),
    EnvironmentalLayerSpec(
        layer_name="parcel",
        korean_label="연속지적",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.FUTURE,
        target_phase=PHASE_1C,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국토교통부",
        official_source="연속지적도 LSMD_CONT_LDREG; per-parcel land-use NED dt_d154 (Phase 2.5A)",
        license_note="Project authorization confirmed; bulk browser/솔루션-mediated",
        update_cycle="수시 / 월",
        source_crs="EPSG:5186",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (cadastral parcel polygons)",
        suitability_role="연속 사용 가능 부지 규모 refinement of a selected candidate only",
        implementation_difficulty="Very High (volume; grid avoids parcel candidates)",
        notes="API-side per-candidate lookups viable; region-wide parcel ingestion out of scope.",
    ),
    EnvironmentalLayerSpec(
        layer_name="land_ownership",
        korean_label="토지소유",
        modality=LayerModality.VECTOR_POLYGON,
        lifecycle=LayerLifecycle.FUTURE,
        target_phase=PHASE_1C,
        verification=VerificationStatus.LIVE_VERIFIED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국토교통부 국가공간정보센터",
        official_source="토지소유공간정보 dt_d160 (NED); bulk NA_12/NA_30 (Phase 2.5A)",
        license_note="data.go.kr 제한 없음 (NED); project authorization confirmed",
        update_cycle="실시간 (API) / 매년·매월 (bulk)",
        source_crs="EPSG:4326 (served)",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiPolygon",
        spatial_resolution="Vector (parcel-level ownership polygons)",
        suitability_role="필지 소유권; ownership never inferred from zoning/PNU/address",
        implementation_difficulty="Very High (volume + field-completeness caveat)",
        notes="Promote beyond optional only after posesn_se_code completeness is validated.",
    ),
    EnvironmentalLayerSpec(
        layer_name="groundwater",
        korean_label="지하수·수문지질",
        modality=LayerModality.POINT_AND_POLYGON,
        lifecycle=LayerLifecycle.FUTURE,
        target_phase=PHASE_1C,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.CONDITIONAL_GO,
        provider="국가지하수정보센터 (GIMS)",
        official_source="국가지하수관측망 수위/수질 + 수문지질도 (gims.go.kr)",
        license_note="KOGL / GIMS 이용 신청 — not live-tested",
        update_cycle="관측 시간/일 단위; 수문지질도 부정기",
        source_crs="EPSG:5186 / decimal-degree points (EPSG undeclared → validate)",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="Point (wells) + MultiPolygon (hydrogeology units)",
        spatial_resolution="Sparse observation network + coarse 수문지질 polygons",
        suitability_role="지하수위·수문지질 sensitivity; real-time levels never permanent evidence",
        implementation_difficulty="High (sparse network → modelled/uncertain surface)",
        notes="Too sparse for a per-cell water table; coarse context with an uncertainty label.",
    ),
    # --- Experimental (not usable now) -------------------------------------- #
    EnvironmentalLayerSpec(
        layer_name="flood_hazard",
        korean_label="홍수·침수 위험",
        modality=LayerModality.RASTER_OR_POLYGON,
        lifecycle=LayerLifecycle.EXPERIMENTAL,
        target_phase=PHASE_1C,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.NO_GO,
        provider="행정안전부 / 환경부",
        official_source="홍수위험지도정보시스템 (floodmap.go.kr) 홍수위험지도/침수예상도",
        license_note="Access-restricted — redistribution/derived-use terms unconfirmed",
        update_cycle="부정기 (재해지도 갱신)",
        source_crs="EPSG:5186",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="Raster depth grids and/or MultiPolygon extents",
        spatial_resolution="Raster and/or polygon inundation extents",
        suitability_role="홍수·침수 위험 exposure screening (high value if obtainable)",
        implementation_difficulty="High (raster + restricted access)",
        notes="Do not ingest until the licence is confirmed in writing; licence question first.",
    ),
    EnvironmentalLayerSpec(
        layer_name="fault",
        korean_label="단층",
        modality=LayerModality.VECTOR_LINE,
        lifecycle=LayerLifecycle.EXPERIMENTAL,
        target_phase=PHASE_1C,
        verification=VerificationStatus.DOCUMENTED_NOT_TESTED,
        recommendation=ReadinessRecommendation.NO_GO,
        provider="한국지질자원연구원(KIGAM) / 행정안전부",
        official_source="활성단층 정보 (2017–2022 활성단층 조사); 수치지질도 단층선",
        license_note="Restricted — active-fault data partially non-public",
        update_cycle="부정기 (조사 단계별 공개)",
        source_crs="EPSG:5186",
        storage_crs=_STORAGE_CRS,
        geometry_or_raster_type="MultiLineString",
        spatial_resolution="Vector (fault-trace lines)",
        suitability_role="단층 seismic-sensitivity screening context (advisory)",
        implementation_difficulty="Medium (data) / High (availability & licence)",
        notes="Confirm public availability + licence; fault proximity is advisory only.",
    ),
)


# Columns persisted to ``environmental_layer_registry`` (the lean catalogue). The
# richer descriptive fields stay on the spec / in the audit doc and back the
# future API without bloating the table.
_SEED_COLUMNS = (
    "layer_name",
    "korean_label",
    "modality",
    "lifecycle",
    "target_phase",
    "verification_status",
    "readiness_recommendation",
    "suitability_role",
    "implementation_difficulty",
    "notes",
)


def registry_seed_rows() -> list[dict[str, str]]:
    """Project the registry to the ordered rows persisted in the DB catalogue.

    The migration inlines an identical seed; a unit test asserts the two never
    diverge (the facility standard-cost cross-check pattern).
    """

    rows: list[dict[str, str]] = []
    for spec in ENVIRONMENTAL_LAYER_REGISTRY:
        rows.append(
            {
                "layer_name": spec.layer_name,
                "korean_label": spec.korean_label,
                "modality": spec.modality.value,
                "lifecycle": spec.lifecycle.value,
                "target_phase": spec.target_phase,
                "verification_status": spec.verification.value,
                "readiness_recommendation": spec.recommendation.value,
                "suitability_role": spec.suitability_role,
                "implementation_difficulty": spec.implementation_difficulty,
                "notes": spec.notes,
            }
        )
    return rows


def layer_names() -> tuple[str, ...]:
    """Stable machine names of every catalogued layer, in registry order."""

    return tuple(spec.layer_name for spec in ENVIRONMENTAL_LAYER_REGISTRY)


def get_layer(layer_name: str) -> EnvironmentalLayerSpec:
    """Return the spec for ``layer_name`` or raise ``KeyError``."""

    for spec in ENVIRONMENTAL_LAYER_REGISTRY:
        if spec.layer_name == layer_name:
            return spec
    raise KeyError(f"Unknown environmental layer: {layer_name!r}")


def layers_by_lifecycle(lifecycle: LayerLifecycle) -> tuple[EnvironmentalLayerSpec, ...]:
    """Every catalogued layer at a given lifecycle stage, in registry order."""

    return tuple(spec for spec in ENVIRONMENTAL_LAYER_REGISTRY if spec.lifecycle is lifecycle)
