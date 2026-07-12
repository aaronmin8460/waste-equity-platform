"""Manifest-driven production ingestion for protected (polygon) and road (line)
structural layers, reusing the versioned structural schema from Phase 2.5B-1.

Design (Phase 2.5B protected/road live ingestion):

* The Git-ignored ``source_manifest.json`` in each family root is the authority
  for layer identity (including nationwide layers, whose identity is never taken
  from the archive filename), per-dataset official reference dates, source CRS,
  and the officially-unavailable cells.
* One ``StructuralDatasetVersion`` is created per provider dataset release (e.g.
  the LSMD 202606 regional bundle, the KNPS national-park boundary, the NGII road
  centerline bundle, the ITS 표준노드링크 release) — never one family-wide version
  forced onto a single invented reference date. A family-level coverage report is
  aggregated over its dataset versions.
* Protected polygons persist to ``structural_protected_features`` (generic
  ``layer_*`` columns); road lines persist to ``structural_line_features``. The
  zoning ``structural_features`` table is not touched.
* Nationwide datasets (national park, 표준노드링크) are spatially filtered and
  clipped to the Seoul/Incheon/Gyeonggi SIDO boundaries stored in PostGIS.
* Features are streamed and written in batches with ``ON CONFLICT DO NOTHING`` so
  multi-million-row road sources ingest without loading everything into memory,
  and an identical re-run inserts zero rows.

Like the zoning loader this is a bulk-file loader: no API key, no fallback to
``data/samples`` or synthetic data. Invalid geometry is rejected and reported,
never silently repaired.
"""

from __future__ import annotations

import datetime
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, cast

import numpy as np
import shapefile  # pyshp
import shapely
from geoalchemy2.shape import from_shape
from numpy.typing import NDArray
from pyproj import Transformer
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry
from sqlalchemy import Table, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    StructuralDatasetVersion,
    StructuralLineFeature,
    StructuralProtectedFeature,
)

from .config import ProbeSettings
from .errors import IngestionError, ProbeError
from .structural_clipping import (
    RegionBoundary,
    clip_to_regions,
    load_capital_region_boundaries,
)
from .structural_layers import normalize_line_geometry
from .structural_manifest import (
    COMPLETE,
    COMPLETE_FOR_AVAILABLE_SOURCES,
    COMPLETE_WITH_FEATURES,
    COMPLETE_ZERO_FEATURES,
    INCOMPLETE,
    LINE,
    NATIONWIDE_SOURCE_EVALUATED,
    OFFICIAL_SOURCE_UNAVAILABLE,
    PARTIAL,
    SOURCE_MISSING,
    VALIDATION_FAILURE,
    DatasetSpec,
    LayerSpec,
    SourceManifest,
    load_manifest,
)
from .vworld_zoning_contract import (
    NORMALIZED_GEOMETRY_TYPE,
    SOURCE_ID,
    TARGET_CRS,
    TARGET_REGIONS,
    TARGET_SRID,
    TargetRegion,
    combined_checksum,
    normalize_polygonal_geometry,
    require_supported_source_crs,
)
from .vworld_zoning_ingestion import (
    SidecarValidationError,  # noqa: F401 - re-exported for callers/tests
    _extract_zip_shapefiles,
    _read_prj_epsg,
    _sha256_file,
    validate_shapefile_sidecars,
)

TRANSFORMATION_VERSION = "vworld-structural-v2"
SUPPORTED_FAMILIES = ("protected", "roads")
NORMALIZED_LINE_GEOMETRY_TYPE = "MultiLineString"
_DEFAULT_BATCH = 1500
_MAX_WARNINGS_PER_SOURCE = 40
_NATIONWIDE_DIR = "nationwide"


# --------------------------------------------------------------------------- #
# Fingerprint
# --------------------------------------------------------------------------- #


def structural_feature_fingerprint(
    geometry: BaseGeometry,
    *,
    layer_code: str,
    target_region_code: str | None,
    provider_feature_id: str | None,
    clipped: bool,
) -> str:
    """Deterministic sha256 over normalized geometry plus stable identity.

    Combines the canonicalized (normalized) geometry with the layer code, the
    target 시도, the provider feature id (LINK_ID/UFID/NPK_CD/MNUM — stable
    within one release), and whether the geometry was clipped from a nationwide
    source. Two distinct provider features that happen to share geometry keep
    distinct fingerprints; a clipped feature is stable because the clip is
    deterministic. Computed after clipping.
    """

    import shapely

    normalized = shapely.normalize(geometry)
    payload = {
        "layer_code": layer_code,
        "target_region_code": target_region_code,
        "provider_feature_id": provider_feature_id,
        "clipped": clipped,
    }
    digest = hashlib.sha256()
    digest.update(normalized.wkb)
    digest.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


def _provider_feature_id(attributes: dict[str, Any], fields: tuple[str, ...]) -> str | None:
    candidates = tuple(f.lower() for f in fields) + ("id", "mnum", "ufid", "gid", "link_id")
    for key in candidates:
        value = attributes.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


def _bbox_overlaps(
    a: tuple[float, float, float, float], b: tuple[float, float, float, float]
) -> bool:
    return not (a[2] < b[0] or a[0] > b[2] or a[3] < b[1] or a[1] > b[3])


def _capital_source_bbox(
    source_crs: str, boundaries: list[RegionBoundary]
) -> tuple[float, float, float, float] | None:
    """Capital-region bounding box expressed in the source CRS (with a margin).

    Used only to cheaply reject nationwide features whose source-coordinate bbox
    cannot overlap the capital region, before any geometry is reprojected. The
    box is densified during transform and padded, so it never drops a feature
    that actually touches a 시도 (precise clipping happens afterwards).
    """

    if not boundaries:
        return None
    minx = min(b.bounds[0] for b in boundaries)
    miny = min(b.bounds[1] for b in boundaries)
    maxx = max(b.bounds[2] for b in boundaries)
    maxy = max(b.bounds[3] for b in boundaries)
    inv = Transformer.from_crs(TARGET_CRS, source_crs, always_xy=True)
    left, bottom, right, top = inv.transform_bounds(minx, miny, maxx, maxy, densify_pts=101)
    pad = 0.01 * max(right - left, top - bottom)
    return (left - pad, bottom - pad, right + pad, top + pad)


