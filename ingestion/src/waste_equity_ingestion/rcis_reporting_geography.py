"""RCIS waste reporting geography build and city-value backfill (additive).

Seven large Gyeonggi cities are reported by RCIS at the city level while SGIS
2024 represents them as administrative-district (구) children. This module builds
an explicit, metric-scoped reporting geography for the waste metrics without
touching native SGIS regions or ``regional_waste_statistics``:

1. Build one ``waste_reporting_regions`` row per city — a **derived** geometry
   equal to the deterministic PostGIS ``ST_Union`` of the exact SGIS child
   boundaries — plus the child lineage in ``waste_reporting_region_members``.
   A missing or duplicate child, or an invalid/empty union geometry, is a visible
   failure.
2. Write the **source-native** RCIS city waste total once per PID into
   ``reporting_region_waste_statistics`` (the value is copied verbatim from the
   source row; it is not aggregated). The values are re-parsed from the stored
   sanitized raw RCIS responses with the production parser, so the backfill is
   fully reproducible offline (no live API call) and idempotent.

The live ``rcis-waste-ingest`` writer imports :func:`upsert_reporting_waste_row`
and :func:`resolve_reporting_region` so a live run writes the same city rows via
the same code path once the reporting regions exist.
"""

from __future__ import annotations

import datetime
import hashlib
from dataclasses import dataclass, field
from typing import Any

from geoalchemy2 import WKBElement
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    IngestionRun,
    RawApiResponse,
    Region,
    ReportingRegionWasteStatistics,
    WasteReportingRegion,
    WasteReportingRegionMember,
)
from waste_equity_backend.models.reporting_geography import (
    DERIVED_GEOMETRY_METHOD_ST_UNION,
    REPORTING_GEOGRAPHY_DERIVED_CITY_UNION,
    SOURCE_REPORTING_LEVEL_CITY,
)

from .errors import IngestionError, RegionMappingError
from .rcis_region_crosswalk import SIDO_ALIASES, normalize_name
from .rcis_waste_contract import (
    ACCOUNTING_BASIS,
    RCIS_SOURCE_ID,
    TARGET_PIDS,
    WasteRecord,
    parse_pid_response,
    require_supported_year,
)
from .rcis_waste_ingestion import _differs, _utcnow

TRANSFORMATION_VERSION = "rcis-reporting-geography-v1"
BOUNDARY_TARGET_CRS = "EPSG:4326"


@dataclass(frozen=True)
class ReportingCitySpec:
    """One RCIS city reporting region declared by its exact SGIS child codes."""

    reporting_region_code: str
    reporting_region_name: str
    rcis_sido_name: str
    rcis_sigungu_name: str
    child_region_codes: tuple[str, ...]


