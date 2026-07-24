"""Production PostGIS ingestion for the 국립생태원 내륙습지 inventory (Phase 1B-1).

Loads the verified inland-wetland shapefile into
``environmental_wetland_inventory_features``, versioned by one
``environmental_dataset_versions`` release row. The Phase 1B-0 contract
validator runs first and its result gates the load: an unexpected CRS, an
undeclared/unexpected encoding, a missing sidecar, or a missing required column
aborts before anything is written.

Design, following the structural bulk loaders:

* **Bulk file, no API.** The source path is always supplied by the caller; there
  is no default path, no download, and no fallback to ``data/samples`` or
  synthetic data. Raw files stay Git-ignored and are never written to.
* **Verified, never repaired.** Phase 1B-0 measured 0 invalid / 0 null / 0 empty
  geometries. Anything else here is a *rejection* with a reason — this module
  never calls ``buffer(0)``, ``make_valid``, ``simplify``, or ``snap``.
* **Idempotent.** Release identity is the natural key (layer + dataset id +
  reference date + source checksum + transformation version); feature identity
  is the provider ``CODE`` within that release, enforced by a unique constraint
  and ``ON CONFLICT DO NOTHING``. Re-running over the same file inserts nothing
  and deletes nothing.
* **Not statutory.** The inventory is a survey under 「습지보전법」; it is not the
  designated 습지보호지역 layer (``UM901``) and is never merged with it. This
  module writes to exactly one feature table and touches no structural,
  suitability, or candidate table.

Scoring is out of scope: nothing here computes, reads, or influences a
suitability score, weight, exclusion rule, rank, or candidate status.
"""

from __future__ import annotations

import datetime
import hashlib
import json
from collections.abc import Iterator, Sequence
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
from shapely.prepared import prep
from sqlalchemy import Table, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    EnvironmentalDatasetVersion,
    EnvironmentalWetlandInventoryFeature,
    IngestionRun,
)

from .errors import IngestionError
from .wetland_inventory_contract import (
    EXPECTED_EPSG,
    OFFICIAL_DATASET_NAME,
    PROVIDER,
    STATUS_FAIL,
    WetlandInventoryValidationReport,
    validate_wetland_inventory,
)

SOURCE_ID = "nie_wetland_inventory"
LAYER_NAME = "wetland_inventory"
TRANSFORMATION_VERSION = "wetland-inventory-v1"

#: Official release identity (공공데이터포털 파일데이터 15086410).
PROVIDER_DATASET_IDENTIFIER = (
    "국립생태원_내륙습지 공간데이터 및 속성정보_20220720 (data.go.kr 15086410)"
)
OFFICIAL_SOURCE_URL = "https://www.data.go.kr/data/15086410/fileData.do"
LICENSE_NOTE = "이용허락범위 제한 없음 (공공데이터포털, 확인일 2026-07-23)"
REFERENCE_DATE = datetime.date(2022, 7, 20)
DECLARED_FEATURE_COUNT = 2704

SOURCE_CRS = f"EPSG:{EXPECTED_EPSG}"
TARGET_CRS = "EPSG:4326"
TARGET_SRID = 4326
NORMALIZED_GEOMETRY_TYPE = "MultiPolygon"
EXPECTED_ENCODING = "utf-8"

#: Every column the source must ship. A missing one aborts before any write.
REQUIRED_SOURCE_FIELDS: tuple[str, ...] = (
    "FID",
    "NAME",
    "CODE",
    "TYPE",
    "TYPE_KOREA",
    "TYPE_RAMSA",
    "AREA",
    "LONGITUDE",
    "LATITUDE",
    "ADDRESS",
    "SD_NN",
    "SGG_NM",
    "EMD_NM",
    "RI_NM",
    "EXP",
)

_DEFAULT_BATCH = 500
_MAX_REPORTED_REJECTIONS = 40
_MAX_REPORTED_WARNINGS = 40


class WetlandIngestionError(IngestionError):
    """Raised when the wetland ingestion cannot safely proceed."""


# --------------------------------------------------------------------------- #
# Report
# --------------------------------------------------------------------------- #