# --------------------------------------------------------------------------- #
# Source discovery
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class StructuralSource:
    shp_path: Path
    dataset: DatasetSpec
    layer: LayerSpec
    region: TargetRegion | None  # None for nationwide sources
    origin_filename: str
    checksum: str


@dataclass
class SourceStats:
    origin_filename: str
    layer_code: str
    region_dir: str | None
    source_crs: str
    source_geometry_type: str | None = None
    received: int = 0
    accepted: int = 0
    rejected: int = 0
    skipped_outside_region: int = 0
    clipped_count: int = 0
    inserted: int = 0
    skipped_existing: int = 0
    promoted: int = 0
    per_region_accepted: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    extra_rejected: int = 0  # rejects beyond the reported cap


def _discover_sources(
    family: str,
    manifest: SourceManifest,
    root: Path,
    tmp_root: Path,
) -> tuple[list[StructuralSource], set[str], list[dict[str, Any]]]:
    """Discover manifest-matched shapefile sources across regional + nationwide dirs.

    Returns ``(sources, present_region_dirs, skipped_files)``. ``skipped_files``
    records non-line/non-matching internal shapefiles that were intentionally not
    ingested (e.g. the STDLINK NODE point file), for the report.
    """

    sources: list[StructuralSource] = []
    present: set[str] = set()
    skipped: list[dict[str, Any]] = []

    # Regional directories.
    for region in TARGET_REGIONS:
        region_dir = root / region.dir_name
        if not region_dir.is_dir():
            continue
        present.add(region.dir_name)
        _scan_dir(family, manifest, region_dir, region, tmp_root, sources, skipped)

    # Nationwide directory.
    nationwide_dir = root / _NATIONWIDE_DIR
    if nationwide_dir.is_dir():
        _scan_dir(family, manifest, nationwide_dir, None, tmp_root, sources, skipped)

    return sources, present, skipped


def _scan_dir(
    family: str,
    manifest: SourceManifest,
    directory: Path,
    region: TargetRegion | None,
    tmp_root: Path,
    sources: list[StructuralSource],
    skipped: list[dict[str, Any]],
) -> None:
    label = region.dir_name if region is not None else _NATIONWIDE_DIR
    seen: set[str] = set()
    for zip_path in sorted(directory.glob("*.zip")):
        extract_dir = tmp_root / f"{family}_{label}_{zip_path.stem}"
        extract_dir.mkdir(parents=True, exist_ok=True)
        checksum = _sha256_file(zip_path)
        for shp_path in _extract_zip_shapefiles(zip_path, extract_dir):
            _consider_shapefile(
                manifest, shp_path, region, zip_path.name, checksum, sources, skipped, seen
            )
    for shp_path in sorted(
        p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() == ".shp"
    ):
        _consider_shapefile(
            manifest,
            shp_path,
            region,
            shp_path.name,
            _sha256_file(shp_path),
            sources,
            skipped,
            seen,
        )


def _consider_shapefile(
    manifest: SourceManifest,
    shp_path: Path,
    region: TargetRegion | None,
    origin_filename: str,
    checksum: str,
    sources: list[StructuralSource],
    skipped: list[dict[str, Any]],
    seen: set[str],
) -> None:
    match = manifest.match(shp_path.stem)
    if match is None:
        skipped.append({"file": shp_path.name, "reason": "no manifest layer alias match"})
        return
    dataset, layer = match
    # Regional datasets ignore the nationwide dir and vice versa.
    if dataset.is_nationwide and region is not None:
        return
    if not dataset.is_nationwide and region is None:
        return
    key = f"{dataset.dataset_key}:{layer.layer_code}:{region.dir_name if region else 'nationwide'}"
    if key in seen:
        return
    # Geometry-family guard: never ingest a POINT/NODE file as a line, or a line
    # as a polygon. This is what rejects MOCT_NODE even if an alias slipped.
    declared_geom = _peek_geometry_family(shp_path)
    if declared_geom is not None and declared_geom != layer.geometry_family:
        skipped.append(
            {
                "file": shp_path.name,
                "reason": (
                    f"geometry family {declared_geom} != expected {layer.geometry_family} "
                    f"for layer {layer.layer_code}"
                ),
            }
        )
        return
    validate_shapefile_sidecars(shp_path)
    sources.append(
        StructuralSource(
            shp_path=shp_path,
            dataset=dataset,
            layer=layer,
            region=region,
            origin_filename=origin_filename,
            checksum=checksum,
        )
    )
    seen.add(key)


_POLYGON_SHAPE_TYPES = {5, 15, 25}
_LINE_SHAPE_TYPES = {3, 13, 23}
_POINT_SHAPE_TYPES = {1, 8, 11, 18, 21, 28}


def _peek_geometry_family(shp_path: Path) -> str | None:
    try:
        reader = shapefile.Reader(str(shp_path))
        stype = reader.shapeType
        reader.close()
    except Exception:  # noqa: BLE001 - unreadable header handled later
        return None
    if stype in _POLYGON_SHAPE_TYPES:
        return "POLYGON"
    if stype in _LINE_SHAPE_TYPES:
        return LINE
    if stype in _POINT_SHAPE_TYPES:
        return "POINT"
    return None


# --------------------------------------------------------------------------- #
# Batched writer
# --------------------------------------------------------------------------- #


