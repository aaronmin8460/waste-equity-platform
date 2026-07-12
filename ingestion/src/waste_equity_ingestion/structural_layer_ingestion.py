"""Generalized production ingestion for protected (polygon) and road (line)
structural layers, reusing the versioned structural schema from Phase 2.5B-1.

Polygon families (``protected``) persist to ``structural_features``; line
families (``roads``) persist to ``structural_line_features`` so line geometry is
never forced into the polygon table. The file inspection, sidecar validation,
CRS reading, checksum, and reprojection logic are shared with the zoning loader;
only the layer registry, geometry family, and target table differ.

Like the zoning loader this is a bulk-file loader: no API key, no fallback to
``data/samples`` or synthetic data. When official archives are absent it reports
exactly which files are required and does not claim success.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import shapefile  # pyshp
from geoalchemy2 import WKTElement
from pyproj import Transformer
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    StructuralDatasetVersion,
    StructuralFeature,
    StructuralLineFeature,
)

from .config import ProbeSettings
from .errors import IngestionError, ProbeError
from .structural_layers import (
    FAMILY_LAYERS,
    FAMILY_PROVIDER,
    LINE,
    NORMALIZED_LINE_GEOMETRY_TYPE,
    StructuralLayerSpec,
    layer_for_name,
    normalize_line_geometry,
)
from .vworld_zoning_contract import (
    NORMALIZED_GEOMETRY_TYPE,
    SOURCE_ID,
    TARGET_CRS,
    TARGET_REGIONS,
    TARGET_SRID,
    TargetRegion,
    combined_checksum,
    feature_fingerprint,
    normalize_polygonal_geometry,
    require_supported_source_crs,
)
from .vworld_zoning_ingestion import (
    SidecarValidationError,  # noqa: F401 - re-exported for callers/tests
    _extract_zip_shapefiles,
    _provider_feature_id,
    _read_prj_epsg,
    _sha256_file,
    validate_shapefile_sidecars,
)

TRANSFORMATION_VERSION = "vworld-structural-v1"
SUPPORTED_FAMILIES = ("protected", "roads")


@dataclass(frozen=True)
class StructuralSource:
    shp_path: Path
    region: TargetRegion
    layer: StructuralLayerSpec
    origin_filename: str
    checksum: str


@dataclass
class StructuralFeatureRow:
    layer_identifier: str
    category: str
    layer_code: str
    layer_name: str
    provider_feature_id: str | None
    target_region_code: str
    target_region_name: str
    source_attributes: dict[str, Any]
    geometry_wkt: str
    feature_fingerprint: str
    source_provenance: dict[str, Any]


@dataclass
class StructuralLoadResult:
    family: str
    geometry_family: str
    features: list[StructuralFeatureRow] = field(default_factory=list)
    total_feature_count: int = 0
    accepted_feature_count: int = 0
    rejected_feature_count: int = 0
    promoted_count: int = 0
    source_files: list[dict[str, Any]] = field(default_factory=list)
    coverage_matrix: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    regions_evaluated: list[str] = field(default_factory=list)
    source_crs_by_region: dict[str, str] = field(default_factory=dict)
    reference_date: str | None = None
    combined_checksum: str | None = None
    coverage_status: str = "INCOMPLETE"


@dataclass
class StructuralIngestionReport:
    job: str
    mode: str
    status: str
    family: str
    reference_date: str | None
    source_path: str | None = None
    total_feature_count: int = 0
    accepted_feature_count: int = 0
    rejected_feature_count: int = 0
    promoted_count: int = 0
    features_inserted: int = 0
    features_skipped_existing: int = 0
    dataset_version_id: int | None = None
    dataset_version_created: bool = False
    ingestion_run_id: int | None = None
    coverage_status: str = "INCOMPLETE"
    regions_evaluated: list[str] = field(default_factory=list)
    coverage_matrix: dict[str, Any] = field(default_factory=dict)
    source_crs_by_region: dict[str, str] = field(default_factory=dict)
    source_files: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    required_sources: list[dict[str, Any]] = field(default_factory=list)
    next_command: str | None = None
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "job": self.job,
            "mode": self.mode,
            "status": self.status,
            "family": self.family,
            "reference_date": self.reference_date,
            "target_crs": TARGET_CRS,
            "total_feature_count": self.total_feature_count,
            "accepted_feature_count": self.accepted_feature_count,
            "rejected_feature_count": self.rejected_feature_count,
            "promoted_count": self.promoted_count,
            "features_inserted": self.features_inserted,
            "features_skipped_existing": self.features_skipped_existing,
            "dataset_version_id": self.dataset_version_id,
            "dataset_version_created": self.dataset_version_created,
            "ingestion_run_id": self.ingestion_run_id,
            "coverage_status": self.coverage_status,
            "regions_evaluated": self.regions_evaluated,
            "source_crs_by_region": self.source_crs_by_region,
            "coverage_matrix": self.coverage_matrix,
            "source_files": self.source_files,
            "warnings": self.warnings,
            "required_sources": self.required_sources,
            "next_command": self.next_command,
            "message": self.message,
        }


def _discover_region_sources(
    family: str, region_dir: Path, region: TargetRegion, tmp_root: Path
) -> list[StructuralSource]:
    sources: list[StructuralSource] = []
    seen: set[str] = set()
    for zip_path in sorted(region_dir.glob("*.zip")):
        layer = layer_for_name(family, zip_path.stem)
        extract_dir = tmp_root / f"{family}_{region.dir_name}_{zip_path.stem}"
        extract_dir.mkdir(parents=True, exist_ok=True)
        for shp_path in _extract_zip_shapefiles(zip_path, extract_dir):
            spec = layer or layer_for_name(family, shp_path.stem)
            if spec is None:
                continue
            validate_shapefile_sidecars(shp_path)
            sources.append(
                StructuralSource(shp_path, region, spec, zip_path.name, _sha256_file(zip_path))
            )
            seen.add(spec.layer_code)
    for shp_path in sorted(
        p for p in region_dir.rglob("*") if p.is_file() and p.suffix.lower() == ".shp"
    ):
        spec = layer_for_name(family, shp_path.stem)
        if spec is None or spec.layer_code in seen:
            continue
        validate_shapefile_sidecars(shp_path)
        sources.append(
            StructuralSource(shp_path, region, spec, shp_path.name, _sha256_file(shp_path))
        )
        seen.add(spec.layer_code)
    return sources


def _load_source(
    source: StructuralSource, result: StructuralLoadResult, *, encoding: str
) -> tuple[int, int, str]:
    source_epsg = _read_prj_epsg(source.shp_path)
    source_crs = require_supported_source_crs(source_epsg)
    transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)

    def _project(x: float, y: float, z: float | None = None) -> tuple[float, float]:
        lon, lat = transformer.transform(x, y)
        return lon, lat

    reader = shapefile.Reader(str(source.shp_path), encoding=encoding, encodingErrors="strict")
    accepted = 0
    rejected = 0
    count = len(reader)
    geom_type_reported: str | None = None
    is_line = source.layer.geometry_family == LINE

    for index in range(count):
        try:
            record = reader.record(index)
        except (UnicodeDecodeError, shapefile.ShapefileException):
            rejected += 1
            result.warnings.append(
                f"{source.origin_filename}[{index}]: undecodable attribute under "
                f"encoding {encoding}; record rejected"
            )
            continue
        attributes = {key.lower(): value for key, value in record.as_dict().items()}
        try:
            raw_geom = shapely_shape(reader.shape(index).__geo_interface__)
        except Exception:  # noqa: BLE001 - malformed geometry is reported, not fatal
            rejected += 1
            result.warnings.append(f"{source.origin_filename}[{index}]: unreadable geometry")
            continue
        if geom_type_reported is None:
            geom_type_reported = raw_geom.geom_type
        projected = shapely_transform(_project, raw_geom)
        normalized: BaseGeometry
        promoted: bool
        try:
            if is_line:
                normalized, promoted = normalize_line_geometry(projected)
            else:
                normalized, promoted = normalize_polygonal_geometry(projected)
        except IngestionError as exc:
            rejected += 1
            result.warnings.append(f"{source.origin_filename}[{index}]: {exc}")
            continue
        if promoted:
            result.promoted_count += 1
        fingerprint = feature_fingerprint(
            normalized,
            layer_code=source.layer.layer_code,
            target_region_code=source.region.sido_code,
            source_attributes=attributes,
        )
        result.features.append(
            StructuralFeatureRow(
                layer_identifier=source.layer.layer_identifier,
                category=source.layer.category,
                layer_code=source.layer.layer_code,
                layer_name=source.layer.korean_name,
                provider_feature_id=_provider_feature_id(attributes),
                target_region_code=source.region.sido_code,
                target_region_name=source.region.sido_name,
                source_attributes=attributes,
                geometry_wkt=normalized.wkt,
                feature_fingerprint=fingerprint,
                source_provenance={
                    "origin_filename": source.origin_filename,
                    "region": source.region.dir_name,
                    "source_crs": source_crs,
                    "target_crs": TARGET_CRS,
                    "checksum": source.checksum,
                },
            )
        )
        accepted += 1

    result.source_files.append(
        {
            "origin_filename": source.origin_filename,
            "layer": source.layer.layer_code,
            "layer_identifier": source.layer.layer_identifier,
            "region": source.region.dir_name,
            "checksum": source.checksum,
            "source_crs": source_crs,
            "target_crs": TARGET_CRS,
            "source_geometry_type": geom_type_reported,
            "features_received": count,
            "features_accepted": accepted,
            "features_rejected": rejected,
        }
    )
    return accepted, rejected, source_crs


def build_load_result(
    family: str,
    sources: list[StructuralSource],
    *,
    present_region_dirs: set[str],
    reference_date: str,
    encoding: str,
) -> StructuralLoadResult:
    geometry_family = LINE if family == "roads" else "POLYGON"
    result = StructuralLoadResult(
        family=family, geometry_family=geometry_family, reference_date=reference_date
    )
    per_cell: dict[tuple[str, str], dict[str, Any]] = {}
    failed_cells: set[tuple[str, str]] = set()
    sources_by_cell: dict[tuple[str, str], StructuralSource] = {
        (s.region.dir_name, s.layer.layer_code): s for s in sources
    }

    checksums: list[str] = []
    for source in sources:
        cell = (source.region.dir_name, source.layer.layer_code)
        try:
            accepted, rejected, source_crs = _load_source(source, result, encoding=encoding)
        except IngestionError as exc:
            failed_cells.add(cell)
            per_cell[cell] = {"accepted": 0, "rejected": 0, "failed": True}
            result.warnings.append(f"{source.origin_filename}: {exc}")
            continue
        per_cell[cell] = {"accepted": accepted, "rejected": rejected, "failed": False}
        result.source_crs_by_region.setdefault(source.region.dir_name, source_crs)
        checksums.append(source.checksum)

    layers = FAMILY_LAYERS[family]
    matrix: dict[str, Any] = {}
    regions_evaluated: list[str] = []
    for region in TARGET_REGIONS:
        region_present = region.dir_name in present_region_dirs
        evaluated = any(
            (region.dir_name, layer.layer_code) in per_cell
            and (region.dir_name, layer.layer_code) not in failed_cells
            for layer in layers
        )
        if evaluated:
            regions_evaluated.append(region.dir_name)
        layer_cells: dict[str, Any] = {}
        for layer in layers:
            cell = (region.dir_name, layer.layer_code)
            data = per_cell.get(cell)
            if not (region_present and cell in sources_by_cell):
                status = "SOURCE_MISSING"
                fc = 0
            elif cell in failed_cells:
                status = "VALIDATION_FAILURE"
                fc = 0
            elif data and data["accepted"] > 0:
                status = "COMPLETE_WITH_FEATURES"
                fc = data["accepted"]
            else:
                status = "COMPLETE_ZERO_FEATURES"
                fc = 0
            layer_cells[layer.layer_code] = {
                "status": status,
                "feature_count": fc,
                "mandatory": layer.mandatory,
            }
        matrix[region.dir_name] = {
            "region_code": region.sido_code,
            "region_name": region.sido_name,
            "region_present": region_present,
            "region_evaluated": evaluated,
            "layers": layer_cells,
        }

    result.coverage_matrix = matrix
    result.regions_evaluated = regions_evaluated
    result.total_feature_count = sum(c["accepted"] + c["rejected"] for c in per_cell.values())
    result.accepted_feature_count = sum(c["accepted"] for c in per_cell.values())
    result.rejected_feature_count = sum(c["rejected"] for c in per_cell.values())
    result.combined_checksum = combined_checksum(checksums) if checksums else None
    if len(regions_evaluated) == len(TARGET_REGIONS) and not failed_cells:
        result.coverage_status = "COMPLETE"
    elif regions_evaluated:
        result.coverage_status = "PARTIAL"
    else:
        result.coverage_status = "INCOMPLETE"
    return result


def _required_sources(family: str, source_path: Path) -> list[dict[str, Any]]:
    layers = FAMILY_LAYERS[family]
    return [
        {
            "region": region.dir_name,
            "sido": region.sido_name,
            "layers": [
                f"{s.layer_code} ({s.korean_name}){'' if s.mandatory else ' [optional]'}"
                for s in layers
            ],
            "expected_directory": str(source_path / region.dir_name),
            "accepted_formats": "official ZIP archive or extracted .shp/.shx/.dbf/.prj set",
        }
        for region in TARGET_REGIONS
    ]


def run_structural_ingestion(
    settings: ProbeSettings,  # noqa: ARG001 - CLI signature parity; no API key needed
    *,
    family: str,
    source_path: str,
    reference_date: str,
    scope: str,
    write: bool,
    encoding: str = "cp949",
) -> StructuralIngestionReport:
    if family not in SUPPORTED_FAMILIES:
        raise IngestionError(f"Unsupported structural family '{family}'")
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented")
    _parse_reference_date(reference_date)
    root = Path(source_path)
    if not root.exists():
        raise IngestionError(f"Source path does not exist: {source_path}")
    job = f"vworld-{family}-ingest"

    present: set[str] = set()
    with TemporaryDirectory(prefix=f"vworld-{family}-") as tmp_name:
        tmp_root = Path(tmp_name)
        all_sources: list[StructuralSource] = []
        for region in TARGET_REGIONS:
            region_dir = root / region.dir_name
            if region_dir.is_dir():
                present.add(region.dir_name)
                all_sources.extend(_discover_region_sources(family, region_dir, region, tmp_root))

        if not all_sources:
            return StructuralIngestionReport(
                job=job,
                mode="inspect",
                status="NO_SOURCE_FILES",
                family=family,
                reference_date=reference_date,
                source_path=str(root),
                coverage_status="INCOMPLETE",
                required_sources=_required_sources(family, root),
                next_command=(
                    f"PYTHONPATH=src:../backend/src python -m waste_equity_ingestion.cli {job} "
                    f"--source-path {root} --reference-date {reference_date} "
                    "--scope capital-region --write"
                ),
                message=(
                    f"No official {family} bulk archives were found. No synthetic or sample "
                    "data was substituted. Place the official archives in the per-region "
                    "directories under required_sources, then run next_command."
                ),
            )

        load = build_load_result(
            family,
            all_sources,
            present_region_dirs=present,
            reference_date=reference_date,
            encoding=encoding,
        )
        if not write:
            return StructuralIngestionReport(
                job=job,
                mode="dry-run",
                status="VALIDATED",
                family=family,
                reference_date=reference_date,
                source_path=str(root),
                total_feature_count=load.total_feature_count,
                accepted_feature_count=load.accepted_feature_count,
                rejected_feature_count=load.rejected_feature_count,
                promoted_count=load.promoted_count,
                coverage_status=load.coverage_status,
                regions_evaluated=load.regions_evaluated,
                coverage_matrix=load.coverage_matrix,
                source_crs_by_region=load.source_crs_by_region,
                source_files=load.source_files,
                warnings=load.warnings,
                message=f"Official {family} sources validated; no database writes performed.",
            )
        return _write_result(job, family, load, source_path=root, reference_date=reference_date)


def _write_result(
    job: str,
    family: str,
    load: StructuralLoadResult,
    *,
    source_path: Path,
    reference_date: str,
) -> StructuralIngestionReport:
    session_factory = get_sessionmaker()
    session = session_factory()
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=_utcnow(),
        status="RUNNING",
        rows_received=load.total_feature_count,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=load.rejected_feature_count,
        reference_period=reference_date,
        transformation_version=TRANSFORMATION_VERSION,
    )
    try:
        session.add(run)
        session.commit()
        session.refresh(run)
        report = _write_bundle(session, job, family, load, run=run, reference_date=reference_date)
        session.commit()
        report.source_path = str(source_path)
        return report
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run.run_id, reference_date, exc)
        if isinstance(exc, ProbeError):
            raise
        raise IngestionError(
            f"{family} ingestion failed; normalized writes were rolled back"
        ) from exc
    finally:
        session.close()


def _write_bundle(
    session: Session,
    job: str,
    family: str,
    load: StructuralLoadResult,
    *,
    run: IngestionRun,
    reference_date: str,
) -> StructuralIngestionReport:
    now = _utcnow()
    version, created = _get_or_create_version(
        session, family, load, run=run, reference_date=reference_date, now=now
    )
    session.flush()

    inserted = 0
    skipped = 0
    seen: set[str] = set()
    is_line = load.geometry_family == LINE
    for feature in load.features:
        if _insert_feature(
            session, feature, version_id=version.id, now=now, seen=seen, is_line=is_line
        ):
            inserted += 1
            seen.add(feature.feature_fingerprint)
        else:
            skipped += 1

    _update_freshness(session, reference_period=reference_date, now=now)
    run.status = "SUCCEEDED"
    run.completed_at = now
    run.rows_inserted = inserted
    run.rows_rejected = load.rejected_feature_count

    return StructuralIngestionReport(
        job=job,
        mode="write",
        status="SUCCEEDED",
        family=family,
        reference_date=reference_date,
        total_feature_count=load.total_feature_count,
        accepted_feature_count=load.accepted_feature_count,
        rejected_feature_count=load.rejected_feature_count,
        promoted_count=load.promoted_count,
        features_inserted=inserted,
        features_skipped_existing=skipped,
        dataset_version_id=version.id,
        dataset_version_created=created,
        ingestion_run_id=run.run_id,
        coverage_status=load.coverage_status,
        regions_evaluated=load.regions_evaluated,
        coverage_matrix=load.coverage_matrix,
        source_crs_by_region=load.source_crs_by_region,
        source_files=load.source_files,
        warnings=load.warnings,
        message=(
            f"VWorld {family} ingestion succeeded."
            if created
            else f"VWorld {family} ingestion re-ran; dataset version already present (idempotent)."
        ),
    )


def _get_or_create_version(
    session: Session,
    family: str,
    load: StructuralLoadResult,
    *,
    run: IngestionRun,
    reference_date: str,
    now: datetime.datetime,
) -> tuple[StructuralDatasetVersion, bool]:
    checksum = load.combined_checksum or ""
    ref_date = _parse_reference_date(reference_date)
    provider, provider_dataset = FAMILY_PROVIDER[family]
    source_crs = next(iter(load.source_crs_by_region.values()), TARGET_CRS)
    existing = session.scalar(
        select(StructuralDatasetVersion).where(
            StructuralDatasetVersion.source_id == SOURCE_ID,
            StructuralDatasetVersion.layer_family == family,
            StructuralDatasetVersion.provider_dataset_identifier == provider_dataset,
            StructuralDatasetVersion.reference_date == ref_date,
            StructuralDatasetVersion.source_checksum == checksum,
            StructuralDatasetVersion.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return existing, False
    normalized_geom = (
        NORMALIZED_LINE_GEOMETRY_TYPE if load.geometry_family == LINE else NORMALIZED_GEOMETRY_TYPE
    )
    version = StructuralDatasetVersion(
        source_id=SOURCE_ID,
        provider=provider,
        provider_dataset_identifier=provider_dataset,
        layer_identifier=None,
        layer_family=family,
        reference_date=ref_date,
        source_filename=f"{len(load.source_files)} official source file(s)",
        source_checksum=checksum,
        source_crs=source_crs,
        target_crs=TARGET_CRS,
        source_geometry_type=_dominant_geom_type(load),
        normalized_geometry_type=normalized_geom,
        transformation_version=TRANSFORMATION_VERSION,
        ingestion_run_id=run.run_id,
        retrieved_at=now,
        total_feature_count=load.total_feature_count,
        accepted_feature_count=load.accepted_feature_count,
        rejected_feature_count=load.rejected_feature_count,
        coverage_status=load.coverage_status,
        source_files=load.source_files,
        coverage_matrix=load.coverage_matrix,
        retrieval_metadata={
            "provider": provider,
            "regions_evaluated": load.regions_evaluated,
            "source_crs_by_region": load.source_crs_by_region,
            "promoted_count": load.promoted_count,
            "authorization": (
                "prior government-project authorization confirmed by the project owner"
            ),
        },
        created_at=now,
    )
    session.add(version)
    return version, True


def _insert_feature(
    session: Session,
    feature: StructuralFeatureRow,
    *,
    version_id: int,
    now: datetime.datetime,
    seen: set[str],
    is_line: bool,
) -> bool:
    if feature.feature_fingerprint in seen:
        return False
    if is_line:
        existing = session.scalar(
            select(StructuralLineFeature.id).where(
                StructuralLineFeature.dataset_version_id == version_id,
                StructuralLineFeature.feature_fingerprint == feature.feature_fingerprint,
            )
        )
        if existing is not None:
            return False
        session.add(
            StructuralLineFeature(
                dataset_version_id=version_id,
                layer_identifier=feature.layer_identifier,
                provider_feature_id=feature.provider_feature_id,
                layer_category=feature.category,
                official_layer_code=feature.layer_code,
                official_layer_name=feature.layer_name,
                target_region_code=feature.target_region_code,
                target_region_name=feature.target_region_name,
                source_attributes=feature.source_attributes,
                geometry=WKTElement(feature.geometry_wkt, srid=TARGET_SRID),
                feature_fingerprint=feature.feature_fingerprint,
                source_provenance=feature.source_provenance,
                created_at=now,
                ingested_at=now,
            )
        )
        return True
    existing = session.scalar(
        select(StructuralFeature.id).where(
            StructuralFeature.dataset_version_id == version_id,
            StructuralFeature.feature_fingerprint == feature.feature_fingerprint,
        )
    )
    if existing is not None:
        return False
    session.add(
        StructuralFeature(
            dataset_version_id=version_id,
            layer_identifier=feature.layer_identifier,
            provider_feature_id=feature.provider_feature_id,
            zoning_category=feature.category,
            official_zoning_code=feature.layer_code,
            official_zoning_name=feature.layer_name,
            target_region_code=feature.target_region_code,
            target_region_name=feature.target_region_name,
            source_attributes=feature.source_attributes,
            geometry=WKTElement(feature.geometry_wkt, srid=TARGET_SRID),
            feature_fingerprint=feature.feature_fingerprint,
            source_provenance=feature.source_provenance,
            created_at=now,
            ingested_at=now,
        )
    )
    return True


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
    if (
        freshness.latest_reference_period != reference_period
        or freshness.freshness_status != "FRESH"
    ):
        freshness.last_changed_at = now
    freshness.latest_reference_period = reference_period
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


def _dominant_geom_type(load: StructuralLoadResult) -> str | None:
    for entry in load.source_files:
        value = entry.get("source_geometry_type")
        if value:
            return str(value)
    return None


def line_feature_count_for_version(session: Session, version_id: int) -> int:
    return int(
        session.scalar(
            select(func.count())
            .select_from(StructuralLineFeature)
            .where(StructuralLineFeature.dataset_version_id == version_id)
        )
        or 0
    )


def _parse_reference_date(value: str) -> datetime.date:
    try:
        return datetime.date.fromisoformat(value)
    except ValueError as exc:
        raise IngestionError(f"--reference-date must be YYYY-MM-DD, got '{value}'") from exc


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)
