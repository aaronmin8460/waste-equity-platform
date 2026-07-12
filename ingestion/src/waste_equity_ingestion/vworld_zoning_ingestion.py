"""One-shot production ingestion of VWorld 용도지역 (zoning) bulk files.

Reads official bulk shapefiles (ZIP archives or extracted shapefile
directories) for UQ111–UQ114 from Git-ignored local directories, validates
sidecars, decodes Korean attributes explicitly, reads and validates the source
CRS, transforms geometry to EPSG:4326, classifies per-region/per-layer
coverage, and persists versioned structural features. Source files are never
committed; only normalized features, provenance, and checksums are stored.

No API key is required: this is a bulk-file loader. It never falls back to
``data/samples`` probe files or any synthetic data.
"""

from __future__ import annotations

import datetime
import hashlib
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import shapefile  # pyshp
from geoalchemy2 import WKTElement
from pyproj import Transformer
from shapely.geometry import shape as shapely_shape
from shapely.ops import transform as shapely_transform
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    StructuralDatasetVersion,
    StructuralFeature,
)

from .config import ProbeSettings
from .errors import IngestionError, ProbeError
from .vworld_zoning_contract import (
    DEFAULT_SOURCE_ENCODING,
    LAYER_FAMILY,
    NORMALIZED_GEOMETRY_TYPE,
    PROVIDER,
    PROVIDER_DATASET_IDENTIFIER,
    SOURCE_ID,
    TARGET_CRS,
    TARGET_REGIONS,
    TARGET_SRID,
    TRANSFORMATION_VERSION,
    ZONING_LAYERS,
    GeometryValidationError,
    TargetRegion,
    ZoningFeature,
    ZoningLayerSpec,
    ZoningLoadResult,
    classify_region_layer,
    combined_checksum,
    epsg_from_prj,
    feature_fingerprint,
    load_availability_manifest,
    normalize_polygonal_geometry,
    require_supported_source_crs,
    validate_required_attributes,
    zoning_layer_for_name,
)

# Sidecar components a shapefile must ship for a valid, CRS-tagged load.
REQUIRED_SIDECAR_SUFFIXES: tuple[str, ...] = (".shp", ".shx", ".dbf", ".prj")


class SidecarValidationError(IngestionError):
    """Raised when a shapefile is missing a required sidecar component."""


class SourceLayoutError(IngestionError):
    """Raised when an archive/directory layout is not a supported shapefile set."""


@dataclass(frozen=True)
class ShapefileSource:
    """A single resolved zoning shapefile ready to read."""

    shp_path: Path
    region: TargetRegion
    layer: ZoningLayerSpec
    origin_filename: str  # archive name or shapefile base name (no local path)
    checksum: str


@dataclass
class ZoningIngestionReport:
    mode: str
    status: str
    reference_date: str | None
    source_path: str | None = None
    total_feature_count: int = 0
    accepted_feature_count: int = 0
    rejected_feature_count: int = 0
    polygon_promoted_count: int = 0
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
            "job": "vworld-zoning-ingest",
            "mode": self.mode,
            "status": self.status,
            "reference_date": self.reference_date,
            "target_crs": TARGET_CRS,
            "total_feature_count": self.total_feature_count,
            "accepted_feature_count": self.accepted_feature_count,
            "rejected_feature_count": self.rejected_feature_count,
            "polygon_promoted_count": self.polygon_promoted_count,
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


# --------------------------------------------------------------------------- #
# Source discovery and shapefile inspection
# --------------------------------------------------------------------------- #


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sidecar_map(shp_path: Path) -> dict[str, Path]:
    """Case-insensitive suffix -> path map for files sharing the base name."""

    stem = shp_path.stem
    found: dict[str, Path] = {}
    for sibling in shp_path.parent.iterdir():
        if sibling.stem == stem and sibling.is_file():
            found[sibling.suffix.lower()] = sibling
    return found


def validate_shapefile_sidecars(shp_path: Path) -> None:
    """Ensure a shapefile ships all required sidecars, else raise."""

    present = _sidecar_map(shp_path)
    missing = [suffix for suffix in REQUIRED_SIDECAR_SUFFIXES if suffix not in present]
    if missing:
        raise SidecarValidationError(
            f"Shapefile '{shp_path.name}' is missing required sidecar(s): " + ", ".join(missing)
        )