class _BatchWriter:
    """Streams feature rows to PostGIS in batches with ON CONFLICT DO NOTHING."""

    def __init__(self, session: Session, *, is_line: bool, batch_size: int) -> None:
        self._session = session
        self._table = cast(
            "Table",
            StructuralLineFeature.__table__ if is_line else StructuralProtectedFeature.__table__,
        )
        self._constraint = (
            "uq_structural_line_features_version_fingerprint"
            if is_line
            else "uq_structural_protected_features_version_fingerprint"
        )
        self._batch_size = batch_size
        self._buffer: list[dict[str, Any]] = []
        self.inserted = 0

    def add(self, row: dict[str, Any]) -> None:
        self._buffer.append(row)
        if len(self._buffer) >= self._batch_size:
            self._flush()

    def _flush(self) -> None:
        if not self._buffer:
            return
        # RETURNING id yields exactly the rows that were inserted; with ON CONFLICT
        # DO NOTHING the conflicting (already-present or in-batch duplicate) rows
        # are not returned, so counting the result is a reliable insert count
        # (multi-row INSERT rowcount is unreliable across drivers).
        stmt = (
            pg_insert(self._table)
            .values(self._buffer)
            .on_conflict_do_nothing(constraint=self._constraint)
            .returning(self._table.c.id)
        )
        result = self._session.execute(stmt)
        self.inserted += sum(1 for _ in result)
        self._buffer.clear()

    def finish(self) -> int:
        self._flush()
        return self.inserted


# --------------------------------------------------------------------------- #
# Per-source processing (shared by dry-run and write)
# --------------------------------------------------------------------------- #


def process_source(
    source: StructuralSource,
    *,
    encoding: str,
    boundaries: list[RegionBoundary],
    version_id: int | None,
    writer: _BatchWriter | None,
    now: datetime.datetime,
) -> SourceStats:
    """Stream one shapefile: transform → (clip nationwide) → normalize → count/write.

    Returns per-source stats. When ``writer`` is ``None`` (dry-run) no rows are
    persisted but the identical validation/clip pipeline runs so counts are real.
    """

    source_epsg = _read_prj_epsg(source.shp_path)
    source_crs = require_supported_source_crs(source_epsg)
    transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)

    def _project(coords: NDArray[np.float64]) -> NDArray[np.float64]:
        # Vectorized reprojection: transform all vertices of a geometry at once
        # (pyproj/numpy), which is orders of magnitude faster than a per-vertex
        # Python callback for the multi-million-vertex road sources.
        lon, lat = transformer.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([lon, lat])

    is_line = source.layer.geometry_family == LINE
    is_nationwide = source.dataset.is_nationwide
    # For a nationwide source, prefilter by bounding box in the SOURCE CRS so the
    # (majority of) features outside the capital region are skipped before any
    # geometry is built or reprojected — a large speedup for the 표준노드링크 scan.
    src_bbox = _capital_source_bbox(source_crs, boundaries) if is_nationwide else None

    reader = shapefile.Reader(str(source.shp_path), encoding=encoding, encodingErrors="strict")
    stats = SourceStats(
        origin_filename=source.origin_filename,
        layer_code=source.layer.layer_code,
        region_dir=source.region.dir_name if source.region else None,
        source_crs=source_crs,
    )
    count = len(reader)

    def _warn(msg: str) -> None:
        if len(stats.warnings) < _MAX_WARNINGS_PER_SOURCE:
            stats.warnings.append(msg)
        else:
            stats.extra_rejected += 1

    for index in range(count):
        stats.received += 1
        try:
            shp = reader.shape(index)
        except Exception:  # noqa: BLE001 - malformed geometry reported, not fatal
            stats.rejected += 1
            _warn(f"{source.origin_filename}[{index}]: unreadable geometry; rejected")
            continue
        if src_bbox is not None:
            bb = getattr(shp, "bbox", None)
            if bb is None or not _bbox_overlaps((bb[0], bb[1], bb[2], bb[3]), src_bbox):
                stats.skipped_outside_region += 1
                continue
        try:
            record = reader.record(index)
        except (UnicodeDecodeError, shapefile.ShapefileException):
            stats.rejected += 1
            _warn(
                f"{source.origin_filename}[{index}]: undecodable attribute ({encoding}); rejected"
            )
            continue
        attributes = {k.lower(): v for k, v in record.as_dict().items()}
        try:
            raw_geom = shapely_shape(shp.__geo_interface__)
        except Exception:  # noqa: BLE001 - malformed geometry reported, not fatal
            stats.rejected += 1
            _warn(f"{source.origin_filename}[{index}]: unreadable geometry; rejected")
            continue
        if stats.source_geometry_type is None:
            stats.source_geometry_type = raw_geom.geom_type
        projected = shapely.transform(raw_geom, _project, include_z=False)
        normalized: BaseGeometry
        promoted: bool
        try:
            if is_line:
                normalized, promoted = normalize_line_geometry(projected)
            else:
                normalized, promoted = normalize_polygonal_geometry(projected)
        except IngestionError as exc:
            stats.rejected += 1
            _warn(f"{source.origin_filename}[{index}]: {exc}; rejected")
            continue
        if promoted:
            stats.promoted += 1
        provider_feature_id = _provider_feature_id(
            attributes, source.layer.provider_feature_id_fields
        )

        if is_nationwide:
            clips = clip_to_regions(normalized, boundaries, is_line=is_line)
            if not clips:
                stats.skipped_outside_region += 1
                continue
            for clip in clips:
                if clip.clipped:
                    stats.clipped_count += 1
                _emit(
                    source,
                    stats,
                    geometry=clip.geometry,
                    region_code=clip.boundary.sido_code,
                    region_name=clip.boundary.sido_name,
                    region_dir=clip.boundary.dir_name,
                    provider_feature_id=provider_feature_id,
                    attributes=attributes,
                    source_crs=source_crs,
                    clipped=clip.clipped,
                    writer=writer,
                    version_id=version_id,
                    now=now,
                )
        else:
            assert source.region is not None
            _emit(
                source,
                stats,
                geometry=normalized,
                region_code=source.region.sido_code,
                region_name=source.region.sido_name,
                region_dir=source.region.dir_name,
                provider_feature_id=provider_feature_id,
                attributes=attributes,
                source_crs=source_crs,
                clipped=False,
                writer=writer,
                version_id=version_id,
                now=now,
            )
    reader.close()
    return stats


