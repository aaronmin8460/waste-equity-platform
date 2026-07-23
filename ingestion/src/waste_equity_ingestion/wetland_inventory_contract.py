"""Read-only contract verification for the 내륙습지 (inland wetland) inventory.

Suitability Phase 1B-0 — *verification only*. This module inspects a local
shapefile copy of the 국립생태원 전국 내륙습지 공간데이터 and returns a typed
report describing what the file actually contains: sidecar completeness,
checksums, the CRS declared by the ``.prj``, the DBF encoding declared by the
``.cpg``, the attribute schema, geometry statistics, and duplicate identifiers.

Deliberately **read-only and offline**:

* every file is opened for reading only — nothing is renamed, rewritten,
  reprojected, or repaired, and invalid geometry is reported, never fixed;
* there is no database access, no HTTP access, and no import of any module that
  touches a database session, so importing this module cannot ingest anything;
* no scoring, weighting, exclusion, or candidate logic lives here — Phase 1B-0
  ends at "is this dataset what it claims to be?".

The source path is always supplied by the caller (function argument or
``python -m waste_equity_ingestion.wetland_inventory_contract <path>``); no local
absolute path is baked in, and the module is intentionally **not** registered as
a subcommand of the production probe/ingestion CLI.

Official basis: ``docs/WETLAND_INVENTORY_DATA_CONTRACT.md`` and the observed
values recorded in ``docs/WETLAND_INVENTORY_VALIDATION_REPORT.md``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import shapely
from pyproj import CRS, Transformer
from pyproj.exceptions import CRSError
from shapely.geometry import shape as shapely_shape
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

from .errors import IngestionError
from .vworld_zoning_contract import epsg_from_prj

CONTRACT_VERSION = "wetland-inventory-contract-v1"
DATASET_KEY = "wetland_inventory"
OFFICIAL_DATASET_NAME = "국립생태원_내륙습지 공간데이터 및 속성정보"
PROVIDER = "국립생태원 (National Institute of Ecology)"

#: The CRS the official distribution declares (Korea 2000 / Central Belt 2010).
EXPECTED_EPSG = 5186

#: Sidecars a usable shapefile set must ship. ``.shx``/``.dbf`` are required to
#: read anything; ``.prj``/``.cpg`` are required so neither the projection nor
#: the attribute encoding is ever guessed.
REQUIRED_SIDECAR_SUFFIXES = (".shx", ".dbf", ".prj", ".cpg")
#: Present in this distribution but not required (QGIS metadata sidecar).
OPTIONAL_SIDECAR_SUFFIXES = (".qmd",)

#: Candidate identifier columns checked for duplicates.
IDENTIFIER_FIELDS = ("CODE", "FID", "NAME")

#: Coarse WGS84 plausibility envelope for South Korea. This is a sanity screen
#: for grossly mis-projected coordinates — it is **not** an administrative
#: boundary and must never be used for region assignment.
SOUTH_KOREA_WGS84_BOUNDS = (124.0, 32.5, 132.5, 39.0)

#: Reporting thresholds for suspicious polygon sizes (projected metres²).
TINY_POLYGON_AREA_M2 = 1_000.0
LARGE_POLYGON_AREA_M2 = 10_000_000.0

#: Cap on per-category examples so a report never becomes a data dump.
MAX_REPORTED_EXAMPLES = 20

STATUS_PASS = "PASS"
STATUS_PASS_WITH_WARNINGS = "PASS_WITH_WARNINGS"
STATUS_FAIL = "FAIL"


class WetlandInventoryContractError(IngestionError):
    """Raised when the supplied path cannot be inspected as a shapefile at all."""


# --------------------------------------------------------------------------- #
# Report types
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class SidecarFile:
    """One file of the shapefile set, identified by name only (never by path)."""

    suffix: str
    filename: str
    size_bytes: int
    sha256: str


@dataclass(frozen=True)
class SidecarReport:
    """Which shapefile sidecars are present, and their checksums."""

    files: tuple[SidecarFile, ...]
    missing_required: tuple[str, ...]
    present_optional: tuple[str, ...]

    @property
    def complete(self) -> bool:
        return not self.missing_required


@dataclass(frozen=True)
class CrsReport:
    """What the ``.prj`` actually declares, and whether it is the expected CRS."""

    prj_present: bool
    crs_name: str | None
    resolved_epsg: int | None
    expected_epsg: int
    matches_expected: bool
    is_projected: bool | None
    axis_units: tuple[str, ...]
    datum_name: str | None
    ellipsoid_name: str | None
    projection_method: str | None
    projection_parameters: tuple[tuple[str, float, str], ...]
    unresolved_reason: str | None


@dataclass(frozen=True)
class EncodingReport:
    """What the ``.cpg`` declares, and whether the DBF decodes under it."""

    cpg_present: bool
    declared_encoding: str | None
    decoded_strictly: bool
    undecodable_record_count: int
    non_ascii_field_count: int
    decode_error: str | None


@dataclass(frozen=True)
class FieldSchema:
    """One DBF column: declared type plus observed occupancy (never values)."""

    name: str
    field_type: str
    width: int
    decimal: int
    empty_count: int
    distinct_count: int
    max_text_length: int


@dataclass(frozen=True)
class DuplicateReport:
    """Duplicate counts for one candidate identifier column."""

    field_name: str
    present: bool
    distinct_count: int
    duplicated_value_count: int
    surplus_record_count: int


@dataclass(frozen=True)
class GeometryReport:
    """Observed geometry statistics. Nothing here repairs or alters geometry."""

    record_count: int
    geometry_type_counts: tuple[tuple[str, int], ...]
    null_geometry_count: int
    empty_geometry_count: int
    invalid_geometry_count: int
    invalid_reason_counts: tuple[tuple[str, int], ...]
    self_intersection_count: int
    multipart_count: int
    singlepart_count: int
    bounds: tuple[float, float, float, float] | None
    wgs84_bounds: tuple[float, float, float, float] | None
    within_south_korea_envelope: bool | None
    outside_envelope_count: int
    source_area_sum_m2: float
    min_area_m2: float | None
    max_area_m2: float | None
    tiny_polygon_count: int
    large_polygon_count: int
    duplicate_geometry_count: int
    surplus_duplicate_geometry_records: int


@dataclass(frozen=True)
class WetlandInventoryValidationReport:
    """Full read-only verification result for one local shapefile set."""

    contract_version: str
    dataset_key: str
    source_filename: str
    status: str
    sidecars: SidecarReport
    crs: CrsReport | None
    encoding: EncodingReport | None
    schema: tuple[FieldSchema, ...]
    duplicates: tuple[DuplicateReport, ...]
    geometry: GeometryReport | None
    errors: tuple[str, ...] = field(default_factory=tuple)
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def to_summary(self) -> dict[str, Any]:
        """A JSON-safe summary containing no source attribute values or paths.

        Only file names, column names, declared types, and aggregate counts are
        emitted. Wetland names, addresses, and every other per-record attribute
        value stay out of the summary — the report describes the dataset, it
        does not republish it.
        """

        return {
            "contract_version": self.contract_version,
            "dataset_key": self.dataset_key,
            "official_dataset_name": OFFICIAL_DATASET_NAME,
            "provider": PROVIDER,
            "source_filename": self.source_filename,
            "status": self.status,
            "sidecars": {
                "complete": self.sidecars.complete,
                "missing_required": list(self.sidecars.missing_required),
                "present_optional": list(self.sidecars.present_optional),
                "files": [
                    {
                        "suffix": f.suffix,
                        "filename": f.filename,
                        "size_bytes": f.size_bytes,
                        "sha256": f.sha256,
                    }
                    for f in self.sidecars.files
                ],
            },
            "crs": None if self.crs is None else _crs_summary(self.crs),
            "encoding": (
                None
                if self.encoding is None
                else {
                    "cpg_present": self.encoding.cpg_present,
                    "declared_encoding": self.encoding.declared_encoding,
                    "decoded_strictly": self.encoding.decoded_strictly,
                    "undecodable_record_count": self.encoding.undecodable_record_count,
                    "non_ascii_field_count": self.encoding.non_ascii_field_count,
                    "decode_error": self.encoding.decode_error,
                }
            ),
            "schema": [
                {
                    "name": s.name,
                    "field_type": s.field_type,
                    "width": s.width,
                    "decimal": s.decimal,
                    "empty_count": s.empty_count,
                    "distinct_count": s.distinct_count,
                    "max_text_length": s.max_text_length,
                }
                for s in self.schema
            ],
            "duplicates": [
                {
                    "field_name": d.field_name,
                    "present": d.present,
                    "distinct_count": d.distinct_count,
                    "duplicated_value_count": d.duplicated_value_count,
                    "surplus_record_count": d.surplus_record_count,
                }
                for d in self.duplicates
            ],
            "geometry": None if self.geometry is None else _geometry_summary(self.geometry),
            "errors": list(self.errors),
            "warnings": list(self.warnings),
        }


def _crs_summary(crs: CrsReport) -> dict[str, Any]:
    return {
        "prj_present": crs.prj_present,
        "crs_name": crs.crs_name,
        "resolved_epsg": crs.resolved_epsg,
        "expected_epsg": crs.expected_epsg,
        "matches_expected": crs.matches_expected,
        "is_projected": crs.is_projected,
        "axis_units": list(crs.axis_units),
        "datum_name": crs.datum_name,
        "ellipsoid_name": crs.ellipsoid_name,
        "projection_method": crs.projection_method,
        "projection_parameters": [
            {"name": n, "value": v, "unit": u} for n, v, u in crs.projection_parameters
        ],
        "unresolved_reason": crs.unresolved_reason,
    }


def _geometry_summary(geom: GeometryReport) -> dict[str, Any]:
    return {
        "record_count": geom.record_count,
        "geometry_type_counts": dict(geom.geometry_type_counts),
        "null_geometry_count": geom.null_geometry_count,
        "empty_geometry_count": geom.empty_geometry_count,
        "invalid_geometry_count": geom.invalid_geometry_count,
        "invalid_reason_counts": dict(geom.invalid_reason_counts),
        "self_intersection_count": geom.self_intersection_count,
        "multipart_count": geom.multipart_count,
        "singlepart_count": geom.singlepart_count,
        "bounds": None if geom.bounds is None else list(geom.bounds),
        "wgs84_bounds": None if geom.wgs84_bounds is None else list(geom.wgs84_bounds),
        "within_south_korea_envelope": geom.within_south_korea_envelope,
        "outside_envelope_count": geom.outside_envelope_count,
        "source_area_sum_m2": geom.source_area_sum_m2,
        "min_area_m2": geom.min_area_m2,
        "max_area_m2": geom.max_area_m2,
        "tiny_polygon_count": geom.tiny_polygon_count,
        "large_polygon_count": geom.large_polygon_count,
        "duplicate_geometry_count": geom.duplicate_geometry_count,
        "surplus_duplicate_geometry_records": geom.surplus_duplicate_geometry_records,
    }


# --------------------------------------------------------------------------- #
# File-level helpers (read-only)
# --------------------------------------------------------------------------- #


def _sha256_file(path: Path) -> str:
    """Stream a file's SHA-256. Opened read-only; the file is never modified."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sidecar_paths(shp_path: Path) -> dict[str, Path]:
    """Case-insensitive ``suffix -> path`` map for files sharing the base name."""

    found: dict[str, Path] = {}
    for candidate in shp_path.parent.iterdir():
        if candidate.is_file() and candidate.stem == shp_path.stem:
            found.setdefault(candidate.suffix.lower(), candidate)
    return found


