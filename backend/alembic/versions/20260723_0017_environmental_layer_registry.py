"""Environmental-layer catalogue table + Phase 1A registry seed (Suitability Phase 1A).

Adds ``environmental_layer_registry`` — a metadata *catalogue* of the
environmental/physical layers a future suitability phase may add — and
idempotently seeds the fifteen audited layers. Every row carries an explicit
``lifecycle`` (IMPLEMENTED / PLANNED / FUTURE / EXPERIMENTAL) so a planned layer
is never presented as implemented.

This migration is purely additive: it creates one new table holding **no** score,
**no** geometry, and **no** candidate data, and touches no existing table. It
changes no suitability score, ranking, candidate status, weight profile, or API
contract. The seed is duplicated here as a self-contained snapshot; a unit test
asserts it never diverges from
``waste_equity_backend.environment.layers.registry_seed_rows``.

Revision ID: 0017
Revises: 0016
Create Date: 2026-07-23

"""

import datetime
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "environmental_layer_registry"

# Ordered seed snapshot: one tuple per layer, columns in _SEED_COLUMN order.
# Kept identical to environment.layers.registry_seed_rows() by a unit test.
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

_SEED_ROWS: tuple[tuple[str, ...], ...] = (
    (
        "admin_boundary",
        "행정구역 경계",
        "vector_polygon",
        "IMPLEMENTED",
        "reuse",
        "LIVE_VERIFIED",
        "GO",
        "Denominators, aggregation geography, 500 m grid base, clipping mask",
        "Low (done)",
        "Reused via the existing regions table; boundary vintage travels with each run.",
    ),
    (
        "zoning",
        "용도지역",
        "vector_polygon",
        "IMPLEMENTED",
        "reuse",
        "LIVE_VERIFIED",
        "GO",
        "용도지역 호환성 (Z component) — already scored today",
        "Low (대분류 done); Medium for subclass detail",
        "Reused via structural_features; subclass re-ingestion is a documented follow-on.",
    ),
    (
        "road_centerline",
        "도로중심선",
        "vector_line",
        "IMPLEMENTED",
        "reuse",
        "LIVE_VERIFIED",
        "GO",
        "도로 근접성 대리지표 (R) — already scored; truck access not claimed",
        "Low (done)",
        "Reused via structural_line_features; truck-restriction modelling out of scope.",
    ),
    (
        "protected_area",
        "보호·규제구역",
        "vector_polygon",
        "IMPLEMENTED",
        "reuse",
        "LIVE_VERIFIED",
        "GO",
        "Hard-exclusion / review screening (existing policy v1/v2)",
        "Low (done)",
        "Reused via structural_protected_features; backbone of the exclusion/review screen.",
    ),
    (
        "dem_slope",
        "수치표고·경사",
        "raster",
        "PLANNED",
        "1B",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "경사 (slope) — top unmodelled factor; steep-slope penalty/review context",
        "High (raster pipeline is new to the platform)",
        "Resolve NGII download/approval + stand up raster→cell-statistic pipeline first.",
    ),
    (
        "land_cover",
        "토지피복",
        "vector_polygon",
        "PLANNED",
        "1B",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "실제 토지 이용 상태 (built-up/forest/water/cropland) beyond zoning",
        "Medium (large; class-code normalization)",
        "Confirm vector (not WMS-only) download; WMS is display-only, not analysis.",
    ),
    (
        "river_network",
        "하천망",
        "vector_line",
        "PLANNED",
        "1B",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "Distance-to-water context; no statutory buffer may be invented",
        "Medium",
        "Distance context once CRS/coverage validated; setbacks need a cited legal basis.",
    ),
    (
        "geology",
        "지질",
        "vector_polygon",
        "PLANNED",
        "1B",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "상세 지질 — bedrock/lithology screening context (advisory only)",
        "Medium (domain code normalization)",
        "Screening context, never a geotechnical/site-survey substitute.",
    ),
    (
        "wetland_inventory",
        "내륙습지 목록",
        "vector_polygon",
        "PLANNED",
        "1B",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "Environmental sensitivity screening beyond designated protected wetlands",
        "Medium",
        "Dedupe against existing UM901; review 생태자연도 Type 3 licence before derived use.",
    ),
    (
        "building_footprint",
        "건축물",
        "vector_polygon",
        "FUTURE",
        "1C",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "건축물 점유·밀도 context (a densely built cell is less usable)",
        "High (very large; approval download)",
        "Density-aggregate use is feasible; per-building demolition claims are not.",
    ),
    (
        "parcel",
        "연속지적",
        "vector_polygon",
        "FUTURE",
        "1C",
        "LIVE_VERIFIED",
        "CONDITIONAL_GO",
        "연속 사용 가능 부지 규모 refinement of a selected candidate only",
        "Very High (volume; grid avoids parcel candidates)",
        "API-side per-candidate lookups viable; region-wide parcel ingestion out of scope.",
    ),
    (
        "land_ownership",
        "토지소유",
        "vector_polygon",
        "FUTURE",
        "1C",
        "LIVE_VERIFIED",
        "CONDITIONAL_GO",
        "필지 소유권; ownership never inferred from zoning/PNU/address",
        "Very High (volume + field-completeness caveat)",
        "Promote beyond optional only after posesn_se_code completeness is validated.",
    ),
    (
        "groundwater",
        "지하수·수문지질",
        "point_and_polygon",
        "FUTURE",
        "1C",
        "DOCUMENTED_NOT_TESTED",
        "CONDITIONAL_GO",
        "지하수위·수문지질 sensitivity; real-time levels never permanent evidence",
        "High (sparse network → modelled/uncertain surface)",
        "Too sparse for a per-cell water table; coarse context with an uncertainty label.",
    ),
    (
        "flood_hazard",
        "홍수·침수 위험",
        "raster_or_polygon",
        "EXPERIMENTAL",
        "1C",
        "DOCUMENTED_NOT_TESTED",
        "NO_GO",
        "홍수·침수 위험 exposure screening (high value if obtainable)",
        "High (raster + restricted access)",
        "Do not ingest until the licence is confirmed in writing; licence question first.",
    ),
    (
        "fault",
        "단층",
        "vector_line",
        "EXPERIMENTAL",
        "1C",
        "DOCUMENTED_NOT_TESTED",
        "NO_GO",
        "단층 seismic-sensitivity screening context (advisory)",
        "Medium (data) / High (availability & licence)",
        "Confirm public availability + licence; fault proximity is advisory only.",
    ),
)