def _emit(
    source: StructuralSource,
    stats: SourceStats,
    *,
    geometry: BaseGeometry,
    region_code: str,
    region_name: str,
    region_dir: str,
    provider_feature_id: str | None,
    attributes: dict[str, Any],
    source_crs: str,
    clipped: bool,
    writer: _BatchWriter | None,
    version_id: int | None,
    now: datetime.datetime,
) -> None:
    fingerprint = structural_feature_fingerprint(
        geometry,
        layer_code=source.layer.layer_code,
        target_region_code=region_code,
        provider_feature_id=provider_feature_id,
        clipped=clipped,
    )
    stats.accepted += 1
    stats.per_region_accepted[region_dir] = stats.per_region_accepted.get(region_dir, 0) + 1
    if writer is None or version_id is None:
        return
    provenance: dict[str, Any] = {
        "origin_filename": source.origin_filename,
        "dataset_key": source.dataset.dataset_key,
        "source_crs": source_crs,
        "target_crs": TARGET_CRS,
        "checksum": source.checksum,
        "coverage_type": source.dataset.coverage_type,
    }
    if source.dataset.is_nationwide:
        provenance["clipped_from_nationwide"] = clipped
        provenance["clipped_region"] = region_dir
    writer.add(
        {
            "dataset_version_id": version_id,
            "layer_identifier": source.layer.layer_identifier,
            "provider_feature_id": provider_feature_id,
            "layer_category": source.layer.category,
            "official_layer_code": source.layer.layer_code,
            "official_layer_name": source.layer.official_layer_name,
            "target_region_code": region_code,
            "target_region_name": region_name,
            "source_attributes": attributes,
            # Binary WKB is much faster to insert than text WKT (no per-row
            # ST_GeomFromEWKT text parse) — matters for the multi-million-row roads.
            "geometry": from_shape(geometry, srid=TARGET_SRID),
            "feature_fingerprint": fingerprint,
            "source_provenance": provenance,
            "created_at": now,
            "ingested_at": now,
        }
    )


# --------------------------------------------------------------------------- #
# Coverage
# --------------------------------------------------------------------------- #


def _dataset_coverage(
    dataset: DatasetSpec,
    manifest: SourceManifest,
    present_region_dirs: set[str],
    accepted_by_cell: dict[tuple[str, str], int],
    failed_cells: set[tuple[str, str]],
    present_cells: set[tuple[str, str]],
) -> dict[str, Any]:
    """Per-dataset region×layer coverage contribution (stored on the version)."""

    contribution: dict[str, Any] = {}
    for region in TARGET_REGIONS:
        layer_cells: dict[str, Any] = {}
        for layer in dataset.layers:
            cell = (region.dir_name, layer.layer_code)
            if dataset.is_nationwide:
                status = NATIONWIDE_SOURCE_EVALUATED
                fc = accepted_by_cell.get(cell, 0)
            elif cell in failed_cells:
                status, fc = VALIDATION_FAILURE, 0
            elif cell in present_cells:
                fc = accepted_by_cell.get(cell, 0)
                status = COMPLETE_WITH_FEATURES if fc > 0 else COMPLETE_ZERO_FEATURES
            else:
                evidence = manifest.unavailable_evidence(region.dir_name, layer.layer_code)
                status = OFFICIAL_SOURCE_UNAVAILABLE if evidence is not None else SOURCE_MISSING
                fc = 0
            entry: dict[str, Any] = {
                "status": status,
                "feature_count": fc,
                "coverage_type": dataset.coverage_type,
            }
            evidence = manifest.unavailable_evidence(region.dir_name, layer.layer_code)
            if status == OFFICIAL_SOURCE_UNAVAILABLE and evidence:
                entry["evidence"] = evidence
            layer_cells[layer.layer_code] = entry
        contribution[region.dir_name] = layer_cells
    return contribution


def _merge_matrices(
    contributions: list[dict[str, Any]], present_region_dirs: set[str]
) -> dict[str, Any]:
    matrix: dict[str, Any] = {}
    for region in TARGET_REGIONS:
        layers: dict[str, Any] = {}
        evaluated = False
        for contribution in contributions:
            region_layers = contribution.get(region.dir_name, {})
            for code, entry in region_layers.items():
                layers[code] = entry
                if entry["status"] in (
                    COMPLETE_WITH_FEATURES,
                    COMPLETE_ZERO_FEATURES,
                    NATIONWIDE_SOURCE_EVALUATED,
                ):
                    evaluated = True
        matrix[region.dir_name] = {
            "region_code": region.sido_code,
            "region_name": region.sido_name,
            "region_present": region.dir_name in present_region_dirs,
            "region_evaluated": evaluated,
            "layers": layers,
        }
    return matrix


def _family_status(matrix: dict[str, Any]) -> str:
    any_evaluated = False
    all_regions_evaluated = True
    has_validation_failure = False
    has_source_missing = False
    has_unavailable = False
    for region in TARGET_REGIONS:
        region_entry = matrix[region.dir_name]
        if region_entry["region_evaluated"]:
            any_evaluated = True
        else:
            all_regions_evaluated = False
        for cell in region_entry["layers"].values():
            status = cell["status"]
            if status == VALIDATION_FAILURE:
                has_validation_failure = True
            elif status == SOURCE_MISSING:
                has_source_missing = True
            elif status == OFFICIAL_SOURCE_UNAVAILABLE:
                has_unavailable = True
    if not any_evaluated:
        return INCOMPLETE
    if all_regions_evaluated and not has_validation_failure and not has_source_missing:
        return COMPLETE_FOR_AVAILABLE_SOURCES if has_unavailable else COMPLETE
    return PARTIAL


# --------------------------------------------------------------------------- #
# Reports
# --------------------------------------------------------------------------- #


@dataclass
class DatasetReport:
    dataset_key: str
    provider: str
    provider_dataset_identifier: str
    official_dataset_name: str
    coverage_type: str
    reference_date: str
    source_crs: str
    dataset_version_id: int | None
    dataset_version_created: bool
    total_feature_count: int
    accepted_feature_count: int
    rejected_feature_count: int
    features_inserted: int
    features_skipped_existing: int
    clipped_from_nationwide: int
    skipped_outside_region: int
    per_region_accepted: dict[str, int]
    source_files: list[dict[str, Any]]


