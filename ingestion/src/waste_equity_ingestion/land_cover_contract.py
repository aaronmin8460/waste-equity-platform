"""Read-only contract verification for the 세분류 [2025] 토지피복지도 (Level-3 land cover).

Suitability Phase 1B (land-cover) — *verification only*. This module inspects a
local, tiled shapefile copy of the 환경부/EGIS 세분류 토지피복지도 for Seoul,
Incheon, and Gyeonggi and returns a typed report describing what the files
actually contain: source discovery by region, shapefile-set integrity, map-sheet
identity and duplication, the CRS declared by the ``.prj`` files, the DBF
encoding (there is **no** ``.cpg``, so the encoding is taken from the DBF
language-driver byte and proven by strict decoding — never assumed), the
attribute schema, per-region feature and class-code statistics, source extents,
and a deterministic, path-free aggregate provenance checksum.

Deliberately **read-only and offline**, exactly like
``wetland_inventory_contract`` which it reuses patterns from:

* every file is opened for reading only — nothing is renamed, rewritten,
  reprojected, repaired, simplified, merged, or de-duplicated, and invalid
  geometry is *reported*, never fixed;
* there is no database access and no HTTP access, so importing this module
  cannot ingest anything;
* no scoring, weighting, exclusion, or candidate logic lives here — this phase
  ends at "is this dataset what it claims to be, and is it safe to ingest later?".

The source root is always supplied by the caller (``--source-root`` /
``validate_land_cover(root)``); there is **no default** and no sample fallback,
so the validator can never silently point at sample data. The raw land-cover
files are Git-ignored local data and are never copied into the repository.

Sanitized output: the JSON summary carries file *names*, column names, declared
types, aggregate counts, ascii class codes, and a single aggregate checksum
only. No absolute filesystem path, no per-feature payload, and no raw Korean
attribute dump ever leaves this module.

Official dataset: 세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map,
2025), 환경부 환경공간정보서비스 (EGIS). Acquisition scope: Seoul, Incheon, Gyeonggi.
"""

from __future__ import annotations

import hashlib
import io
import struct
import sys
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import shapely
from pyproj import CRS
from pyproj.exceptions import CRSError

from .errors import IngestionError
from .vworld_zoning_contract import epsg_from_prj

CONTRACT_VERSION = "land-cover-contract-v1"
DATASET_KEY = "land_cover"
OFFICIAL_DATASET_NAME = "세분류 [2025] 전국 토지피복지도 (Detailed / Level-3 Land Cover Map, 2025)"
PROVIDER = "환경부 환경공간정보서비스 EGIS (Ministry of Environment, EGIS)"
#: The reference *year* stated by the dataset label. Kept deliberately distinct
#: from the local acquisition/download observation (see the provenance section):
#: a year is not a precise reference date and none is inferred from folder names,
#: DBF update bytes, or filesystem timestamps.
REFERENCE_YEAR = 2025
ACQUISITION_SCOPE = ("seoul", "incheon", "gyeonggi")

#: The three regional subdirectories every acquisition must contain. A missing
#: one is a hard, visible failure — never silently treated as empty.
REQUIRED_REGIONS = ("seoul", "incheon", "gyeonggi")

#: The CRS the parameters of the official ``.prj`` resolve to (Korea Central
#: Belt 2010). Note the ``.prj`` names the *ITRF2000* datum, not Korea 2000, so
#: EPSG:5186 is confirmed from projection *parameters*, never from the name.
EXPECTED_EPSG = 5186

#: Sidecars a readable shapefile set must ship. Unlike the wetland inventory this
#: source ships **no** ``.cpg``; the DBF encoding is taken from the DBF language
#: driver byte instead (see :func:`inspect_encoding`), never guessed.
REQUIRED_SIDECAR_SUFFIXES = (".shx", ".dbf", ".prj")
#: Present in this distribution but not required for ingestion (per-sheet imagery
#: metadata / QGIS / schema sidecars, and a ``.cpg`` if a future release adds one).
OPTIONAL_SIDECAR_SUFFIXES = (".cpg", ".xml", ".xlsx", ".xsd", ".qmd", ".qpj", ".sbn", ".sbx")

#: The authoritative observed DBF schema: ``(name, dbf_type, width)``. Types are
#: dBASE field types (``C`` character, ``D`` date). Verified against every real
#: shapefile; deviations are reported, never normalized.
EXPECTED_SCHEMA: tuple[tuple[str, str, int], ...] = (
    ("L1_CODE", "C", 3),
    ("L1_NAME", "C", 25),
    ("L2_CODE", "C", 3),
    ("L2_NAME", "C", 25),
    ("L3_CODE", "C", 3),
    ("L3_NAME", "C", 25),
    ("IMG_NAME", "C", 25),
    ("IMG_DATE", "D", 8),
    ("LU_INFO", "C", 25),
    ("ETC_INFO", "C", 25),
    ("ENV_INFO", "C", 25),
    ("FOR_INFO", "C", 25),
    ("UD_INFO", "C", 25),
    ("INX_NUM", "C", 8),
    ("ANNO", "C", 254),
)
#: The analytically essential columns; a real shapefile missing any of these
#: cannot be ingested and is a hard failure.
REQUIRED_FIELDS = ("L1_CODE", "L1_NAME", "L2_CODE", "L2_NAME", "L3_CODE", "L3_NAME")
#: Class code/name column pairs, in hierarchy order (parent → child).
CLASS_LEVELS = (("L1_CODE", "L1_NAME"), ("L2_CODE", "L2_NAME"), ("L3_CODE", "L3_NAME"))

#: dBASE language-driver (LDID) byte → declared code page. The official files
#: carry ``0x4E`` = Windows code page 949 (Korean, a strict superset of EUC-KR).
LDID_CODEPAGE = {
    0x00: (None, "no language driver declared"),
    0x4D: ("cp936", "Windows-936 (Simplified Chinese GBK)"),
    0x4E: ("cp949", "Windows-949 (Korean, UHC — superset of EUC-KR)"),
    0x4F: ("cp950", "Windows-950 (Traditional Chinese Big5)"),
    0x57: ("cp1252", "Windows-1252 (ANSI Latin-1)"),
}
#: Encodings the *local evidence* supports testing: the LDID-declared CP949 and
#: its narrower ancestor EUC-KR. UTF-8 is tested only to *disprove* it (the
#: source must never be labelled UTF-8 unless the bytes prove it).
EVIDENCE_ENCODINGS = ("cp949", "euc-kr")
DISPROOF_ENCODING = "utf-8"

#: Coarse WGS84 plausibility envelope for South Korea — a sanity screen for
#: grossly mis-projected extents, never an administrative boundary.
SOUTH_KOREA_WGS84_BOUNDS = (124.0, 32.5, 132.5, 39.0)
#: A generous EPSG:5186-metre envelope covering the capital region *including its
#: far-western Incheon islands* (observed minx ≈ 86 400 m ≈ 125.7°E). Used only to
#: flag a grossly-wrong or degenerate per-file extent, never to claim coverage and
#: never as an administrative boundary — the authoritative plausibility gate is
#: the WGS84 South Korea envelope on the combined extent.
CAPITAL_REGION_5186_BOUNDS = (0.0, 250000.0, 550000.0, 900000.0)

#: Cap on per-category examples so a report never becomes a data dump.
MAX_REPORTED_EXAMPLES = 30

STATUS_PASS = "PASS"
STATUS_PASS_WITH_WARNINGS = "PASS_WITH_WARNINGS"
STATUS_FAIL = "FAIL"

#: Ingestion go/no-go, derived one-to-one from status.
GO = "GO"
CONDITIONAL_GO = "CONDITIONAL_GO"
NO_GO = "NO_GO"
_RECOMMENDATION = {STATUS_PASS: GO, STATUS_PASS_WITH_WARNINGS: CONDITIONAL_GO, STATUS_FAIL: NO_GO}


class LandCoverContractError(IngestionError):
    """Raised when the supplied source root cannot be inspected at all."""


# --------------------------------------------------------------------------- #
# Report types
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class RegionDiscovery:
    """What was found under one regional subdirectory."""

    region: str
    present: bool
    shapefile_count: int
    tile_dir_count: int


@dataclass(frozen=True)
class SidecarIntegrity:
    """Aggregate shapefile-set integrity across every real ``.shp``."""

    shapefile_count: int
    complete_set_count: int
    missing_required: tuple[tuple[str, str, str], ...]  # (region, tile_id, suffix)
    zero_byte_files: tuple[tuple[str, str, str], ...]  # (region, tile_id, filename)
    unreadable_files: tuple[tuple[str, str, str], ...]  # (region, tile_id, reason)
    optional_sidecar_counts: tuple[tuple[str, int], ...]
    cpg_present_count: int


