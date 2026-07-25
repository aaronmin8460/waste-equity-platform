"""Scalable PostGIS ingestion foundation for the 세분류 [2025] 토지피복지도 (Phase 1B-LC1).

Loads the verified Level-3 land-cover map sheets into
``environmental_land_cover_features``, one canonical sheet per
``environmental_land_cover_map_sheets`` row, versioned by one
``environmental_dataset_versions`` release. This module is the *foundation and
controlled pilot* — the full persistent write of all 7,438,457 official features
is a separate operational phase. Every design choice here is sized for that scale
without performing it.

Design, following the structural / wetland bulk loaders but built for 2,117
tiled shapefiles and millions of features:

* **Explicit source, no fallback.** The source root is always supplied by the
  caller (``--source-root data/raw/environment/land_cover/2025_lv3``); there is
  no default, no ``data/samples`` fallback, and no hard-coded USB path. Raw files
  stay Git-ignored and are never written, reprojected, repaired, or renamed.
* **Bounded memory, streaming, bulk write.** Features are streamed sheet by sheet
  and record by record — never a full in-memory list or GeoDataFrame — and
  written with PostgreSQL ``COPY`` into a temporary staging table, then
  ``INSERT … SELECT … ON CONFLICT DO NOTHING`` into the target. Re-running over
  the same source inserts nothing.
* **Strict CP949, EPSG:5186 by parameters.** The DBF encoding is forced to strict
  ``cp949`` (no ``.cpg`` ships; the wetland UTF-8 assumption would corrupt every
  Korean label). The CRS is resolved from the ``.prj`` TM parameters via
  ``epsg_from_prj`` (never from the ITRF2000 datum *name*, never via
  ``CRS.equals``) and transformed to EPSG:4326 with ``always_xy=True``. Area is
  measured in EPSG:5186 metres before reprojection.
* **MakeValid, audited — never a silent drop.** The 14,244 known invalid source
  polygons (ring self-intersections) are repaired with ``shapely.make_valid`` in
  the source CRS; polygonal components are retained, non-polygonal components are
  counted and named, and a record is rejected only when no valid polygon
  remains. Valid geometry is not otherwise altered.
* **Deterministic duplicate policy.** The 101 byte-identical cross-region border
  sheets are loaded once, with every folder occurrence preserved as provenance. A
  duplicate map-sheet id whose ``.shp`` checksums *differ* halts the load — never
  silently merged or auto-picked.

Scoring is out of scope: nothing here computes, reads, or influences a
suitability score, weight, exclusion rule, rank, or candidate status.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import struct
import time
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import shapely
import shapely.ops
from pyproj import CRS, Transformer
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.polygon import Polygon
from shapely.validation import explain_validity
from sqlalchemy import Table, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    EnvironmentalDatasetVersion,
    EnvironmentalLandCoverMapSheet,
    IngestionRun,
)

from .errors import IngestionError
from .land_cover_contract import (
    EXPECTED_EPSG,
    OFFICIAL_DATASET_NAME,
    PROVIDER,
    REQUIRED_FIELDS,
    REQUIRED_REGIONS,
    STATUS_FAIL,
    LandCoverValidationReport,
    TileSource,
    discover_sources,
    validate_land_cover,
)
from .vworld_zoning_contract import epsg_from_prj

SOURCE_ID = "egis_land_cover"
LAYER_NAME = "land_cover"
TRANSFORMATION_VERSION = "land-cover-v1"

#: Official release identity. There is no single provider file id (2,117 sheets),
#: so the acquisition scope is named explicitly.
PROVIDER_DATASET_IDENTIFIER = (
    "환경부 EGIS 세분류 [2025] 전국 토지피복지도 — Seoul/Incheon/Gyeonggi (Level-3)"
)
OFFICIAL_SOURCE_URL = "https://egis.me.go.kr"
#: The EGIS/KOGL vector-download licence is not yet confirmed in writing; the
#: contract carries this as a condition before any official write.
LICENSE_NOTE = (
    "EGIS/KOGL 벡터 토지피복지도 다운로드 약관 — 서면 재확인 필요 (적재 전 조건, "
    "WMS 표시전용 제품 아님)"
)

#: The source proves a reference *year*, not a precise date. reference_period is
#: the year string; reference_date stays NULL (never fabricated).
REFERENCE_PERIOD = "2025"
REFERENCE_DATE: datetime.date | None = None
#: Provider feature count from the verified contract — documented context, not a
#: gate (the loader counts what it actually reads).
DECLARED_FEATURE_COUNT = 7_438_457

SOURCE_CRS = f"EPSG:{EXPECTED_EPSG}"
TARGET_CRS = "EPSG:4326"
TARGET_SRID = 4326
NORMALIZED_GEOMETRY_TYPE = "MultiPolygon"
#: Forced strict encoding (no .cpg ships; DBF LDID byte 0x4E = CP949, proven by
#: the contract's strict full-decode of all 7,438,457 records).
EXPECTED_ENCODING = "cp949"
REPAIR_METHOD = "shapely.make_valid"

#: DBF language-driver bytes that mean CP949 (Windows-949 / UHC).
_CP949_LDID = {0x4E}

_DEFAULT_BATCH = 1000
_MAX_REPORTED_REJECTIONS = 40
_MAX_REPORTED_WARNINGS = 40
_REGION_ORDER = {region: index for index, region in enumerate(REQUIRED_REGIONS)}

#: The 15 verbatim source attribute names, in source order.
SOURCE_ATTRIBUTE_NAMES: tuple[str, ...] = (
    "L1_CODE",
    "L1_NAME",
    "L2_CODE",
    "L2_NAME",
    "L3_CODE",
    "L3_NAME",
    "IMG_NAME",
    "IMG_DATE",
    "LU_INFO",
    "ETC_INFO",
    "ENV_INFO",
    "FOR_INFO",
    "UD_INFO",
    "INX_NUM",
    "ANNO",
)


class LandCoverIngestionError(IngestionError):
    """Raised when the land-cover ingestion cannot safely proceed."""


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


@dataclass
class LandCoverIngestionReport:
    """Structured, sanitized result of one ingestion run (no paths, no row dump)."""

    mode: str  # "dry-run" | "write"
    status: str  # SUCCEEDED | PARTIAL | FAILED
    source_root_name: str
    contract_status: str = ""
    source_crs: str = SOURCE_CRS
    target_crs: str = TARGET_CRS
    source_encoding: str = EXPECTED_ENCODING
    transformation_version: str = TRANSFORMATION_VERSION
    reference_period: str = REFERENCE_PERIOD
    reference_date: str | None = None
    declared_feature_count: int = DECLARED_FEATURE_COUNT
    aggregate_manifest_sha256: str | None = None
    # Selection (pilot).
    selectors: dict[str, Any] = field(default_factory=dict)
    total_unique_sheets: int = 0
    total_duplicate_sheets: int = 0
    map_sheets_selected: int = 0
    map_sheets_processed: int = 0
    map_sheets_truncated: int = 0
    duplicate_occurrences_loaded_once: int = 0
    # Feature tallies.
    raw_features_read: int = 0
    accepted_feature_count: int = 0
    source_invalid_feature_count: int = 0
    repaired_feature_count: int = 0
    rejected_feature_count: int = 0
    discarded_component_count: int = 0
    geometry_type_counts: dict[str, int] = field(default_factory=dict)
    l1_code_count: int = 0
    l2_code_count: int = 0
    l3_code_count: int = 0
    transformed_wkb_bytes_total: int = 0
    # Performance.
    batch_size: int = _DEFAULT_BATCH
    elapsed_seconds: float = 0.0
    features_per_second: float = 0.0
    peak_rss_mb: float | None = None
    # Persistence.
    inserted_feature_count: int = 0
    skipped_feature_count: int = 0
    inserted_map_sheet_count: int = 0
    dataset_version_id: int | None = None
    dataset_version_created: bool = False
    ingestion_run_id: int | None = None
    rejections: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_warning(self, message: str) -> None:
        if len(self.warnings) < _MAX_REPORTED_WARNINGS and message not in self.warnings:
            self.warnings.append(message)

    def add_rejection(self, sheet_id: str, record_index: int, reason: str) -> None:
        self.rejected_feature_count += 1
        if len(self.rejections) < _MAX_REPORTED_REJECTIONS:
            self.rejections.append(
                {"map_sheet_id": sheet_id, "record_index": record_index, "reason": reason}
            )

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "job": "land-cover-ingest",
            "layer_name": LAYER_NAME,
            "provider": PROVIDER,
            "official_dataset_name": OFFICIAL_DATASET_NAME,
            "mode": self.mode,
            "status": self.status,
            "contract_status": self.contract_status,
            "source_root_name": self.source_root_name,
            "source_crs": self.source_crs,
            "target_crs": self.target_crs,
            "source_encoding": self.source_encoding,
            "transformation_version": self.transformation_version,
            "reference_period": self.reference_period,
            "reference_date": self.reference_date,
            "declared_feature_count": self.declared_feature_count,
            "aggregate_manifest_sha256": self.aggregate_manifest_sha256,
            "selectors": self.selectors,
            "total_unique_sheets": self.total_unique_sheets,
            "total_duplicate_sheets": self.total_duplicate_sheets,
            "map_sheets_selected": self.map_sheets_selected,
            "map_sheets_processed": self.map_sheets_processed,
            "map_sheets_truncated": self.map_sheets_truncated,
            "duplicate_occurrences_loaded_once": self.duplicate_occurrences_loaded_once,
            "raw_features_read": self.raw_features_read,
            "accepted_feature_count": self.accepted_feature_count,
            "source_invalid_feature_count": self.source_invalid_feature_count,
            "repaired_feature_count": self.repaired_feature_count,
            "rejected_feature_count": self.rejected_feature_count,
            "discarded_component_count": self.discarded_component_count,
            "geometry_type_counts": self.geometry_type_counts,
            "class_code_counts": {
                "l1": self.l1_code_count,
                "l2": self.l2_code_count,
                "l3": self.l3_code_count,
            },
            "transformed_wkb_bytes_total": self.transformed_wkb_bytes_total,
            "batch_size": self.batch_size,
            "elapsed_seconds": round(self.elapsed_seconds, 3),
            "features_per_second": round(self.features_per_second, 1),
            "peak_rss_mb": None if self.peak_rss_mb is None else round(self.peak_rss_mb, 1),
            "inserted_feature_count": self.inserted_feature_count,
            "skipped_feature_count": self.skipped_feature_count,
            "inserted_map_sheet_count": self.inserted_map_sheet_count,
            "dataset_version_id": self.dataset_version_id,
            "dataset_version_created": self.dataset_version_created,
            "ingestion_run_id": self.ingestion_run_id,
            "rejections": list(self.rejections),
            "warnings": list(self.warnings),
        }


# --------------------------------------------------------------------------- #
# Canonical map-sheet planning + deterministic de-duplication
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class CanonicalSheet:
    """One unique map sheet chosen deterministically from its folder occurrences."""

    map_sheet_id: str
    canonical: TileSource
    canonical_checksum: str
    occurrences: tuple[dict[str, str], ...]
    duplicate_classification: str

    @property
    def duplicate_occurrence_count(self) -> int:
        return len(self.occurrences)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _shp_bbox(shp_path: Path) -> list[float] | None:
    """Read the source-CRS bounding box from the 100-byte ``.shp`` header (5186)."""

    try:
        with shp_path.open("rb") as handle:
            header = handle.read(100)
    except OSError:
        return None
    if len(header) < 68:
        return None
    minx, miny, maxx, maxy = struct.unpack("<4d", header[36:68])
    return [minx, miny, maxx, maxy]


def _dbf_ldid(shp_path: Path) -> int | None:
    """Read the DBF language-driver byte (byte 29) for the sheet, or None."""

    dbf = shp_path.with_suffix(".dbf")
    try:
        with dbf.open("rb") as handle:
            header = handle.read(32)
    except OSError:
        return None
    return header[29] if len(header) >= 30 else None


def plan_canonical_sheets(
    sources: Sequence[TileSource],
) -> tuple[dict[str, list[TileSource]], int, int]:
    """Group discovered sheets by id and count unique vs duplicate ids.

    Returns ``(occurrences_by_id, unique_count, duplicate_count)``. Purely from
    the directory listing — no file contents are read here, so planning stays
    cheap even for the full 2,117-sheet acquisition.
    """

    by_id: dict[str, list[TileSource]] = {}
    for source in sources:
        by_id.setdefault(source.tile_id, []).append(source)
    duplicate = sum(1 for occ in by_id.values() if len(occ) > 1)
    unique = len(by_id)
    return by_id, unique, duplicate


def resolve_canonical_sheet(tile_id: str, occurrences: Sequence[TileSource]) -> CanonicalSheet:
    """Choose the canonical copy and classify duplication, halting on conflicts.

    Byte-identical duplicates load once; the canonical copy is the deterministic
    first occurrence in (region-order, dir-name) order. A duplicate id whose
    ``.shp`` checksums differ is a genuine conflict and raises — never
    auto-picked, merged, or silently de-duplicated.
    """

    ordered = sorted(occurrences, key=lambda s: (_REGION_ORDER.get(s.region, 99), s.dir_name))
    checksums = {source.shp_path: _sha256_file(source.shp_path) for source in ordered}
    distinct = set(checksums.values())
    if len(distinct) > 1:
        raise LandCoverIngestionError(
            f"Map-sheet id {tile_id!r} has {len(distinct)} distinct .shp checksums across "
            f"{len(ordered)} occurrence(s) "
            + ", ".join(f"{s.region}/{s.dir_name}" for s in ordered)
            + ". A conflicting duplicate must be resolved by a human; ingestion halts rather "
            "than merging or auto-selecting one copy."
        )
    canonical = ordered[0]
    if len(ordered) == 1:
        classification = "unique"
    else:
        regions = {s.region for s in ordered}
        classification = (
            "byte_identical_cross_region" if len(regions) > 1 else "byte_identical_within_region"
        )
    return CanonicalSheet(
        map_sheet_id=tile_id,
        canonical=canonical,
        canonical_checksum=checksums[canonical.shp_path],
        occurrences=tuple({"region": s.region, "dir_name": s.dir_name} for s in ordered),
        duplicate_classification=classification,
    )


def select_sheet_ids(
    by_id: Mapping[str, Sequence[TileSource]],
    *,
    map_sheet_ids: Sequence[str] | None,
    region: str | None,
    max_map_sheets: int | None,
) -> tuple[list[str], int]:
    """Apply the pilot selectors deterministically. Returns ``(ids, truncated)``.

    ``truncated`` is the number of otherwise-selected sheets dropped by
    ``max_map_sheets`` — reported, never silently hidden.
    """

    ids = sorted(by_id)
    if region is not None:
        wanted = region.strip().lower()
        ids = [tile_id for tile_id in ids if any(s.region == wanted for s in by_id[tile_id])]
    if map_sheet_ids:
        requested = {mid.strip() for mid in map_sheet_ids if mid.strip()}
        ids = [tile_id for tile_id in ids if tile_id in requested]
    truncated = 0
    if max_map_sheets is not None and len(ids) > max_map_sheets:
        truncated = len(ids) - max_map_sheets
        ids = ids[:max_map_sheets]
    return ids, truncated


# --------------------------------------------------------------------------- #
# Geometry normalization + repair audit
# --------------------------------------------------------------------------- #


def _polygonal_components(geom: BaseGeometry) -> tuple[list[Polygon], list[str]]:
    """Return the polygonal parts of ``geom`` and the types of the discarded rest.

    Handles the ``MakeValid`` result set: a single Polygon, a MultiPolygon, or a
    mixed GeometryCollection (from which only Polygon/MultiPolygon parts are
    kept, every discarded non-polygonal component's type being recorded).
    """

    polygons: list[Polygon] = []
    discarded: list[str] = []

    def _walk(g: BaseGeometry) -> None:
        gtype = g.geom_type
        if gtype == "Polygon":
            if not g.is_empty:
                polygons.append(cast("Polygon", g))
        elif gtype == "MultiPolygon":
            for part in g.geoms:  # type: ignore[attr-defined]
                if not part.is_empty:
                    polygons.append(cast("Polygon", part))
        elif gtype == "GeometryCollection":
            for part in g.geoms:  # type: ignore[attr-defined]
                _walk(part)
        elif not g.is_empty:
            discarded.append(gtype)

    _walk(geom)
    return polygons, discarded


def promote_to_multipolygon(geom: BaseGeometry) -> MultiPolygon:
    """Promote polygonal geometry to a canonical, normalized ``MultiPolygon``."""

    if geom.is_empty:
        raise LandCoverIngestionError("Empty geometry")
    if geom.geom_type == "Polygon":
        promoted: BaseGeometry = MultiPolygon([cast("Polygon", geom)])
    elif geom.geom_type == "MultiPolygon":
        promoted = geom
    else:
        raise LandCoverIngestionError(
            f"Unexpected geometry type {geom.geom_type}; expected polygonal"
        )
    normalized = shapely.normalize(promoted)
    if not isinstance(normalized, MultiPolygon):  # pragma: no cover - shapely invariant
        raise LandCoverIngestionError(f"Normalization produced {normalized.geom_type}")
    return normalized


@dataclass
class RepairedGeometry:
    """Result of the source-CRS validity gate + MakeValid audit."""

    geometry_5186: MultiPolygon
    source_valid: bool
    invalidity_reason: str | None
    repair_status: str  # "none" | "made_valid"
    repair_method: str | None
    discarded_component_count: int
    discarded_component_types: list[str]
    source_area_m2: float | None
    repaired_area_m2: float | None
    area_delta_m2: float | None


def repair_source_geometry(geom: BaseGeometry) -> RepairedGeometry:
    """Validate a source-CRS geometry and repair it with MakeValid if invalid.

    Applied to the geometry as published, in EPSG:5186. Follows the contract's
    ten-step policy: valid geometry is passed through unchanged (only structural
    promotion to MultiPolygon), invalid geometry is repaired with
    ``shapely.make_valid`` in the source CRS, only polygonal components are
    retained, discarded non-polygonal components are counted, and a record with
    no valid polygon remaining is rejected by raising. ``buffer(0)``, ``simplify``,
    ``snap``, and arbitrary tolerances are never used.
    """

    if geom.is_empty:
        raise LandCoverIngestionError("Empty/null source geometry")
    if geom.geom_type not in ("Polygon", "MultiPolygon"):
        raise LandCoverIngestionError(f"Non-polygonal source geometry ({geom.geom_type})")
    if geom.is_valid:
        return RepairedGeometry(
            geometry_5186=promote_to_multipolygon(geom),
            source_valid=True,
            invalidity_reason=None,
            repair_status="none",
            repair_method=None,
            discarded_component_count=0,
            discarded_component_types=[],
            source_area_m2=None,
            repaired_area_m2=None,
            area_delta_m2=None,
        )

    reason = explain_validity(geom).split("[")[0].strip()
    source_area = float(abs(geom.area))
    repaired = shapely.make_valid(geom)
    polygons, discarded = _polygonal_components(repaired)
    if not polygons:
        raise LandCoverIngestionError(
            f"MakeValid left no polygonal geometry (was {reason!r}; result {repaired.geom_type})"
        )
    repaired_mp = promote_to_multipolygon(
        MultiPolygon(polygons) if len(polygons) > 1 else polygons[0]
    )
    repaired_area = float(repaired_mp.area)
    return RepairedGeometry(
        geometry_5186=repaired_mp,
        source_valid=False,
        invalidity_reason=reason,
        repair_status="made_valid",
        repair_method=REPAIR_METHOD,
        discarded_component_count=len(discarded),
        discarded_component_types=sorted(set(discarded)),
        source_area_m2=source_area,
        repaired_area_m2=repaired_area,
        area_delta_m2=repaired_area - source_area,
    )


def land_cover_feature_fingerprint(
    geometry_wgs84: BaseGeometry,
    *,
    map_sheet_id: str,
    source_record_index: int,
    sheet_checksum: str,
    reference_period: str,
    transformation_version: str,
) -> str:
    """Deterministic sha-256 over the normalized stored geometry + release identity.

    Reproducible from the source sheet alone (its ``.shp`` checksum), independent
    of surrogate database ids.
    """

    digest = hashlib.sha256()
    digest.update(shapely.normalize(geometry_wgs84).wkb)
    payload = {
        "map_sheet_id": map_sheet_id,
        "source_record_index": source_record_index,
        "sheet_checksum": sheet_checksum,
        "reference_period": reference_period,
        "transformation_version": transformation_version,
    }
    digest.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


# --------------------------------------------------------------------------- #
# Per-sheet streaming reader
# --------------------------------------------------------------------------- #


@dataclass
class NormalizedLandCoverFeature:
    """One source record normalized for storage (no database identifiers yet)."""

    map_sheet_id: str
    source_record_index: int
    l1_code: str | None
    l1_name: str | None
    l2_code: str | None
    l2_name: str | None
    l3_code: str | None
    l3_name: str | None
    img_name: str | None
    img_date: str | None
    inx_num: str | None
    anno: str | None
    geometry_wgs84: MultiPolygon
    geometry_area_m2: float
    repair: RepairedGeometry
    source_geometry_fingerprint: str
    feature_fingerprint: str
    raw_attributes: dict[str, Any]


def _text_or_none(value: object) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _gate_sheet_contract(sheet: CanonicalSheet) -> None:
    """Per-sheet contract gate: CRS EPSG:5186 by parameters, CP949 LDID, schema.

    The same rules the whole-dataset ``validate_land_cover`` gate enforces,
    applied to one canonical sheet so a bounded pilot stays bounded. A ``--write``
    run additionally runs the full-root gate (see ``run_land_cover_ingestion``).
    """

    shp = sheet.canonical.shp_path
    prj = shp.with_suffix(".prj")
    try:
        prj_text = prj.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        raise LandCoverIngestionError(
            f"Sheet {sheet.map_sheet_id}: unreadable .prj ({exc})"
        ) from exc
    epsg = epsg_from_prj(prj_text)
    if epsg != EXPECTED_EPSG:
        raise LandCoverIngestionError(
            f"Sheet {sheet.map_sheet_id}: source CRS resolves to EPSG:{epsg}, expected "
            f"EPSG:{EXPECTED_EPSG}. Refusing to reproject from an unverified projection."
        )
    ldid = _dbf_ldid(shp)
    if ldid not in _CP949_LDID:
        raise LandCoverIngestionError(
            f"Sheet {sheet.map_sheet_id}: DBF language-driver byte {ldid!r} is not CP949 "
            f"(0x4E). Refusing to decode Korean attributes under an unverified encoding."
        )


def iter_sheet_features(
    sheet: CanonicalSheet,
    *,
    transformer: Transformer,
    reference_period: str = REFERENCE_PERIOD,
    transformation_version: str = TRANSFORMATION_VERSION,
) -> Iterator[tuple[int, NormalizedLandCoverFeature | None, str | None]]:
    """Stream one canonical sheet, yielding ``(index, feature | None, reason | None)``.

    Reads records and shapes together under a strict CP949 decode, measures area
    in EPSG:5186 (metres) *before* transforming, repairs invalid source geometry
    with MakeValid, then reprojects to EPSG:4326 with ``always_xy=True``. A strict
    decode error is a hard failure (raises); a per-record geometry problem is a
    visible rejection, never a silent drop. Memory stays bounded to one record.
    """

    import shapefile

    reader = shapefile.Reader(
        str(sheet.canonical.shp_path), encoding=EXPECTED_ENCODING, encodingErrors="strict"
    )
    try:
        for index in range(len(reader)):
            try:
                record = reader.record(index)
            except (UnicodeDecodeError, shapefile.ShapefileException) as exc:
                # pyshp wraps a strict decode failure in dbfFileException. Either
                # way a strict CP949 decode error is a hard failure — the source
                # is not the verified CP949 (e.g. it is UTF-8) and must be
                # re-verified, never decoded with replacement characters.
                raise LandCoverIngestionError(
                    f"Sheet {sheet.map_sheet_id} record {index}: strict {EXPECTED_ENCODING} "
                    f"decode failed ({exc}). Refusing to substitute replacement characters."
                ) from exc
            values: dict[str, Any] = dict(record.as_dict())
            missing = [name for name in REQUIRED_FIELDS if name not in values]
            if missing:
                yield index, None, f"Missing required field(s): {', '.join(missing)}"
                continue
            try:
                interface = reader.shape(index).__geo_interface__
                if not interface or not interface.get("coordinates"):
                    raise LandCoverIngestionError("Null/empty geometry")
                source_geometry = shapely_shape(interface)
                repair = repair_source_geometry(source_geometry)
                area_m2 = float(repair.geometry_5186.area)
                projected = shapely.ops.transform(transformer.transform, repair.geometry_5186)
                geometry_wgs84 = promote_to_multipolygon(projected)
            except LandCoverIngestionError as exc:
                yield index, None, str(exc)
                continue

            source_fp = hashlib.sha256(shapely.to_wkb(source_geometry)).hexdigest()
            feature_fp = land_cover_feature_fingerprint(
                geometry_wgs84,
                map_sheet_id=sheet.map_sheet_id,
                source_record_index=index,
                sheet_checksum=sheet.canonical_checksum,
                reference_period=reference_period,
                transformation_version=transformation_version,
            )
            yield (
                index,
                NormalizedLandCoverFeature(
                    map_sheet_id=sheet.map_sheet_id,
                    source_record_index=index,
                    l1_code=_text_or_none(values.get("L1_CODE")),
                    l1_name=_text_or_none(values.get("L1_NAME")),
                    l2_code=_text_or_none(values.get("L2_CODE")),
                    l2_name=_text_or_none(values.get("L2_NAME")),
                    l3_code=_text_or_none(values.get("L3_CODE")),
                    l3_name=_text_or_none(values.get("L3_NAME")),
                    img_name=_text_or_none(values.get("IMG_NAME")),
                    img_date=_text_or_none(values.get("IMG_DATE")),
                    inx_num=_text_or_none(values.get("INX_NUM")),
                    anno=_text_or_none(values.get("ANNO")),
                    geometry_wgs84=geometry_wgs84,
                    geometry_area_m2=area_m2,
                    repair=repair,
                    source_geometry_fingerprint=source_fp,
                    feature_fingerprint=feature_fp,
                    raw_attributes={
                        name: (None if values.get(name) is None else str(values.get(name)).strip())
                        for name in SOURCE_ATTRIBUTE_NAMES
                        if name in values
                    },
                ),
                None,
            )
    finally:
        reader.close()


# --------------------------------------------------------------------------- #
# COPY-based bulk writer (bounded memory, staging + ON CONFLICT DO NOTHING)
# --------------------------------------------------------------------------- #


_STAGE_COLUMNS: tuple[str, ...] = (
    "dataset_version_id",
    "map_sheet_id",
    "source_record_index",
    "l1_code",
    "l1_name",
    "l2_code",
    "l2_name",
    "l3_code",
    "l3_name",
    "img_name",
    "img_date",
    "inx_num",
    "anno",
    "geometry",
    "geometry_area_m2",
    "source_geometry_valid",
    "source_invalidity_reason",
    "geometry_repair_status",
    "geometry_repair_method",
    "discarded_component_count",
    "discarded_component_types",
    "source_area_m2",
    "repaired_area_m2",
    "area_delta_m2",
    "source_geometry_fingerprint",
    "feature_fingerprint",
    "source_crs",
    "target_crs",
    "source_encoding",
    "source_reference_period",
    "transformation_version",
    "raw_attributes",
    "created_at",
)

_STAGE_DDL = """
CREATE TEMP TABLE _land_cover_stage (
    dataset_version_id bigint,
    map_sheet_id text,
    source_record_index integer,
    l1_code text, l1_name text, l2_code text, l2_name text, l3_code text, l3_name text,
    img_name text, img_date text, inx_num text, anno text,
    geometry text,
    geometry_area_m2 double precision,
    source_geometry_valid boolean,
    source_invalidity_reason text,
    geometry_repair_status text,
    geometry_repair_method text,
    discarded_component_count integer,
    discarded_component_types text,
    source_area_m2 double precision,
    repaired_area_m2 double precision,
    area_delta_m2 double precision,
    source_geometry_fingerprint text,
    feature_fingerprint text,
    source_crs text, target_crs text, source_encoding text, source_reference_period text,
    transformation_version text,
    raw_attributes text,
    created_at timestamptz
) ON COMMIT DROP
"""

_STAGE_DDL_IF_NOT_EXISTS = _STAGE_DDL.replace(
    "CREATE TEMP TABLE _land_cover_stage", "CREATE TEMP TABLE IF NOT EXISTS _land_cover_stage"
)

_INSERT_FROM_STAGE = """
INSERT INTO environmental_land_cover_features (
    dataset_version_id, map_sheet_id, source_record_index,
    l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
    img_name, img_date, inx_num, anno,
    geometry, geometry_area_m2,
    source_geometry_valid, source_invalidity_reason,
    geometry_repair_status, geometry_repair_method,
    discarded_component_count, discarded_component_types,
    source_area_m2, repaired_area_m2, area_delta_m2,
    source_geometry_fingerprint, feature_fingerprint,
    source_crs, target_crs, source_encoding, source_reference_period,
    transformation_version, raw_attributes, created_at
)
SELECT
    dataset_version_id, map_sheet_id, source_record_index,
    l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
    img_name, img_date, inx_num, anno,
    geometry::geometry, geometry_area_m2,
    source_geometry_valid, source_invalidity_reason,
    geometry_repair_status, geometry_repair_method,
    discarded_component_count, NULLIF(discarded_component_types, '')::jsonb,
    source_area_m2, repaired_area_m2, area_delta_m2,
    source_geometry_fingerprint, feature_fingerprint,
    source_crs, target_crs, source_encoding, source_reference_period,
    transformation_version, NULLIF(raw_attributes, '')::jsonb, created_at
FROM _land_cover_stage
ON CONFLICT DO NOTHING
RETURNING id
"""


class _BatchCopyWriter:
    """Batched ``COPY`` → ``INSERT … SELECT … ON CONFLICT`` → ``TRUNCATE`` writer.

    Each batch of at most ``batch_size`` rows is COPYed into an unindexed TEMP
    staging table, merged into the indexed target with ``ON CONFLICT DO NOTHING``
    (which applies both uniqueness guards and makes an identical re-run insert
    nothing), then the staging table is truncated. This bounds **both** memory (a
    single batch of Python rows) **and** transient disk (the staging table never
    exceeds one batch) — the property that matters at 7.4-million-row scale, where
    accumulating the whole release in a temp table would double on-disk storage
    during the load. Rows are streamed in; nothing accumulates across batches.
    """

    def __init__(self, session: Session, *, batch_size: int) -> None:
        self._session = session
        self._batch_size = max(1, batch_size)
        raw = session.connection().connection.driver_connection
        if raw is None:  # pragma: no cover - a live DBAPI connection always has one
            raise LandCoverIngestionError("No DBAPI driver connection available for COPY.")
        self._raw: Any = raw
        self._columns = ", ".join(_STAGE_COLUMNS)
        self._buffer: list[Sequence[Any]] = []
        self.inserted = 0
        session.execute(text(_STAGE_DDL_IF_NOT_EXISTS))

    def add(self, row: Sequence[Any]) -> None:
        self._buffer.append(row)
        if len(self._buffer) >= self._batch_size:
            self._flush()

    def _flush(self) -> None:
        if not self._buffer:
            return
        with (
            self._raw.cursor() as cursor,
            cursor.copy(f"COPY _land_cover_stage ({self._columns}) FROM STDIN") as copy,
        ):
            for row in self._buffer:
                copy.write_row(list(row))
        self._buffer.clear()
        # The COPY has closed before this INSERT: a COPY-in-progress would block
        # any other statement on this connection.
        result = self._session.execute(text(_INSERT_FROM_STAGE))
        self.inserted += sum(1 for _ in result)
        self._session.execute(text("TRUNCATE _land_cover_stage"))

    def finish(self) -> int:
        self._flush()
        return self.inserted


def _feature_copy_row(
    feature: NormalizedLandCoverFeature, *, dataset_version_id: int, now: datetime.datetime
) -> list[Any]:
    geom = shapely.set_srid(feature.geometry_wgs84, TARGET_SRID)
    ewkb_hex = shapely.to_wkb(geom, hex=True, include_srid=True)
    discarded = feature.repair.discarded_component_types
    return [
        dataset_version_id,
        feature.map_sheet_id,
        feature.source_record_index,
        feature.l1_code,
        feature.l1_name,
        feature.l2_code,
        feature.l2_name,
        feature.l3_code,
        feature.l3_name,
        feature.img_name,
        feature.img_date,
        feature.inx_num,
        feature.anno,
        ewkb_hex,
        feature.geometry_area_m2,
        feature.repair.source_valid,
        feature.repair.invalidity_reason,
        feature.repair.repair_status,
        feature.repair.repair_method,
        feature.repair.discarded_component_count,
        json.dumps(discarded, ensure_ascii=False) if discarded else None,
        feature.repair.source_area_m2,
        feature.repair.repaired_area_m2,
        feature.repair.area_delta_m2,
        feature.source_geometry_fingerprint,
        feature.feature_fingerprint,
        SOURCE_CRS,
        TARGET_CRS,
        EXPECTED_ENCODING,
        REFERENCE_PERIOD,
        TRANSFORMATION_VERSION,
        json.dumps(feature.raw_attributes, ensure_ascii=False),
        now,
    ]


# --------------------------------------------------------------------------- #
# Provenance
# --------------------------------------------------------------------------- #


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _peak_rss_mb() -> float | None:
    try:
        import resource
        import sys

        rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    except Exception:  # noqa: BLE001 - resource unavailable on some platforms
        return None
    # ru_maxrss is bytes on macOS, kilobytes on Linux.
    divisor = 1024 * 1024 if sys.platform == "darwin" else 1024
    return rss / divisor


def _get_or_create_version(
    session: Session,
    *,
    aggregate_manifest_sha256: str,
    contract: LandCoverValidationReport | None,
    run: IngestionRun,
    now: datetime.datetime,
    total_features: int,
    accepted: int,
    rejected: int,
) -> tuple[EnvironmentalDatasetVersion, bool]:
    """Return the release row for this exact source, creating it if new."""

    existing = session.execute(
        select(EnvironmentalDatasetVersion).where(
            EnvironmentalDatasetVersion.layer_name == LAYER_NAME,
            EnvironmentalDatasetVersion.provider_dataset_identifier == PROVIDER_DATASET_IDENTIFIER,
            EnvironmentalDatasetVersion.reference_period == REFERENCE_PERIOD,
            EnvironmentalDatasetVersion.source_checksum == aggregate_manifest_sha256,
            EnvironmentalDatasetVersion.transformation_version == TRANSFORMATION_VERSION,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    geometry_types = None
    encoding = EXPECTED_ENCODING
    if contract is not None and contract.geometry is not None:
        geometry_types = "/".join(name for name, _ in contract.geometry.geometry_type_counts)
    version = EnvironmentalDatasetVersion(
        layer_name=LAYER_NAME,
        source_id=SOURCE_ID,
        provider=PROVIDER,
        official_dataset_name=OFFICIAL_DATASET_NAME,
        provider_dataset_identifier=PROVIDER_DATASET_IDENTIFIER,
        official_source_url=OFFICIAL_SOURCE_URL,
        reference_period=REFERENCE_PERIOD,
        reference_date=REFERENCE_DATE,
        source_archive_filename=None,
        source_filename=None,
        source_archive_checksum=None,
        source_checksum=aggregate_manifest_sha256,
        source_crs=SOURCE_CRS,
        target_crs=TARGET_CRS,
        source_encoding=encoding,
        source_geometry_type=geometry_types,
        normalized_geometry_type=NORMALIZED_GEOMETRY_TYPE,
        declared_feature_count=DECLARED_FEATURE_COUNT,
        total_feature_count=total_features,
        accepted_feature_count=accepted,
        rejected_feature_count=rejected,
        transformation_version=TRANSFORMATION_VERSION,
        license_note=LICENSE_NOTE,
        ingestion_run_id=run.run_id,
        retrieved_at=now,
        acquired_on=None,
        source_files=[],
        retrieval_metadata={
            "contract_status": None if contract is None else contract.status,
            "aggregate_manifest_sha256": aggregate_manifest_sha256,
            "official_source_url": OFFICIAL_SOURCE_URL,
        },
        is_active=True,
        created_at=now,
    )
    session.add(version)
    session.flush()
    return version, True


def _write_map_sheet_rows(
    session: Session,
    *,
    dataset_version_id: int,
    sheets: Sequence[tuple[CanonicalSheet, dict[str, int]]],
    now: datetime.datetime,
) -> int:
    """Insert one provenance row per canonical sheet (idempotent)."""

    table = cast("Table", EnvironmentalLandCoverMapSheet.__table__)
    rows = [
        {
            "dataset_version_id": dataset_version_id,
            "map_sheet_id": sheet.map_sheet_id,
            "canonical_source_filename": sheet.canonical.shp_path.name,
            "source_shp_checksum": sheet.canonical_checksum,
            "source_regions": list(sheet.occurrences),
            "duplicate_occurrence_count": sheet.duplicate_occurrence_count,
            "duplicate_classification": sheet.duplicate_classification,
            "source_feature_count": tally["read"],
            "source_bounds_5186": _shp_bbox(sheet.canonical.shp_path),
            "source_crs": SOURCE_CRS,
            "source_encoding": EXPECTED_ENCODING,
            "processing_status": "PROCESSED",
            "accepted_feature_count": tally["accepted"],
            "repaired_feature_count": tally["repaired"],
            "rejected_feature_count": tally["rejected"],
            "transformation_version": TRANSFORMATION_VERSION,
            "created_at": now,
        }
        for sheet, tally in sheets
    ]
    if not rows:
        return 0
    stmt = pg_insert(table).values(rows).on_conflict_do_nothing().returning(table.c.id)
    return sum(1 for _ in session.execute(stmt))


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def run_land_cover_ingestion(
    *,
    source_root: str,
    write: bool,
    batch_size: int = _DEFAULT_BATCH,
    map_sheet_ids: Sequence[str] | None = None,
    region: str | None = None,
    max_map_sheets: int | None = None,
    expected_manifest_sha256: str | None = None,
    run_full_contract: bool | None = None,
    session_factory: Any | None = None,
    progress: bool = False,
) -> LandCoverIngestionReport:
    """Validate, normalize, and (when ``write``) load land-cover features.

    A filtered/partial ``--write`` is prohibited: only a full, checksum-guarded
    write may create the active release, and this foundation phase never performs
    the full official write. ``write=False`` streams the full read/normalize/
    transform path and reports what would be loaded without opening a write
    transaction, honouring the ``map_sheet_ids`` / ``region`` / ``max_map_sheets``
    pilot selectors.
    """

    root = Path(source_root)
    selectors = {
        "map_sheet_ids": list(map_sheet_ids) if map_sheet_ids else None,
        "region": region,
        "max_map_sheets": max_map_sheets,
    }
    has_selector = bool(map_sheet_ids or region or max_map_sheets is not None)

    if write and has_selector:
        raise LandCoverIngestionError(
            "A filtered/partial --write is prohibited: selectors (--map-sheet-id, --region, "
            "--max-map-sheets) may only be used with --dry-run. A partial official source must "
            "never create a normal active release."
        )
    if write and not expected_manifest_sha256:
        raise LandCoverIngestionError(
            "--write requires --expected-manifest-sha256 matching the validated source "
            "aggregate manifest checksum."
        )

    report = LandCoverIngestionReport(
        mode="write" if write else "dry-run",
        status="SUCCEEDED",
        source_root_name=root.name,
        reference_date=None if REFERENCE_DATE is None else REFERENCE_DATE.isoformat(),
        selectors=selectors,
        batch_size=batch_size,
    )

    # Full-root contract gate. Always for a write; for a dry-run only when no
    # selectors are given (a bounded pilot uses the per-sheet gate instead).
    contract: LandCoverValidationReport | None = None
    should_run_full = (
        run_full_contract if run_full_contract is not None else (write or not has_selector)
    )
    if should_run_full:
        contract = validate_land_cover(root, read_geometry=write, progress=progress)
        report.contract_status = contract.status
        report.aggregate_manifest_sha256 = (
            None if contract.provenance is None else contract.provenance.aggregate_manifest_sha256
        )
        if contract.status == STATUS_FAIL:
            report.status = "FAILED"
            report.add_warning("Contract validation FAILED: " + "; ".join(contract.errors[:5]))
            raise LandCoverIngestionError(
                "Contract validation FAILED; refusing to load a source that does not match the "
                "verified contract. Errors: " + "; ".join(contract.errors[:5])
            )
    else:
        report.contract_status = "PER_SHEET_GATE"

    if write:
        aggregate = report.aggregate_manifest_sha256
        if aggregate is None:  # pragma: no cover - contract always yields provenance
            raise LandCoverIngestionError("Aggregate manifest checksum unavailable; cannot write.")
        if expected_manifest_sha256 != aggregate:
            raise LandCoverIngestionError(
                "Source aggregate manifest checksum mismatch: the source does not match the "
                "validated checksum. Refusing to write."
            )

    sources, discoveries = discover_sources(root)
    missing = [d.region for d in discoveries if not d.present]
    if missing and (write or should_run_full):
        raise LandCoverIngestionError(
            f"Required regional director(ies) missing: {', '.join(missing)}."
        )
    by_id, unique_count, duplicate_count = plan_canonical_sheets(sources)
    report.total_unique_sheets = unique_count
    report.total_duplicate_sheets = duplicate_count

    selected_ids, truncated = select_sheet_ids(
        by_id, map_sheet_ids=map_sheet_ids, region=region, max_map_sheets=max_map_sheets
    )
    report.map_sheets_selected = len(selected_ids)
    report.map_sheets_truncated = truncated
    if truncated:
        report.add_warning(
            f"--max-map-sheets dropped {truncated} otherwise-selected sheet(s) (reported, not "
            "silently hidden)."
        )
    if write and truncated:  # pragma: no cover - guarded above
        raise LandCoverIngestionError("Partial official write prohibited.")

    transformer = Transformer.from_crs(
        CRS.from_epsg(EXPECTED_EPSG), CRS.from_epsg(TARGET_SRID), always_xy=True
    )

    # Resolve canonical sheets (reads .shp checksums; halts on a conflicting dup).
    canonical_sheets: list[CanonicalSheet] = []
    for tile_id in selected_ids:
        sheet = resolve_canonical_sheet(tile_id, by_id[tile_id])
        _gate_sheet_contract(sheet)
        canonical_sheets.append(sheet)
        if sheet.duplicate_occurrence_count > 1:
            report.duplicate_occurrences_loaded_once += sheet.duplicate_occurrence_count - 1

    l1: set[str] = set()
    l2: set[str] = set()
    l3: set[str] = set()
    started = time.perf_counter()

    if not write:
        _dry_run_stream(
            report,
            canonical_sheets,
            transformer=transformer,
            l1=l1,
            l2=l2,
            l3=l3,
            progress=progress,
        )
        report.l1_code_count, report.l2_code_count, report.l3_code_count = len(l1), len(l2), len(l3)
        report.elapsed_seconds = time.perf_counter() - started
        report.features_per_second = (
            report.raw_features_read / report.elapsed_seconds if report.elapsed_seconds else 0.0
        )
        report.peak_rss_mb = _peak_rss_mb()
        report.status = "SUCCEEDED" if report.rejected_feature_count == 0 else "PARTIAL"
        return report

    return _write_release(
        report,
        canonical_sheets,
        contract=contract,
        transformer=transformer,
        l1=l1,
        l2=l2,
        l3=l3,
        session_factory=session_factory,
        started=started,
        progress=progress,
    )


def _accumulate_feature_stats(
    report: LandCoverIngestionReport,
    feature: NormalizedLandCoverFeature,
    *,
    l1: set[str],
    l2: set[str],
    l3: set[str],
) -> None:
    report.accepted_feature_count += 1
    if not feature.repair.source_valid:
        report.source_invalid_feature_count += 1
    if feature.repair.repair_status == "made_valid":
        report.repaired_feature_count += 1
    report.discarded_component_count += feature.repair.discarded_component_count
    gtype = feature.geometry_wgs84.geom_type
    report.geometry_type_counts[gtype] = report.geometry_type_counts.get(gtype, 0) + 1
    report.transformed_wkb_bytes_total += len(feature.geometry_wgs84.wkb)
    if feature.l1_code:
        l1.add(feature.l1_code)
    if feature.l2_code:
        l2.add(feature.l2_code)
    if feature.l3_code:
        l3.add(feature.l3_code)


def _dry_run_stream(
    report: LandCoverIngestionReport,
    sheets: Sequence[CanonicalSheet],
    *,
    transformer: Transformer,
    l1: set[str],
    l2: set[str],
    l3: set[str],
    progress: bool,
) -> None:
    import sys

    for position, sheet in enumerate(sheets, start=1):
        for index, feature, reason in iter_sheet_features(sheet, transformer=transformer):
            report.raw_features_read += 1
            if feature is None:
                report.add_rejection(sheet.map_sheet_id, index, reason or "unspecified")
                continue
            _accumulate_feature_stats(report, feature, l1=l1, l2=l2, l3=l3)
        report.map_sheets_processed += 1
        if progress:
            print(
                f"  [dry-run {position}/{len(sheets)}] sheet {sheet.map_sheet_id} "
                f"({report.raw_features_read} features)",
                file=sys.stderr,
                flush=True,
            )


def _write_release(
    report: LandCoverIngestionReport,
    sheets: Sequence[CanonicalSheet],
    *,
    contract: LandCoverValidationReport | None,
    transformer: Transformer,
    l1: set[str],
    l2: set[str],
    l3: set[str],
    session_factory: Any | None,
    started: float,
    progress: bool,
) -> LandCoverIngestionReport:
    import sys

    aggregate = report.aggregate_manifest_sha256
    assert aggregate is not None
    factory = session_factory or get_sessionmaker()
    session: Session = factory()
    now = _utcnow()
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=now,
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=REFERENCE_PERIOD,
        transformation_version=TRANSFORMATION_VERSION,
    )
    try:
        session.add(run)
        session.commit()
        session.refresh(run)
        report.ingestion_run_id = run.run_id

        version, created = _get_or_create_version(
            session,
            aggregate_manifest_sha256=aggregate,
            contract=contract,
            run=run,
            now=now,
            total_features=0,
            accepted=0,
            rejected=0,
        )
        report.dataset_version_id = version.id
        report.dataset_version_created = created

        sheet_tallies: list[tuple[CanonicalSheet, dict[str, int]]] = []
        writer = _BatchCopyWriter(session, batch_size=report.batch_size)
        for position, sheet in enumerate(sheets, start=1):
            tally = {"read": 0, "accepted": 0, "repaired": 0, "rejected": 0}
            for index, feature, reason in iter_sheet_features(sheet, transformer=transformer):
                report.raw_features_read += 1
                tally["read"] += 1
                if feature is None:
                    report.add_rejection(sheet.map_sheet_id, index, reason or "unspecified")
                    tally["rejected"] += 1
                    continue
                _accumulate_feature_stats(report, feature, l1=l1, l2=l2, l3=l3)
                tally["accepted"] += 1
                if not feature.repair.source_valid:
                    tally["repaired"] += 1
                writer.add(_feature_copy_row(feature, dataset_version_id=version.id, now=now))
            sheet_tallies.append((sheet, tally))
            report.map_sheets_processed += 1
            if progress:
                print(
                    f"  [write {position}/{len(sheets)}] sheet {sheet.map_sheet_id}",
                    file=sys.stderr,
                    flush=True,
                )
        report.inserted_feature_count = writer.finish()
        report.skipped_feature_count = report.accepted_feature_count - report.inserted_feature_count
        report.inserted_map_sheet_count = _write_map_sheet_rows(
            session, dataset_version_id=version.id, sheets=sheet_tallies, now=now
        )

        version.total_feature_count = report.raw_features_read
        version.accepted_feature_count = report.accepted_feature_count
        version.rejected_feature_count = report.rejected_feature_count

        run.status = "SUCCEEDED" if report.rejected_feature_count == 0 else "PARTIAL"
        run.completed_at = _utcnow()
        run.rows_received = report.raw_features_read
        run.rows_inserted = report.inserted_feature_count
        run.rows_rejected = report.rejected_feature_count
        # Freshness reflects a full successful load only.
        freshness = session.get(DatasetFreshness, SOURCE_ID)
        if freshness is None:
            freshness = DatasetFreshness(source_id=SOURCE_ID)
            session.add(freshness)
        freshness.latest_reference_period = REFERENCE_PERIOD
        freshness.last_checked_at = run.completed_at
        freshness.last_success_at = run.completed_at
        freshness.freshness_status = "FRESH"
        session.commit()
    except Exception as exc:
        session.rollback()
        run.status = "FAILED"
        run.completed_at = _utcnow()
        run.error_category = type(exc).__name__
        run.error_message = str(exc)[:2000]
        session.commit()
        report.status = "FAILED"
        report.add_warning(f"Ingestion failed and was rolled back: {exc}")
        raise
    finally:
        session.close()

    report.l1_code_count, report.l2_code_count, report.l3_code_count = len(l1), len(l2), len(l3)
    report.elapsed_seconds = time.perf_counter() - started
    report.features_per_second = (
        report.raw_features_read / report.elapsed_seconds if report.elapsed_seconds else 0.0
    )
    report.peak_rss_mb = _peak_rss_mb()
    if report.rejected_feature_count:
        report.status = "PARTIAL"
    return report


# --------------------------------------------------------------------------- #
# Coverage-proof design (Part 8) — reproducible, no invented tolerance
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class RegionCoverage:
    """Exact coverage geometry results for one 시도 boundary (areas in EPSG:5186 m²)."""

    region_code: str
    boundary_area_m2: float
    covered_area_m2: float
    uncovered_area_m2: float
    coverage_ratio: float


@dataclass(frozen=True)
class CoverageResult:
    """Exact coverage results against official boundaries. No tolerance is applied.

    ``coverage_ratio`` is reported per region; whether any given ratio is "enough"
    is a policy question this foundation phase deliberately leaves unresolved (no
    legally/methodologically justified tolerance exists to assert). Footprint
    overlap is the union-vs-sum-of-areas difference, in the same EPSG:5186 metre
    measure the areas use.
    """

    per_region: tuple[RegionCoverage, ...]
    footprint_overlap_area_m2: float
    tolerance_policy: str = (
        "NONE — exact geometry results only; threshold interpretation is UNRESOLVED "
        "(no justified tolerance asserted)."
    )


def coverage_against_boundaries(
    sheet_footprints_5186: Sequence[BaseGeometry],
    sido_boundaries_5186: Mapping[str, BaseGeometry],
) -> CoverageResult:
    """Compute exact covered / uncovered / overlap areas in the source CRS.

    Inputs are already in EPSG:5186 (the projected metre CRS the areas are
    measured in). Boundaries loaded from the platform's official ``regions`` in
    EPSG:4326 must be transformed to EPSG:5186 first (see
    :func:`compute_land_cover_coverage`). This function invents no tolerance: it
    returns the exact intersection/difference areas and the coverage ratio, and
    leaves any threshold decision to the caller.
    """

    footprints = [g for g in sheet_footprints_5186 if not g.is_empty]
    union = shapely.union_all(footprints) if footprints else Polygon()
    sum_area = float(sum(g.area for g in footprints))
    overlap = max(sum_area - float(union.area), 0.0)

    per_region: list[RegionCoverage] = []
    for region_code, boundary in sorted(sido_boundaries_5186.items()):
        boundary_area = float(boundary.area)
        covered = float(boundary.intersection(union).area) if not union.is_empty else 0.0
        uncovered = max(boundary_area - covered, 0.0)
        ratio = covered / boundary_area if boundary_area > 0 else 0.0
        per_region.append(
            RegionCoverage(
                region_code=region_code,
                boundary_area_m2=boundary_area,
                covered_area_m2=covered,
                uncovered_area_m2=uncovered,
                coverage_ratio=ratio,
            )
        )
    return CoverageResult(per_region=tuple(per_region), footprint_overlap_area_m2=overlap)


def compute_land_cover_coverage(
    session: Session, *, dataset_version_id: int, region_level: str = "SIDO"
) -> CoverageResult:
    """DB-driven coverage proof for a loaded release (validated method).

    Constructs each canonical map-sheet footprint as the union of its stored
    feature geometries, transforms the official ``regions`` boundaries into
    EPSG:5186, and delegates to :func:`coverage_against_boundaries`. This runs the
    *actual* calculation only once a release is loaded; the foundation phase
    validates the method on fixtures and never claims full official coverage from
    an unloaded source.
    """

    footprint_rows = session.execute(
        text(
            """
            SELECT ST_AsBinary(
                ST_Transform(ST_UnaryUnion(ST_Collect(geometry)), :epsg)
            ) AS wkb
            FROM environmental_land_cover_features
            WHERE dataset_version_id = :v
            GROUP BY map_sheet_id
            """
        ),
        {"v": dataset_version_id, "epsg": EXPECTED_EPSG},
    ).all()
    footprints = [shapely.from_wkb(bytes(row.wkb)) for row in footprint_rows if row.wkb is not None]

    boundary_rows = session.execute(
        text(
            """
            SELECT DISTINCT ON (region_code)
                   region_code, ST_AsBinary(ST_Transform(geometry, :epsg)) AS wkb
            FROM regions
            WHERE region_level = :level AND geometry IS NOT NULL
            ORDER BY region_code, valid_from DESC
            """
        ),
        {"level": region_level, "epsg": EXPECTED_EPSG},
    ).all()
    boundaries = {
        str(row.region_code): shapely.from_wkb(bytes(row.wkb))
        for row in boundary_rows
        if row.wkb is not None
    }
    return coverage_against_boundaries(footprints, boundaries)
