"""Read-only response schemas for the inland-wetland inventory API (Phase 1B-2).

Serves the surveyed 내륙습지 목록 (국립생태원 inventory) that Phase 1B-1 loaded into
PostGIS. Every response is read-only and carries explicit provenance and a
statutory-status disclaimer. **This inventory is not a statutory protection
area.** The statutory 습지보호지역 layer is ``UM901`` in
``structural_protected_features`` — a different dataset with different legal
effect and scope. These schemas never emit a legal-protection boolean, never a
score, and never merge the two layers. See ``docs/WETLAND_INVENTORY_API_AND_MAP.md``.
"""

from __future__ import annotations

import datetime

from pydantic import BaseModel, ConfigDict, Field

# --- Canonical layer identity and disclosures --------------------------------
# Machine name and Korean label are the single source of truth for both the API
# and the frontend layer, so the two never drift.
WETLAND_LAYER_NAME = "wetland_inventory"
WETLAND_KOREAN_LABEL = "내륙습지 목록"

# The three legally-load-bearing disclosures. They are stored here verbatim so
# the API, the frontend layer, and the tests all assert the *same* Korean text.
# The inventory being surveyed confers no statutory status; overlap with UM901
# does not make it equivalent (WETLAND_INVENTORY_DATA_CONTRACT.md §9).
WETLAND_INVENTORY_DISCLAIMER = (
    "내륙습지 목록은 국립생태원의 조사·목록 데이터이며, "
    "모든 습지가 법정 습지보호지역을 의미하지 않습니다."
)
WETLAND_UM901_DISTINCTION = (
    "법정 습지보호지역은 기존 UM901 보호구역 레이어에서 별도로 확인할 수 있습니다."
)
WETLAND_DETAIL_STATUTORY_WARNING = (
    "이 레이어는 조사된 내륙습지 목록입니다. 모든 항목이 법정 습지보호지역을 뜻하지 않습니다."
)
# Label the source note (``EXP``) must always carry so it is never read as an
# authoritative legal determination — it is raw source text only.
WETLAND_DESIGNATION_NOTE_LABEL = "원자료 지정 메모"

# EPSG identifiers, stated on every provenance block.
WETLAND_SOURCE_CRS = "EPSG:5186"
WETLAND_STORAGE_CRS = "EPSG:4326"


class WetlandInventoryLifecycle(BaseModel):
    """Per-aspect lifecycle of the inland-wetland layer.

    These are documented phase states, not live health checks. ``scoring_integration``
    is ``NOT_IMPLEMENTED`` by contract: this phase adds no score, weight, or
    exclusion. ``production_deployment`` is ``NOT_RUN`` — the layer is verified
    locally only.
    """

    contract_verification: str
    database_ingestion: str
    api_exposure: str
    frontend_map_exposure: str
    scoring_integration: str
    production_deployment: str


class WetlandInventoryIngestionInfo(BaseModel):
    """Last successful local ingestion of the active release, when recorded."""

    run_id: int
    status: str
    started_at: datetime.datetime
    completed_at: datetime.datetime | None
    rows_received: int
    rows_inserted: int
    rows_rejected: int
    reference_period: str | None
    transformation_version: str | None


class WetlandInventoryProvenance(BaseModel):
    """Reproducible provenance of the served release (from the active version)."""

    dataset_version_id: int
    provider: str
    official_dataset_name: str
    provider_dataset_identifier: str
    official_source_url: str | None
    reference_date: datetime.date
    source_crs: str
    storage_crs: str
    source_encoding: str | None
    transformation_version: str
    license_note: str | None


class WetlandInventoryMetadataResponse(BaseModel):
    """Layer-level metadata, provenance, lifecycle, and statutory disclosures."""

    layer_name: str
    korean_label: str
    provider: str
    official_dataset_name: str
    provider_dataset_identifier: str
    official_source_url: str | None
    reference_date: datetime.date
    source_crs: str
    storage_crs: str
    source_encoding: str | None
    transformation_version: str
    declared_feature_count: int | None
    served_feature_count: int
    geometry_type: str
    lifecycle: WetlandInventoryLifecycle
    statutory_status_statement: str
    um901_distinction_statement: str
    license_note: str | None
    provenance: WetlandInventoryProvenance
    last_ingestion: WetlandInventoryIngestionInfo | None


class WetlandInventoryFeatureSummary(BaseModel):
    """One inland-wetland feature, normalized public-safe fields only.

    Carries the provider's reported representative point
    (``source_longitude``/``source_latitude``) — reported metadata, never a
    computed centroid and never geometry. ``raw_attributes`` is deliberately
    absent from this summary (available only on the detail endpoint, opt-in).
    ``designation_note`` is verbatim source text (``EXP``); it is never a legal
    status.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    source_feature_id: str
    wetland_code: str
    wetland_name: str
    wetland_type: str
    wetland_type_korea: str | None
    wetland_type_ramsar: str | None
    reported_area_m2: int | None
    geometry_area_m2: float
    source_address: str | None
    source_sido_name: str | None
    source_sigungu_name: str | None
    source_eupmyeondong_name: str | None
    source_ri_name: str | None
    designation_note: str | None
    normalized_sido_code: str | None
    normalized_sigungu_code: str | None
    source_longitude: float | None
    source_latitude: float | None
    source_reference_date: datetime.date
    dataset_version_id: int


class WetlandInventoryListResponse(BaseModel):
    """Bounded, deterministically-ordered page over the inventory."""

    items: list[WetlandInventoryFeatureSummary]
    total: int
    limit: int
    offset: int
    has_more: bool


class WetlandInventoryFeatureDetail(BaseModel):
    """One feature with geometry, provenance, and statutory disclosures.

    ``geometry`` is bounded GeoJSON for the single requested feature (EPSG:4326),
    consistent with the suitability candidate-detail endpoint. ``source_attributes``
    is the sanitized verbatim source-attribute map and is populated only when the
    request opts in (``include_raw_attributes=true``); it is public official
    source text, never PII or database internals.
    """

    id: int
    source_feature_id: str
    source_fid: int | None
    wetland_code: str
    wetland_name: str
    wetland_type: str
    wetland_type_korea: str | None
    wetland_type_ramsar: str | None
    reported_area_m2: int | None
    geometry_area_m2: float
    source_address: str | None
    source_sido_name: str | None
    source_sigungu_name: str | None
    source_eupmyeondong_name: str | None
    source_ri_name: str | None
    designation_note: str | None
    designation_note_label: str = WETLAND_DESIGNATION_NOTE_LABEL
    normalized_sido_code: str | None
    normalized_sigungu_code: str | None
    source_longitude: float | None
    source_latitude: float | None
    source_reference_date: datetime.date
    source_crs: str
    transformation_version: str
    dataset_version_id: int
    geometry: dict[str, object]
    provenance: WetlandInventoryProvenance
    statutory_status_statement: str = WETLAND_DETAIL_STATUTORY_WARNING
    um901_distinction_statement: str = WETLAND_UM901_DISTINCTION
    source_attributes: dict[str, object] | None = Field(default=None)


class WetlandInventoryError(BaseModel):
    """Structured error detail for a missing feature or unavailable dataset."""

    error: str
    detail: str