def _find_shapefiles(directory: Path) -> list[Path]:
    """Return .shp files directly or nested within a directory."""

    return sorted(p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() == ".shp")


def _extract_zip_shapefiles(zip_path: Path, dest: Path) -> list[Path]:
    """Extract a ZIP's shapefile sets to ``dest`` and return the .shp paths.

    Rejects an archive that contains no shapefile. Only the standard shapefile
    sidecar files are extracted; unrelated members are ignored.
    """

    with zipfile.ZipFile(zip_path) as archive:
        names = archive.namelist()
        shp_members = [n for n in names if n.lower().endswith(".shp")]
        if not shp_members:
            raise SourceLayoutError(
                f"Archive '{zip_path.name}' contains no .shp file; not a shapefile archive."
            )
        for member in names:
            suffix = Path(member).suffix.lower()
            if suffix in {".shp", ".shx", ".dbf", ".prj", ".cpg"}:
                # Flatten to avoid absolute/relative traversal; keep base name.
                target = dest / Path(member).name
                with archive.open(member) as src, target.open("wb") as out:
                    out.write(src.read())
    return sorted(dest.glob("*.shp"))


def discover_region_sources(
    region_dir: Path,
    region: TargetRegion,
    tmp_root: Path,
) -> list[ShapefileSource]:
    """Discover zoning shapefiles for one region (ZIPs and extracted dirs).

    ZIP archives are checksummed as the archive file; extracted-directory
    shapefiles are checksummed as the .shp file. Non-zoning shapefiles are
    skipped. Sidecar completeness is validated before a source is accepted.
    """

    sources: list[ShapefileSource] = []
    seen_layers: set[str] = set()

    # ZIP archives first.
    for zip_path in sorted(region_dir.glob("*.zip")):
        layer = zoning_layer_for_name(zip_path.stem)
        extract_dir = tmp_root / f"{region.dir_name}_{zip_path.stem}"
        extract_dir.mkdir(parents=True, exist_ok=True)
        shp_paths = _extract_zip_shapefiles(zip_path, extract_dir)
        checksum = _sha256_file(zip_path)
        for shp_path in shp_paths:
            spec = layer or zoning_layer_for_name(shp_path.stem)
            if spec is None:
                continue
            validate_shapefile_sidecars(shp_path)
            sources.append(
                ShapefileSource(
                    shp_path=shp_path,
                    region=region,
                    layer=spec,
                    origin_filename=zip_path.name,
                    checksum=checksum,
                )
            )
            seen_layers.add(spec.layer_code)

    # Extracted shapefile directories / loose shapefiles.
    for shp_path in _find_shapefiles(region_dir):
        spec = zoning_layer_for_name(shp_path.stem)
        if spec is None or spec.layer_code in seen_layers:
            continue
        validate_shapefile_sidecars(shp_path)
        sources.append(
            ShapefileSource(
                shp_path=shp_path,
                region=region,
                layer=spec,
                origin_filename=shp_path.name,
                checksum=_sha256_file(shp_path),
            )
        )
        seen_layers.add(spec.layer_code)

    return sources


# --------------------------------------------------------------------------- #
# Reading, CRS, geometry
# --------------------------------------------------------------------------- #


def _read_prj_epsg(shp_path: Path) -> int | None:
    prj = _sidecar_map(shp_path).get(".prj")
    if prj is None:
        return None
    return epsg_from_prj(prj.read_text(encoding="utf-8", errors="ignore"))