@dataclass
class StructuralIngestionReport:
    job: str
    mode: str
    status: str
    family: str
    source_path: str | None = None
    total_feature_count: int = 0
    accepted_feature_count: int = 0
    rejected_feature_count: int = 0
    promoted_count: int = 0
    features_inserted: int = 0
    features_skipped_existing: int = 0
    clipped_from_nationwide: int = 0
    skipped_outside_region: int = 0
    dataset_versions: list[dict[str, Any]] = field(default_factory=list)
    coverage_status: str = INCOMPLETE
    regions_evaluated: list[str] = field(default_factory=list)
    coverage_matrix: dict[str, Any] = field(default_factory=dict)
    source_crs_by_dataset: dict[str, str] = field(default_factory=dict)
    reference_date_by_dataset: dict[str, str] = field(default_factory=dict)
    source_files: list[dict[str, Any]] = field(default_factory=list)
    skipped_files: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    required_sources: list[dict[str, Any]] = field(default_factory=list)
    ingestion_run_id: int | None = None
    next_command: str | None = None
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "job": self.job,
            "mode": self.mode,
            "status": self.status,
            "family": self.family,
            "target_crs": TARGET_CRS,
            "total_feature_count": self.total_feature_count,
            "accepted_feature_count": self.accepted_feature_count,
            "rejected_feature_count": self.rejected_feature_count,
            "promoted_count": self.promoted_count,
            "features_inserted": self.features_inserted,
            "features_skipped_existing": self.features_skipped_existing,
            "clipped_from_nationwide": self.clipped_from_nationwide,
            "skipped_outside_region": self.skipped_outside_region,
            "dataset_versions": self.dataset_versions,
            "coverage_status": self.coverage_status,
            "regions_evaluated": self.regions_evaluated,
            "coverage_matrix": self.coverage_matrix,
            "source_crs_by_dataset": self.source_crs_by_dataset,
            "reference_date_by_dataset": self.reference_date_by_dataset,
            "source_files": self.source_files,
            "skipped_files": self.skipped_files,
            "warnings": self.warnings,
            "required_sources": self.required_sources,
            "ingestion_run_id": self.ingestion_run_id,
            "next_command": self.next_command,
            "message": self.message,
        }


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def run_structural_ingestion(
    settings: ProbeSettings,  # noqa: ARG001 - CLI signature parity; no API key needed
    *,
    family: str,
    source_path: str,
    reference_date: str | None = None,  # noqa: ARG001 - manifest is authoritative now
    scope: str,
    write: bool,
    encoding: str = "cp949",
    batch_size: int = _DEFAULT_BATCH,
) -> StructuralIngestionReport:
    if family not in SUPPORTED_FAMILIES:
        raise IngestionError(f"Unsupported structural family '{family}'")
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented")
    root = Path(source_path)
    if not root.exists():
        raise IngestionError(f"Source path does not exist: {source_path}")
    job = f"vworld-{family}-ingest"
    manifest = load_manifest(root, family=family)

    with TemporaryDirectory(prefix=f"vworld-{family}-") as tmp_name:
        tmp_root = Path(tmp_name)
        sources, present, skipped_files = _discover_sources(family, manifest, root, tmp_root)
        if not sources:
            return _no_sources_report(job, family, manifest, root, skipped_files)

        needs_boundaries = any(s.dataset.is_nationwide for s in sources)
        boundaries: list[RegionBoundary] = []
        # Only touch the database when a nationwide source needs SIDO boundaries
        # or when writing; a purely-regional dry-run runs with no DB access.
        session_factory = get_sessionmaker() if (needs_boundaries or write) else None
        if needs_boundaries:
            assert session_factory is not None
            boundary_session = session_factory()
            try:
                boundaries = load_capital_region_boundaries(boundary_session)
            finally:
                boundary_session.close()

        if not write:
            return _dry_run(
                job, family, manifest, root, sources, present, skipped_files, boundaries, encoding
            )
        return _write(
            job,
            family,
            manifest,
            root,
            sources,
            present,
            skipped_files,
            boundaries,
            encoding,
            session_factory=session_factory,
            batch_size=batch_size,
        )


def _datasets_with_sources(
    sources: list[StructuralSource],
) -> list[tuple[DatasetSpec, list[StructuralSource]]]:
    order: list[str] = []
    by_key: dict[str, list[StructuralSource]] = {}
    specs: dict[str, DatasetSpec] = {}
    for s in sources:
        if s.dataset.dataset_key not in by_key:
            by_key[s.dataset.dataset_key] = []
            order.append(s.dataset.dataset_key)
            specs[s.dataset.dataset_key] = s.dataset
        by_key[s.dataset.dataset_key].append(s)
    return [(specs[k], by_key[k]) for k in order]


def _source_file_entry(source: StructuralSource, stats: SourceStats) -> dict[str, Any]:
    return {
        "origin_filename": source.origin_filename,
        "internal_shapefile": source.shp_path.name,
        "dataset_key": source.dataset.dataset_key,
        "layer": source.layer.layer_code,
        "layer_identifier": source.layer.layer_identifier,
        "region": source.region.dir_name if source.region else _NATIONWIDE_DIR,
        "coverage_type": source.dataset.coverage_type,
        "checksum": source.checksum,
        "source_crs": stats.source_crs,
        "target_crs": TARGET_CRS,
        "source_geometry_type": stats.source_geometry_type,
        "reference_date": source.dataset.reference_date.isoformat(),
        "records_received": stats.received,
        "records_accepted": stats.accepted,
        "records_rejected": stats.rejected + stats.extra_rejected,
        "records_skipped_outside_region": stats.skipped_outside_region,
        "records_clipped": stats.clipped_count,
    }