@dataclass(frozen=True)
class DuplicateTile:
    """One map-sheet identifier that occurs more than once."""

    tile_id: str
    occurrences: tuple[tuple[str, str], ...]  # (region, dir_name)
    scope: str  # "within-region" | "cross-region"
    distinct_shp_checksums: int
    byte_identical: bool


@dataclass(frozen=True)
class DuplicateReport:
    """Map-sheet duplication findings and the policy recommendation."""

    total_tile_ids: int
    duplicate_tile_ids: int
    duplicates: tuple[DuplicateTile, ...]
    cross_region_shared_ids: tuple[str, ...]
    policy_recommendation: str
    seoul_web_vs_local_note: str


@dataclass(frozen=True)
class CrsReport:
    """What the ``.prj`` files declare, and whether they resolve to one CRS."""

    prj_count: int
    distinct_prj_checksums: int
    all_identical: bool
    crs_name: str | None
    resolved_epsg: int | None
    resolved_via: str
    authority_epsg: int | None
    equals_expected_registry: bool | None
    matches_expected: bool
    is_projected: bool | None
    datum_name: str | None
    ellipsoid_name: str | None
    projection_method: str | None
    projection_parameters: tuple[tuple[str, float, str], ...]
    distinct_resolved_epsg: tuple[int, ...]
    unresolved_reason: str | None


@dataclass(frozen=True)
class EncodingReport:
    """DBF encoding evidence — proven by strict decode, never assumed."""

    cpg_present: bool
    ldid_bytes: tuple[tuple[str, int], ...]  # (hex, count)
    declared_codepage: str | None
    declared_encoding_evidence: str
    tested_encodings: tuple[tuple[str, int, int], ...]  # (encoding, files_ok, files_failed)
    observed_compatible_encoding: str | None
    chosen_encoding: str
    chosen_total_records: int
    chosen_undecodable_records: int
    utf8_rejected: bool
    exact_provider_declared_encoding_resolved: bool
    korean_samples_decoded: bool


@dataclass(frozen=True)
class SchemaReport:
    """Authoritative observed schema and any per-file deviation."""

    authoritative_schema: tuple[tuple[str, str, int], ...]
    distinct_schema_variants: int
    files_matching_authoritative: int
    files_missing_required_field: tuple[tuple[str, str, str], ...]  # (region, tile_id, field)
    files_with_extra_fields: tuple[tuple[str, str, str], ...]  # (region, tile_id, field)
    files_with_type_or_width_mismatch: tuple[tuple[str, str, str], ...]


@dataclass(frozen=True)
class ClassDictionaryReport:
    """Observed L1/L2/L3 code↔name dictionaries and their integrity."""

    l1_code_count: int
    l2_code_count: int
    l3_code_count: int
    code_to_multiple_names: tuple[tuple[str, str, int], ...]  # (level, code, n_names)
    name_to_multiple_codes: tuple[tuple[str, str, int], ...]  # (level, name, n_codes)
    hierarchy_violations: tuple[tuple[str, str], ...]  # (level, child_code)
    malformed_codes: tuple[tuple[str, str], ...]  # (level, code)
    null_or_blank_required: tuple[tuple[str, int], ...]  # (field, count)


@dataclass(frozen=True)
class GeometryReport:
    """Observed geometry statistics. Nothing here repairs or alters geometry."""

    total_features: int
    features_by_region: tuple[tuple[str, int], ...]
    geometry_type_counts: tuple[tuple[str, int], ...]
    null_geometry_count: int
    empty_geometry_count: int
    invalid_geometry_count: int
    invalid_reason_counts: tuple[tuple[str, int], ...]
    zero_feature_file_count: int
    zero_feature_files: tuple[tuple[str, str], ...]  # (region, tile_id)
    dbf_shx_count_mismatch_count: int


@dataclass(frozen=True)
class SpatialReport:
    """Source extents and the (conservative) coverage assessment."""

    region_bounds_5186: tuple[tuple[str, tuple[float, float, float, float]], ...]
    combined_bounds_5186: tuple[float, float, float, float] | None
    combined_bounds_wgs84: tuple[float, float, float, float] | None
    within_south_korea_envelope: bool | None
    implausible_extent_files: tuple[tuple[str, str], ...]  # (region, tile_id)
    duplicate_tile_overlap: tuple[tuple[str, float], ...]  # (tile_id, bbox_iou)
    coverage_status: str
    coverage_evidence_gap: str


@dataclass(frozen=True)
class ProvenanceReport:
    """Sanitized, path-free provenance and the aggregate manifest checksum."""

    official_dataset_name: str
    provider: str
    reference_year: int
    acquisition_scope: tuple[str, ...]
    acquisition_observed_note: str
    imagery_date_note: str
    real_source_file_count: int
    real_source_total_bytes: int
    aggregate_manifest_sha256: str
    per_region_manifest_sha256: tuple[tuple[str, str], ...]
    provider_evidence_note: str


@dataclass(frozen=True)
class LandCoverValidationReport:
    """Full read-only verification result for a local land-cover acquisition."""

    contract_version: str
    dataset_key: str
    source_root_name: str
    status: str
    regions: tuple[RegionDiscovery, ...]
    sidecars: SidecarIntegrity | None
    duplicates: DuplicateReport | None
    crs: CrsReport | None
    encoding: EncodingReport | None
    schema: SchemaReport | None
    class_dictionary: ClassDictionaryReport | None
    geometry: GeometryReport | None
    spatial: SpatialReport | None
    provenance: ProvenanceReport | None
    unresolved_issues: tuple[str, ...] = field(default_factory=tuple)
    errors: tuple[str, ...] = field(default_factory=tuple)
    warnings: tuple[str, ...] = field(default_factory=tuple)

    @property
    def recommendation(self) -> str:
        return _RECOMMENDATION[self.status]

    def to_summary(self) -> dict[str, Any]:
        """A JSON-safe summary with no path, no per-feature payload, no Korean dump.

        Class dictionaries are emitted as *counts* plus ascii conflict *codes*;
        the Korean class labels themselves are never serialized here.
        """

        return {
            "contract_version": self.contract_version,
            "dataset_key": self.dataset_key,
            "official_dataset_name": OFFICIAL_DATASET_NAME,
            "provider": PROVIDER,
            "reference_year": REFERENCE_YEAR,
            "source_root_name": self.source_root_name,
            "status": self.status,
            "recommendation": self.recommendation,
            "regions": [
                {
                    "region": r.region,
                    "present": r.present,
                    "shapefile_count": r.shapefile_count,
                    "tile_dir_count": r.tile_dir_count,
                }
                for r in self.regions
            ],
            "sidecars": None if self.sidecars is None else _sidecar_summary(self.sidecars),
            "duplicates": None if self.duplicates is None else _duplicate_summary(self.duplicates),
            "crs": None if self.crs is None else _crs_summary(self.crs),
            "encoding": None if self.encoding is None else _encoding_summary(self.encoding),
            "schema": None if self.schema is None else _schema_summary(self.schema),
            "class_dictionary": (
                None if self.class_dictionary is None else _class_summary(self.class_dictionary)
            ),
            "geometry": None if self.geometry is None else _geometry_summary(self.geometry),
            "spatial": None if self.spatial is None else _spatial_summary(self.spatial),
            "provenance": None if self.provenance is None else _provenance_summary(self.provenance),
            "unresolved_issues": list(self.unresolved_issues),
            "errors": list(self.errors),
            "warnings": list(self.warnings),
        }


def _sidecar_summary(s: SidecarIntegrity) -> dict[str, Any]:
    return {
        "shapefile_count": s.shapefile_count,
        "complete_set_count": s.complete_set_count,
        "missing_required_count": len(s.missing_required),
        "missing_required": [list(x) for x in s.missing_required[:MAX_REPORTED_EXAMPLES]],
        "zero_byte_file_count": len(s.zero_byte_files),
        "unreadable_file_count": len(s.unreadable_files),
        "optional_sidecar_counts": dict(s.optional_sidecar_counts),
        "cpg_present_count": s.cpg_present_count,
    }


def _duplicate_summary(d: DuplicateReport) -> dict[str, Any]:
    return {
        "total_tile_ids": d.total_tile_ids,
        "duplicate_tile_ids": d.duplicate_tile_ids,
        "cross_region_shared_ids": list(d.cross_region_shared_ids[:MAX_REPORTED_EXAMPLES]),
        "duplicates": [
            {
                "tile_id": t.tile_id,
                "scope": t.scope,
                "occurrences": [list(o) for o in t.occurrences],
                "distinct_shp_checksums": t.distinct_shp_checksums,
                "byte_identical": t.byte_identical,
            }
            for t in d.duplicates[:MAX_REPORTED_EXAMPLES]
        ],
        "policy_recommendation": d.policy_recommendation,
        "seoul_web_vs_local_note": d.seoul_web_vs_local_note,
    }