def inspect_sidecars(shp_path: Path) -> SidecarReport:
    """Report sidecar completeness and per-file checksums. Never mutates."""

    paths = _sidecar_paths(shp_path)
    files = tuple(
        SidecarFile(
            suffix=suffix,
            filename=path.name,
            size_bytes=path.stat().st_size,
            sha256=_sha256_file(path),
        )
        for suffix, path in sorted(paths.items())
    )
    missing = tuple(s for s in REQUIRED_SIDECAR_SUFFIXES if s not in paths)
    optional = tuple(s for s in OPTIONAL_SIDECAR_SUFFIXES if s in paths)
    return SidecarReport(files=files, missing_required=missing, present_optional=optional)


def inspect_crs(prj_path: Path | None, *, expected_epsg: int = EXPECTED_EPSG) -> CrsReport:
    """Parse a ``.prj`` and describe the CRS it declares.

    Resolution uses :func:`epsg_from_prj` — the same helper the structural
    loaders use — so an ESRI-style WKT is read exactly as the production code
    would read it. The file is read, never rewritten.
    """

    if prj_path is None:
        return CrsReport(
            prj_present=False,
            crs_name=None,
            resolved_epsg=None,
            expected_epsg=expected_epsg,
            matches_expected=False,
            is_projected=None,
            axis_units=(),
            datum_name=None,
            ellipsoid_name=None,
            projection_method=None,
            projection_parameters=(),
            unresolved_reason="No .prj sidecar; the projection must not be guessed.",
        )

    text = prj_path.read_text(encoding="utf-8", errors="ignore")
    try:
        crs = CRS.from_wkt(text.strip())
    except (CRSError, ValueError) as exc:
        return CrsReport(
            prj_present=True,
            crs_name=None,
            resolved_epsg=None,
            expected_epsg=expected_epsg,
            matches_expected=False,
            is_projected=None,
            axis_units=(),
            datum_name=None,
            ellipsoid_name=None,
            projection_method=None,
            projection_parameters=(),
            unresolved_reason=f"Unparseable .prj WKT: {exc}",
        )

    epsg = epsg_from_prj(text)
    operation = crs.coordinate_operation
    parameters = (
        tuple((p.name, float(p.value), p.unit_name) for p in operation.params)
        if operation is not None
        else ()
    )
    return CrsReport(
        prj_present=True,
        crs_name=crs.name,
        resolved_epsg=epsg,
        expected_epsg=expected_epsg,
        matches_expected=epsg == expected_epsg,
        is_projected=crs.is_projected,
        axis_units=tuple(axis.unit_name for axis in crs.axis_info),
        datum_name=None if crs.datum is None else crs.datum.name,
        ellipsoid_name=None if crs.ellipsoid is None else crs.ellipsoid.name,
        projection_method=None if operation is None else operation.method_name,
        projection_parameters=parameters,
        unresolved_reason=(
            None if epsg is not None else "CRS could not be resolved to a definite EPSG code."
        ),
    )