def _load_source(
    source: ShapefileSource,
    result: ZoningLoadResult,
    *,
    encoding: str,
) -> tuple[int, int, str]:
    """Read one shapefile source, appending accepted features to ``result``.

    Returns ``(accepted, rejected, source_crs)`` for this source. Raises for a
    missing/unsupported CRS (a whole-source failure); per-record geometry or
    decode problems are counted and reported, not fatal.
    """

    source_epsg = _read_prj_epsg(source.shp_path)
    source_crs = require_supported_source_crs(source_epsg)
    transformer = Transformer.from_crs(source_crs, TARGET_CRS, always_xy=True)

    def _project(x: float, y: float, z: float | None = None) -> tuple[float, float]:
        lon, lat = transformer.transform(x, y)
        return lon, lat

    reader = shapefile.Reader(str(source.shp_path), encoding=encoding, encodingErrors="strict")
    accepted = 0
    rejected = 0
    try:
        count = len(reader)
    finally:
        pass
    geom_type_reported: str | None = None

    for index in range(count):
        # Decode attributes explicitly; never silently replace undecodable text.
        # pyshp raises ShapefileException (dbfFileException) on a strict decode
        # failure; both that and UnicodeDecodeError mean "do not guess".
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
        missing = validate_required_attributes(attributes)
        if missing:
            rejected += 1
            result.warnings.append(
                f"{source.origin_filename}[{index}]: missing required attribute(s) "
                + ", ".join(missing)
            )
            continue

        try:
            raw_geom = shapely_shape(reader.shape(index).__geo_interface__)
        except Exception:  # noqa: BLE001 - malformed record geometry is reported, not fatal
            rejected += 1
            result.warnings.append(f"{source.origin_filename}[{index}]: unreadable geometry")
            continue

        if geom_type_reported is None:
            geom_type_reported = raw_geom.geom_type

        projected = shapely_transform(_project, raw_geom)
        try:
            multipolygon, promoted = normalize_polygonal_geometry(projected)
        except GeometryValidationError as exc:
            rejected += 1
            result.warnings.append(f"{source.origin_filename}[{index}]: {exc}")
            continue

        if promoted:
            result.polygon_promoted_count += 1

        provider_feature_id = _provider_feature_id(attributes)
        fingerprint = feature_fingerprint(
            multipolygon,
            layer_code=source.layer.layer_code,
            target_region_code=source.region.sido_code,
            source_attributes=attributes,
        )
        result.features.append(
            ZoningFeature(
                layer_identifier=source.layer.layer_identifier,
                zoning_category=source.layer.zoning_category,
                official_zoning_code=source.layer.layer_code,
                official_zoning_name=source.layer.zoning_name,
                provider_feature_id=provider_feature_id,
                target_region_code=source.region.sido_code,
                target_region_name=source.region.sido_name,
                source_attributes=attributes,
                geometry_wkt=multipolygon.wkt,
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


def _provider_feature_id(attributes: dict[str, Any]) -> str | None:
    for key in ("id", "mnum", "ufid", "gid"):
        value = attributes.get(key)
        if value is not None and str(value).strip():
            return str(value)
    return None


# --------------------------------------------------------------------------- #
# Coverage
# --------------------------------------------------------------------------- #


def build_load_result(
    sources: list[ShapefileSource],
    *,
    present_region_dirs: set[str],
    reference_date: str,
    encoding: str,
    availability: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> ZoningLoadResult:
    """Validate/normalize all sources and build the coverage matrix.

    ``availability`` is the optional official-source manifest map
    ``{(region, layer): {status, evidence}}``; a missing cell that the manifest
    marks ``OFFICIAL_SOURCE_UNAVAILABLE`` is classified as such rather than
    ``SOURCE_MISSING``.
    """

    availability = availability or {}
    result = ZoningLoadResult(reference_date=reference_date)
    per_cell: dict[tuple[str, str], dict[str, Any]] = {}
    failed_cells: set[tuple[str, str]] = set()
    sources_by_cell: dict[tuple[str, str], ShapefileSource] = {}

    for source in sources:
        sources_by_cell[(source.region.dir_name, source.layer.layer_code)] = source

    all_checksums: list[str] = []
    for source in sources:
        cell = (source.region.dir_name, source.layer.layer_code)
        try:
            accepted, rejected, source_crs = _load_source(source, result, encoding=encoding)
        except IngestionError as exc:
            failed_cells.add(cell)
            result.warnings.append(f"{source.origin_filename}: {exc}")
            per_cell[cell] = {"accepted": 0, "rejected": 0, "failed": True}
            continue
        per_cell[cell] = {"accepted": accepted, "rejected": rejected, "failed": False}
        result.source_crs_by_region.setdefault(source.region.dir_name, source_crs)
        all_checksums.append(source.checksum)

    # Region-by-layer completeness matrix over all three target 시도.
    matrix: dict[str, dict[str, Any]] = {}
    regions_evaluated: list[str] = []
    for region in TARGET_REGIONS:
        region_present = region.dir_name in present_region_dirs
        region_evaluated = any(
            (region.dir_name, layer.layer_code) in per_cell
            and not failed_cells.__contains__((region.dir_name, layer.layer_code))
            for layer in ZONING_LAYERS
        )
        if region_evaluated:
            regions_evaluated.append(region.dir_name)
        layer_cells: dict[str, Any] = {}
        for layer in ZONING_LAYERS:
            cell = (region.dir_name, layer.layer_code)
            cell_data = per_cell.get(cell)
            manifest_entry = availability.get(cell, {})
            official_unavailable = manifest_entry.get("status") == "OFFICIAL_SOURCE_UNAVAILABLE"
            coverage = classify_region_layer(
                source_present=region_present and cell in sources_by_cell,
                validation_failed=cell in failed_cells,
                feature_count=(cell_data or {}).get("accepted", 0),
                evaluated=cell in per_cell and cell not in failed_cells,
                official_unavailable=official_unavailable,
            )
            layer_cells[layer.layer_code] = {
                "status": coverage.status,
                "feature_count": coverage.feature_count,
            }
            if coverage.status == "OFFICIAL_SOURCE_UNAVAILABLE" and manifest_entry.get("evidence"):
                layer_cells[layer.layer_code]["evidence"] = manifest_entry["evidence"]
        matrix[region.dir_name] = {
            "region_code": region.sido_code,
            "region_name": region.sido_name,
            "region_present": region_present,
            "region_evaluated": region_evaluated,
            "layers": layer_cells,
        }

    result.coverage_matrix = matrix
    result.regions_evaluated = regions_evaluated
    result.total_feature_count = sum(c["accepted"] + c["rejected"] for c in per_cell.values())
    result.accepted_feature_count = sum(c["accepted"] for c in per_cell.values())
    result.rejected_feature_count = sum(c["rejected"] for c in per_cell.values())
    result.combined_checksum = combined_checksum(all_checksums) if all_checksums else None

    # Count undocumented gaps (SOURCE_MISSING) vs documented-unavailable cells.
    unexpected_missing = 0
    documented_unavailable = 0
    for region_entry in matrix.values():
        for cell in region_entry["layers"].values():
            if cell["status"] == "SOURCE_MISSING":
                unexpected_missing += 1
            elif cell["status"] == "OFFICIAL_SOURCE_UNAVAILABLE":
                documented_unavailable += 1

    evaluated_count = len(regions_evaluated)
    if evaluated_count == len(TARGET_REGIONS) and not failed_cells and unexpected_missing == 0:
        # Every target region evaluated, every present file validated, and every
        # gap is an officially-unavailable source documented in the manifest.
        result.coverage_status = (
            "COMPLETE_FOR_AVAILABLE_SOURCES" if documented_unavailable else "COMPLETE"
        )
    elif evaluated_count > 0:
        result.coverage_status = "PARTIAL"
    else:
        result.coverage_status = "INCOMPLETE"
    return result


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def _required_sources(source_path: Path) -> list[dict[str, Any]]:
    required: list[dict[str, Any]] = []
    for region in TARGET_REGIONS:
        required.append(
            {
                "region": region.dir_name,
                "sido": region.sido_name,
                "layers": [f"{s.layer_code} ({s.zoning_name})" for s in ZONING_LAYERS],
                "expected_directory": str(source_path / region.dir_name),
                "accepted_formats": "official ZIP archive or extracted .shp/.shx/.dbf/.prj set",
            }
        )
    return required


def _next_command(source_path: Path, reference_date: str) -> str:
    return (
        "PYTHONPATH=src:../backend/src python -m waste_equity_ingestion.cli "
        f"vworld-zoning-ingest --source-path {source_path} "
        f"--reference-date {reference_date} --scope capital-region --write"
    )


def run_zoning_ingestion(
    settings: ProbeSettings,  # noqa: ARG001 - kept for CLI signature parity; no API key needed
    *,
    source_path: str,
    reference_date: str,
    scope: str,
    write: bool,
    encoding: str = DEFAULT_SOURCE_ENCODING,
) -> ZoningIngestionReport:
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented in Phase 2.5B-1")
    _parse_reference_date(reference_date)
    root = Path(source_path)
    if not root.exists():
        raise IngestionError(f"Source path does not exist: {source_path}")

    present_region_dirs: set[str] = set()
    with TemporaryDirectory(prefix="vworld-zoning-") as tmp_name:
        tmp_root = Path(tmp_name)
        all_sources: list[ShapefileSource] = []
        for region in TARGET_REGIONS:
            region_dir = root / region.dir_name
            if region_dir.is_dir():
                present_region_dirs.add(region.dir_name)
                all_sources.extend(discover_region_sources(region_dir, region, tmp_root))

        if not all_sources:
            return _missing_sources_report(root, reference_date, present_region_dirs)

        load = build_load_result(
            all_sources,
            present_region_dirs=present_region_dirs,
            reference_date=reference_date,
            encoding=encoding,
            availability=load_availability_manifest(root),
        )

        if not write:
            return _dry_run_report(root, load)
        return _write_result(load, source_path=root, reference_date=reference_date)


def _dry_run_report(root: Path, load: ZoningLoadResult) -> ZoningIngestionReport:
    return ZoningIngestionReport(
        mode="dry-run",
        status="VALIDATED",
        reference_date=load.reference_date,
        source_path=str(root),
        total_feature_count=load.total_feature_count,
        accepted_feature_count=load.accepted_feature_count,
        rejected_feature_count=load.rejected_feature_count,
        polygon_promoted_count=load.polygon_promoted_count,
        coverage_status=load.coverage_status,
        regions_evaluated=load.regions_evaluated,
        coverage_matrix=load.coverage_matrix,
        source_crs_by_region=load.source_crs_by_region,
        source_files=load.source_files,
        warnings=load.warnings,
        message="Official zoning sources validated and normalized; no database writes performed.",
    )


def _missing_sources_report(
    root: Path,
    reference_date: str,
    present_region_dirs: set[str],
) -> ZoningIngestionReport:
    coverage = {
        region.dir_name: {
            "region_code": region.sido_code,
            "region_name": region.sido_name,
            "region_present": region.dir_name in present_region_dirs,
            "status": "SOURCE_MISSING",
        }
        for region in TARGET_REGIONS
    }
    return ZoningIngestionReport(
        mode="inspect",
        status="NO_SOURCE_FILES",
        reference_date=reference_date,
        source_path=str(root),
        coverage_status="INCOMPLETE",
        coverage_matrix=coverage,
        required_sources=_required_sources(root),
        next_command=_next_command(root, reference_date),
        message=(
            "No official zoning bulk archives were found. No synthetic or sample "
            "data was substituted. Place the official UQ111–UQ114 ZIP archives or "
            "extracted shapefile sets in the per-region directories listed under "
            "required_sources, then run next_command."
        ),
    )


def _write_result(
    load: ZoningLoadResult,
    *,
    source_path: Path,
    reference_date: str,
) -> ZoningIngestionReport:
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
        report = _write_bundle(session, load, run=run, reference_date=reference_date)
        session.commit()
        report.source_path = str(source_path)
        return report
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run.run_id, reference_date, exc)
        if isinstance(exc, ProbeError):
            raise
        raise IngestionError("Zoning ingestion failed; normalized writes were rolled back") from exc
    finally:
        session.close()


def _write_bundle(
    session: Session,
    load: ZoningLoadResult,
    *,
    run: IngestionRun,
    reference_date: str,
) -> ZoningIngestionReport:
    now = _utcnow()
    version, version_created = _get_or_create_dataset_version(
        session, load, run=run, reference_date=reference_date, now=now
    )
    session.flush()

    inserted = 0
    skipped = 0
    seen_fingerprints: set[str] = set()
    for feature in load.features:
        created = _insert_feature_if_absent(
            session, feature, version_id=version.id, now=now, seen=seen_fingerprints
        )
        if created:
            inserted += 1
            seen_fingerprints.add(feature.feature_fingerprint)
        else:
            skipped += 1

    _update_freshness(session, reference_period=reference_date, now=now)

    run.status = "SUCCEEDED"
    run.completed_at = now
    run.rows_inserted = inserted
    run.rows_updated = 0
    run.rows_rejected = load.rejected_feature_count

    return ZoningIngestionReport(
        mode="write",
        status="SUCCEEDED",
        reference_date=reference_date,
        total_feature_count=load.total_feature_count,
        accepted_feature_count=load.accepted_feature_count,
        rejected_feature_count=load.rejected_feature_count,
        polygon_promoted_count=load.polygon_promoted_count,
        features_inserted=inserted,
        features_skipped_existing=skipped,
        dataset_version_id=version.id,
        dataset_version_created=version_created,
        ingestion_run_id=run.run_id,
        coverage_status=load.coverage_status,
        regions_evaluated=load.regions_evaluated,
        coverage_matrix=load.coverage_matrix,
        source_crs_by_region=load.source_crs_by_region,
        source_files=load.source_files,
        warnings=load.warnings,
        message=(
            "VWorld zoning ingestion succeeded."
            if version_created
            else "VWorld zoning ingestion re-ran; dataset version already present (idempotent)."
        ),
    )


def _get_or_create_dataset_version(
    session: Session,
    load: ZoningLoadResult,
    *,
    run: IngestionRun,
    reference_date: str,
    now: datetime.datetime,
) -> tuple[StructuralDatasetVersion, bool]:
    checksum = load.combined_checksum or ""
    ref_date = _parse_reference_date(reference_date)
    source_crs = _dominant_source_crs(load)
    existing = session.scalar(
        select(StructuralDatasetVersion).where(
            StructuralDatasetVersion.source_id == SOURCE_ID,
            StructuralDatasetVersion.layer_family == LAYER_FAMILY,
            StructuralDatasetVersion.provider_dataset_identifier == PROVIDER_DATASET_IDENTIFIER,
            StructuralDatasetVersion.reference_date == ref_date,
            StructuralDatasetVersion.source_checksum == checksum,
            StructuralDatasetVersion.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return existing, False

    version = StructuralDatasetVersion(
        source_id=SOURCE_ID,
        provider=PROVIDER,
        provider_dataset_identifier=PROVIDER_DATASET_IDENTIFIER,
        layer_identifier=None,
        layer_family=LAYER_FAMILY,
        reference_date=ref_date,
        source_filename=f"{len(load.source_files)} official source file(s)",
        source_checksum=checksum,
        source_crs=source_crs,
        target_crs=TARGET_CRS,
        source_geometry_type=_dominant_source_geometry_type(load),
        normalized_geometry_type=NORMALIZED_GEOMETRY_TYPE,
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
            "provider": PROVIDER,
            "provider_dataset_identifier": PROVIDER_DATASET_IDENTIFIER,
            "regions_evaluated": load.regions_evaluated,
            "source_crs_by_region": load.source_crs_by_region,
            "polygon_promoted_count": load.polygon_promoted_count,
            "warnings": load.warnings,
            "authorization": (
                "prior government-project authorization confirmed by the project owner"
            ),
        },
        created_at=now,
    )
    session.add(version)
    return version, True


def _insert_feature_if_absent(
    session: Session,
    feature: ZoningFeature,
    *,
    version_id: int,
    now: datetime.datetime,
    seen: set[str],
) -> bool:
    # In-batch duplicates (same fingerprint twice in one load) are caught by the
    # in-memory set because a pending INSERT is not visible to a SELECT before
    # flush; cross-run duplicates are caught by the DB query.
    if feature.feature_fingerprint in seen:
        return False
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
            zoning_category=feature.zoning_category,
            official_zoning_code=feature.official_zoning_code,
            official_zoning_name=feature.official_zoning_name,
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


def _dominant_source_crs(load: ZoningLoadResult) -> str:
    values = list(load.source_crs_by_region.values())
    return values[0] if values else TARGET_CRS


def _dominant_source_geometry_type(load: ZoningLoadResult) -> str | None:
    for entry in load.source_files:
        value = entry.get("source_geometry_type")
        if value:
            return str(value)
    return None


def feature_count_for_version(session: Session, version_id: int) -> int:
    """Count persisted features for a dataset version (integration helper)."""

    return int(
        session.scalar(
            select(func.count())
            .select_from(StructuralFeature)
            .where(StructuralFeature.dataset_version_id == version_id)
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