def _crs_summary(c: CrsReport) -> dict[str, Any]:
    return {
        "prj_count": c.prj_count,
        "distinct_prj_checksums": c.distinct_prj_checksums,
        "all_identical": c.all_identical,
        "crs_name": c.crs_name,
        "resolved_epsg": c.resolved_epsg,
        "resolved_via": c.resolved_via,
        "authority_epsg": c.authority_epsg,
        "equals_expected_registry": c.equals_expected_registry,
        "matches_expected": c.matches_expected,
        "is_projected": c.is_projected,
        "datum_name": c.datum_name,
        "ellipsoid_name": c.ellipsoid_name,
        "projection_method": c.projection_method,
        "projection_parameters": [
            {"name": n, "value": v, "unit": u} for n, v, u in c.projection_parameters
        ],
        "distinct_resolved_epsg": list(c.distinct_resolved_epsg),
        "unresolved_reason": c.unresolved_reason,
    }


def _encoding_summary(e: EncodingReport) -> dict[str, Any]:
    return {
        "cpg_present": e.cpg_present,
        "ldid_bytes": dict(e.ldid_bytes),
        "declared_codepage": e.declared_codepage,
        "declared_encoding_evidence": e.declared_encoding_evidence,
        "tested_encodings": [
            {"encoding": enc, "files_ok": ok, "files_failed": failed}
            for enc, ok, failed in e.tested_encodings
        ],
        "observed_compatible_encoding": e.observed_compatible_encoding,
        "chosen_encoding": e.chosen_encoding,
        "chosen_total_records": e.chosen_total_records,
        "chosen_undecodable_records": e.chosen_undecodable_records,
        "utf8_rejected": e.utf8_rejected,
        "exact_provider_declared_encoding_resolved": e.exact_provider_declared_encoding_resolved,
        "korean_samples_decoded": e.korean_samples_decoded,
    }


def _schema_summary(s: SchemaReport) -> dict[str, Any]:
    return {
        "authoritative_schema": [
            {"name": n, "type": t, "width": w} for n, t, w in s.authoritative_schema
        ],
        "distinct_schema_variants": s.distinct_schema_variants,
        "files_matching_authoritative": s.files_matching_authoritative,
        "files_missing_required_field_count": len(s.files_missing_required_field),
        "files_with_extra_fields_count": len(s.files_with_extra_fields),
        "files_with_type_or_width_mismatch_count": len(s.files_with_type_or_width_mismatch),
        "missing_required_examples": [
            list(x) for x in s.files_missing_required_field[:MAX_REPORTED_EXAMPLES]
        ],
    }


def _class_summary(c: ClassDictionaryReport) -> dict[str, Any]:
    return {
        "l1_code_count": c.l1_code_count,
        "l2_code_count": c.l2_code_count,
        "l3_code_count": c.l3_code_count,
        "code_to_multiple_names": [
            list(x) for x in c.code_to_multiple_names[:MAX_REPORTED_EXAMPLES]
        ],
        "name_to_multiple_codes_count": len(c.name_to_multiple_codes),
        "hierarchy_violation_count": len(c.hierarchy_violations),
        "hierarchy_violations": [list(x) for x in c.hierarchy_violations[:MAX_REPORTED_EXAMPLES]],
        "malformed_code_count": len(c.malformed_codes),
        "malformed_codes": [list(x) for x in c.malformed_codes[:MAX_REPORTED_EXAMPLES]],
        "null_or_blank_required": dict(c.null_or_blank_required),
    }


def _geometry_summary(g: GeometryReport) -> dict[str, Any]:
    return {
        "total_features": g.total_features,
        "features_by_region": dict(g.features_by_region),
        "geometry_type_counts": dict(g.geometry_type_counts),
        "null_geometry_count": g.null_geometry_count,
        "empty_geometry_count": g.empty_geometry_count,
        "invalid_geometry_count": g.invalid_geometry_count,
        "invalid_reason_counts": dict(g.invalid_reason_counts),
        "zero_feature_file_count": g.zero_feature_file_count,
        "dbf_shx_count_mismatch_count": g.dbf_shx_count_mismatch_count,
    }


def _spatial_summary(s: SpatialReport) -> dict[str, Any]:
    return {
        "region_bounds_5186": {r: list(b) for r, b in s.region_bounds_5186},
        "combined_bounds_5186": None
        if s.combined_bounds_5186 is None
        else list(s.combined_bounds_5186),
        "combined_bounds_wgs84": (
            None if s.combined_bounds_wgs84 is None else list(s.combined_bounds_wgs84)
        ),
        "within_south_korea_envelope": s.within_south_korea_envelope,
        "implausible_extent_file_count": len(s.implausible_extent_files),
        "duplicate_tile_overlap": [
            {"tile_id": t, "bbox_iou": round(v, 6)} for t, v in s.duplicate_tile_overlap
        ],
        "coverage_status": s.coverage_status,
        "coverage_evidence_gap": s.coverage_evidence_gap,
    }


def _provenance_summary(p: ProvenanceReport) -> dict[str, Any]:
    return {
        "official_dataset_name": p.official_dataset_name,
        "provider": p.provider,
        "reference_year": p.reference_year,
        "acquisition_scope": list(p.acquisition_scope),
        "acquisition_observed_note": p.acquisition_observed_note,
        "imagery_date_note": p.imagery_date_note,
        "real_source_file_count": p.real_source_file_count,
        "real_source_total_bytes": p.real_source_total_bytes,
        "aggregate_manifest_sha256": p.aggregate_manifest_sha256,
        "per_region_manifest_sha256": dict(p.per_region_manifest_sha256),
        "provider_evidence_note": p.provider_evidence_note,
    }


# --------------------------------------------------------------------------- #
# Source discovery (read-only)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class TileSource:
    """One real shapefile set located under a regional directory."""

    region: str
    tile_id: str
    dir_name: str
    shp_path: Path
    dir_embedded_id: str | None


def _is_ignored_name(name: str) -> bool:
    """AppleDouble, .DS_Store, and hidden Apple metadata are never source files."""

    return name.startswith("._") or name == ".DS_Store"


def _iter_real_files(directory: Path) -> Iterator[Path]:
    for entry in directory.iterdir():
        if entry.is_file() and not _is_ignored_name(entry.name):
            yield entry


def _tile_id_for(shp_path: Path, dir_name: str) -> tuple[str, str | None]:
    """Derive the map-sheet id from the file name, cross-checked with the dir.

    The ``.shp`` stem (e.g. ``37705097``) is the canonical map-sheet number. The
    directory name (``SG05_37705097_20251113``) embeds the same id between an
    acquisition-product prefix and an image date; both are recorded so a mismatch
    is visible rather than hidden.
    """

    stem = shp_path.stem
    embedded: str | None = None
    parts = dir_name.split("_")
    for token in parts[1:]:
        if token.isdigit() and len(token) >= 6:
            embedded = token
            break
    return stem, embedded


def discover_sources(source_root: Path) -> tuple[list[TileSource], list[RegionDiscovery]]:
    """Recursively discover real ``.shp`` files grouped by region.

    Apple metadata (``._*``), ``.DS_Store``, and hidden directories are ignored.
    A missing required regional directory is recorded as ``present=False`` so the
    caller can fail visibly rather than silently proceeding on partial data.
    """

    sources: list[TileSource] = []
    discoveries: list[RegionDiscovery] = []
    for region in REQUIRED_REGIONS:
        region_dir = source_root / region
        if not region_dir.is_dir():
            discoveries.append(
                RegionDiscovery(region=region, present=False, shapefile_count=0, tile_dir_count=0)
            )
            continue
        region_sources: list[TileSource] = []
        tile_dirs = 0
        for entry in sorted(region_dir.iterdir(), key=lambda p: p.name):
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            tile_dirs += 1
            for candidate in sorted(_iter_real_files(entry), key=lambda p: p.name):
                if candidate.suffix.lower() == ".shp":
                    tile_id, embedded = _tile_id_for(candidate, entry.name)
                    region_sources.append(
                        TileSource(
                            region=region,
                            tile_id=tile_id,
                            dir_name=entry.name,
                            shp_path=candidate,
                            dir_embedded_id=embedded,
                        )
                    )
        sources.extend(region_sources)
        discoveries.append(
            RegionDiscovery(
                region=region,
                present=True,
                shapefile_count=len(region_sources),
                tile_dir_count=tile_dirs,
            )
        )
    return sources, discoveries


# --------------------------------------------------------------------------- #
# Low-level file readers (read-only, single USB pass per file)
# --------------------------------------------------------------------------- #


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _read_dbf_header(data: bytes) -> tuple[int, int, tuple[tuple[str, str, int, int], ...]]:
    """Parse record count, LDID byte, and field descriptors from DBF bytes."""

    record_count = struct.unpack("<I", data[4:8])[0]
    ldid = data[29]
    fields: list[tuple[str, str, int, int]] = []
    offset = 32
    while offset < len(data) and data[offset] != 0x0D:
        fd = data[offset : offset + 32]
        if len(fd) < 32:
            break
        name = fd[0:11].split(b"\x00")[0].decode("ascii", "replace")
        ftype = chr(fd[11])
        flen = fd[16]
        dec = fd[17]
        fields.append((name, ftype, flen, dec))
        offset += 32
    return record_count, ldid, tuple(fields)