def read_declared_encoding(cpg_path: Path | None) -> str | None:
    """Return the encoding declared by a ``.cpg``, or ``None`` when undeclared."""

    if cpg_path is None:
        return None
    declared = cpg_path.read_text(encoding="ascii", errors="ignore").strip()
    return declared or None


# --------------------------------------------------------------------------- #
# Attribute + geometry inspection
# --------------------------------------------------------------------------- #


def _field_definitions(reader: Any) -> list[tuple[str, str, int, int]]:
    """Normalize pyshp field tuples, dropping the internal DeletionFlag column."""

    definitions: list[tuple[str, str, int, int]] = []
    for entry in reader.fields:
        name = str(entry[0])
        if name == "DeletionFlag":
            continue
        field_type = entry[1]
        definitions.append(
            (
                name,
                str(getattr(field_type, "value", field_type)),
                int(entry[2]),
                int(entry[3]),
            )
        )
    return definitions


def _inspect_attributes(
    shp_path: Path,
    *,
    encoding: str,
    identifier_fields: Sequence[str],
) -> tuple[tuple[FieldSchema, ...], tuple[DuplicateReport, ...], EncodingReport]:
    """Read the DBF under ``encoding`` and summarize schema + duplicates.

    Decoding is strict: an undecodable record is counted and reported, never
    silently replaced with substitute characters. Records are read one at a time
    by index so a single bad record is counted instead of aborting the pass.

    Per-column distinct sets and per-identifier value tallies are held in memory,
    which suits an inventory-scale dataset (thousands of features). A bulk layer
    with millions of rows would need a different strategy; this validator is
    scoped to the wetland inventory and deliberately not generalized.
    """

    import shapefile

    empty_counts: dict[str, int] = {}
    distinct: dict[str, set[str]] = {}
    max_len: dict[str, int] = {}
    tallies: dict[str, dict[str, int]] = {}
    undecodable = 0
    decode_error: str | None = None

    reader = shapefile.Reader(str(shp_path), encoding=encoding, encodingErrors="strict")
    try:
        definitions = _field_definitions(reader)
        names = [name for name, _, _, _ in definitions]
        empty_counts = {name: 0 for name in names}
        distinct = {name: set() for name in names}
        max_len = {name: 0 for name in names}
        tallies = {name: {} for name in identifier_fields if name in names}

        for index in range(len(reader)):
            try:
                values = reader.record(index).as_dict()
            except (UnicodeDecodeError, shapefile.ShapefileException) as exc:
                undecodable += 1
                if decode_error is None:
                    decode_error = f"record {index}: {exc}"
                continue
            for name in names:
                raw = values.get(name)
                text = "" if raw is None else str(raw).strip()
                if not text:
                    empty_counts[name] += 1
                    continue
                distinct[name].add(text)
                max_len[name] = max(max_len[name], len(text))
                tally = tallies.get(name)
                if tally is not None:
                    tally[text] = tally.get(text, 0) + 1
    finally:
        reader.close()

    schema = tuple(
        FieldSchema(
            name=name,
            field_type=field_type,
            width=width,
            decimal=decimal,
            empty_count=empty_counts[name],
            distinct_count=len(distinct[name]),
            max_text_length=max_len[name],
        )
        for name, field_type, width, decimal in definitions
    )
    duplicates = tuple(_duplicate_report(name, tallies.get(name)) for name in identifier_fields)
    encoding_report = EncodingReport(
        cpg_present=True,
        declared_encoding=encoding,
        decoded_strictly=undecodable == 0,
        undecodable_record_count=undecodable,
        non_ascii_field_count=sum(1 for s in schema if not s.name.isascii()),
        decode_error=decode_error,
    )
    return schema, duplicates, encoding_report