def _aggregate_dataset(
    dataset: DatasetSpec,
    dataset_sources: list[StructuralSource],
    stats_list: list[SourceStats],
    manifest: SourceManifest,
    present: set[str],
) -> tuple[dict[str, Any], dict[tuple[str, str], int]]:
    accepted_by_cell: dict[tuple[str, str], int] = {}
    present_cells: set[tuple[str, str]] = set()
    failed_cells: set[tuple[str, str]] = set()
    for source, stats in zip(dataset_sources, stats_list, strict=True):
        if dataset.is_nationwide:
            for region_dir, cnt in stats.per_region_accepted.items():
                cell = (region_dir, source.layer.layer_code)
                accepted_by_cell[cell] = accepted_by_cell.get(cell, 0) + cnt
        else:
            assert source.region is not None
            cell = (source.region.dir_name, source.layer.layer_code)
            present_cells.add(cell)
            accepted_by_cell[cell] = accepted_by_cell.get(cell, 0) + stats.accepted
    contribution = _dataset_coverage(
        dataset, manifest, present, accepted_by_cell, failed_cells, present_cells
    )
    return contribution, accepted_by_cell


def _dry_run(
    job: str,
    family: str,
    manifest: SourceManifest,
    root: Path,
    sources: list[StructuralSource],
    present: set[str],
    skipped_files: list[dict[str, Any]],
    boundaries: list[RegionBoundary],
    encoding: str,
) -> StructuralIngestionReport:
    now = _utcnow()
    report = StructuralIngestionReport(
        job=job, mode="dry-run", status="VALIDATED", family=family, source_path=str(root)
    )
    contributions: list[dict[str, Any]] = []
    for dataset, dataset_sources in _datasets_with_sources(sources):
        stats_list = [
            process_source(
                s, encoding=encoding, boundaries=boundaries, version_id=None, writer=None, now=now
            )
            for s in dataset_sources
        ]
        contribution, _ = _aggregate_dataset(
            dataset, dataset_sources, stats_list, manifest, present
        )
        contributions.append(contribution)
        _accumulate_report(
            report, dataset, dataset_sources, stats_list, version=None, created=False
        )
    _finalize_report(report, manifest, contributions, present, skipped_files=skipped_files)
    report.message = (
        f"Official {family} sources validated and clipped; no database writes performed."
    )
    return report


def _write(
    job: str,
    family: str,
    manifest: SourceManifest,
    root: Path,
    sources: list[StructuralSource],
    present: set[str],
    skipped_files: list[dict[str, Any]],
    boundaries: list[RegionBoundary],
    encoding: str,
    *,
    session_factory: Any,
    batch_size: int,
) -> StructuralIngestionReport:
    now = _utcnow()
    session = session_factory()
    datasets = _datasets_with_sources(sources)
    # Newest official reference date across every dataset in this run (created or
    # reused). Used for both the run's reference_period and dataset freshness so
    # neither regresses on an idempotent re-run or when an older dataset is added.
    all_reference_dates = sorted({ds.reference_date for ds, _ in datasets})
    latest_reference = all_reference_dates[-1]
    # Compact, bounded (<=22 chars) reference_period that fits String(50) even
    # with many distinct dataset reference dates.
    reference_period = (
        all_reference_dates[0].isoformat()
        if len(all_reference_dates) == 1
        else f"{all_reference_dates[0].isoformat()}..{all_reference_dates[-1].isoformat()}"
    )
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=now,
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=reference_period,
        transformation_version=TRANSFORMATION_VERSION,
    )
    report = StructuralIngestionReport(
        job=job, mode="write", status="SUCCEEDED", family=family, source_path=str(root)
    )
    contributions: list[dict[str, Any]] = []
    try:
        session.add(run)
        session.commit()
        session.refresh(run)
        report.ingestion_run_id = run.run_id
        total_inserted = 0
        total_rejected = 0
        for dataset, dataset_sources in datasets:
            is_line = dataset.layers[0].geometry_family == LINE
            checksum = combined_checksum(sorted({s.checksum for s in dataset_sources}))
            version, created = _get_or_create_version(
                session,
                family,
                dataset,
                dataset_sources,
                checksum,
                run=run,
                now=now,
                is_line=is_line,
            )
            if not created:
                # Idempotent: this exact release is already fully persisted.
                contribution = version.coverage_matrix or {}
                contributions.append(contribution)
                report.dataset_versions.append(
                    _dataset_version_summary(dataset, version, created=False)
                )
                report.features_skipped_existing += int(version.accepted_feature_count or 0)
                report.accepted_feature_count += int(version.accepted_feature_count or 0)
                report.total_feature_count += int(version.total_feature_count or 0)
                report.source_crs_by_dataset[dataset.dataset_key] = version.source_crs
                report.reference_date_by_dataset[dataset.dataset_key] = (
                    dataset.reference_date.isoformat()
                )
                for entry in version.source_files or []:
                    report.source_files.append(entry)
                continue
            session.flush()
            writer = _BatchWriter(session, is_line=is_line, batch_size=batch_size)
            stats_list: list[SourceStats] = []
            for s in dataset_sources:
                st = process_source(
                    s,
                    encoding=encoding,
                    boundaries=boundaries,
                    version_id=version.id,
                    writer=writer,
                    now=now,
                )
                stats_list.append(st)
            writer.finish()
            contribution, _ = _aggregate_dataset(
                dataset, dataset_sources, stats_list, manifest, present
            )
            _finalize_version(
                version, dataset, dataset_sources, stats_list, contribution, writer, now=now
            )
            # No per-dataset commit: every dataset version + its features stay in
            # one transaction so the whole family write is atomic (a later-dataset
            # failure rolls back ALL datasets, honoring the "rolled back" contract).
            session.flush()
            contributions.append(contribution)
            total_inserted += writer.inserted
            total_rejected += sum(st.rejected + st.extra_rejected for st in stats_list)
            _accumulate_report(
                report,
                dataset,
                dataset_sources,
                stats_list,
                version=version,
                created=True,
                inserted=writer.inserted,
            )

        # Freshness updates on every successful run (including a fully idempotent
        # re-run) using the newest reference date across ALL datasets present, so
        # last_checked/last_success advance and the recorded period never regresses.
        _update_freshness(session, reference_period=latest_reference.isoformat(), now=now)
        run.status = "SUCCEEDED"
        run.completed_at = _utcnow()
        run.rows_inserted = total_inserted
        run.rows_received = report.total_feature_count
        run.rows_rejected = total_rejected
        session.commit()
        _finalize_report(report, manifest, contributions, present, skipped_files=skipped_files)
        report.message = _write_message(report)
        return report
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run.run_id, run.reference_period or "", exc)
        if isinstance(exc, ProbeError):
            raise
        raise IngestionError(
            f"{family} ingestion failed; normalized writes were rolled back"
        ) from exc
    finally:
        session.close()