def _read_shp_header(data: bytes) -> tuple[int, tuple[float, float, float, float]]:
    """Parse the shape type and bounding box from the 100-byte ``.shp`` header."""

    shape_type = struct.unpack("<i", data[32:36])[0]
    bbox = struct.unpack("<4d", data[36:68])
    return shape_type, bbox


def _shx_record_count(shx_bytes: bytes) -> int:
    return max((len(shx_bytes) - 100) // 8, 0)


# --------------------------------------------------------------------------- #
# CRS
# --------------------------------------------------------------------------- #


def inspect_crs(
    prj_texts: Sequence[tuple[str, str]], *, expected_epsg: int = EXPECTED_EPSG
) -> CrsReport:
    """Resolve the CRS from every ``.prj`` and confirm they agree.

    ``prj_texts`` is a sequence of ``(sha256, text)`` for each real ``.prj``.
    EPSG:5186 is confirmed from the projection *parameters* via the shared
    :func:`epsg_from_prj` helper — never from the datum name, which this source
    declares as ITRF2000 rather than Korea 2000. PROJ's own authority-based
    ``to_epsg()`` returning ``None`` and ``CRS.equals(EPSG:5186)`` returning
    ``False`` are both recorded as evidence, not treated as the answer.
    """

    checksums = {sha for sha, _ in prj_texts}
    if not prj_texts:
        return CrsReport(
            prj_count=0,
            distinct_prj_checksums=0,
            all_identical=False,
            crs_name=None,
            resolved_epsg=None,
            resolved_via="none",
            authority_epsg=None,
            equals_expected_registry=None,
            matches_expected=False,
            is_projected=None,
            datum_name=None,
            ellipsoid_name=None,
            projection_method=None,
            projection_parameters=(),
            distinct_resolved_epsg=(),
            unresolved_reason="No .prj files were found.",
        )

    # Resolve each distinct .prj text once.
    resolved: set[int | None] = set()
    distinct_texts: dict[str, str] = {}
    for sha, text in prj_texts:
        distinct_texts.setdefault(sha, text)
    sample_text = next(iter(distinct_texts.values()))
    for text in distinct_texts.values():
        resolved.add(epsg_from_prj(text))

    try:
        crs = CRS.from_wkt(sample_text.strip())
    except (CRSError, ValueError) as exc:
        return CrsReport(
            prj_count=len(prj_texts),
            distinct_prj_checksums=len(checksums),
            all_identical=len(checksums) == 1,
            crs_name=None,
            resolved_epsg=None,
            resolved_via="unparseable",
            authority_epsg=None,
            equals_expected_registry=None,
            matches_expected=False,
            is_projected=None,
            datum_name=None,
            ellipsoid_name=None,
            projection_method=None,
            projection_parameters=(),
            distinct_resolved_epsg=(),
            unresolved_reason=f"Unparseable .prj WKT: {exc}",
        )

    authority = crs.to_epsg()
    resolved_epsg = epsg_from_prj(sample_text)
    if authority is not None:
        resolved_via = "proj-authority"
    elif resolved_epsg is not None:
        resolved_via = "tm-parameter-match"
    else:
        resolved_via = "unresolved"
    operation = crs.coordinate_operation
    parameters = (
        tuple((p.name, float(p.value), p.unit_name) for p in operation.params)
        if operation is not None
        else ()
    )
    try:
        equals_registry = crs.equals(CRS.from_epsg(expected_epsg))
    except CRSError:
        equals_registry = None

    distinct_resolved = tuple(sorted(v for v in resolved if v is not None))
    unresolved = None
    if None in resolved:
        unresolved = "One or more .prj files could not be resolved to a definite EPSG code."
    elif len(distinct_resolved) > 1:
        unresolved = f"Mixed CRS across files: EPSG {distinct_resolved}."

    return CrsReport(
        prj_count=len(prj_texts),
        distinct_prj_checksums=len(checksums),
        all_identical=len(checksums) == 1,
        crs_name=crs.name,
        resolved_epsg=resolved_epsg,
        resolved_via=resolved_via,
        authority_epsg=authority,
        equals_expected_registry=equals_registry,
        matches_expected=(distinct_resolved == (expected_epsg,)),
        is_projected=crs.is_projected,
        datum_name=None if crs.datum is None else crs.datum.name,
        ellipsoid_name=None if crs.ellipsoid is None else crs.ellipsoid.name,
        projection_method=None if operation is None else operation.method_name,
        projection_parameters=parameters,
        distinct_resolved_epsg=distinct_resolved,
        unresolved_reason=unresolved,
    )


# --------------------------------------------------------------------------- #
# Accumulator (single streaming pass over all tiles)
# --------------------------------------------------------------------------- #


class _Accumulator:
    """Mutable aggregation state for one full pass. Holds no geometry batch."""

    def __init__(self) -> None:
        # Sidecar integrity
        self.complete_sets = 0
        self.missing_required: list[tuple[str, str, str]] = []
        self.zero_byte: list[tuple[str, str, str]] = []
        self.unreadable: list[tuple[str, str, str]] = []
        self.optional_counts: dict[str, int] = {}
        self.cpg_present = 0
        # Duplication
        self.tile_occurrences: dict[str, list[tuple[str, str]]] = {}
        self.tile_shp_checksums: dict[str, set[str]] = {}
        self.tile_bboxes: dict[str, list[tuple[float, float, float, float]]] = {}
        # CRS
        self.prj_texts: list[tuple[str, str]] = []
        # Encoding
        self.ldid_counts: dict[int, int] = {}
        self.encoding_ok: dict[str, int] = {
            enc: 0 for enc in (*EVIDENCE_ENCODINGS, DISPROOF_ENCODING)
        }
        self.encoding_failed: dict[str, int] = {
            enc: 0 for enc in (*EVIDENCE_ENCODINGS, DISPROOF_ENCODING)
        }
        self.korean_samples_decoded = False
        # Full strict decode under the chosen encoding (the definitive test).
        self.chosen_total = 0
        self.chosen_undecodable = 0
        # Schema
        self.schema_variants: dict[tuple[tuple[str, str, int], ...], int] = {}
        self.files_matching_schema = 0
        self.schema_missing_required: list[tuple[str, str, str]] = []
        self.schema_extra: list[tuple[str, str, str]] = []
        self.schema_type_mismatch: list[tuple[str, str, str]] = []
        # Class dictionary
        self.code_to_names: dict[str, dict[str, set[str]]] = {"L1": {}, "L2": {}, "L3": {}}
        self.name_to_codes: dict[str, dict[str, set[str]]] = {"L1": {}, "L2": {}, "L3": {}}
        self.child_to_parent: dict[str, dict[str, set[str]]] = {"L2": {}, "L3": {}}
        self.null_blank: dict[str, int] = {f: 0 for f in REQUIRED_FIELDS}
        # Geometry
        self.total_features = 0
        self.features_by_region: dict[str, int] = {}
        self.geom_types: dict[str, int] = {}
        self.null_geom = 0
        self.empty_geom = 0
        self.invalid_geom = 0
        self.invalid_reasons: dict[str, int] = {}
        self.zero_feature_files: list[tuple[str, str]] = []
        self.count_mismatch = 0
        # Spatial
        self.region_bounds: dict[str, list[float]] = {}
        self.implausible_extent: list[tuple[str, str]] = []
        self.imagery_dates: set[str] = set()
        # Provenance
        self.real_file_count = 0
        self.real_total_bytes = 0
        self.manifest_lines: list[str] = []
        self.per_region_manifest: dict[str, list[str]] = {r: [] for r in REQUIRED_REGIONS}


def _accumulate_bbox(
    current: list[float] | None, bbox: tuple[float, float, float, float]
) -> list[float]:
    if current is None:
        return [bbox[0], bbox[1], bbox[2], bbox[3]]
    return [
        min(current[0], bbox[0]),
        min(current[1], bbox[1]),
        max(current[2], bbox[2]),
        max(current[3], bbox[3]),
    ]


def _classify_record(acc: _Accumulator, values: dict[str, Any]) -> None:
    """Fold one DBF record into the class dictionaries and null/blank tallies."""

    parent_code: str | None = None
    for level, (code_field, name_field) in zip(("L1", "L2", "L3"), CLASS_LEVELS, strict=True):
        raw_code = values.get(code_field)
        raw_name = values.get(name_field)
        code = "" if raw_code is None else str(raw_code).strip()
        name = "" if raw_name is None else str(raw_name).strip()
        if not code:
            acc.null_blank[code_field] += 1
        if not name:
            acc.null_blank[name_field] += 1
        if code:
            acc.code_to_names[level].setdefault(code, set()).add(name)
            if name:
                acc.name_to_codes[level].setdefault(name, set()).add(code)
            if level in ("L2", "L3") and parent_code:
                acc.child_to_parent[level].setdefault(code, set()).add(parent_code)
            parent_code = code
        else:
            parent_code = None


def _process_tile(
    acc: _Accumulator,
    source: TileSource,
    *,
    encoding: str,
    read_geometry: bool,
) -> None:
    """Read one tile once from disk and fold every statistic into ``acc``.

    The (slow, read-only) USB directory is scanned once and each of
    ``.shp``/``.shx``/``.dbf``/``.prj`` is read a single time into memory,
    checksummed for the aggregate manifest, and fed to pyshp from a ``BytesIO`` —
    so no source file is ever read twice and nothing is ever written.
    """

    import shapefile

    region, tile_id, dir_name = source.region, source.tile_id, source.dir_name
    directory = source.shp_path.parent
    stem = source.shp_path.stem

    # One directory scan.
    real_files = list(_iter_real_files(directory))
    set_files = {f.suffix.lower(): f for f in real_files if f.stem == stem}
    for f in real_files:
        suffix = f.suffix.lower()
        if suffix in OPTIONAL_SIDECAR_SUFFIXES:
            acc.optional_counts[suffix] = acc.optional_counts.get(suffix, 0) + 1
    if ".cpg" in set_files:
        acc.cpg_present += 1

    missing = [s for s in REQUIRED_SIDECAR_SUFFIXES if s not in set_files]
    for suffix in missing:
        acc.missing_required.append((region, tile_id, suffix))
    if not missing:
        acc.complete_sets += 1
    acc.tile_occurrences.setdefault(tile_id, []).append((region, dir_name))

    # Read the four shapefile-set files once each, checksum, record provenance.
    blobs: dict[str, bytes] = {}
    for suffix in (".shp", ".shx", ".dbf", ".prj"):
        entry = set_files.get(suffix)
        if entry is None:
            continue
        try:
            data = entry.read_bytes()
        except OSError as exc:
            acc.unreadable.append((region, tile_id, f"{suffix}: {exc.__class__.__name__}"))
            continue
        blobs[suffix] = data
        if len(data) == 0:
            acc.zero_byte.append((region, tile_id, entry.name))
        sha = _sha256_bytes(data)
        line = f"{region}/{tile_id}{suffix}\t{len(data)}\t{sha}"
        acc.manifest_lines.append(line)
        acc.per_region_manifest[region].append(line)
        acc.real_file_count += 1
        acc.real_total_bytes += len(data)
        if suffix == ".prj":
            acc.prj_texts.append((sha, data.decode("utf-8", "ignore")))
        elif suffix == ".shp":
            acc.tile_shp_checksums.setdefault(tile_id, set()).add(sha)

    # .shp header (extent) + optional geometry validation.
    shp_bytes = blobs.get(".shp")
    if shp_bytes is not None and len(shp_bytes) >= 100:
        _shp_type, bbox = _read_shp_header(shp_bytes)
        acc.tile_bboxes.setdefault(tile_id, []).append(bbox)
        acc.region_bounds[region] = _accumulate_bbox(acc.region_bounds.get(region), bbox)
        if not _bbox_plausible(bbox):
            acc.implausible_extent.append((region, tile_id))
        if read_geometry:
            _fold_geometry(acc, region, shp_bytes)

    # .dbf: schema, encoding evidence, class dictionary. All from the one read.
    dbf_bytes = blobs.get(".dbf")
    if dbf_bytes is None:
        return
    record_count, ldid, raw_fields = _read_dbf_header(dbf_bytes)
    acc.ldid_counts[ldid] = acc.ldid_counts.get(ldid, 0) + 1
    schema_key = tuple((n, t, w) for (n, t, w, _dec) in raw_fields)
    acc.schema_variants[schema_key] = acc.schema_variants.get(schema_key, 0) + 1
    _check_schema(acc, region, tile_id, schema_key)

    shx_bytes = blobs.get(".shx")
    shx_records = _shx_record_count(shx_bytes) if shx_bytes is not None else -1
    if shx_records == 0:
        acc.zero_feature_files.append((region, tile_id))
    if shx_records >= 0 and record_count != shx_records:
        acc.count_mismatch += 1

    # Strict multi-encoding probe (bounded sample per file, reusing dbf_bytes).
    _probe_encodings(acc, dbf_bytes)

    field_names = {n for (n, _t, _w) in schema_key}
    if not set(REQUIRED_FIELDS).issubset(field_names):
        return  # required columns absent — already flagged; skip decode

    # Definitive strict decode of every record under the chosen encoding, to
    # build the class dictionaries and count any undecodable record.
    shx_arg = io.BytesIO(shx_bytes) if shx_bytes is not None else None
    reader = shapefile.Reader(
        dbf=io.BytesIO(dbf_bytes),
        shx=shx_arg,
        encoding=encoding,
        encodingErrors="strict",
    )
    try:
        for index in range(record_count):
            acc.chosen_total += 1
            try:
                values = reader.record(index).as_dict()
            except (UnicodeDecodeError, shapefile.ShapefileException):
                acc.chosen_undecodable += 1
                continue
            _classify_record(acc, values)
            if not acc.korean_samples_decoded:
                for name_field in ("L1_NAME", "L2_NAME", "L3_NAME"):
                    val = values.get(name_field)
                    if val and any(ord(ch) > 0x1000 for ch in str(val)):
                        acc.korean_samples_decoded = True
                        break
            img = values.get("IMG_DATE")
            if img is not None:
                acc.imagery_dates.add(str(img))
    finally:
        reader.close()


def _probe_encodings(acc: _Accumulator, dbf_bytes: bytes) -> None:
    """Strict-decode probe of one DBF under each candidate encoding.

    Records, per candidate encoding, whether a bounded sample of the file's
    records decoded strictly. The disproof encoding (UTF-8) is expected to fail;
    recording that failure is how the source is *proven* not to be UTF-8.
    """

    import shapefile

    for enc in (*EVIDENCE_ENCODINGS, DISPROOF_ENCODING):
        try:
            reader = shapefile.Reader(
                dbf=io.BytesIO(dbf_bytes), encoding=enc, encodingErrors="strict"
            )
        except Exception:  # noqa: BLE001 - header decode failure is a decode failure
            acc.encoding_failed[enc] += 1
            continue
        ok = True
        try:
            for i in _probe_indices(len(reader)):
                try:
                    reader.record(i)
                except (UnicodeDecodeError, shapefile.ShapefileException):
                    ok = False
                    break
        finally:
            reader.close()
        if ok:
            acc.encoding_ok[enc] += 1
        else:
            acc.encoding_failed[enc] += 1


def _fold_geometry(acc: _Accumulator, region: str, shp_bytes: bytes) -> None:
    """Validate every geometry in one ``.shp`` (vectorized), fold counts in."""

    import numpy as np
    import shapefile
    from shapely.geometry import shape as shapely_shape
    from shapely.validation import explain_validity

    reader = shapefile.Reader(shp=io.BytesIO(shp_bytes))
    try:
        geoms: list[Any] = []
        n = 0
        for shp in reader.iterShapes():
            n += 1
            interface = shp.__geo_interface__
            if not interface or not interface.get("coordinates"):
                acc.null_geom += 1
                continue
            geoms.append(shapely_shape(interface))
    finally:
        reader.close()

    acc.total_features += n
    acc.features_by_region[region] = acc.features_by_region.get(region, 0) + n
    if not geoms:
        return
    arr = np.array(geoms, dtype=object)
    empty_mask = shapely.is_empty(arr)
    valid_mask = shapely.is_valid(arr)
    type_ids = shapely.get_type_id(arr)
    for tid, count in zip(*np.unique(type_ids, return_counts=True), strict=True):
        name = _GEOM_TYPE_NAMES.get(int(tid), f"type_{int(tid)}")
        acc.geom_types[name] = acc.geom_types.get(name, 0) + int(count)
    acc.empty_geom += int(empty_mask.sum())
    invalid_mask = (~valid_mask) & (~empty_mask)
    n_invalid = int(invalid_mask.sum())
    acc.invalid_geom += n_invalid
    if n_invalid:
        for geom in arr[invalid_mask]:
            reason = explain_validity(geom).split("[")[0].strip()
            acc.invalid_reasons[reason] = acc.invalid_reasons.get(reason, 0) + 1


_GEOM_TYPE_NAMES = {
    0: "Point",
    1: "LineString",
    2: "LinearRing",
    3: "Polygon",
    4: "MultiPoint",
    5: "MultiLineString",
    6: "MultiPolygon",
    7: "GeometryCollection",
}


def _check_schema(
    acc: _Accumulator, region: str, tile_id: str, schema_key: tuple[tuple[str, str, int], ...]
) -> None:
    names = {n for (n, _t, _w) in schema_key}
    by_name = {n: (t, w) for (n, t, w) in schema_key}
    expected_by_name = {n: (t, w) for (n, t, w) in EXPECTED_SCHEMA}
    for req in REQUIRED_FIELDS:
        if req not in names:
            acc.schema_missing_required.append((region, tile_id, req))
    for name in names - set(expected_by_name):
        acc.schema_extra.append((region, tile_id, name))
    mismatch = False
    for name, (etype, ewidth) in expected_by_name.items():
        if name in by_name and by_name[name] != (etype, ewidth):
            acc.schema_type_mismatch.append((region, tile_id, name))
            mismatch = True
    if schema_key == EXPECTED_SCHEMA:
        acc.files_matching_schema += 1
    elif not mismatch and set(expected_by_name).issubset(names):
        acc.files_matching_schema += 1


def _bbox_plausible(bbox: tuple[float, float, float, float]) -> bool:
    minx, miny, maxx, maxy = bbox
    if maxx <= minx or maxy <= miny:
        return False
    west, south, east, north = CAPITAL_REGION_5186_BOUNDS
    # Generous: reject only extents clearly outside the capital envelope.
    return not (maxx < west or minx > east or maxy < south or miny > north)


# --------------------------------------------------------------------------- #
# Finalization
# --------------------------------------------------------------------------- #


def _build_duplicate_report(acc: _Accumulator) -> DuplicateReport:
    duplicates: list[DuplicateTile] = []
    cross_shared: list[str] = []
    for tile_id, occurrences in sorted(acc.tile_occurrences.items()):
        if len(occurrences) < 2:
            continue
        regions = {r for r, _ in occurrences}
        scope = "cross-region" if len(regions) > 1 else "within-region"
        if scope == "cross-region":
            cross_shared.append(tile_id)
        checksums = acc.tile_shp_checksums.get(tile_id, set())
        duplicates.append(
            DuplicateTile(
                tile_id=tile_id,
                occurrences=tuple(occurrences),
                scope=scope,
                distinct_shp_checksums=len(checksums),
                byte_identical=len(checksums) == 1,
            )
        )
    seoul_ids = {t for t, occ in acc.tile_occurrences.items() for r, _ in occ if r == "seoul"}
    seoul_cross = sorted(
        t for t in seoul_ids if {r for r, _ in acc.tile_occurrences[t]} - {"seoul"}
    )
    if seoul_cross:
        note = (
            f"{len(seoul_cross)} Seoul map-sheet id(s) also appear under incheon/gyeonggi "
            "(border sheets filed under an adjacent province). This is a candidate but not a "
            "proven explanation for a 137-vs-130 web/local gap: the original web listing is not "
            "part of the local evidence, so the exact reconciliation is UNRESOLVED."
        )
    else:
        note = (
            "No Seoul map-sheet id also appears under another province in the local files, so "
            "the local evidence does not explain a 137-vs-130 web/local gap. Marked UNRESOLVED: "
            "the original 137-item web listing is not available to diff against locally."
        )
    return DuplicateReport(
        total_tile_ids=len(acc.tile_occurrences),
        duplicate_tile_ids=len(duplicates),
        duplicates=tuple(duplicates),
        cross_region_shared_ids=tuple(cross_shared),
        policy_recommendation=(
            "Ingestion must key features by (map-sheet id + geometry fingerprint) and treat "
            "byte-identical duplicate sheets as one (load once); a duplicate id whose .shp "
            "checksums differ is a genuine conflict that must halt ingestion for that sheet, "
            "never be silently merged or auto-picked."
        ),
        seoul_web_vs_local_note=note,
    )


def _build_encoding_report(acc: _Accumulator, chosen_encoding: str) -> EncodingReport:
    ldid_hex = tuple(sorted(((hex(k), v) for k, v in acc.ldid_counts.items()), key=lambda x: -x[1]))
    dominant_ldid = (
        max(acc.ldid_counts, key=lambda k: acc.ldid_counts[k]) if acc.ldid_counts else None
    )
    declared_codepage = None
    evidence = "No DBF language-driver byte was read."
    if dominant_ldid is not None:
        enc, desc = LDID_CODEPAGE.get(dominant_ldid, (None, f"unmapped LDID {hex(dominant_ldid)}"))
        declared_codepage = enc
        evidence = (
            f"No .cpg present. DBF language-driver byte {hex(dominant_ldid)} = {desc} "
            f"across {acc.ldid_counts[dominant_ldid]} of {sum(acc.ldid_counts.values())} files."
        )
    tested = tuple(
        (enc, acc.encoding_ok[enc], acc.encoding_failed[enc])
        for enc in (*EVIDENCE_ENCODINGS, DISPROOF_ENCODING)
    )
    # The observed compatible encoding is the widest evidence encoding that
    # decoded every file strictly. CP949 supersets EUC-KR, so prefer it.
    observed = None
    for enc in EVIDENCE_ENCODINGS:
        if acc.encoding_failed[enc] == 0 and acc.encoding_ok[enc] > 0:
            observed = enc
            break
    utf8_rejected = (
        acc.encoding_failed[DISPROOF_ENCODING] > 0 and acc.encoding_ok[DISPROOF_ENCODING] == 0
    )
    return EncodingReport(
        cpg_present=acc.cpg_present > 0,
        ldid_bytes=ldid_hex,
        declared_codepage=declared_codepage,
        declared_encoding_evidence=evidence,
        tested_encodings=tested,
        observed_compatible_encoding=observed,
        chosen_encoding=chosen_encoding,
        chosen_total_records=acc.chosen_total,
        chosen_undecodable_records=acc.chosen_undecodable,
        utf8_rejected=utf8_rejected,
        # The provider shipped no .cpg, so the *exact* provider-declared encoding
        # string is not resolved from a provider artifact; CP949 is inferred from
        # the LDID byte and proven by strict decode. Recorded honestly as such.
        exact_provider_declared_encoding_resolved=False,
        korean_samples_decoded=acc.korean_samples_decoded,
    )


def _build_class_report(acc: _Accumulator) -> ClassDictionaryReport:
    code_multi: list[tuple[str, str, int]] = []
    name_multi: list[tuple[str, str, int]] = []
    malformed: list[tuple[str, str]] = []
    hierarchy: list[tuple[str, str]] = []
    for level in ("L1", "L2", "L3"):
        for code, names in sorted(acc.code_to_names[level].items()):
            real_names = {n for n in names if n}
            if len(real_names) > 1:
                code_multi.append((level, code, len(real_names)))
            if not (len(code) == 3 and code.isdigit()):
                malformed.append((level, code))
        for name, codes in sorted(acc.name_to_codes[level].items()):
            if len(codes) > 1:
                name_multi.append((level, name, len(codes)))
    for level in ("L2", "L3"):
        for child, parents in sorted(acc.child_to_parent[level].items()):
            if len(parents) > 1:
                hierarchy.append((level, child))
    return ClassDictionaryReport(
        l1_code_count=len(acc.code_to_names["L1"]),
        l2_code_count=len(acc.code_to_names["L2"]),
        l3_code_count=len(acc.code_to_names["L3"]),
        code_to_multiple_names=tuple(code_multi),
        name_to_multiple_codes=tuple(name_multi),
        hierarchy_violations=tuple(hierarchy),
        malformed_codes=tuple(malformed),
        null_or_blank_required=tuple((f, acc.null_blank[f]) for f in REQUIRED_FIELDS),
    )


def _build_spatial_report(acc: _Accumulator, duplicates: DuplicateReport) -> SpatialReport:
    from pyproj import Transformer

    region_bounds = tuple(
        (r, (b[0], b[1], b[2], b[3])) for r, b in sorted(acc.region_bounds.items())
    )
    acc_combined: list[float] | None = None
    for _r, b in acc.region_bounds.items():
        acc_combined = _accumulate_bbox(acc_combined, (b[0], b[1], b[2], b[3]))
    combined_5186: tuple[float, float, float, float] | None = (
        (acc_combined[0], acc_combined[1], acc_combined[2], acc_combined[3])
        if acc_combined
        else None
    )
    combined_wgs84: tuple[float, float, float, float] | None = None
    within_envelope: bool | None = None
    if combined_5186 is not None:
        transformer = Transformer.from_crs(
            CRS.from_epsg(EXPECTED_EPSG), CRS.from_epsg(4326), always_xy=True
        )
        left, bottom, right, top = transformer.transform_bounds(
            combined_5186[0], combined_5186[1], combined_5186[2], combined_5186[3], densify_pts=101
        )
        combined_wgs84 = (left, bottom, right, top)
        west, south, east, north = SOUTH_KOREA_WGS84_BOUNDS
        within_envelope = left >= west and bottom >= south and right <= east and top <= north

    overlaps: list[tuple[str, float]] = []
    for tile_id in duplicates.cross_region_shared_ids:
        boxes = acc.tile_bboxes.get(tile_id, [])
        if len(boxes) >= 2:
            overlaps.append((tile_id, _bbox_iou(boxes[0], boxes[1])))

    return SpatialReport(
        region_bounds_5186=region_bounds,
        combined_bounds_5186=combined_5186,
        combined_bounds_wgs84=combined_wgs84,
        within_south_korea_envelope=within_envelope,
        implausible_extent_files=tuple(acc.implausible_extent[:MAX_REPORTED_EXAMPLES]),
        duplicate_tile_overlap=tuple(overlaps[:MAX_REPORTED_EXAMPLES]),
        coverage_status="NOT_PROVEN",
        coverage_evidence_gap=(
            "Full capital-region coverage is not proven by this phase. Per-region source extents "
            "are recorded and plausible, but proving no-gap coverage requires unioning tile "
            "footprints and intersecting them with the platform's official 시도 boundaries in "
            "PostGIS — deferred to the ingestion phase, which loads into PostGIS. No coverage "
            "claim is fabricated here."
        ),
    )


def _bbox_iou(a: tuple[float, ...], b: tuple[float, ...]) -> float:
    ix0, iy0 = max(a[0], b[0]), max(a[1], b[1])
    ix1, iy1 = min(a[2], b[2]), min(a[3], b[3])
    if ix1 <= ix0 or iy1 <= iy0:
        return 0.0
    inter = (ix1 - ix0) * (iy1 - iy0)
    area_a = (a[2] - a[0]) * (a[3] - a[1])
    area_b = (b[2] - b[0]) * (b[3] - b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _build_provenance_report(acc: _Accumulator) -> ProvenanceReport:
    manifest_body = "\n".join(sorted(acc.manifest_lines))
    aggregate = hashlib.sha256(manifest_body.encode("utf-8")).hexdigest()
    per_region = tuple(
        (
            region,
            hashlib.sha256("\n".join(sorted(lines)).encode("utf-8")).hexdigest(),
        )
        for region, lines in sorted(acc.per_region_manifest.items())
        if lines
    )
    imagery_note = (
        "IMG_DATE / directory date tokens describe *imagery* acquisition and are recorded as "
        "source evidence only; they are not used as the dataset reference date. Distinct "
        f"IMG_DATE values observed: {len(acc.imagery_dates)}."
    )
    return ProvenanceReport(
        official_dataset_name=OFFICIAL_DATASET_NAME,
        provider=PROVIDER,
        reference_year=REFERENCE_YEAR,
        acquisition_scope=ACQUISITION_SCOPE,
        acquisition_observed_note=(
            "Acquisition (download) is a local observation, distinct from the dataset reference "
            "year 2025. No precise source reference date is inferred from folder names, DBF "
            "update bytes, or filesystem timestamps."
        ),
        imagery_date_note=imagery_note,
        real_source_file_count=acc.real_file_count,
        real_source_total_bytes=acc.real_total_bytes,
        aggregate_manifest_sha256=aggregate,
        per_region_manifest_sha256=per_region,
        provider_evidence_note=(
            "Provider/label recorded from the project's Phase 1A environmental audit and the "
            "dataset title; the local files carry per-sheet imagery metadata (XML/XLSX/XSD) but "
            "no standalone provider licence receipt was committed."
        ),
    )


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def validate_land_cover(
    source_root: Path | str,
    *,
    expected_epsg: int = EXPECTED_EPSG,
    read_geometry: bool = True,
    progress: bool = False,
) -> LandCoverValidationReport:
    """Verify a local land-cover acquisition root and return a typed report.

    Raises :class:`LandCoverContractError` only when the root itself cannot be
    inspected. Every data problem — a missing region, a missing sidecar, a mixed
    CRS, an undecodable DBF, an invalid geometry, a duplicate map sheet — is
    *reported* in the returned report, never raised and never silently dropped.
    The source files are never written to, reprojected, or repaired.

    ``read_geometry=False`` skips per-feature geometry validation (used only by
    fast structural tests); the live contract run always validates geometry.
    """

    root = Path(source_root)
    if not root.exists():
        raise LandCoverContractError(f"Source root not found: {root.name}")
    if not root.is_dir():
        raise LandCoverContractError(f"Source root is not a directory: {root.name}")

    sources, discoveries = discover_sources(root)
    errors: list[str] = []
    warnings: list[str] = []
    unresolved: list[str] = []

    missing_regions = [d.region for d in discoveries if not d.present]
    for region in missing_regions:
        errors.append(f"Required regional directory '{region}' is missing.")

    if not sources:
        return LandCoverValidationReport(
            contract_version=CONTRACT_VERSION,
            dataset_key=DATASET_KEY,
            source_root_name=root.name,
            status=STATUS_FAIL,
            regions=tuple(discoveries),
            sidecars=None,
            duplicates=None,
            crs=None,
            encoding=None,
            schema=None,
            class_dictionary=None,
            geometry=None,
            spatial=None,
            provenance=None,
            unresolved_issues=(),
            errors=tuple(errors or ["No real .shp files were discovered under the source root."]),
            warnings=(),
        )

    acc = _Accumulator()
    encoding = _resolve_encoding(sources)
    total = len(sources)
    for index, source in enumerate(sources, start=1):
        try:
            _process_tile(acc, source, encoding=encoding, read_geometry=read_geometry)
        except Exception as exc:  # noqa: BLE001 - a bad tile is reported, never fatal
            acc.unreadable.append((source.region, source.tile_id, exc.__class__.__name__))
        if progress and (index % 100 == 0 or index == total):
            print(f"  [{index}/{total}] {source.region}", file=sys.stderr, flush=True)

    sidecars = SidecarIntegrity(
        shapefile_count=total,
        complete_set_count=acc.complete_sets,
        missing_required=tuple(acc.missing_required),
        zero_byte_files=tuple(acc.zero_byte),
        unreadable_files=tuple(acc.unreadable),
        optional_sidecar_counts=tuple(sorted(acc.optional_counts.items())),
        cpg_present_count=acc.cpg_present,
    )
    duplicates = _build_duplicate_report(acc)
    crs_report = inspect_crs(acc.prj_texts, expected_epsg=expected_epsg)
    encoding_report = _build_encoding_report(acc, encoding)
    schema_report = SchemaReport(
        authoritative_schema=EXPECTED_SCHEMA,
        distinct_schema_variants=len(acc.schema_variants),
        files_matching_authoritative=acc.files_matching_schema,
        files_missing_required_field=tuple(acc.schema_missing_required),
        files_with_extra_fields=tuple(acc.schema_extra),
        files_with_type_or_width_mismatch=tuple(acc.schema_type_mismatch),
    )
    class_report = _build_class_report(acc)
    geometry_report = GeometryReport(
        total_features=acc.total_features,
        features_by_region=tuple(sorted(acc.features_by_region.items())),
        geometry_type_counts=tuple(sorted(acc.geom_types.items())),
        null_geometry_count=acc.null_geom,
        empty_geometry_count=acc.empty_geom,
        invalid_geometry_count=acc.invalid_geom,
        invalid_reason_counts=tuple(
            sorted(acc.invalid_reasons.items(), key=lambda x: -x[1])[:MAX_REPORTED_EXAMPLES]
        ),
        zero_feature_file_count=len(acc.zero_feature_files),
        zero_feature_files=tuple(acc.zero_feature_files[:MAX_REPORTED_EXAMPLES]),
        dbf_shx_count_mismatch_count=acc.count_mismatch,
    )
    spatial_report = _build_spatial_report(acc, duplicates)
    provenance_report = _build_provenance_report(acc)

    _collect_findings(
        errors,
        warnings,
        unresolved,
        sidecars=sidecars,
        duplicates=duplicates,
        crs=crs_report,
        encoding=encoding_report,
        schema=schema_report,
        class_dictionary=class_report,
        geometry=geometry_report,
        spatial=spatial_report,
        read_geometry=read_geometry,
    )

    if errors:
        status = STATUS_FAIL
    elif warnings:
        status = STATUS_PASS_WITH_WARNINGS
    else:
        status = STATUS_PASS

    return LandCoverValidationReport(
        contract_version=CONTRACT_VERSION,
        dataset_key=DATASET_KEY,
        source_root_name=root.name,
        status=status,
        regions=tuple(discoveries),
        sidecars=sidecars,
        duplicates=duplicates,
        crs=crs_report,
        encoding=encoding_report,
        schema=schema_report,
        class_dictionary=class_report,
        geometry=geometry_report,
        spatial=spatial_report,
        provenance=provenance_report,
        unresolved_issues=tuple(unresolved),
        errors=tuple(errors),
        warnings=tuple(warnings),
    )


def _resolve_encoding(sources: Sequence[TileSource]) -> str:
    """Pick the strict decode encoding from the first readable DBF's LDID byte.

    Defaults to CP949 (the LDID this source carries and the platform's Korean
    default). Never silently falls back to UTF-8.
    """

    for source in sources:
        dbf = source.shp_path.with_suffix(".dbf")
        if dbf.is_file():
            try:
                with dbf.open("rb") as handle:
                    header = handle.read(32)
            except OSError:
                continue
            if len(header) >= 30:
                enc, _desc = LDID_CODEPAGE.get(header[29], (None, ""))
                if enc in EVIDENCE_ENCODINGS:
                    return enc
    return EVIDENCE_ENCODINGS[0]


def _probe_indices(n: int) -> Iterable[int]:
    if n <= 0:
        return ()
    if n <= 64:
        return range(n)
    stride = max(1, n // 64)
    return sorted({0, n - 1, *range(0, n, stride)})


def _collect_findings(
    errors: list[str],
    warnings: list[str],
    unresolved: list[str],
    *,
    sidecars: SidecarIntegrity,
    duplicates: DuplicateReport,
    crs: CrsReport,
    encoding: EncodingReport,
    schema: SchemaReport,
    class_dictionary: ClassDictionaryReport,
    geometry: GeometryReport,
    spatial: SpatialReport,
    read_geometry: bool,
) -> None:
    # --- hard failures -----------------------------------------------------
    if sidecars.missing_required:
        errors.append(
            f"{len(sidecars.missing_required)} shapefile set(s) are missing a required "
            "sidecar (.shx/.dbf/.prj)."
        )
    if sidecars.zero_byte_files:
        errors.append(f"{len(sidecars.zero_byte_files)} zero-byte source file(s) found.")
    if sidecars.unreadable_files:
        errors.append(f"{len(sidecars.unreadable_files)} source file(s) could not be read.")
    if crs.resolved_epsg is None or crs.unresolved_reason:
        errors.append(
            crs.unresolved_reason or "Source CRS could not be resolved to a definite EPSG."
        )
    elif not crs.matches_expected:
        errors.append(
            f"Source CRS resolves to EPSG {crs.distinct_resolved_epsg}, expected "
            f"EPSG:{EXPECTED_EPSG}."
        )
    if encoding.observed_compatible_encoding is None:
        errors.append("No evidence-supported encoding decoded the DBF files strictly.")
    if encoding.chosen_undecodable_records:
        errors.append(
            f"{encoding.chosen_undecodable_records} record(s) did not decode strictly under the "
            f"chosen encoding '{encoding.chosen_encoding}'."
        )
    if schema.files_missing_required_field:
        errors.append(
            f"{len(schema.files_missing_required_field)} shapefile(s) are missing a required "
            "class field (L1/L2/L3 CODE or NAME)."
        )
    if class_dictionary.code_to_multiple_names:
        errors.append(
            f"{len(class_dictionary.code_to_multiple_names)} class code(s) map to more than one "
            "name (code/name conflict)."
        )
    if class_dictionary.hierarchy_violations:
        errors.append(
            f"{len(class_dictionary.hierarchy_violations)} class code(s) appear under more than "
            "one parent (hierarchy conflict)."
        )
    if read_geometry and (geometry.null_geometry_count or geometry.empty_geometry_count):
        errors.append(
            f"{geometry.null_geometry_count} null and {geometry.empty_geometry_count} empty "
            "geometry/geometries found."
        )

    # --- warnings (→ CONDITIONAL_GO) --------------------------------------
    if not crs.all_identical:
        warnings.append(
            f"{crs.distinct_prj_checksums} distinct .prj byte-contents across files (CRS still "
            "resolves consistently)."
        )
    if crs.authority_epsg is None and crs.resolved_epsg is not None:
        warnings.append(
            "CRS confirmed as EPSG:5186 from TM parameters only: PROJ authority resolution "
            "returns None because the .prj declares the ITRF2000 datum by name (not Korea 2000), "
            "and CRS.equals(EPSG:5186) is False for the same reason. Ingestion must transform "
            "with always_xy=True, exactly as the existing 표준노드링크 loader does."
        )
    if not encoding.cpg_present:
        warnings.append(
            "No .cpg sidecar: DBF encoding is taken from the language-driver byte and proven by "
            "strict decode, and the loader must be given an explicit validated encoding "
            f"({encoding.observed_compatible_encoding})."
        )
    if not encoding.exact_provider_declared_encoding_resolved:
        unresolved.append(
            "Exact provider-declared encoding string is unresolved (no .cpg shipped); CP949 is "
            "inferred from the DBF LDID byte and proven by strict decode."
        )
    if schema.distinct_schema_variants > 1:
        warnings.append(
            f"{schema.distinct_schema_variants} distinct DBF schema variants across files."
        )
    if schema.files_with_type_or_width_mismatch:
        warnings.append(
            f"{len(schema.files_with_type_or_width_mismatch)} file(s) deviate from the "
            "authoritative field type/width."
        )
    if schema.files_with_extra_fields:
        warnings.append(
            f"{len(schema.files_with_extra_fields)} file(s) carry fields beyond the "
            "authoritative schema."
        )
    if class_dictionary.name_to_multiple_codes:
        warnings.append(
            f"{len(class_dictionary.name_to_multiple_codes)} class name(s) map to more than one "
            "code (recorded verbatim, not corrected)."
        )
    if class_dictionary.malformed_codes:
        warnings.append(
            f"{len(class_dictionary.malformed_codes)} class code(s) are not 3-digit numerics."
        )
    blank = [f"{f}={n}" for f, n in class_dictionary.null_or_blank_required if n]
    if blank:
        warnings.append("Null/blank required class values: " + ", ".join(blank) + ".")
    if read_geometry and geometry.invalid_geometry_count:
        warnings.append(
            f"{geometry.invalid_geometry_count} invalid source geometry/geometries "
            f"({geometry.invalid_geometry_count / max(geometry.total_features, 1):.4%} of "
            "features) — reported only; ingestion must MakeValid and never silently drop them."
        )
    if geometry.zero_feature_file_count:
        warnings.append(f"{geometry.zero_feature_file_count} zero-feature shapefile(s).")
    if geometry.dbf_shx_count_mismatch_count:
        warnings.append(
            f"{geometry.dbf_shx_count_mismatch_count} file(s) have a DBF/SHX record-count mismatch."
        )
    if duplicates.duplicate_tile_ids:
        conflicting = [d for d in duplicates.duplicates if not d.byte_identical]
        warnings.append(
            f"{duplicates.duplicate_tile_ids} duplicate map-sheet id(s) "
            f"({len(conflicting)} with conflicting .shp checksums)."
        )
    if spatial.implausible_extent_files:
        warnings.append(
            f"{len(spatial.implausible_extent_files)} file(s) have an implausible source extent."
        )
    if spatial.within_south_korea_envelope is False:
        warnings.append("Combined source extent falls outside the coarse South Korea envelope.")
    if not read_geometry:
        warnings.append("Geometry validation was skipped (read_geometry=False).")

    # --- always-unresolved coverage note ----------------------------------
    unresolved.append(spatial.coverage_evidence_gap)
    unresolved.append(duplicates.seoul_web_vs_local_note)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #


def _write_report_json(report: LandCoverValidationReport, path: Path) -> None:
    """Write the sanitized summary to a local path (never committed to Git)."""

    import json

    path.write_text(json.dumps(report.to_summary(), ensure_ascii=False, indent=2), encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    """Print a sanitized JSON verification summary for a local source root."""

    import argparse
    import json

    parser = argparse.ArgumentParser(
        prog="land-cover-contract-validate",
        description=(
            "Read-only contract verification for a local 세분류 [2025] 토지피복지도 acquisition "
            "(Seoul/Incheon/Gyeonggi). Reads only; never writes, reprojects, repairs, or ingests."
        ),
    )
    parser.add_argument(
        "--source-root",
        required=True,
        help=(
            "Local root directory containing seoul/incheon/gyeonggi tile subdirectories "
            "(Git-ignored raw data). Required — there is no default and no sample fallback."
        ),
    )
    parser.add_argument(
        "--report-json",
        help="Optional local path to write the sanitized JSON summary (never committed).",
    )
    parser.add_argument(
        "--expected-epsg",
        type=int,
        default=EXPECTED_EPSG,
        help=f"EPSG code the source is expected to resolve to (default: {EXPECTED_EPSG}).",
    )
    parser.add_argument(
        "--no-geometry",
        action="store_true",
        help="Skip per-feature geometry validation (structural checks only).",
    )
    parser.add_argument(
        "--progress",
        action="store_true",
        help="Emit per-100-tile progress to stderr (no paths).",
    )
    args = parser.parse_args(argv)

    try:
        report = validate_land_cover(
            args.source_root,
            expected_epsg=args.expected_epsg,
            read_geometry=not args.no_geometry,
            progress=args.progress,
        )
    except LandCoverContractError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(report.to_summary(), ensure_ascii=False, indent=2))
    if args.report_json:
        _write_report_json(report, Path(args.report_json))
    return 0 if report.status != STATUS_FAIL else 1


if __name__ == "__main__":  # pragma: no cover - module CLI entry point
    raise SystemExit(main())