def _duplicate_report(name: str, tally: dict[str, int] | None) -> DuplicateReport:
    """Duplicate summary for one identifier column.

    ``surplus_record_count`` is how many records would have to be dropped to make
    the column unique. A column absent from the schema is reported as absent, not
    silently treated as unique.
    """

    if tally is None:
        return DuplicateReport(
            field_name=name,
            present=False,
            distinct_count=0,
            duplicated_value_count=0,
            surplus_record_count=0,
        )
    duplicated = {value: n for value, n in tally.items() if n > 1}
    return DuplicateReport(
        field_name=name,
        present=True,
        distinct_count=len(tally),
        duplicated_value_count=len(duplicated),
        surplus_record_count=sum(duplicated.values()) - len(duplicated),
    )


def _inspect_geometry(shp_path: Path, crs: CrsReport) -> GeometryReport:
    """Stream every shape and summarize it. Invalid geometry is reported only."""

    import shapefile

    type_counts: dict[str, int] = {}
    reason_counts: dict[str, int] = {}
    geometry_hashes: dict[str, int] = {}
    null_geometry = 0
    empty_geometry = 0
    invalid = 0
    self_intersections = 0
    multipart = 0
    singlepart = 0
    outside_envelope = 0
    area_sum = 0.0
    min_area: float | None = None
    max_area: float | None = None
    tiny = 0
    large = 0
    minx = miny = float("inf")
    maxx = maxy = float("-inf")

    to_wgs84: Transformer | None = None
    if crs.resolved_epsg is not None:
        to_wgs84 = Transformer.from_crs(
            CRS.from_epsg(crs.resolved_epsg), CRS.from_epsg(4326), always_xy=True
        )

    reader = shapefile.Reader(str(shp_path))
    try:
        record_count = len(reader)
        for shape in reader.iterShapes():
            geometry = _shape_to_geometry(shape)
            if geometry is None:
                null_geometry += 1
                continue
            type_counts[geometry.geom_type] = type_counts.get(geometry.geom_type, 0) + 1
            if geometry.is_empty:
                empty_geometry += 1
                continue
            if not geometry.is_valid:
                invalid += 1
                reason = explain_validity(geometry).split("[")[0].strip()
                reason_counts[reason] = reason_counts.get(reason, 0) + 1
                if "self-intersection" in reason.lower():
                    self_intersections += 1
            parts = getattr(geometry, "geoms", None)
            if parts is not None and len(parts) > 1:
                multipart += 1
            else:
                singlepart += 1

            area = geometry.area
            area_sum += area
            min_area = area if min_area is None else min(min_area, area)
            max_area = area if max_area is None else max(max_area, area)
            if area < TINY_POLYGON_AREA_M2:
                tiny += 1
            if area > LARGE_POLYGON_AREA_M2:
                large += 1

            bounds = geometry.bounds
            minx, miny = min(minx, bounds[0]), min(miny, bounds[1])
            maxx, maxy = max(maxx, bounds[2]), max(maxy, bounds[3])
            if to_wgs84 is not None and not _within_envelope(bounds, to_wgs84):
                outside_envelope += 1

            digest = hashlib.sha256(shapely.normalize(geometry).wkb).hexdigest()
            geometry_hashes[digest] = geometry_hashes.get(digest, 0) + 1
    finally:
        reader.close()

    have_bounds = minx != float("inf")
    source_bounds = (minx, miny, maxx, maxy) if have_bounds else None
    wgs84_bounds: tuple[float, float, float, float] | None = None
    if source_bounds is not None and to_wgs84 is not None:
        left, bottom, right, top = to_wgs84.transform_bounds(*source_bounds, densify_pts=101)
        wgs84_bounds = (left, bottom, right, top)

    duplicate_values = {h: n for h, n in geometry_hashes.items() if n > 1}
    return GeometryReport(
        record_count=record_count,
        geometry_type_counts=tuple(sorted(type_counts.items())),
        null_geometry_count=null_geometry,
        empty_geometry_count=empty_geometry,
        invalid_geometry_count=invalid,
        invalid_reason_counts=tuple(sorted(reason_counts.items())[:MAX_REPORTED_EXAMPLES]),
        self_intersection_count=self_intersections,
        multipart_count=multipart,
        singlepart_count=singlepart,
        bounds=source_bounds,
        wgs84_bounds=wgs84_bounds,
        within_south_korea_envelope=(
            None if wgs84_bounds is None else outside_envelope == 0 and _in_korea(wgs84_bounds)
        ),
        outside_envelope_count=outside_envelope,
        source_area_sum_m2=area_sum,
        min_area_m2=min_area,
        max_area_m2=max_area,
        tiny_polygon_count=tiny,
        large_polygon_count=large,
        duplicate_geometry_count=len(duplicate_values),
        surplus_duplicate_geometry_records=sum(duplicate_values.values()) - len(duplicate_values),
    )