# The seven Gyeonggi cities RCIS reports at city level, with their EXACT SGIS 2024
# child region codes (verified against the loaded SGIS geography). The
# reporting_region_code namespace ``KR-RCISRG-*`` cannot be mistaken for an SGIS
# code (``KR-SGIS-*``); the numeric suffix is the shared 4-digit SGIS prefix of
# the member districts and is a minted platform code, never an SGIS adm_cd.
REPORTING_CITIES: tuple[ReportingCitySpec, ...] = (
    ReportingCitySpec(
        "KR-RCISRG-3101",
        "경기도 수원시",
        "경기",
        "수원시",
        ("KR-SGIS-31011", "KR-SGIS-31012", "KR-SGIS-31013", "KR-SGIS-31014"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3102",
        "경기도 성남시",
        "경기",
        "성남시",
        ("KR-SGIS-31021", "KR-SGIS-31022", "KR-SGIS-31023"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3104",
        "경기도 안양시",
        "경기",
        "안양시",
        ("KR-SGIS-31041", "KR-SGIS-31042"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3105",
        "경기도 부천시",
        "경기",
        "부천시",
        ("KR-SGIS-31051", "KR-SGIS-31052", "KR-SGIS-31053"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3109",
        "경기도 안산시",
        "경기",
        "안산시",
        ("KR-SGIS-31091", "KR-SGIS-31092"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3110",
        "경기도 고양시",
        "경기",
        "고양시",
        ("KR-SGIS-31101", "KR-SGIS-31103", "KR-SGIS-31104"),
    ),
    ReportingCitySpec(
        "KR-RCISRG-3119",
        "경기도 용인시",
        "경기",
        "용인시",
        ("KR-SGIS-31191", "KR-SGIS-31192", "KR-SGIS-31193"),
    ),
)


def _canonical(sido: str, sigungu: str) -> tuple[str, str]:
    key = normalize_name(sido)
    return SIDO_ALIASES.get(key, key), normalize_name(sigungu)


# (canonical sido, sigungu) -> spec, for mapping an RCIS city record to a region.
_CITY_BY_NAME: dict[tuple[str, str], ReportingCitySpec] = {
    _canonical(spec.rcis_sido_name, spec.rcis_sigungu_name): spec for spec in REPORTING_CITIES
}


def resolve_reporting_region(
    session: Session, rcis_sido_name: str, rcis_sigungu_name: str, year: int
) -> WasteReportingRegion | None:
    """Return the built reporting region for an RCIS city name pair, or None."""
    spec = _CITY_BY_NAME.get(_canonical(rcis_sido_name, rcis_sigungu_name))
    if spec is None:
        return None
    return session.scalar(
        select(WasteReportingRegion).where(
            WasteReportingRegion.reporting_region_code == spec.reporting_region_code,
            WasteReportingRegion.valid_from == datetime.date(year, 1, 1),
        )
    )


@dataclass
class CityGeometryReport:
    reporting_region_code: str
    reporting_region_name: str
    child_region_codes: list[str]
    action: str  # INSERTED | UPDATED | UNCHANGED
    child_members_written: int


@dataclass
class ReportingGeographyReport:
    mode: str
    status: str
    reference_year: int
    transformation_version: str = TRANSFORMATION_VERSION
    regions_expected: int = 0
    regions_built: int = 0
    regions_inserted: int = 0
    regions_updated: int = 0
    regions_unchanged: int = 0
    members_expected: int = 0
    members_present: int = 0
    stats_rows_inserted: int = 0
    stats_rows_updated: int = 0
    stats_rows_unchanged: int = 0
    stats_rows_expected: int = 0
    ingestion_run_id: int | None = None
    city_reports: list[CityGeometryReport] = field(default_factory=list)
    per_pid_city_rows: dict[str, int] = field(default_factory=dict)
    missing_city_records: list[str] = field(default_factory=list)
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "reference_year": self.reference_year,
            "transformation_version": self.transformation_version,
            "regions_expected": self.regions_expected,
            "regions_built": self.regions_built,
            "regions_inserted": self.regions_inserted,
            "regions_updated": self.regions_updated,
            "regions_unchanged": self.regions_unchanged,
            "members_expected": self.members_expected,
            "members_present": self.members_present,
            "stats_rows_expected": self.stats_rows_expected,
            "stats_rows_inserted": self.stats_rows_inserted,
            "stats_rows_updated": self.stats_rows_updated,
            "stats_rows_unchanged": self.stats_rows_unchanged,
            "ingestion_run_id": self.ingestion_run_id,
            "city_reports": [
                {
                    "reporting_region_code": c.reporting_region_code,
                    "reporting_region_name": c.reporting_region_name,
                    "child_region_codes": c.child_region_codes,
                    "action": c.action,
                    "child_members_written": c.child_members_written,
                }
                for c in self.city_reports
            ],
            "per_pid_city_rows": self.per_pid_city_rows,
            "missing_city_records": self.missing_city_records,
            "message": self.message,
        }


@dataclass(frozen=True)
class _ChildRegion:
    region_id: int
    region_code: str
    region_name: str
    boundary_reference_period: str | None
    boundary_source_crs: str | None
    boundary_target_crs: str | None
    source_id: str | None


def _load_children(session: Session, spec: ReportingCitySpec, year: int) -> list[_ChildRegion]:
    year_start = datetime.date(year, 1, 1)
    rows = session.execute(
        select(
            Region.id,
            Region.region_code,
            Region.region_name,
            Region.boundary_reference_period,
            Region.boundary_source_crs,
            Region.boundary_target_crs,
            Region.source_id,
        ).where(
            Region.region_code.in_(spec.child_region_codes),
            Region.region_level == "SIGUNGU",
            Region.valid_from <= year_start,
            (Region.valid_to.is_(None)) | (Region.valid_to >= year_start),
        )
    ).all()
    children = [_ChildRegion(r[0], r[1], r[2], r[3], r[4], r[5], r[6]) for r in rows]
    found_codes = {child.region_code for child in children}
    expected_codes = set(spec.child_region_codes)
    missing = sorted(expected_codes - found_codes)
    extra = sorted(found_codes - expected_codes)
    if missing:
        raise RegionMappingError(
            f"{spec.reporting_region_code} ({spec.reporting_region_name}): missing SGIS child "
            f"region(s) {missing}; cannot build a derived geometry from an incomplete child set"
        )
    if len(children) != len(spec.child_region_codes) or extra:
        raise RegionMappingError(
            f"{spec.reporting_region_code} ({spec.reporting_region_name}): expected exactly "
            f"{len(spec.child_region_codes)} SGIS children {sorted(expected_codes)}, found "
            f"{sorted(found_codes)} (duplicate or unexpected rows)"
        )
    return children


def _build_union_geometry(session: Session, child_ids: list[int], label: str) -> tuple[bytes, str]:
    """Deterministic ST_Union of the child boundaries; visible failure if invalid.

    Returns (EWKB bytes, sha256 hex hash).
    """
    row = session.execute(
        text(
            """
            SELECT
                ST_IsValid(g) AS is_valid,
                ST_IsEmpty(g) AS is_empty,
                ST_SRID(g) AS srid,
                GeometryType(g) AS gtype,
                ST_AsEWKB(g) AS ewkb
            FROM (
                SELECT ST_Multi(ST_Union(geometry)) AS g
                FROM regions
                WHERE id = ANY(:ids)
            ) t
            """
        ),
        {"ids": child_ids},
    ).one()
    is_valid, is_empty, srid, gtype, ewkb = row
    if ewkb is None or is_empty:
        raise RegionMappingError(f"{label}: derived union geometry is empty")
    if not is_valid:
        raise RegionMappingError(f"{label}: derived union geometry is not ST_IsValid")
    if int(srid) != 4326:
        raise RegionMappingError(f"{label}: derived union SRID is {srid}, expected 4326")
    if gtype not in ("MULTIPOLYGON", "POLYGON"):
        raise RegionMappingError(f"{label}: derived union GeometryType is {gtype!r}")
    ewkb_bytes = bytes(ewkb)
    return ewkb_bytes, hashlib.sha256(ewkb_bytes).hexdigest()


def _build_city(
    session: Session, spec: ReportingCitySpec, year: int, now: datetime.datetime, write: bool
) -> CityGeometryReport:
    children = _load_children(session, spec, year)
    child_ids = [child.region_id for child in children]
    ewkb, geom_hash = _build_union_geometry(
        session, child_ids, f"{spec.reporting_region_code} ({spec.reporting_region_name})"
    )
    # Inherit boundary provenance from the SGIS children (they must agree).
    reference_periods = {c.boundary_reference_period for c in children}
    target_crs = {c.boundary_target_crs for c in children}
    if len(target_crs) != 1 or next(iter(target_crs)) != BOUNDARY_TARGET_CRS:
        raise RegionMappingError(
            f"{spec.reporting_region_code}: SGIS children disagree on boundary target CRS "
            f"({sorted(str(c) for c in target_crs)}) or it is not {BOUNDARY_TARGET_CRS}"
        )
    boundary_reference_period = (
        next(iter(reference_periods)) if len(reference_periods) == 1 else str(year)
    )
    source_crs = {c.boundary_source_crs for c in children}
    boundary_source_crs = next(iter(source_crs)) if len(source_crs) == 1 else None
    source_ids = {c.source_id for c in children}
    boundary_source_id = next(iter(source_ids)) if len(source_ids) == 1 else None

    valid_from = datetime.date(year, 1, 1)
    valid_to = datetime.date(year, 12, 31)
    existing = session.scalar(
        select(WasteReportingRegion).where(
            WasteReportingRegion.reporting_region_code == spec.reporting_region_code,
            WasteReportingRegion.valid_from == valid_from,
        )
    )
    data_values: dict[str, Any] = {
        "reporting_region_name": spec.reporting_region_name,
        "rcis_sido_name": spec.rcis_sido_name,
        "rcis_sigungu_name": spec.rcis_sigungu_name,
        "reporting_geography_type": REPORTING_GEOGRAPHY_DERIVED_CITY_UNION,
        "geometry_kind": "DERIVED",
        "derived_geometry_method": DERIVED_GEOMETRY_METHOD_ST_UNION,
        "source_reporting_level": SOURCE_REPORTING_LEVEL_CITY,
        "child_region_count": len(children),
        "boundary_source_id": boundary_source_id,
        "boundary_reference_period": boundary_reference_period,
        "boundary_source_crs": boundary_source_crs,
        "boundary_target_crs": BOUNDARY_TARGET_CRS,
        "boundary_geometry_hash": geom_hash,
        "valid_to": valid_to,
    }
    geometry = WKBElement(ewkb, srid=4326, extended=True)

    if existing is None:
        action = "INSERTED"
        if write:
            region = WasteReportingRegion(
                reporting_region_code=spec.reporting_region_code,
                valid_from=valid_from,
                geometry=geometry,
                boundary_retrieved_at=now,
                created_at=now,
                updated_at=now,
                **data_values,
            )
            session.add(region)
            session.flush()
            reporting_region_id = region.id
        else:
            reporting_region_id = None
    else:
        # Idempotency: a matching hash + unchanged metadata is UNCHANGED.
        changed = existing.boundary_geometry_hash != geom_hash or any(
            _differs(getattr(existing, attr), value) for attr, value in data_values.items()
        )
        action = "UPDATED" if changed else "UNCHANGED"
        reporting_region_id = existing.id
        if write and changed:
            existing.geometry = geometry
            for attr, value in data_values.items():
                setattr(existing, attr, value)
            existing.boundary_retrieved_at = now
            existing.updated_at = now

    members_written = 0
    if write and reporting_region_id is not None:
        members_written = _upsert_members(session, reporting_region_id, children)

    return CityGeometryReport(
        reporting_region_code=spec.reporting_region_code,
        reporting_region_name=spec.reporting_region_name,
        child_region_codes=[child.region_code for child in children],
        action=action,
        child_members_written=members_written,
    )


def _upsert_members(
    session: Session, reporting_region_id: int, children: list[_ChildRegion]
) -> int:
    existing = {
        member.child_region_id: member
        for member in session.scalars(
            select(WasteReportingRegionMember).where(
                WasteReportingRegionMember.reporting_region_id == reporting_region_id
            )
        ).all()
    }
    present = 0
    for child in children:
        member = existing.get(child.region_id)
        if member is None:
            session.add(
                WasteReportingRegionMember(
                    reporting_region_id=reporting_region_id,
                    child_region_id=child.region_id,
                    child_region_code=child.region_code,
                    child_region_name=child.region_name,
                )
            )
        else:
            member.child_region_code = child.region_code
            member.child_region_name = child.region_name
        present += 1
    return present


def upsert_reporting_waste_row(
    session: Session,
    *,
    reporting_region_id: int,
    record: WasteRecord,
    year: int,
    raw_response_id: int | None,
    run_id: int,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    """Upsert a source-native RCIS city waste row. Returns (created, changed)."""
    existing = session.scalar(
        select(ReportingRegionWasteStatistics).where(
            ReportingRegionWasteStatistics.reporting_region_id == reporting_region_id,
            ReportingRegionWasteStatistics.reference_year == year,
            ReportingRegionWasteStatistics.source_pid == record.source_pid,
            ReportingRegionWasteStatistics.waste_category_name == record.waste_category_name,
        )
    )
    data_values: dict[str, Any] = {
        "reference_period": str(year),
        "source_id": RCIS_SOURCE_ID,
        "official_dataset_name": record.official_dataset_name,
        "waste_stream": record.waste_stream,
        "waste_category_code": None,
        "generation_quantity": record.generation_quantity,
        "recycling_quantity": record.recycling_quantity,
        "incineration_quantity": record.incineration_quantity,
        "landfill_quantity": record.landfill_quantity,
        "other_treatment_quantity": record.other_treatment_quantity,
        "total_treatment_quantity": record.total_treatment_quantity,
        "total_treatment_is_derived": True,
        "treatment_reconciliation_difference": record.treatment_reconciliation_difference,
        "quantity_unit": record.quantity_unit,
        "accounting_basis": ACCOUNTING_BASIS,
        "rcis_sido_name": record.rcis_sido_name,
        "rcis_sigungu_name": record.rcis_sigungu_name,
        "source_geographic_level": SOURCE_REPORTING_LEVEL_CITY,
        "reporting_geography_type": REPORTING_GEOGRAPHY_DERIVED_CITY_UNION,
        "transformation_version": TRANSFORMATION_VERSION,
    }
    provenance_values: dict[str, Any] = {
        "retrieved_at": now,
        "raw_response_id": raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            ReportingRegionWasteStatistics(
                reporting_region_id=reporting_region_id,
                reference_year=year,
                source_pid=record.source_pid,
                waste_category_name=record.waste_category_name,
                created_at=now,
                updated_at=now,
                **data_values,
                **provenance_values,
            )
        )
        return True, True
    changed = any(_differs(getattr(existing, attr), value) for attr, value in data_values.items())
    if changed:
        for attr, value in {**data_values, **provenance_values}.items():
            setattr(existing, attr, value)
        existing.updated_at = now
    return False, changed


def _latest_raw_payload(session: Session, pid: str, year: int) -> tuple[dict[str, Any], int] | None:
    row = session.execute(
        select(RawApiResponse.sanitized_response, RawApiResponse.id)
        .where(
            RawApiResponse.source_id == RCIS_SOURCE_ID,
            RawApiResponse.endpoint_identifier == f"wss/JsonApi/{pid}:year={year}",
        )
        .order_by(RawApiResponse.id.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    sanitized, raw_id = row
    payload = sanitized.get("payload") if isinstance(sanitized, dict) else None
    if not isinstance(payload, dict):
        return None
    return payload, raw_id


def run_reporting_geography(
    settings: Any,
    *,
    year: int,
    scope: str,
    write: bool,
    pids: tuple[str, ...] = TARGET_PIDS,
) -> ReportingGeographyReport:
    """Build the reporting regions and backfill city waste values from raw responses."""
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented for reporting geography")
    require_supported_year(year)

    session_factory = get_sessionmaker()
    session = session_factory()
    now = _utcnow()
    report = ReportingGeographyReport(
        mode="write" if write else "dry-run",
        status="RUNNING",
        reference_year=year,
        regions_expected=len(REPORTING_CITIES),
        members_expected=sum(len(spec.child_region_codes) for spec in REPORTING_CITIES),
        stats_rows_expected=len(REPORTING_CITIES) * len(pids),
    )
    run: IngestionRun | None = None
    try:
        if write:
            run = IngestionRun(
                source_id=RCIS_SOURCE_ID,
                started_at=now,
                status="RUNNING",
                rows_received=0,
                rows_inserted=0,
                rows_updated=0,
                rows_rejected=0,
                reference_period=str(year),
                transformation_version=TRANSFORMATION_VERSION,
            )
            session.add(run)
            session.commit()
            session.refresh(run)
            report.ingestion_run_id = run.run_id

        # 1) Build reporting regions + members (derived geometry).
        for spec in REPORTING_CITIES:
            city_report = _build_city(session, spec, year, now, write)
            report.city_reports.append(city_report)
            report.regions_built += 1
            report.members_present += city_report.child_members_written
            if city_report.action == "INSERTED":
                report.regions_inserted += 1
            elif city_report.action == "UPDATED":
                report.regions_updated += 1
            else:
                report.regions_unchanged += 1
        if write:
            session.flush()

        # 2) Backfill source-native city waste values from stored raw responses.
        code_to_region_id: dict[str, int] = {}
        if write:
            for spec in REPORTING_CITIES:
                region = session.scalar(
                    select(WasteReportingRegion).where(
                        WasteReportingRegion.reporting_region_code == spec.reporting_region_code,
                        WasteReportingRegion.valid_from == datetime.date(year, 1, 1),
                    )
                )
                if region is not None:
                    code_to_region_id[spec.reporting_region_code] = region.id

        for pid in pids:
            loaded = _latest_raw_payload(session, pid, year)
            if loaded is None:
                report.missing_city_records.append(f"{pid}: no stored raw response for {year}")
                continue
            payload, raw_id = loaded
            parsed = parse_pid_response(payload, pid=pid, year=year)
            city_rows = 0
            for record in parsed.records:
                city_spec = _CITY_BY_NAME.get(
                    _canonical(record.rcis_sido_name, record.rcis_sigungu_name)
                )
                if city_spec is None:
                    continue
                city_rows += 1
                if not write:
                    continue
                reporting_region_id = code_to_region_id.get(city_spec.reporting_region_code)
                if reporting_region_id is None:
                    report.missing_city_records.append(
                        f"{pid}: reporting region {city_spec.reporting_region_code} not built"
                    )
                    continue
                created, changed = upsert_reporting_waste_row(
                    session,
                    reporting_region_id=reporting_region_id,
                    record=record,
                    year=year,
                    raw_response_id=raw_id,
                    run_id=run.run_id if run is not None else 0,
                    now=now,
                )
                if created:
                    report.stats_rows_inserted += 1
                elif changed:
                    report.stats_rows_updated += 1
                else:
                    report.stats_rows_unchanged += 1
            report.per_pid_city_rows[pid] = city_rows

        if write and run is not None:
            run.status = "SUCCEEDED"
            run.completed_at = _utcnow()
            run.rows_received = sum(report.per_pid_city_rows.values())
            run.rows_inserted = report.stats_rows_inserted
            run.rows_updated = report.stats_rows_updated
            run.rows_rejected = 0
            session.commit()

        report.status = "SUCCEEDED" if write else "VALIDATED"
        report.message = (
            "RCIS reporting geography built and city waste values written."
            if write
            else "Reporting geography validated (child sets, union geometry, city records); "
            "no database writes performed."
        )
        return report
    except Exception as exc:
        session.rollback()
        if write and run is not None:
            failed = session.get(IngestionRun, run.run_id)
            if failed is not None:
                failed.status = "FAILED"
                failed.completed_at = _utcnow()
                failed.error_category = exc.__class__.__name__[:50]
                failed.error_message = str(exc)[:1000]
                session.commit()
        raise
    finally:
        session.close()


__all__ = [
    "REPORTING_CITIES",
    "ReportingCitySpec",
    "ReportingGeographyReport",
    "resolve_reporting_region",
    "run_reporting_geography",
    "upsert_reporting_waste_row",
]