def _write_message(report: StructuralIngestionReport) -> str:
    created = [d for d in report.dataset_versions if d["created"]]
    reused = [d for d in report.dataset_versions if not d["created"]]
    if created and not reused:
        return f"VWorld {report.family} ingestion succeeded ({len(created)} dataset version(s))."
    if reused and not created:
        return (
            f"VWorld {report.family} ingestion re-ran; all {len(reused)} dataset version(s) "
            "already present (idempotent)."
        )
    return (
        f"VWorld {report.family} ingestion: {len(created)} new dataset version(s), "
        f"{len(reused)} already present (idempotent)."
    )


def _accumulate_report(
    report: StructuralIngestionReport,
    dataset: DatasetSpec,
    dataset_sources: list[StructuralSource],
    stats_list: list[SourceStats],
    *,
    version: StructuralDatasetVersion | None,
    created: bool,
    inserted: int | None = None,
) -> None:
    ds_total = sum(st.received for st in stats_list)
    ds_accepted = sum(st.accepted for st in stats_list)
    ds_rejected = sum(st.rejected + st.extra_rejected for st in stats_list)
    ds_clipped = sum(st.clipped_count for st in stats_list)
    ds_outside = sum(st.skipped_outside_region for st in stats_list)
    ds_promoted = sum(st.promoted for st in stats_list)
    report.total_feature_count += ds_total
    report.accepted_feature_count += ds_accepted
    report.rejected_feature_count += ds_rejected
    report.clipped_from_nationwide += ds_clipped
    report.skipped_outside_region += ds_outside
    report.promoted_count += ds_promoted
    report.source_crs_by_dataset[dataset.dataset_key] = (
        stats_list[0].source_crs if stats_list else ""
    )
    report.reference_date_by_dataset[dataset.dataset_key] = dataset.reference_date.isoformat()
    for source, stats in zip(dataset_sources, stats_list, strict=True):
        report.source_files.append(_source_file_entry(source, stats))
        report.warnings.extend(stats.warnings)
    if version is not None:
        # Actual distinct rows persisted this write (post ON CONFLICT dedup), not
        # the pre-dedup accepted count.
        actual_inserted = inserted if inserted is not None else 0
        report.features_inserted += actual_inserted
        report.features_skipped_existing += max(0, ds_accepted - actual_inserted)
        report.dataset_versions.append(_dataset_version_summary(dataset, version, created=created))
    else:
        report.dataset_versions.append(
            {
                "dataset_key": dataset.dataset_key,
                "provider": dataset.provider,
                "provider_dataset_identifier": dataset.provider_dataset_identifier,
                "reference_date": dataset.reference_date.isoformat(),
                "coverage_type": dataset.coverage_type,
                "accepted_feature_count": ds_accepted,
                "rejected_feature_count": ds_rejected,
                "clipped_from_nationwide": ds_clipped,
                "skipped_outside_region": ds_outside,
                "dataset_version_id": None,
                "created": False,
            }
        )


def _dataset_version_summary(
    dataset: DatasetSpec, version: StructuralDatasetVersion, *, created: bool
) -> dict[str, Any]:
    return {
        "dataset_key": dataset.dataset_key,
        "provider": version.provider,
        "provider_dataset_identifier": version.provider_dataset_identifier,
        "reference_date": version.reference_date.isoformat(),
        "coverage_type": dataset.coverage_type,
        "source_crs": version.source_crs,
        "accepted_feature_count": int(version.accepted_feature_count or 0),
        "rejected_feature_count": int(version.rejected_feature_count or 0),
        "coverage_status": version.coverage_status,
        "dataset_version_id": version.id,
        "created": created,
    }


def _finalize_report(
    report: StructuralIngestionReport,
    manifest: SourceManifest,
    contributions: list[dict[str, Any]],
    present: set[str],
    *,
    skipped_files: list[dict[str, Any]] | None = None,
) -> None:
    matrix = _merge_matrices(contributions, present)
    report.coverage_matrix = matrix
    report.coverage_status = _family_status(matrix)
    report.regions_evaluated = [
        r.dir_name for r in TARGET_REGIONS if matrix[r.dir_name]["region_evaluated"]
    ]
    if skipped_files is not None:
        report.skipped_files = skipped_files


# --------------------------------------------------------------------------- #
# Version persistence
# --------------------------------------------------------------------------- #


