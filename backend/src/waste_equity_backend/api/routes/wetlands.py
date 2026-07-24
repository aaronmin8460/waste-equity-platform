"""Read-only inland-wetland inventory API (Suitability Phase 1B-2).

Exposes the surveyed 내륙습지 목록 (국립생태원 inventory) that Phase 1B-1 loaded into
PostGIS. Four read-only endpoints — layer metadata, a bounded list/query, a
single-feature detail, and PostGIS vector tiles — serve exactly what ingestion
stored, with full provenance and an explicit statutory-status disclaimer.

**This inventory is not a statutory protection area.** The statutory 습지보호지역
layer is ``UM901`` in ``structural_protected_features`` — a different dataset with
different legal effect and (including coastal) scope. This router lives in its own
namespace, never reads or writes ``structural_*`` or ``suitability_*`` tables,
never emits a legal-protection boolean, and never a score. ``designation_note``
(source column ``EXP``) is verbatim source text and is never a legal status.

Every handler is read-only: no INSERT/UPDATE/DELETE and no scoring, ranking, or
candidate code path is touched. See ``docs/WETLAND_INVENTORY_API_AND_MAP.md``.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, Response
from sqlalchemy import ColumnElement, func, or_, select, text
from sqlalchemy.orm import InstrumentedAttribute, Session, defer

from ...db import get_session
from ...models import (
    EnvironmentalDatasetVersion,
    EnvironmentalWetlandInventoryFeature,
    IngestionRun,
)
from ...schemas import (
    WetlandInventoryError,
    WetlandInventoryFeatureDetail,
    WetlandInventoryFeatureSummary,
    WetlandInventoryIngestionInfo,
    WetlandInventoryLifecycle,
    WetlandInventoryListResponse,
    WetlandInventoryMetadataResponse,
    WetlandInventoryProvenance,
)
from ...schemas.wetland import (
    WETLAND_INVENTORY_DISCLAIMER,
    WETLAND_KOREAN_LABEL,
    WETLAND_LAYER_NAME,
    WETLAND_UM901_DISTINCTION,
)

router = APIRouter(prefix="/api/v1/environment/wetlands", tags=["environment-wetlands"])
SessionDep = Annotated[Session, Depends(get_session)]

Feature = EnvironmentalWetlandInventoryFeature

# --- Lifecycle (documented phase states, not live health checks) -------------
# scoring_integration is NOT_IMPLEMENTED by contract: this phase adds no score,
# weight, or exclusion. production_deployment is NOT_RUN — verified locally only.
LIFECYCLE = WetlandInventoryLifecycle(
    contract_verification="LIVE_VERIFIED",
    database_ingestion="IMPLEMENTED_AND_LOCALLY_VERIFIED",
    api_exposure="IMPLEMENTED",
    frontend_map_exposure="IMPLEMENTED",
    scoring_integration="NOT_IMPLEMENTED",
    production_deployment="NOT_RUN",
)

# --- Pagination bounds (project convention: datasets uses page_size<=100; the
# candidate list uses 500/5000). The inventory is 2,704 features, so a 50-row
# default / 200-row ceiling keeps a page small and never full-table. ------------
DEFAULT_LIMIT = 50
MAX_LIMIT = 200

# Whitelisted sort keys → (column, descending). Every list response also gets a
# deterministic secondary sort by id, so paging is stable even on ties.
SortKey = Literal[
    "id",
    "-id",
    "wetland_name",
    "-wetland_name",
    "wetland_code",
    "-wetland_code",
    "reported_area_m2",
    "-reported_area_m2",
    "geometry_area_m2",
    "-geometry_area_m2",
]
_SORT_COLUMNS: dict[str, InstrumentedAttribute[Any]] = {
    "id": Feature.id,
    "wetland_name": Feature.wetland_name,
    "wetland_code": Feature.wetland_code,
    "reported_area_m2": Feature.reported_area_m2,
    "geometry_area_m2": Feature.geometry_area_m2,
}

# --- Vector-tile (MVT) constants ---------------------------------------------
MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"
MVT_MIN_ZOOM = 0
MVT_MAX_ZOOM = 22
# Source-layer name the frontend binds its wetland layers to (separate from the
# suitability ``candidates`` source-layer).
TILE_SOURCE_LAYER = "wetlands"
# The tile is pinned to an immutable dataset version, so its bytes never change;
# cache aggressively (one year, immutable), exactly like the suitability tiles.
TILE_CACHE_CONTROL = "public, max-age=31536000, immutable"

# Parameterized MVT query mirroring the suitability tile pattern: the tile
# envelope is built in EPSG:3857 (``ST_TileEnvelope``) and transformed to 4326
# for the ``geometry && <bounds>`` predicate so it hits the existing 4326 GiST
# index (filter-before-transform); only matched geometries are transformed to
# 3857 for ``ST_AsMVTGeom``. Only the light attributes the map needs travel in the
# tile — never ``raw_attributes`` and never full provenance. Every user-controlled
# value (version, z, x, y) is a bound parameter.
_TILE_SQL = f"""
WITH bounds AS (
    SELECT
        ST_TileEnvelope(:z, :x, :y) AS geom_3857,
        ST_Transform(ST_TileEnvelope(:z, :x, :y), 4326) AS geom_4326
),
tile AS (
    SELECT
        ST_AsMVTGeom(
            ST_Transform(w.geometry, 3857),
            bounds.geom_3857,
            4096, 64, true
        ) AS geom,
        w.id AS id,
        w.wetland_code AS wetland_code,
        w.wetland_name AS wetland_name,
        w.wetland_type AS wetland_type,
        w.reported_area_m2 AS reported_area_m2,
        w.designation_note AS designation_note,
        w.normalized_sido_code AS normalized_sido_code,
        w.normalized_sigungu_code AS normalized_sigungu_code
    FROM environmental_wetland_inventory_features w, bounds
    WHERE w.dataset_version_id = :version_id
      AND w.geometry && bounds.geom_4326
)
SELECT ST_AsMVT(tile.*, '{TILE_SOURCE_LAYER}', 4096, 'geom')
FROM tile
WHERE tile.geom IS NOT NULL
"""
_TILE_SQL_STMT = text(_TILE_SQL)


def _not_available() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=WetlandInventoryError(
            error="WETLAND_DATASET_NOT_AVAILABLE",
            detail="No active inland-wetland inventory release is loaded.",
        ).model_dump(),
    )


def _not_found(feature_id: int) -> HTTPException:
    return HTTPException(
        status_code=404,
        detail=WetlandInventoryError(
            error="WETLAND_FEATURE_NOT_FOUND",
            detail=f"No inland-wetland feature with id {feature_id}.",
        ).model_dump(),
    )


def _active_version(session: Session) -> EnvironmentalDatasetVersion | None:
    """The most recent active release of the inventory (never a superseded one).

    Only active versions may be read (see the ingestion contract). When more than
    one is active the latest by reference date then id wins, so the endpoint is
    deterministic.
    """

    return session.scalars(
        select(EnvironmentalDatasetVersion)
        .where(
            EnvironmentalDatasetVersion.layer_name == WETLAND_LAYER_NAME,
            EnvironmentalDatasetVersion.is_active.is_(True),
        )
        .order_by(
            EnvironmentalDatasetVersion.reference_date.desc(),
            EnvironmentalDatasetVersion.id.desc(),
        )
        .limit(1)
    ).first()


def _provenance(version: EnvironmentalDatasetVersion) -> WetlandInventoryProvenance:
    return WetlandInventoryProvenance(
        dataset_version_id=version.id,
        provider=version.provider,
        official_dataset_name=version.official_dataset_name,
        provider_dataset_identifier=version.provider_dataset_identifier,
        official_source_url=version.official_source_url,
        reference_date=version.reference_date,
        source_crs=version.source_crs,
        storage_crs=version.target_crs,
        source_encoding=version.source_encoding,
        transformation_version=version.transformation_version,
        license_note=version.license_note,
    )


def _escape_like(value: str) -> str:
    """Escape LIKE wildcards so a user-supplied ``q`` is treated as literal text."""

    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _parse_bbox(bbox: str | None) -> tuple[float, float, float, float] | None:
    """Validate ``minLon,minLat,maxLon,maxLat`` and enforce WGS84 range."""

    if bbox is None:
        return None
    parts = bbox.split(",")
    if len(parts) != 4:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox must be minLon,minLat,maxLon,maxLat"},
        )
    try:
        min_lon, min_lat, max_lon, max_lat = (float(p) for p in parts)
    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox values must be numbers"},
        ) from exc
    if min_lon >= max_lon or min_lat >= max_lat:
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "bbox min must be less than max"},
        )
    if not (-180.0 <= min_lon <= 180.0 and -180.0 <= max_lon <= 180.0):
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "longitude must be within [-180, 180]"},
        )
    if not (-90.0 <= min_lat <= 90.0 and -90.0 <= max_lat <= 90.0):
        raise HTTPException(
            status_code=422,
            detail={"error": "INVALID_BBOX", "detail": "latitude must be within [-90, 90]"},
        )
    return (min_lon, min_lat, max_lon, max_lat)


@router.get("/metadata", response_model=WetlandInventoryMetadataResponse)
def wetland_metadata(session: SessionDep) -> WetlandInventoryMetadataResponse:
    """Layer identity, provenance, lifecycle, and statutory disclosures.

    ``declared_feature_count`` is what the provider declares (2,704) and
    ``served_feature_count`` is a live indexed count of the features actually
    stored for the served release — kept beside each other so a discrepancy is
    visible rather than absorbed.
    """

    version = _active_version(session)
    if version is None:
        raise _not_available()
    served = (
        session.scalar(
            select(func.count())
            .select_from(Feature)
            .where(Feature.dataset_version_id == version.id)
        )
        or 0
    )
    last_ingestion: WetlandInventoryIngestionInfo | None = None
    if version.ingestion_run_id is not None:
        run = session.get(IngestionRun, version.ingestion_run_id)
        if run is not None:
            last_ingestion = WetlandInventoryIngestionInfo(
                run_id=run.run_id,
                status=run.status,
                started_at=run.started_at,
                completed_at=run.completed_at,
                rows_received=run.rows_received,
                rows_inserted=run.rows_inserted,
                rows_rejected=run.rows_rejected,
                reference_period=run.reference_period,
                transformation_version=run.transformation_version,
            )
    return WetlandInventoryMetadataResponse(
        layer_name=WETLAND_LAYER_NAME,
        korean_label=WETLAND_KOREAN_LABEL,
        provider=version.provider,
        official_dataset_name=version.official_dataset_name,
        provider_dataset_identifier=version.provider_dataset_identifier,
        official_source_url=version.official_source_url,
        reference_date=version.reference_date,
        source_crs=version.source_crs,
        storage_crs=version.target_crs,
        source_encoding=version.source_encoding,
        transformation_version=version.transformation_version,
        declared_feature_count=version.declared_feature_count,
        served_feature_count=served,
        geometry_type=version.normalized_geometry_type,
        lifecycle=LIFECYCLE,
        statutory_status_statement=WETLAND_INVENTORY_DISCLAIMER,
        um901_distinction_statement=WETLAND_UM901_DISTINCTION,
        license_note=version.license_note,
        provenance=_provenance(version),
        last_ingestion=last_ingestion,
    )


@router.get("", response_model=WetlandInventoryListResponse)
def list_wetlands(
    session: SessionDep,
    sido_code: str | None = Query(default=None, description="Normalized SIDO region code."),
    sigungu_code: str | None = Query(default=None, description="Normalized SIGUNGU region code."),
    source_sido_name: str | None = Query(default=None, description="Source 시도 name (verbatim)."),
    source_sigungu_name: str | None = Query(
        default=None, description="Source 시군구 name (verbatim)."
    ),
    wetland_type: str | None = Query(
        default=None, description="Korean wetland type (하천습지/호수습지/산지습지/인공습지)."
    ),
    designation_only: bool = Query(
        default=False, description="Only features carrying a source designation note (EXP)."
    ),
    q: str | None = Query(default=None, description="Case-insensitive name/code search."),
    bbox: str | None = Query(
        default=None, description="Viewport filter minLon,minLat,maxLon,maxLat."
    ),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    offset: int = Query(default=0, ge=0),
    sort: SortKey = "id",
) -> WetlandInventoryListResponse:
    """Bounded, deterministically-ordered page over the active release.

    Filters compose with AND. Geometry and ``raw_attributes`` are never selected
    here (deferred), so the query stays light; the map uses the tile endpoint.
    ``total`` is an indexed count, never a geometry transform.
    """

    version = _active_version(session)
    if version is None:
        # No release loaded: an empty, well-formed page (never a 500 or fake data).
        return WetlandInventoryListResponse(
            items=[], total=0, limit=limit, offset=offset, has_more=False
        )

    conditions: list[ColumnElement[bool]] = [Feature.dataset_version_id == version.id]
    if sido_code is not None:
        conditions.append(Feature.normalized_sido_code == sido_code)
    if sigungu_code is not None:
        conditions.append(Feature.normalized_sigungu_code == sigungu_code)
    if source_sido_name is not None:
        conditions.append(Feature.source_sido_name == source_sido_name)
    if source_sigungu_name is not None:
        conditions.append(Feature.source_sigungu_name == source_sigungu_name)
    if wetland_type is not None:
        conditions.append(Feature.wetland_type == wetland_type)
    if designation_only:
        conditions.append(Feature.designation_note.is_not(None))
    if q is not None and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        conditions.append(
            or_(
                Feature.wetland_name.ilike(pattern, escape="\\"),
                Feature.wetland_code.ilike(pattern, escape="\\"),
            )
        )
    box = _parse_bbox(bbox)
    if box is not None:
        conditions.append(
            Feature.geometry.op("&&")(func.ST_MakeEnvelope(box[0], box[1], box[2], box[3], 4326))
        )

    total = session.scalar(select(func.count()).select_from(Feature).where(*conditions)) or 0

    descending = sort.startswith("-")
    column = _SORT_COLUMNS[sort.lstrip("-")]
    primary = column.desc() if descending else column.asc()
    order_by = [primary, Feature.id.asc()] if sort.lstrip("-") != "id" else [primary]

    rows = session.scalars(
        select(Feature)
        .where(*conditions)
        .options(defer(Feature.geometry), defer(Feature.raw_attributes))
        .order_by(*order_by)
        .limit(limit)
        .offset(offset)
    ).all()
    items = [WetlandInventoryFeatureSummary.model_validate(row) for row in rows]
    return WetlandInventoryListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.get("/tiles/{z}/{x}/{y}.mvt")
def wetland_tile(
    session: SessionDep,
    request: Request,
    z: int = Path(..., ge=MVT_MIN_ZOOM, le=MVT_MAX_ZOOM),
    x: int = Path(..., ge=0),
    y: int = Path(..., ge=0),
) -> Response:
    """Serve one Web-Mercator vector tile of the active release's wetlands.

    Each tile carries only the light attributes the map renders/inspects with;
    full provenance and ``raw_attributes`` stay on the detail endpoint. A tile
    that overlaps no feature is a valid *empty* tile (200, 0 bytes), never a 5xx.
    """

    max_index = (1 << z) - 1
    if x > max_index or y > max_index:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "INVALID_TILE_COORDINATE",
                "detail": f"x and y must be in [0, {max_index}] at zoom {z}",
            },
        )
    version = _active_version(session)
    if version is None:
        # No release loaded: a valid empty tile, never a server error.
        return Response(content=b"", media_type=MVT_CONTENT_TYPE)

    # The tile is pinned to an immutable dataset version, so (version, z, x, y)
    # fully determines the bytes: honor conditional requests without regenerating.
    etag = f'"wetland-{version.id}-{z}-{x}-{y}"'
    cache_headers = {"Cache-Control": TILE_CACHE_CONTROL, "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=cache_headers)

    raw = session.execute(
        _TILE_SQL_STMT, {"version_id": version.id, "z": z, "x": x, "y": y}
    ).scalar()
    body = bytes(raw) if raw is not None else b""
    return Response(content=body, media_type=MVT_CONTENT_TYPE, headers=cache_headers)


@router.get("/{feature_id}", response_model=WetlandInventoryFeatureDetail)
def wetland_detail(
    session: SessionDep,
    feature_id: int,
    include_raw_attributes: bool = Query(
        default=False,
        description="Include the sanitized verbatim source-attribute map (public source text).",
    ),
) -> WetlandInventoryFeatureDetail:
    """One feature with bounded GeoJSON geometry, provenance, and disclosures.

    ``source_attributes`` (verbatim source columns) is returned only when
    ``include_raw_attributes=true``. Missing feature -> structured 404.
    """

    result = session.execute(
        select(Feature, func.ST_AsGeoJSON(Feature.geometry).label("geojson")).where(
            Feature.id == feature_id
        )
    ).first()
    if result is None:
        raise _not_found(feature_id)
    feature, geojson = result
    if geojson is None:
        raise HTTPException(
            status_code=500,
            detail={"error": "MISSING_GEOMETRY", "detail": f"feature {feature_id} has no geometry"},
        )
    version = session.get(EnvironmentalDatasetVersion, feature.dataset_version_id)
    if version is None:  # pragma: no cover - FK guarantees the version row exists
        raise HTTPException(
            status_code=500,
            detail={
                "error": "MISSING_PROVENANCE",
                "detail": f"feature {feature_id} has no dataset version",
            },
        )
    source_attributes = feature.raw_attributes if include_raw_attributes else None
    return WetlandInventoryFeatureDetail(
        id=feature.id,
        source_feature_id=feature.source_feature_id,
        source_fid=feature.source_fid,
        wetland_code=feature.wetland_code,
        wetland_name=feature.wetland_name,
        wetland_type=feature.wetland_type,
        wetland_type_korea=feature.wetland_type_korea,
        wetland_type_ramsar=feature.wetland_type_ramsar,
        reported_area_m2=feature.reported_area_m2,
        geometry_area_m2=feature.geometry_area_m2,
        source_address=feature.source_address,
        source_sido_name=feature.source_sido_name,
        source_sigungu_name=feature.source_sigungu_name,
        source_eupmyeondong_name=feature.source_eupmyeondong_name,
        source_ri_name=feature.source_ri_name,
        designation_note=feature.designation_note,
        normalized_sido_code=feature.normalized_sido_code,
        normalized_sigungu_code=feature.normalized_sigungu_code,
        source_longitude=feature.source_longitude,
        source_latitude=feature.source_latitude,
        source_reference_date=feature.source_reference_date,
        source_crs=feature.source_crs,
        transformation_version=feature.transformation_version,
        dataset_version_id=feature.dataset_version_id,
        geometry=json.loads(geojson),
        provenance=_provenance(version),
        source_attributes=source_attributes,
    )
