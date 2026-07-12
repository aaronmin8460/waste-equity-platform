"""Contract for VWorld 용도지역 (zoning) bulk structural-layer ingestion.

This module holds the pure, dependency-light logic for Phase 2.5B-1: the
UQ111–UQ114 layer/category mapping, source-CRS support and detection, geometry
normalization/validation, the deterministic feature fingerprint, and target
region resolution. Database access and file/archive I/O live in
``vworld_zoning_ingestion``.

Official basis: ``docs/VWORLD_STRUCTURAL_LAYER_AUDIT.md`` (Phase 2.5A). The four
용도지역 layers are 국토교통부 LSMD/NA_24 bulk shapefiles distributed per 시도,
native CRS EPSG:5186 (일부 2097), transformed to EPSG:4326 for PostGIS.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Any

import shapely
from shapely.geometry.base import BaseGeometry
from shapely.geometry.multipolygon import MultiPolygon
from shapely.geometry.polygon import Polygon

from .errors import IngestionError

SOURCE_ID = "vworld_structural"
PROVIDER = "국토교통부"
PROVIDER_DATASET_IDENTIFIER = "용도지역지구도 (LSMD/NA_24)"
LAYER_FAMILY = "zoning"
TRANSFORMATION_VERSION = "vworld-zoning-v1"
TARGET_CRS = "EPSG:4326"
TARGET_SRID = 4326
NORMALIZED_GEOMETRY_TYPE = "MultiPolygon"

# Documented source CRS allowlist for the zoning bulk files (audit CRS table):
# LSMD zone bulk is EPSG:5186 (일부 2097); the VWorld request-CRS family covers
# 5179 and 5185–5188. A source whose EPSG is not in this set is rejected rather
# than guessed.
SUPPORTED_SOURCE_EPSG: frozenset[int] = frozenset({4326, 2097, 5174, 5179, 5185, 5186, 5187, 5188})

# Default Korean attribute encoding for LSMD/NA_24 DBF files. Undecodable values
# are never silently replaced; the loader records and rejects the record.
DEFAULT_SOURCE_ENCODING = "cp949"


@dataclass(frozen=True)
class ZoningLayerSpec:
    """One 용도지역 layer: official code, category, and Korean name."""

    layer_code: str  # UQ111..UQ114
    layer_identifier: str  # LT_C_UQ111..
    zoning_category: str  # URBAN / MANAGEMENT / AGRICULTURAL_FOREST / NATURAL_ENV_CONSERVATION
    zoning_name: str  # 도시지역 / 관리지역 / 농림지역 / 자연환경보전지역


ZONING_LAYERS: tuple[ZoningLayerSpec, ...] = (
    ZoningLayerSpec("UQ111", "LT_C_UQ111", "URBAN", "도시지역"),
    ZoningLayerSpec("UQ112", "LT_C_UQ112", "MANAGEMENT", "관리지역"),
    ZoningLayerSpec("UQ113", "LT_C_UQ113", "AGRICULTURAL_FOREST", "농림지역"),
    ZoningLayerSpec("UQ114", "LT_C_UQ114", "NATURAL_ENV_CONSERVATION", "자연환경보전지역"),
)

ZONING_LAYERS_BY_CODE: dict[str, ZoningLayerSpec] = {
    spec.layer_code: spec for spec in ZONING_LAYERS
}


@dataclass(frozen=True)
class TargetRegion:
    """A target 시도 in the capital-region scope."""

    dir_name: str
    sido_code: str
    sido_name: str


TARGET_REGIONS: tuple[TargetRegion, ...] = (
    TargetRegion("seoul", "11", "서울특별시"),
    TargetRegion("incheon", "28", "인천광역시"),
    TargetRegion("gyeonggi", "41", "경기도"),
)

TARGET_REGIONS_BY_DIR: dict[str, TargetRegion] = {r.dir_name: r for r in TARGET_REGIONS}

# Official source attributes preserved for interpretation (audit WFS schema).
# Kept verbatim in ``source_attributes``; a subset feeds the fingerprint.
INTERPRETATION_ATTRIBUTES: tuple[str, ...] = (
    "uname",
    "ucode",
    "mnum",
    "dyear",
    "dnum",
    "sido_cd",
    "sigungu_cd",
    "admin_cd",
    "sido_name",
    "sigg_name",
)

# The minimum attribute needed to interpret a zoning feature. VWorld zone WFS
# exposes ``uname``/``ucode``; bulk LSMD DBFs carry the same columns.
REQUIRED_ATTRIBUTES: tuple[str, ...] = ("uname",)

_UPPER_ALNUM = re.compile(r"[^A-Z0-9]")


class UnsupportedCrsError(IngestionError):
    """Raised when a source CRS is missing or not in the supported allowlist."""


class GeometryValidationError(IngestionError):
    """Raised when a geometry is not a usable polygon/multipolygon."""


def zoning_layer_for_name(name: str) -> ZoningLayerSpec | None:
    """Resolve a UQ111–UQ114 layer from a shapefile/archive base name.

    Matches the official layer token (``uq111`` or ``lt_c_uq111``) case- and
    separator-insensitively. Returns ``None`` when no zoning layer is present
    so non-zoning files can be skipped without guessing.
    """

    token = _UPPER_ALNUM.sub("", name.upper())
    for spec in ZONING_LAYERS:
        if spec.layer_code in token:
            return spec
    return None


def region_for_dir_name(name: str) -> TargetRegion | None:
    """Resolve a target 시도 from a source subdirectory name."""

    return TARGET_REGIONS_BY_DIR.get(name.strip().lower())


def epsg_from_prj(prj_text: str) -> int | None:
    """Read the EPSG code from a shapefile ``.prj`` WKT, or ``None``.

    Uses pyproj to interpret the projection WKT. Returns ``None`` when the WKT
    is absent/unparseable or pyproj cannot resolve a definite EPSG code; the
    caller rejects rather than guesses.
    """

    text = prj_text.strip()
    if not text:
        return None
    try:
        from pyproj import CRS
        from pyproj.exceptions import CRSError

        crs = CRS.from_wkt(text)
    except (CRSError, ValueError):
        return None
    epsg = crs.to_epsg()
    return int(epsg) if epsg is not None else None


def require_supported_source_crs(epsg: int | None) -> str:
    """Validate a detected EPSG against the documented allowlist.

    Returns the canonical ``EPSG:<code>`` string, or raises
    ``UnsupportedCrsError`` for a missing or unsupported CRS.
    """

    if epsg is None:
        raise UnsupportedCrsError(
            "Source CRS is missing or undetectable; refusing to guess the projection."
        )
    if epsg not in SUPPORTED_SOURCE_EPSG:
        raise UnsupportedCrsError(
            f"Unsupported source CRS EPSG:{epsg}; supported: "
            + ", ".join(f"EPSG:{code}" for code in sorted(SUPPORTED_SOURCE_EPSG))
        )
    return f"EPSG:{epsg}"


def validate_required_attributes(attributes: dict[str, Any]) -> list[str]:
    """Return the list of missing required zoning attributes (empty when ok)."""

    missing: list[str] = []
    for name in REQUIRED_ATTRIBUTES:
        value = attributes.get(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            missing.append(name)
    return missing


def normalize_polygonal_geometry(geom: BaseGeometry) -> tuple[MultiPolygon, bool]:
    """Normalize a polygonal geometry to MultiPolygon in EPSG:4326 space.

    Returns ``(multipolygon, promoted)`` where ``promoted`` is True when a
    single Polygon was wrapped into a MultiPolygon (a topology-preserving
    normalization that is counted and documented). Rejects empty, invalid, and
    non-polygonal geometry rather than performing topology-changing repairs on
    legally meaningful boundaries.
    """

    if geom.is_empty:
        raise GeometryValidationError("Empty geometry")
    geom_type = geom.geom_type
    if geom_type not in ("Polygon", "MultiPolygon"):
        raise GeometryValidationError(f"Unexpected geometry type {geom_type}; expected polygon")
    if not geom.is_valid:
        # Invalid boundaries are reported and rejected, never silently repaired.
        raise GeometryValidationError("Invalid polygon geometry")
    if isinstance(geom, Polygon):
        return MultiPolygon([geom]), True
    assert isinstance(geom, MultiPolygon)
    return geom, False


def feature_fingerprint(
    geometry: BaseGeometry,
    *,
    layer_code: str,
    target_region_code: str | None,
    source_attributes: dict[str, Any],
) -> str:
    """Deterministic sha256 over normalized geometry plus relevant attributes.

    Identity does not rely on the provider feature id (stability across provider
    refreshes is unverified). It combines the canonicalized geometry with the
    layer code, target region, and the interpretation attributes so it changes
    when either the geometry or a relevant official attribute changes.
    """

    normalized = shapely.normalize(geometry)
    relevant = {name: source_attributes.get(name) for name in INTERPRETATION_ATTRIBUTES}
    payload = {
        "layer_code": layer_code,
        "target_region_code": target_region_code,
        "attributes": relevant,
    }
    digest = hashlib.sha256()
    digest.update(normalized.wkb)
    digest.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


@dataclass
class RegionLayerCoverage:
    """Coverage classification for one (region, layer) cell."""

    # EVALUATED_WITH_FEATURES | EVALUATED_ZERO_FEATURES | NOT_EVALUATED |
    # SOURCE_MISSING | VALIDATION_FAILURE
    status: str
    feature_count: int = 0
    detail: str | None = None


def classify_region_layer(
    *,
    source_present: bool,
    validation_failed: bool,
    feature_count: int,
    evaluated: bool,
) -> RegionLayerCoverage:
    """Classify a (region, layer) cell honestly.

    Never treats zero features as equivalent to not-evaluated: a region whose
    source was read and validated but yielded no matching features is
    ``EVALUATED_ZERO_FEATURES``, distinct from ``NOT_EVALUATED``.
    """

    if not source_present:
        return RegionLayerCoverage("SOURCE_MISSING")
    if validation_failed:
        return RegionLayerCoverage("VALIDATION_FAILURE", feature_count=feature_count)
    if not evaluated:
        return RegionLayerCoverage("NOT_EVALUATED")
    if feature_count > 0:
        return RegionLayerCoverage("EVALUATED_WITH_FEATURES", feature_count=feature_count)
    return RegionLayerCoverage("EVALUATED_ZERO_FEATURES", feature_count=0)


@dataclass
class ZoningFeature:
    """A normalized, validated zoning feature ready for persistence."""

    layer_identifier: str
    zoning_category: str
    official_zoning_code: str
    official_zoning_name: str
    provider_feature_id: str | None
    target_region_code: str | None
    target_region_name: str | None
    source_attributes: dict[str, Any]
    geometry_wkt: str
    feature_fingerprint: str
    source_provenance: dict[str, Any]


@dataclass
class ZoningLoadResult:
    """Outcome of validating/normalizing all zoning sources (no DB writes)."""

    features: list[ZoningFeature] = field(default_factory=list)
    total_feature_count: int = 0
    accepted_feature_count: int = 0
    rejected_feature_count: int = 0
    polygon_promoted_count: int = 0
    source_files: list[dict[str, Any]] = field(default_factory=list)
    coverage_matrix: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    regions_evaluated: list[str] = field(default_factory=list)
    source_crs_by_region: dict[str, str] = field(default_factory=dict)
    reference_date: str | None = None
    combined_checksum: str | None = None
    coverage_status: str = "INCOMPLETE"

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "reference_date": self.reference_date,
            "total_feature_count": self.total_feature_count,
            "accepted_feature_count": self.accepted_feature_count,
            "rejected_feature_count": self.rejected_feature_count,
            "polygon_promoted_count": self.polygon_promoted_count,
            "regions_evaluated": self.regions_evaluated,
            "source_crs_by_region": self.source_crs_by_region,
            "target_crs": TARGET_CRS,
            "coverage_status": self.coverage_status,
            "coverage_matrix": self.coverage_matrix,
            "warnings": self.warnings,
            "source_files": self.source_files,
        }


def combined_checksum(file_checksums: list[str]) -> str:
    """Deterministic checksum over the sorted per-file checksums of a release."""

    digest = hashlib.sha256()
    for value in sorted(file_checksums):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()