def _seed_rows() -> list[dict[str, object]]:
    now = datetime.datetime.now(tz=datetime.UTC)
    rows: list[dict[str, object]] = []
    for values in _SEED_ROWS:
        row: dict[str, object] = dict(zip(_SEED_COLUMNS, values, strict=True))
        row["created_at"] = now
        rows.append(row)
    return rows


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("layer_name", sa.String(length=50), nullable=False),
        sa.Column("korean_label", sa.String(length=100), nullable=False),
        sa.Column("modality", sa.String(length=30), nullable=False),
        sa.Column("lifecycle", sa.String(length=20), nullable=False),
        sa.Column("target_phase", sa.String(length=20), nullable=False),
        sa.Column("verification_status", sa.String(length=40), nullable=False),
        sa.Column("readiness_recommendation", sa.String(length=20), nullable=False),
        sa.Column("suitability_role", sa.String(length=300), nullable=False),
        sa.Column("implementation_difficulty", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_environmental_layer_registry")),
        sa.UniqueConstraint("layer_name", name=op.f("uq_environmental_layer_registry_layer_name")),
    )
    op.create_index(
        op.f("ix_environmental_layer_registry_lifecycle"), _TABLE, ["lifecycle"], unique=False
    )

    # Idempotent seed: only insert when the catalogue is empty, so re-running the
    # seed step never duplicates rows.
    bind = op.get_bind()
    existing = bind.execute(
        sa.text("SELECT COUNT(*) FROM environmental_layer_registry")
    ).scalar_one()
    if existing == 0:
        table = sa.table(
            _TABLE,
            sa.column("layer_name", sa.String),
            sa.column("korean_label", sa.String),
            sa.column("modality", sa.String),
            sa.column("lifecycle", sa.String),
            sa.column("target_phase", sa.String),
            sa.column("verification_status", sa.String),
            sa.column("readiness_recommendation", sa.String),
            sa.column("suitability_role", sa.String),
            sa.column("implementation_difficulty", sa.String),
            sa.column("notes", sa.String),
            sa.column("created_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(table, _seed_rows())


def downgrade() -> None:
    op.drop_index(op.f("ix_environmental_layer_registry_lifecycle"), table_name=_TABLE)
    op.drop_table(_TABLE)