def _get_or_create_version(
    session: Session,
    family: str,
    dataset: DatasetSpec,
    dataset_sources: list[StructuralSource],
    checksum: str,
    *,
    run: IngestionRun,
    now: datetime.datetime,
    is_line: bool,
) -> tuple[StructuralDatasetVersion, bool]:
    existing = session.scalar(
        select(StructuralDatasetVersion).where(
            StructuralDatasetVersion.source_id == SOURCE_ID,
            StructuralDatasetVersion.layer_family == family,
            StructuralDatasetVersion.provider_dataset_identifier
            == dataset.provider_dataset_identifier,
            StructuralDatasetVersion.reference_date == dataset.reference_date,
            StructuralDatasetVersion.source_checksum == checksum,
            StructuralDatasetVersion.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return existing, False
    version = StructuralDatasetVersion(
        source_id=SOURCE_ID,
        provider=dataset.provider,
        provider_dataset_identifier=dataset.provider_dataset_identifier,
        layer_identifier=(dataset.layers[0].layer_identifier if len(dataset.layers) == 1 else None),
        layer_family=family,
        reference_date=dataset.reference_date,
        source_filename=(
            f"{len(dataset_sources)} official source file(s): {dataset.official_dataset_name}"
        ),
        source_checksum=checksum,
        source_crs=(dataset.source_crs or TARGET_CRS),
        target_crs=TARGET_CRS,
        source_geometry_type=None,
        normalized_geometry_type=(
            NORMALIZED_LINE_GEOMETRY_TYPE if is_line else NORMALIZED_GEOMETRY_TYPE
        ),
        transformation_version=TRANSFORMATION_VERSION,
        ingestion_run_id=run.run_id,
        retrieved_at=now,
        total_feature_count=0,
        accepted_feature_count=0,
        rejected_feature_count=0,
        coverage_status="PARTIAL",
        source_files=[],
        coverage_matrix={},
        retrieval_metadata={
            "provider": dataset.provider,
            "official_dataset_name": dataset.official_dataset_name,
            "official_source_url": dataset.official_source_url,
            "coverage_type": dataset.coverage_type,
            "reference_date_evidence": dataset.evidence,
            "source_update_date": dataset.source_update_date,
            "authorization": (
                "prior government-project authorization confirmed by the project owner"
            ),
        },
        created_at=now,
    )
    session.add(version)
    return version, True


def _finalize_version(
    version: StructuralDatasetVersion,
    dataset: DatasetSpec,
    dataset_sources: list[StructuralSource],
    stats_list: list[SourceStats],
    contribution: dict[str, Any],
    writer: _BatchWriter,
    *,
    now: datetime.datetime,
) -> None:
    total = sum(st.received for st in stats_list)
    valid = sum(st.accepted for st in stats_list)
    rejected = sum(st.rejected + st.extra_rejected for st in stats_list)
    # accepted_feature_count reflects the distinct rows actually persisted (after
    # ON CONFLICT dedup), so it reconciles with the row count in PostGIS.
    accepted = writer.inserted
    version.total_feature_count = total
    version.accepted_feature_count = accepted
    version.rejected_feature_count = rejected
    version.source_geometry_type = next(
        (st.source_geometry_type for st in stats_list if st.source_geometry_type), None
    )
    version.coverage_matrix = contribution
    version.source_files = [
        _source_file_entry(s, st) for s, st in zip(dataset_sources, stats_list, strict=True)
    ]
    version.coverage_status = COMPLETE_WITH_FEATURES if accepted > 0 else COMPLETE_ZERO_FEATURES
    meta = dict(version.retrieval_metadata or {})
    meta.update(
        {
            "inserted": writer.inserted,
            "valid_feature_count": valid,
            "duplicate_fingerprints_deduped": max(0, valid - writer.inserted),
            "clipped_from_nationwide": sum(st.clipped_count for st in stats_list),
            "skipped_outside_region": sum(st.skipped_outside_region for st in stats_list),
            "promoted_count": sum(st.promoted for st in stats_list),
        }
    )
    version.retrieval_metadata = meta


# --------------------------------------------------------------------------- #
# No-source + freshness + failure bookkeeping
# --------------------------------------------------------------------------- #


def _no_sources_report(
    job: str,
    family: str,
    manifest: SourceManifest,
    root: Path,
    skipped_files: list[dict[str, Any]],
) -> StructuralIngestionReport:
    required: list[dict[str, Any]] = []
    for dataset in manifest.datasets:
        required.append(
            {
                "dataset_key": dataset.dataset_key,
                "provider": dataset.provider,
                "official_dataset_name": dataset.official_dataset_name,
                "coverage_type": dataset.coverage_type,
                "reference_date": dataset.reference_date.isoformat(),
                "layers": [
                    f"{layer.layer_code} ({layer.official_layer_name})" for layer in dataset.layers
                ],
                "expected_directory": (
                    str(root / _NATIONWIDE_DIR)
                    if dataset.is_nationwide
                    else str(root / "{seoul,incheon,gyeonggi}")
                ),
            }
        )
    return StructuralIngestionReport(
        job=job,
        mode="inspect",
        status="NO_SOURCE_FILES",
        family=family,
        source_path=str(root),
        coverage_status=INCOMPLETE,
        required_sources=required,
        skipped_files=skipped_files,
        next_command=(
            f"PYTHONPATH=ingestion/src:backend/src python -m waste_equity_ingestion.cli {job} "
            f"--source-path {root} --scope capital-region --write"
        ),
        message=(
            f"No official {family} bulk archives matched the manifest. No synthetic or sample "
            "data was substituted."
        ),
    )


def _update_freshness(session: Session, *, reference_period: str, now: datetime.datetime) -> None:
    freshness = session.get(DatasetFreshness, SOURCE_ID)
    if freshness is None:
        session.add(
            DatasetFreshness(
                source_id=SOURCE_ID,
                latest_reference_period=reference_period,
                last_checked_at=now,
                last_changed_at=now,
                last_success_at=now,
                freshness_status="FRESH",
            )
        )
        return
    # Never regress the recorded period: the ``vworld_structural`` freshness row
    # is shared across zoning/protected/road families, so keep the newest ISO
    # reference date seen (ISO dates compare chronologically as strings).
    effective_period = reference_period
    current = freshness.latest_reference_period
    if current and current > reference_period:
        effective_period = current
    if effective_period != current or freshness.freshness_status != "FRESH":
        freshness.last_changed_at = now
    freshness.latest_reference_period = effective_period
    freshness.last_checked_at = now
    freshness.last_success_at = now
    freshness.freshness_status = "FRESH"


def _mark_run_failed(
    session: Session, run_id: int | None, reference_date: str, exc: Exception
) -> None:
    if run_id is None:
        return
    run = session.get(IngestionRun, run_id)
    if run is None:
        return
    run.status = "FAILED"
    run.completed_at = _utcnow()
    run.reference_period = reference_date
    run.transformation_version = TRANSFORMATION_VERSION
    run.error_category = exc.__class__.__name__[:50]
    run.error_message = str(exc)[:1000]
    session.commit()


def protected_feature_count_for_version(session: Session, version_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(StructuralProtectedFeature)
            .where(StructuralProtectedFeature.dataset_version_id == version_id)
        )
        or 0
    )


def line_feature_count_for_version(session: Session, version_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(StructuralLineFeature)
            .where(StructuralLineFeature.dataset_version_id == version_id)
        )
        or 0
    )


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)