def _shape_to_geometry(shape: Any) -> BaseGeometry | None:
    """Convert a pyshp shape to shapely, or ``None`` for a null geometry."""

    interface = shape.__geo_interface__
    if not interface or not interface.get("coordinates"):
        return None
    geometry = shapely_shape(interface)
    if isinstance(geometry, BaseGeometry):
        return geometry
    return None


def _within_envelope(bounds: tuple[float, float, float, float], to_wgs84: Transformer) -> bool:
    left, bottom, right, top = to_wgs84.transform_bounds(*bounds, densify_pts=21)
    return _in_korea((left, bottom, right, top))


def _in_korea(bounds: tuple[float, float, float, float]) -> bool:
    left, bottom, right, top = bounds
    west, south, east, north = SOUTH_KOREA_WGS84_BOUNDS
    return left >= west and bottom >= south and right <= east and top <= north


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #


def validate_wetland_inventory(
    shp_path: Path | str,
    *,
    expected_epsg: int = EXPECTED_EPSG,
    identifier_fields: Sequence[str] = IDENTIFIER_FIELDS,
) -> WetlandInventoryValidationReport:
    """Verify one local inland-wetland shapefile set and return a typed report.

    Raises :class:`WetlandInventoryContractError` only when the path itself
    cannot be inspected (missing, not a file, not a ``.shp``). Every other
    problem — a missing sidecar, an unresolved CRS, an undeclared encoding,
    invalid geometry, duplicate identifiers — is *reported* in the returned
    report with an explicit message rather than raised or silently dropped.

    The dataset is never written to, reprojected, or repaired.
    """

    path = Path(shp_path)
    if not path.exists():
        raise WetlandInventoryContractError(f"Source shapefile not found: {path.name}")
    if not path.is_file():
        raise WetlandInventoryContractError(f"Source path is not a file: {path.name}")
    if path.suffix.lower() != ".shp":
        raise WetlandInventoryContractError(
            f"Expected a .shp file, got '{path.suffix or path.name}'. "
            "Point the validator at the shapefile itself, not the archive or directory."
        )

    errors: list[str] = []
    warnings: list[str] = []

    sidecars = inspect_sidecars(path)
    paths = _sidecar_paths(path)
    for suffix in sidecars.missing_required:
        errors.append(f"Missing required sidecar '{suffix}'.")

    crs_report = inspect_crs(paths.get(".prj"), expected_epsg=expected_epsg)
    if not crs_report.prj_present:
        pass  # already reported as a missing sidecar
    elif crs_report.resolved_epsg is None:
        errors.append(crs_report.unresolved_reason or "Source CRS could not be resolved.")
    elif not crs_report.matches_expected:
        errors.append(
            f"Source CRS is EPSG:{crs_report.resolved_epsg}, "
            f"expected EPSG:{expected_epsg} for this dataset."
        )

    declared_encoding = read_declared_encoding(paths.get(".cpg"))
    if paths.get(".cpg") is not None and declared_encoding is None:
        errors.append("The .cpg sidecar is empty; the DBF encoding must not be guessed.")

    schema: tuple[FieldSchema, ...] = ()
    duplicates: tuple[DuplicateReport, ...] = ()
    encoding_report: EncodingReport | None = None
    geometry_report: GeometryReport | None = None

    readable = ".shx" not in sidecars.missing_required and ".dbf" not in sidecars.missing_required
    if not readable:
        errors.append(
            "Attribute and geometry inspection skipped: the .shx/.dbf sidecars a "
            "shapefile needs to be read are missing."
        )
    else:
        if declared_encoding is None:
            encoding_report = EncodingReport(
                cpg_present=paths.get(".cpg") is not None,
                declared_encoding=None,
                decoded_strictly=False,
                undecodable_record_count=0,
                non_ascii_field_count=0,
                decode_error=None,
            )
            errors.append(
                "Attribute inspection skipped: no DBF encoding is declared, and this "
                "validator does not guess an encoding."
            )
        else:
            schema, duplicates, encoding_report = _inspect_attributes(
                path, encoding=declared_encoding, identifier_fields=identifier_fields
            )
            if not encoding_report.decoded_strictly:
                errors.append(
                    f"{encoding_report.undecodable_record_count} record(s) do not decode as "
                    f"'{declared_encoding}'; first failure: {encoding_report.decode_error}"
                )
        geometry_report = _inspect_geometry(path, crs_report)

    if geometry_report is not None:
        if geometry_report.invalid_geometry_count:
            errors.append(
                f"{geometry_report.invalid_geometry_count} invalid geometry/geometries "
                "found (reported only; Phase 1B-0 performs no repair)."
            )
        if geometry_report.null_geometry_count or geometry_report.empty_geometry_count:
            errors.append(
                f"{geometry_report.null_geometry_count} null and "
                f"{geometry_report.empty_geometry_count} empty geometry/geometries found."
            )
        if geometry_report.duplicate_geometry_count:
            warnings.append(
                f"{geometry_report.duplicate_geometry_count} geometry value(s) occur more "
                f"than once ({geometry_report.surplus_duplicate_geometry_records} surplus "
                "record(s))."
            )
        if geometry_report.within_south_korea_envelope is False:
            warnings.append(
                f"{geometry_report.outside_envelope_count} feature(s) fall outside the coarse "
                "South Korea plausibility envelope."
            )
        if geometry_report.tiny_polygon_count:
            warnings.append(
                f"{geometry_report.tiny_polygon_count} polygon(s) are smaller than "
                f"{TINY_POLYGON_AREA_M2:.0f} m²."
            )
        if geometry_report.large_polygon_count:
            warnings.append(
                f"{geometry_report.large_polygon_count} polygon(s) are larger than "
                f"{LARGE_POLYGON_AREA_M2 / 1e6:.0f} km²."
            )

    for duplicate in duplicates:
        if not duplicate.present:
            warnings.append(f"Identifier column '{duplicate.field_name}' is not in this schema.")
        elif duplicate.surplus_record_count:
            errors.append(
                f"Identifier column '{duplicate.field_name}' is not unique: "
                f"{duplicate.duplicated_value_count} duplicated value(s), "
                f"{duplicate.surplus_record_count} surplus record(s)."
            )

    if errors:
        status = STATUS_FAIL
    elif warnings:
        status = STATUS_PASS_WITH_WARNINGS
    else:
        status = STATUS_PASS

    return WetlandInventoryValidationReport(
        contract_version=CONTRACT_VERSION,
        dataset_key=DATASET_KEY,
        source_filename=path.name,
        status=status,
        sidecars=sidecars,
        crs=crs_report,
        encoding=encoding_report,
        schema=schema,
        duplicates=duplicates,
        geometry=geometry_report,
        errors=tuple(errors),
        warnings=tuple(warnings),
    )


def main(argv: Sequence[str] | None = None) -> int:
    """Print a sanitized JSON verification summary for a local shapefile."""

    parser = argparse.ArgumentParser(
        prog="wetland-inventory-contract",
        description=(
            "Read-only contract verification for a local 내륙습지 inventory shapefile. "
            "Reads only; never writes, reprojects, repairs, or ingests."
        ),
    )
    parser.add_argument("shapefile", help="Path to the local .shp file to verify.")
    parser.add_argument(
        "--expected-epsg",
        type=int,
        default=EXPECTED_EPSG,
        help=f"EPSG code the source is expected to declare (default: {EXPECTED_EPSG}).",
    )
    args = parser.parse_args(argv)

    try:
        report = validate_wetland_inventory(args.shapefile, expected_epsg=args.expected_epsg)
    except WetlandInventoryContractError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(json.dumps(report.to_summary(), ensure_ascii=False, indent=2))
    return 0 if report.status != STATUS_FAIL else 1


if __name__ == "__main__":  # pragma: no cover - module CLI entry point
    raise SystemExit(main())