@dataclass
class WetlandIngestionReport:
    """Structured, sanitized result of one ingestion run."""

    mode: str  # "dry-run" | "write"
    status: str  # SUCCEEDED | FAILED
    source_filename: str
    contract_status: str = ""
    source_crs: str = SOURCE_CRS
    target_crs: str = TARGET_CRS
    source_encoding: str = ""
    transformation_version: str = TRANSFORMATION_VERSION
    reference_date: str = REFERENCE_DATE.isoformat()
    declared_feature_count: int = DECLARED_FEATURE_COUNT
    source_checksum: str = ""
    source_archive_checksum: str | None = None
    total_feature_count: int = 0
    inserted_count: int = 0
    skipped_count: int = 0
    rejected_count: int = 0
    # Features whose geometry is valid in EPSG:5186 but self-intersecting after
    # reprojection to EPSG:4326. Loaded as transformed and reported, not dropped.
    post_transform_invalid_count: int = 0
    dataset_version_id: int | None = None
    dataset_version_created: bool = False
    ingestion_run_id: int | None = None
    region_assignment: str = "NOT_ATTEMPTED"
    sido_assigned_count: int = 0
    sigungu_assigned_count: int = 0
    rejections: list[dict[str, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def add_warning(self, message: str) -> None:
        if len(self.warnings) < _MAX_REPORTED_WARNINGS and message not in self.warnings:
            self.warnings.append(message)

    def add_rejection(self, source_feature_id: str, reason: str) -> None:
        self.rejected_count += 1
        if len(self.rejections) < _MAX_REPORTED_REJECTIONS:
            self.rejections.append({"source_feature_id": source_feature_id, "reason": reason})

    def sanitized_summary(self) -> dict[str, Any]:
        """JSON-safe summary: counts and identifiers, no paths, no row values."""

        return {
            "job": "wetland-inventory-ingest",
            "layer_name": LAYER_NAME,
            "provider": PROVIDER,
            "official_dataset_name": OFFICIAL_DATASET_NAME,
            "mode": self.mode,
            "status": self.status,
            "contract_status": self.contract_status,
            "source_filename": self.source_filename,
            "source_crs": self.source_crs,
            "target_crs": self.target_crs,
            "source_encoding": self.source_encoding,
            "transformation_version": self.transformation_version,
            "reference_date": self.reference_date,
            "declared_feature_count": self.declared_feature_count,
            "source_checksum": self.source_checksum,
            "source_archive_checksum": self.source_archive_checksum,
            "total_feature_count": self.total_feature_count,
            "inserted_count": self.inserted_count,
            "skipped_count": self.skipped_count,
            "rejected_count": self.rejected_count,
            "post_transform_invalid_count": self.post_transform_invalid_count,
            "dataset_version_id": self.dataset_version_id,
            "dataset_version_created": self.dataset_version_created,
            "ingestion_run_id": self.ingestion_run_id,
            "region_assignment": self.region_assignment,
            "sido_assigned_count": self.sido_assigned_count,
            "sigungu_assigned_count": self.sigungu_assigned_count,
            "rejections": list(self.rejections),
            "warnings": list(self.warnings),
        }


# --------------------------------------------------------------------------- #
# Gate: contract validation
# --------------------------------------------------------------------------- #


def _require_valid_contract(shp_path: Path) -> WetlandInventoryValidationReport:
    """Run Phase 1B-0 validation and refuse to continue on any failure."""

    report = validate_wetland_inventory(shp_path)
    if report.status == STATUS_FAIL:
        detail = "; ".join(report.errors) or "unspecified contract failure"
        raise WetlandIngestionError(
            f"Contract validation FAILED for '{report.source_filename}': {detail}. "
            "Ingestion refuses to load a source that does not match the verified contract."
        )
    if report.crs is None or report.crs.resolved_epsg != EXPECTED_EPSG:
        found = None if report.crs is None else report.crs.resolved_epsg
        raise WetlandIngestionError(
            f"Unexpected source CRS EPSG:{found}; this dataset must be EPSG:{EXPECTED_EPSG}. "
            "Refusing to guess or reproject from an unverified projection."
        )
    encoding = None if report.encoding is None else report.encoding.declared_encoding
    if encoding is None or encoding.strip().lower().replace("_", "-") != EXPECTED_ENCODING:
        raise WetlandIngestionError(
            f"Unexpected source encoding {encoding!r}; this dataset declares UTF-8 in its .cpg. "
            "Refusing to decode Korean attributes under an unverified encoding."
        )
    if report.encoding is not None and not report.encoding.decoded_strictly:
        raise WetlandIngestionError(
            f"{report.encoding.undecodable_record_count} record(s) do not decode strictly as "
            f"{encoding}; refusing to substitute replacement characters."
        )
    present = {column.name for column in report.schema}
    missing = [name for name in REQUIRED_SOURCE_FIELDS if name not in present]
    if missing:
        raise WetlandIngestionError(
            "Source schema does not match the verified contract; missing column(s): "
            + ", ".join(missing)
        )
    return report


# --------------------------------------------------------------------------- #
# Geometry
# --------------------------------------------------------------------------- #


def promote_to_multipolygon(geom: BaseGeometry) -> MultiPolygon:
    """Structural normalization only: promote to a canonical ``MultiPolygon``.

    Rejects empty and non-polygonal geometry by raising. Ring/part ordering is
    canonicalized with ``shapely.normalize`` so the fingerprint is stable across
    reads. This function deliberately makes **no** topology judgement — see
    :func:`normalize_source_geometry` for the validity gate.
    """

    if geom.is_empty:
        raise WetlandIngestionError("Empty geometry")
    geom_type = geom.geom_type
    if geom_type not in ("Polygon", "MultiPolygon"):
        raise WetlandIngestionError(f"Unexpected geometry type {geom_type}; expected polygonal")
    promoted = MultiPolygon([geom]) if isinstance(geom, Polygon) else geom
    assert isinstance(promoted, MultiPolygon)
    normalized = shapely.normalize(promoted)
    if not isinstance(normalized, MultiPolygon):  # pragma: no cover - shapely invariant
        raise WetlandIngestionError(f"Normalization produced {normalized.geom_type}")
    return normalized


def normalize_source_geometry(geom: BaseGeometry) -> MultiPolygon:
    """Validate a **source-CRS** geometry strictly, then promote it.

    This is the validity gate, and it is applied to the geometry as published,
    in EPSG:5186 — the projection the contract was verified in. Empty,
    non-polygonal, and invalid source geometry is rejected by raising; nothing is
    repaired, because the verified source contained no invalid geometry and an
    invalid feature here means the file changed and must be re-verified.

    Validity is deliberately **not** re-asserted after reprojection. Reprojecting
    is this pipeline's own operation, and on this dataset it introduces
    sub-square-centimetre self-intersections in a handful of polygons that carry
    near-degenerate micro-segments (consecutive source vertices as close as
    5.5 µm). Dropping official wetlands over a µm-scale artifact of our own
    transform would lose real public data; repairing them would silently alter
    official boundaries. Instead the transformed geometry is stored exactly as
    computed and the artifact is counted and named in the run report — see
    ``docs/WETLAND_INVENTORY_INGESTION.md``.
    """

    if not geom.is_empty and geom.geom_type in ("Polygon", "MultiPolygon") and not geom.is_valid:
        raise WetlandIngestionError(
            "Invalid source geometry; the verified source contained none. Re-run contract "
            "verification instead of repairing in place."
        )
    return promote_to_multipolygon(geom)


def wetland_feature_fingerprint(
    geometry: BaseGeometry,
    *,
    source_feature_id: str,
    source_checksum: str,
    reference_date: datetime.date,
    transformation_version: str,
) -> str:
    """Deterministic sha256 over the stored geometry plus the release identity.

    Uses the *release* identity (source checksum + reference date +
    transformation version) rather than the surrogate ``dataset_version_id`` so
    the same source file yields the same fingerprint in any database.
    """

    digest = hashlib.sha256()
    digest.update(shapely.normalize(geometry).wkb)
    payload = {
        "source_feature_id": source_feature_id,
        "source_checksum": source_checksum,
        "reference_date": reference_date.isoformat(),
        "transformation_version": transformation_version,
    }
    digest.update(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8"))
    return digest.hexdigest()


# --------------------------------------------------------------------------- #
# Spatial region assignment (optional, official boundaries only)
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class _Boundary:
    region_code: str
    prepared: Any
    bounds: tuple[float, float, float, float]


def _load_region_boundaries(session: Session, level: str) -> list[_Boundary]:
    """Load official ``regions`` boundaries (EPSG:4326) for one level."""

    rows = session.execute(
        text(
            """
            SELECT DISTINCT ON (region_code)
                   region_code, ST_AsBinary(geometry) AS wkb
            FROM regions
            WHERE region_level = :level AND geometry IS NOT NULL
            ORDER BY region_code, valid_from DESC
            """
        ),
        {"level": level},
    ).all()
    boundaries: list[_Boundary] = []
    for row in rows:
        geom = shapely.from_wkb(bytes(row.wkb))
        boundaries.append(
            _Boundary(region_code=str(row.region_code), prepared=prep(geom), bounds=geom.bounds)
        )
    return boundaries


def _assign_region(point: Any, boundaries: Sequence[_Boundary]) -> str | None:
    """Return the code of the first boundary containing ``point``, else ``None``."""

    x, y = point.x, point.y
    for boundary in boundaries:
        minx, miny, maxx, maxy = boundary.bounds
        if x < minx or x > maxx or y < miny or y > maxy:
            continue
        if boundary.prepared.contains(point):
            return boundary.region_code
    return None


# --------------------------------------------------------------------------- #
# Reading and normalization
# --------------------------------------------------------------------------- #


def _text_or_none(value: object) -> str | None:
    """Trim a decoded source value; an empty string becomes ``None``."""

    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _int_or_none(value: object) -> int | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        return int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _float_or_none(value: object) -> float | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


@dataclass
class NormalizedWetlandFeature:
    """One source record normalized for storage (no database identifiers yet)."""

    source_feature_id: str
    source_fid: int | None
    wetland_name: str
    wetland_type: str
    wetland_type_korea: str | None
    wetland_type_ramsar: str | None
    reported_area_m2: int | None
    source_longitude: float | None
    source_latitude: float | None
    source_address: str | None
    source_sido_name: str | None
    source_sigungu_name: str | None
    source_eupmyeondong_name: str | None
    source_ri_name: str | None
    designation_note: str | None
    geometry_wgs84: MultiPolygon
    geometry_area_m2: float
    feature_fingerprint: str
    raw_attributes: dict[str, Any]
    # True when reprojection introduced a self-intersection that the source did
    # not have. The geometry is stored exactly as transformed — never repaired,
    # never dropped — and the run report names every affected feature.
    post_transform_invalid: bool = False


def iter_normalized_features(
    shp_path: Path,
    *,
    source_checksum: str,
    reference_date: datetime.date = REFERENCE_DATE,
    transformation_version: str = TRANSFORMATION_VERSION,
) -> Iterator[tuple[str, NormalizedWetlandFeature | None, str | None]]:
    """Yield ``(source_feature_id, feature | None, rejection_reason | None)``.

    Reads records and shapes together under a strict UTF-8 decode, measures area
    in the projected source CRS (metres) *before* transforming, then reprojects
    to EPSG:4326 with ``always_xy=True``. A record that cannot be normalized is
    yielded as a rejection with its reason; it is never repaired or dropped
    silently.
    """

    import shapefile

    transformer = Transformer.from_crs(
        CRS.from_epsg(EXPECTED_EPSG), CRS.from_epsg(TARGET_SRID), always_xy=True
    )

    reader = shapefile.Reader(str(shp_path), encoding=EXPECTED_ENCODING, encodingErrors="strict")
    try:
        for index in range(len(reader)):
            values: dict[str, Any] = dict(reader.record(index).as_dict())
            code = _text_or_none(values.get("CODE"))
            identity = code or f"<row {index}>"
            if code is None:
                yield identity, None, "Missing CODE; the source identifier is required."
                continue
            try:
                interface = reader.shape(index).__geo_interface__
                if not interface or not interface.get("coordinates"):
                    raise WetlandIngestionError("Null geometry")
                source_geometry = shapely_shape(interface)
                if not isinstance(source_geometry, BaseGeometry):  # pragma: no cover
                    raise WetlandIngestionError("Unreadable geometry")
                normalized_source = normalize_source_geometry(source_geometry)
                # Projected-CRS area (metres), measured before reprojection —
                # never from EPSG:4326 degrees.
                area_m2 = float(normalized_source.area)
                projected = shapely.ops.transform(transformer.transform, normalized_source)
                geometry_wgs84 = promote_to_multipolygon(projected)
            except WetlandIngestionError as exc:
                yield identity, None, str(exc)
                continue

            name = _text_or_none(values.get("NAME"))
            wetland_type = _text_or_none(values.get("TYPE"))
            if name is None or wetland_type is None:
                yield identity, None, "Missing required NAME or TYPE."
                continue

            fingerprint = wetland_feature_fingerprint(
                geometry_wgs84,
                source_feature_id=code,
                source_checksum=source_checksum,
                reference_date=reference_date,
                transformation_version=transformation_version,
            )
            yield (
                identity,
                NormalizedWetlandFeature(
                    source_feature_id=code,
                    source_fid=_int_or_none(values.get("FID")),
                    wetland_name=name,
                    wetland_type=wetland_type,
                    # TYPE_KOREA / TYPE_RAMSA are stored exactly as published:
                    # no case folding, no correction of the one anomalous label.
                    wetland_type_korea=_text_or_none(values.get("TYPE_KOREA")),
                    wetland_type_ramsar=_text_or_none(values.get("TYPE_RAMSA")),
                    reported_area_m2=_int_or_none(values.get("AREA")),
                    source_longitude=_float_or_none(values.get("LONGITUDE")),
                    source_latitude=_float_or_none(values.get("LATITUDE")),
                    source_address=_text_or_none(values.get("ADDRESS")),
                    source_sido_name=_text_or_none(values.get("SD_NN")),
                    source_sigungu_name=_text_or_none(values.get("SGG_NM")),
                    source_eupmyeondong_name=_text_or_none(values.get("EMD_NM")),
                    source_ri_name=_text_or_none(values.get("RI_NM")),
                    designation_note=_text_or_none(values.get("EXP")),
                    geometry_wgs84=geometry_wgs84,
                    geometry_area_m2=area_m2,
                    feature_fingerprint=fingerprint,
                    post_transform_invalid=not geometry_wgs84.is_valid,
                    raw_attributes={
                        key: (value if value is None else str(value).strip())
                        for key, value in values.items()
                    },
                ),
                None,
            )
    finally:
        reader.close()


def collect_source_anomaly_warnings(
    features: Sequence[NormalizedWetlandFeature],
) -> list[str]:
    """Report known source anomalies as warnings. Nothing is corrected."""

    warnings: list[str] = []
    non_code_type_korea = sum(
        1
        for f in features
        if f.wetland_type_korea is not None and not _looks_like_type_code(f.wetland_type_korea)
    )
    if non_code_type_korea:
        warnings.append(
            f"{non_code_type_korea} record(s) carry a TYPE_KOREA value that is not a "
            "classification code; stored verbatim, not corrected."
        )
    ramsar_values = {f.wetland_type_ramsar for f in features if f.wetland_type_ramsar}
    case_collisions = sorted(
        {v for v in ramsar_values if v.upper() != v and v.upper() in ramsar_values}
    )
    if case_collisions:
        warnings.append(
            "TYPE_RAMSA contains case variants ("
            + ", ".join(case_collisions)
            + "); stored exactly as published because no official code list ships "
            "with the dataset."
        )
    unofficial_sido = sorted(
        {
            f.source_sido_name
            for f in features
            if f.source_sido_name
            and f.source_sido_name.endswith("자치시")
            and "제주" in f.source_sido_name
        }
    )
    if unofficial_sido:
        warnings.append(
            "SD_NN uses a non-official 시도 spelling (" + ", ".join(unofficial_sido) + "); "
            "preserved as published."
        )
    return warnings


def _looks_like_type_code(value: str) -> bool:
    """A TYPE_KOREA code is a letter followed by a digit (e.g. ``R4``)."""

    return len(value) == 2 and value[0].isascii() and value[0].isalpha() and value[1].isdigit()


# --------------------------------------------------------------------------- #
# Persistence
# --------------------------------------------------------------------------- #


class _BatchWriter:
    """Batched ``INSERT ... ON CONFLICT DO NOTHING`` with a reliable insert count."""

    def __init__(self, session: Session, table: Table, *, batch_size: int) -> None:
        self._session = session
        self._table = table
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
        # RETURNING id yields exactly the rows actually inserted; conflicting
        # rows are not returned, so counting the result is reliable (multi-row
        # INSERT rowcount is not).
        stmt = (
            pg_insert(self._table)
            .values(self._buffer)
            # No conflict target: both unique constraints
            # (version+source_feature_id and version+fingerprint) are handled, so
            # an idempotent re-run can never raise on either arbiter.
            .on_conflict_do_nothing()
            .returning(self._table.c.id)
        )
        result = self._session.execute(stmt)
        self.inserted += sum(1 for _ in result)
        self._buffer.clear()

    def finish(self) -> int:
        self._flush()
        return self.inserted


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _sidecar_checksums(validation: WetlandInventoryValidationReport) -> dict[str, str]:
    return {entry.suffix: entry.sha256 for entry in validation.sidecars.files}


def _find_archive(shp_path: Path) -> Path | None:
    """Locate the distribution ZIP beside the extracted shapefile, if present.

    Looks in the shapefile's directory and its parent — the layout this project
    uses (``<root>/<archive>.zip`` and ``<root>/extracted/<name>.shp``). Returns
    ``None`` when no single unambiguous archive is found; the archive checksum is
    then recorded as unknown rather than guessed.
    """

    for directory in (shp_path.parent, shp_path.parent.parent):
        archives = sorted(p for p in directory.glob("*.zip") if p.is_file())
        if len(archives) == 1:
            return archives[0]
    return None


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _get_or_create_version(
    session: Session,
    *,
    validation: WetlandInventoryValidationReport,
    shp_checksum: str,
    archive_checksum: str | None,
    archive_filename: str | None,
    run: IngestionRun,
    now: datetime.datetime,
    total_features: int,
    accepted: int,
    rejected: int,
    contract_warnings: Sequence[str],
) -> tuple[EnvironmentalDatasetVersion, bool]:
    """Return the release row for this exact source, creating it if new."""

    existing = session.execute(
        select(EnvironmentalDatasetVersion).where(
            EnvironmentalDatasetVersion.layer_name == LAYER_NAME,
            EnvironmentalDatasetVersion.provider_dataset_identifier == PROVIDER_DATASET_IDENTIFIER,
            EnvironmentalDatasetVersion.reference_date == REFERENCE_DATE,
            EnvironmentalDatasetVersion.source_checksum == shp_checksum,
            EnvironmentalDatasetVersion.transformation_version == TRANSFORMATION_VERSION,
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing, False

    version = EnvironmentalDatasetVersion(
        layer_name=LAYER_NAME,
        source_id=SOURCE_ID,
        provider=PROVIDER,
        official_dataset_name=OFFICIAL_DATASET_NAME,
        provider_dataset_identifier=PROVIDER_DATASET_IDENTIFIER,
        official_source_url=OFFICIAL_SOURCE_URL,
        reference_date=REFERENCE_DATE,
        source_archive_filename=archive_filename,
        source_filename=validation.source_filename,
        source_archive_checksum=archive_checksum,
        source_checksum=shp_checksum,
        source_crs=SOURCE_CRS,
        target_crs=TARGET_CRS,
        source_encoding=(
            None if validation.encoding is None else validation.encoding.declared_encoding
        ),
        source_geometry_type=(
            None
            if validation.geometry is None
            else "/".join(name for name, _ in validation.geometry.geometry_type_counts)
        ),
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
        source_files=[
            {
                "suffix": entry.suffix,
                "filename": entry.filename,
                "sha256": entry.sha256,
                "size_bytes": entry.size_bytes,
            }
            for entry in validation.sidecars.files
        ],
        retrieval_metadata={
            "contract_status": validation.status,
            "contract_warnings": list(validation.warnings),
            "source_anomaly_warnings": list(contract_warnings),
            "official_source_url": OFFICIAL_SOURCE_URL,
        },
        is_active=True,
        created_at=now,
    )
    session.add(version)
    session.flush()
    return version, True


def run_wetland_inventory_ingestion(
    *,
    source_shp: str,
    write: bool,
    batch_size: int = _DEFAULT_BATCH,
    assign_regions: bool = True,
    session_factory: Any | None = None,
) -> WetlandIngestionReport:
    """Validate, normalize, and (when ``write``) load the inventory into PostGIS.

    ``write=False`` performs the full read/normalize path and reports what would
    be loaded without opening a write transaction.
    """

    shp_path = Path(source_shp)
    validation = _require_valid_contract(shp_path)
    checksums = _sidecar_checksums(validation)
    shp_checksum = checksums.get(".shp")
    if shp_checksum is None:  # pragma: no cover - validator guarantees .shp
        raise WetlandIngestionError("Source .shp checksum unavailable; refusing to ingest.")
    archive = _find_archive(shp_path)

    report = WetlandIngestionReport(
        mode="write" if write else "dry-run",
        status="SUCCEEDED",
        source_filename=validation.source_filename,
        contract_status=validation.status,
        source_encoding=(
            "" if validation.encoding is None else (validation.encoding.declared_encoding or "")
        ),
        source_checksum=shp_checksum,
        source_archive_checksum=None if archive is None else _sha256_file(archive),
    )
    for message in validation.warnings:
        report.add_warning(f"contract: {message}")

    features: list[NormalizedWetlandFeature] = []
    for identity, feature, reason in iter_normalized_features(
        shp_path, source_checksum=shp_checksum
    ):
        report.total_feature_count += 1
        if feature is None:
            report.add_rejection(identity, reason or "unspecified")
            continue
        features.append(feature)

    affected = [f.source_feature_id for f in features if f.post_transform_invalid]
    report.post_transform_invalid_count = len(affected)
    if affected:
        report.add_warning(
            f"{len(affected)} feature(s) are valid in {SOURCE_CRS} but self-intersecting "
            f"after reprojection to {TARGET_CRS} (near-degenerate source micro-segments). "
            "Stored exactly as transformed — not repaired and not dropped. Affected "
            "source ids: " + ", ".join(sorted(affected)[:10]) + ("…" if len(affected) > 10 else "")
        )
    for message in collect_source_anomaly_warnings(features):
        report.add_warning(f"source: {message}")
    if report.total_feature_count != DECLARED_FEATURE_COUNT:
        report.add_warning(
            f"Read {report.total_feature_count} records but the provider declares "
            f"{DECLARED_FEATURE_COUNT}."
        )

    if not write:
        report.skipped_count = len(features)
        report.region_assignment = "SKIPPED_DRY_RUN"
        return report

    factory = session_factory or get_sessionmaker()
    session: Session = factory()
    now = _utcnow()
    run = IngestionRun(
        source_id=SOURCE_ID,
        started_at=now,
        status="RUNNING",
        rows_received=report.total_feature_count,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=report.rejected_count,
        reference_period=REFERENCE_DATE.isoformat(),
        transformation_version=TRANSFORMATION_VERSION,
    )
    try:
        session.add(run)
        session.commit()
        session.refresh(run)
        report.ingestion_run_id = run.run_id

        # One transaction covers the version row, every feature batch, the run
        # status, and the freshness row: a failure mid-load leaves no partial
        # release behind. The session already opened its transaction on the
        # refresh above, so it is committed explicitly at the end rather than
        # through a nested ``session.begin()``.
        version, created = _get_or_create_version(
            session,
            validation=validation,
            shp_checksum=shp_checksum,
            archive_checksum=report.source_archive_checksum,
            archive_filename=None if archive is None else archive.name,
            run=run,
            now=now,
            total_features=report.total_feature_count,
            accepted=len(features),
            rejected=report.rejected_count,
            contract_warnings=report.warnings,
        )
        report.dataset_version_id = version.id
        report.dataset_version_created = created

        sido: list[_Boundary] = []
        sigungu: list[_Boundary] = []
        if assign_regions:
            sido = _load_region_boundaries(session, "SIDO")
            sigungu = _load_region_boundaries(session, "SIGUNGU")
            if sido or sigungu:
                report.region_assignment = "SPATIAL_OFFICIAL_BOUNDARIES"
            else:
                report.region_assignment = "DEFERRED_NO_OFFICIAL_BOUNDARIES"
                report.add_warning(
                    "No official region boundaries are present in this database; "
                    "normalized_sido_code/normalized_sigungu_code are left NULL and "
                    "spatial assignment is deferred. Source names are preserved."
                )
        else:
            report.region_assignment = "DISABLED"

        # Same cast convention as the structural loaders: the declarative
        # ``__table__`` attribute is typed as FromClause.
        table = cast("Table", EnvironmentalWetlandInventoryFeature.__table__)
        writer = _BatchWriter(session, table, batch_size=batch_size)
        for feature in features:
            sido_code: str | None = None
            sigungu_code: str | None = None
            if sido or sigungu:
                point = feature.geometry_wgs84.representative_point()
                sido_code = _assign_region(point, sido)
                sigungu_code = _assign_region(point, sigungu)
                if sido_code is not None:
                    report.sido_assigned_count += 1
                if sigungu_code is not None:
                    report.sigungu_assigned_count += 1
            writer.add(
                {
                    "dataset_version_id": version.id,
                    "source_feature_id": feature.source_feature_id,
                    "source_fid": feature.source_fid,
                    "wetland_name": feature.wetland_name,
                    "wetland_code": feature.source_feature_id,
                    "wetland_type": feature.wetland_type,
                    "wetland_type_korea": feature.wetland_type_korea,
                    "wetland_type_ramsar": feature.wetland_type_ramsar,
                    "reported_area_m2": feature.reported_area_m2,
                    "source_longitude": feature.source_longitude,
                    "source_latitude": feature.source_latitude,
                    "source_address": feature.source_address,
                    "source_sido_name": feature.source_sido_name,
                    "source_sigungu_name": feature.source_sigungu_name,
                    "source_eupmyeondong_name": feature.source_eupmyeondong_name,
                    "source_ri_name": feature.source_ri_name,
                    "designation_note": feature.designation_note,
                    "normalized_sido_code": sido_code,
                    "normalized_sigungu_code": sigungu_code,
                    "geometry": f"SRID={TARGET_SRID};{feature.geometry_wgs84.wkt}",
                    "geometry_area_m2": feature.geometry_area_m2,
                    "source_crs": SOURCE_CRS,
                    "transformation_version": TRANSFORMATION_VERSION,
                    "source_reference_date": REFERENCE_DATE,
                    "source_checksum": shp_checksum,
                    "feature_fingerprint": feature.feature_fingerprint,
                    "raw_attributes": feature.raw_attributes,
                    "created_at": now,
                }
            )
        report.inserted_count = writer.finish()
        report.skipped_count = len(features) - report.inserted_count
        if report.sido_assigned_count == 0 and report.region_assignment.startswith("SPATIAL"):
            report.add_warning(
                "No feature fell inside an official boundary stored in this database; "
                "region codes are NULL. Source names are preserved."
            )

        run.status = "SUCCEEDED" if report.rejected_count == 0 else "PARTIAL"
        run.completed_at = _utcnow()
        run.rows_inserted = report.inserted_count
        run.rows_rejected = report.rejected_count
        freshness = session.get(DatasetFreshness, SOURCE_ID)
        if freshness is None:
            freshness = DatasetFreshness(source_id=SOURCE_ID)
            session.add(freshness)
        freshness.latest_reference_period = REFERENCE_DATE.isoformat()
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

    if report.rejected_count:
        report.status = "PARTIAL"
    return report
