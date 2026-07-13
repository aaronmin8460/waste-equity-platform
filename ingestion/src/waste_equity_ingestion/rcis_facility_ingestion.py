"""One-shot RCIS waste-treatment facility production ingestion (Phase 2.3).

Reuses the Phase 2.0/2.1/2.2 production ingestion framework (ingestion_runs,
raw_api_responses, dataset_freshness, data_sources, backend models/session, the
RCIS client/request builder, sanitization, and the region crosswalk) and the
CLI/Docker one-shot pattern. It does not create a second ingestion-run framework
and does not add a scheduler.

In-scope (capital-region) facilities are always stored, including those whose
RCIS sigungu name does not map to a single SGIS canonical region (SGIS
multi-district cities, non-canonical labels). Those are retained with a NULL
region_id and a ``region_mapping_status`` pending geocoding/review — facilities
are discrete real records worth preserving, unlike aggregate region rows.
Geocoding is deferred to a later VWorld phase.
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    RawApiResponse,
    WasteTreatmentFacility,
)

from .config import ProbeSettings
from .errors import IngestionError, ProbeError
from .probes.waste_statistics import OPERATION_PATH
from .rcis_facility_contract import (
    ACCOUNTING_BASIS,
    PID_SPECS,
    RCIS_SOURCE_ID,
    TARGET_PIDS,
    TRANSFORMATION_VERSION,
    FacilityParseResult,
    FacilityRecord,
    parse_facility_response,
)
from .rcis_region_crosswalk import (
    AMBIGUOUS,
    COARSER_REPORTING_GEOGRAPHY,
    EXACT_MATCH,
    OUT_OF_SCOPE,
    UNMATCHED,
    RegionCrosswalk,
)
from .rcis_waste_contract import require_supported_year
from .rcis_waste_ingestion import (
    DEFAULT_REQUEST_DELAY_SECONDS,
    RawRcisResponse,
    _hash_payload,
    _load_crosswalk,
    _require_rcis_config,
    _sanitize_error,
    _utcnow,
    fetch_pid,
)
from .samples import sanitize

# RCIS sigungu resolution -> stored facility region_mapping_status. A facility in
# a coarser-reporting-geography city (RCIS reports the city, SGIS has 구 districts)
# still needs geocoding to pin it to a native district, so it maps to
# REQUIRES_GEOCODE exactly as before.
_STATUS_MAP = {
    EXACT_MATCH: "EXACT_MATCH",
    COARSER_REPORTING_GEOGRAPHY: "REQUIRES_GEOCODE",
    UNMATCHED: "UNMATCHED",
    AMBIGUOUS: "AMBIGUOUS",
}


@dataclass(frozen=True)
class MappedFacility:
    record: FacilityRecord
    region_id: int | None
    region_mapping_status: str


@dataclass
class FacilityPidReport:
    pid: str
    provider_code: str
    official_dataset_name: str
    facility_category: str
    source_record_count: int
    excluded_aggregate_rows: int
    parse_rejected: int
    in_scope_facilities: int
    exact_match: int
    requires_geocode: int
    unmatched: int
    ambiguous: int


@dataclass
class RcisFacilityReport:
    mode: str
    status: str
    reference_year: int
    schema_era: str
    accounting_basis: str
    rows_received: int
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_rejected: int = 0
    normalized_row_total: int | None = None
    raw_responses_inserted: int = 0
    raw_responses_reused: int = 0
    ingestion_run_id: int | None = None
    pid_reports: list[FacilityPidReport] = field(default_factory=list)
    region_mapping_status_totals: dict[str, int] = field(default_factory=dict)
    facilities_by_sido: dict[str, int] = field(default_factory=dict)
    unmatched_labels: list[str] = field(default_factory=list)
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "reference_year": self.reference_year,
            "schema_era": self.schema_era,
            "accounting_basis": self.accounting_basis,
            "rows_received": self.rows_received,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_rejected": self.rows_rejected,
            "normalized_row_total": self.normalized_row_total,
            "raw_responses_inserted": self.raw_responses_inserted,
            "raw_responses_reused": self.raw_responses_reused,
            "ingestion_run_id": self.ingestion_run_id,
            "pid_reports": [
                {
                    "pid": r.pid,
                    "provider_code": r.provider_code,
                    "official_dataset_name": r.official_dataset_name,
                    "facility_category": r.facility_category,
                    "source_record_count": r.source_record_count,
                    "excluded_aggregate_rows": r.excluded_aggregate_rows,
                    "parse_rejected_nationwide": r.parse_rejected,
                    "in_scope_facilities": r.in_scope_facilities,
                    "exact_match": r.exact_match,
                    "requires_geocode": r.requires_geocode,
                    "unmatched": r.unmatched,
                    "ambiguous": r.ambiguous,
                }
                for r in self.pid_reports
            ],
            "region_mapping_status_totals": self.region_mapping_status_totals,
            "facilities_by_sido": self.facilities_by_sido,
            "unmatched_labels": self.unmatched_labels,
            "message": self.message,
        }


@dataclass(frozen=True)
class FacilityFetchBundle:
    raw_responses: list[RawRcisResponse]
    parse_results: dict[str, FacilityParseResult]


def fetch_all_facilities(
    settings: ProbeSettings,
    *,
    year: int,
    pids: tuple[str, ...],
    request_delay: float,
) -> FacilityFetchBundle:
    import time

    _require_rcis_config(settings)
    require_supported_year(year)
    endpoint = settings.rcis_api_base_url.rstrip("/") + OPERATION_PATH
    raw_responses: list[RawRcisResponse] = []
    parse_results: dict[str, FacilityParseResult] = {}
    for index, pid in enumerate(pids):
        if index > 0 and request_delay > 0:
            time.sleep(request_delay)
        response, retrieved_at = fetch_pid(settings, endpoint, pid, year)
        parsed = parse_facility_response(response.payload, pid=pid, year=year)
        parse_results[pid] = parsed
        raw_responses.append(
            RawRcisResponse(
                pid=pid,
                endpoint_identifier=f"wss/JsonApi/{pid}:year={year}",
                reference_period=str(year),
                request_metadata={
                    "endpoint_path": OPERATION_PATH,
                    "pid": pid,
                    "year": str(year),
                    "provider_code": parsed.provider_code,
                    "record_count": parsed.source_record_count,
                },
                payload=response.payload,
                retrieved_at=retrieved_at,
                record_count=parsed.source_record_count,
            )
        )
    return FacilityFetchBundle(raw_responses=raw_responses, parse_results=parse_results)


def run_rcis_facility_ingestion(
    settings: ProbeSettings,
    *,
    year: int,
    scope: str,
    write: bool,
    pids: tuple[str, ...] = TARGET_PIDS,
    request_delay: float = DEFAULT_REQUEST_DELAY_SECONDS,
) -> RcisFacilityReport:
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented in Phase 2.3")
    for pid in pids:
        if pid not in PID_SPECS:
            raise IngestionError(f"Unsupported RCIS facility PID {pid!r}")
    require_supported_year(year)

    session_factory = get_sessionmaker()
    read_session = session_factory()
    try:
        crosswalk, _regions = _load_crosswalk(read_session, year)
    finally:
        read_session.close()

    bundle = fetch_all_facilities(settings, year=year, pids=pids, request_delay=request_delay)
    mapping = _map_bundle(bundle, crosswalk, pids)

    if not write:
        report = _build_report("dry-run", "VALIDATED", year, bundle, mapping)
        report.message = "Live RCIS facility responses validated and mapped; no writes performed."
        return report

    session = session_factory()
    run = IngestionRun(
        source_id=RCIS_SOURCE_ID,
        started_at=_utcnow(),
        status="RUNNING",
        rows_received=0,
        rows_inserted=0,
        rows_updated=0,
        rows_rejected=0,
        reference_period=str(year),
        transformation_version=TRANSFORMATION_VERSION,
    )
    try:
        session.add(run)
        session.commit()
        session.refresh(run)
        report = _write_bundle(session, year, bundle, mapping, run)
        session.commit()
        return report
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run.run_id, year, exc)
        if isinstance(exc, ProbeError):
            raise
        raise IngestionError(
            "RCIS facility ingestion failed; normalized writes were rolled back"
        ) from exc
    finally:
        session.close()


@dataclass
class _FacilityMapping:
    mapped_by_pid: dict[str, list[MappedFacility]]
    in_scope_by_pid: dict[str, int]
    parse_rejected_by_pid: dict[str, int]
    status_by_pid: dict[str, dict[str, int]]
    unmatched_labels: set[str]


def _map_bundle(
    bundle: FacilityFetchBundle,
    crosswalk: RegionCrosswalk,
    pids: tuple[str, ...],
) -> _FacilityMapping:
    mapped_by_pid: dict[str, list[MappedFacility]] = {}
    in_scope_by_pid: dict[str, int] = {}
    parse_rejected_by_pid: dict[str, int] = {}
    status_by_pid: dict[str, dict[str, int]] = {}
    unmatched_labels: set[str] = set()

    for pid in pids:
        parsed = bundle.parse_results[pid]
        parse_rejected_by_pid[pid] = len(parsed.rejected_rows)
        mapped: list[MappedFacility] = []
        counts = {"EXACT_MATCH": 0, "REQUIRES_GEOCODE": 0, "UNMATCHED": 0, "AMBIGUOUS": 0}
        for record in parsed.records:
            resolution = crosswalk.resolve(record.rcis_sido_name, record.rcis_sigungu_name)
            if resolution.status == OUT_OF_SCOPE:
                continue
            status = _STATUS_MAP[resolution.status]
            region_id = resolution.region.region_id if resolution.region is not None else None
            if status in ("UNMATCHED", "AMBIGUOUS"):
                unmatched_labels.add(f"{record.rcis_sido_name} {record.rcis_sigungu_name}")
            counts[status] += 1
            mapped.append(
                MappedFacility(record=record, region_id=region_id, region_mapping_status=status)
            )
        mapped_by_pid[pid] = mapped
        in_scope_by_pid[pid] = len(mapped)
        status_by_pid[pid] = counts

    return _FacilityMapping(
        mapped_by_pid=mapped_by_pid,
        in_scope_by_pid=in_scope_by_pid,
        parse_rejected_by_pid=parse_rejected_by_pid,
        status_by_pid=status_by_pid,
        unmatched_labels=unmatched_labels,
    )


def _write_bundle(
    session: Session,
    year: int,
    bundle: FacilityFetchBundle,
    mapping: _FacilityMapping,
    run: IngestionRun,
) -> RcisFacilityReport:
    now = _utcnow()
    raw_inserted = 0
    raw_reused = 0
    raw_ids_by_pid: dict[str, int] = {}
    for raw in bundle.raw_responses:
        raw_response, was_inserted = _get_or_create_raw_response(session, raw, run.run_id)
        raw_ids_by_pid[raw.pid] = raw_response.id
        raw_inserted += int(was_inserted)
        raw_reused += int(not was_inserted)

    inserted = 0
    updated = 0
    for pid in bundle.parse_results:
        raw_id = raw_ids_by_pid[pid]
        for facility in mapping.mapped_by_pid.get(pid, []):
            created, changed = _upsert_facility(
                session,
                facility=facility,
                year=year,
                raw_response_id=raw_id,
                run_id=run.run_id,
                now=now,
            )
            inserted += int(created)
            updated += int(changed and not created)

    _update_freshness(session, year=year, now=now)
    session.flush()
    normalized_count = session.scalar(
        select(func.count())
        .select_from(WasteTreatmentFacility)
        .where(WasteTreatmentFacility.reference_year == year)
    )

    rows_received = sum(mapping.in_scope_by_pid.values())
    run.status = "SUCCEEDED"
    run.completed_at = now
    run.rows_received = rows_received
    run.rows_inserted = inserted
    run.rows_updated = updated
    run.rows_rejected = 0
    run.reference_period = str(year)
    run.transformation_version = TRANSFORMATION_VERSION

    report = _build_report("write", "SUCCEEDED", year, bundle, mapping)
    report.rows_inserted = inserted
    report.rows_updated = updated
    report.raw_responses_inserted = raw_inserted
    report.raw_responses_reused = raw_reused
    report.ingestion_run_id = run.run_id
    report.normalized_row_total = int(normalized_count or 0)
    report.message = "RCIS capital-region waste-treatment facility ingestion succeeded."
    return report


def _upsert_facility(
    session: Session,
    *,
    facility: MappedFacility,
    year: int,
    raw_response_id: int,
    run_id: int,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    record = facility.record
    existing = session.scalar(
        select(WasteTreatmentFacility).where(
            WasteTreatmentFacility.source_pid == record.source_pid,
            WasteTreatmentFacility.reference_year == year,
            WasteTreatmentFacility.source_row_index == record.source_row_index,
        )
    )
    data_values: dict[str, Any] = {
        "source_id": RCIS_SOURCE_ID,
        "official_dataset_name": record.official_dataset_name,
        "reference_period": str(year),
        "facility_category": record.facility_category,
        "facility_kind": record.facility_kind,
        "ownership": record.ownership,
        "facility_name": record.facility_name,
        "address": record.address,
        "operator_name": record.operator_name,
        "source_seq": record.source_seq,
        "rcis_sido_name": record.rcis_sido_name,
        "rcis_sigungu_name": record.rcis_sigungu_name,
        "region_id": facility.region_id,
        "source_geographic_level": "SIGUNGU",
        "region_mapping_status": facility.region_mapping_status,
        "capacity_quantity": record.capacity_quantity,
        "capacity_unit": record.capacity_unit,
        "throughput_quantity": record.throughput_quantity,
        "throughput_unit": record.throughput_unit,
        "residue_total": record.residue_total,
        "residue_recycling": record.residue_recycling,
        "residue_incineration": record.residue_incineration,
        "residue_landfill": record.residue_landfill,
        "residue_other": record.residue_other,
        "fill_area_m2": record.fill_area_m2,
        "total_fill_capacity_m3": record.total_fill_capacity_m3,
        "remaining_fill_capacity_m3": record.remaining_fill_capacity_m3,
        "fill_quantity_m3": record.fill_quantity_m3,
        "fill_use_period": record.fill_use_period,
        "permit_date": record.permit_date,
        "return_date": record.return_date,
        "accounting_basis": ACCOUNTING_BASIS,
        "source_fields": sanitize(record.source_fields),
        "transformation_version": TRANSFORMATION_VERSION,
    }
    provenance_values: dict[str, Any] = {
        "retrieved_at": now,
        "raw_response_id": raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            WasteTreatmentFacility(
                source_pid=record.source_pid,
                reference_year=year,
                source_row_index=record.source_row_index,
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


def _get_or_create_raw_response(
    session: Session,
    response: RawRcisResponse,
    run_id: int,
) -> tuple[RawApiResponse, bool]:
    sanitized_payload = {
        "source": RCIS_SOURCE_ID,
        "endpoint_identifier": response.endpoint_identifier,
        "request_metadata": response.request_metadata,
        "record_count": response.record_count,
        "payload": response.payload,
    }
    clean_payload = sanitize(sanitized_payload)
    response_hash = _hash_payload(clean_payload)
    existing = session.scalar(
        select(RawApiResponse).where(
            RawApiResponse.source_id == RCIS_SOURCE_ID,
            RawApiResponse.endpoint_identifier == response.endpoint_identifier,
            RawApiResponse.reference_period == response.reference_period,
            RawApiResponse.response_hash == response_hash,
            RawApiResponse.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return existing, False
    raw = RawApiResponse(
        source_id=RCIS_SOURCE_ID,
        endpoint_identifier=response.endpoint_identifier,
        reference_period=response.reference_period,
        request_timestamp=response.retrieved_at,
        response_hash=response_hash,
        transformation_version=TRANSFORMATION_VERSION,
        sanitized_response=clean_payload,
        ingestion_run_id=run_id,
    )
    session.add(raw)
    session.flush()
    return raw, True


def _update_freshness(session: Session, *, year: int, now: datetime.datetime) -> None:
    freshness = session.get(DatasetFreshness, RCIS_SOURCE_ID)
    if freshness is None:
        session.add(
            DatasetFreshness(
                source_id=RCIS_SOURCE_ID,
                latest_reference_period=str(year),
                last_checked_at=now,
                last_changed_at=now,
                last_success_at=now,
                freshness_status="FRESH",
            )
        )
        return
    freshness.latest_reference_period = str(year)
    freshness.last_checked_at = now
    freshness.last_success_at = now
    freshness.freshness_status = "FRESH"


def _mark_run_failed(session: Session, run_id: int | None, year: int, exc: Exception) -> None:
    if run_id is None:
        return
    run = session.get(IngestionRun, run_id)
    if run is None:
        return
    run.status = "FAILED"
    run.completed_at = _utcnow()
    run.reference_period = str(year)
    run.transformation_version = TRANSFORMATION_VERSION
    run.error_category = exc.__class__.__name__[:50]
    run.error_message = _sanitize_error(str(exc))
    session.commit()


def _build_report(
    mode: str,
    status: str,
    year: int,
    bundle: FacilityFetchBundle,
    mapping: _FacilityMapping,
) -> RcisFacilityReport:
    pid_reports: list[FacilityPidReport] = []
    status_totals = {"EXACT_MATCH": 0, "REQUIRES_GEOCODE": 0, "UNMATCHED": 0, "AMBIGUOUS": 0}
    by_sido: dict[str, int] = {}
    for pid, parsed in bundle.parse_results.items():
        counts = mapping.status_by_pid.get(pid, {})
        for key in status_totals:
            status_totals[key] += counts.get(key, 0)
        for facility in mapping.mapped_by_pid.get(pid, []):
            by_sido[facility.record.rcis_sido_name] = (
                by_sido.get(facility.record.rcis_sido_name, 0) + 1
            )
        pid_reports.append(
            FacilityPidReport(
                pid=pid,
                provider_code=parsed.provider_code,
                official_dataset_name=parsed.official_dataset_name,
                facility_category=PID_SPECS[pid].facility_category,
                source_record_count=parsed.source_record_count,
                excluded_aggregate_rows=parsed.excluded_aggregate_rows,
                parse_rejected=mapping.parse_rejected_by_pid.get(pid, 0),
                in_scope_facilities=mapping.in_scope_by_pid.get(pid, 0),
                exact_match=counts.get("EXACT_MATCH", 0),
                requires_geocode=counts.get("REQUIRES_GEOCODE", 0),
                unmatched=counts.get("UNMATCHED", 0),
                ambiguous=counts.get("AMBIGUOUS", 0),
            )
        )
    return RcisFacilityReport(
        mode=mode,
        status=status,
        reference_year=year,
        schema_era="2020_ONWARD",
        accounting_basis=ACCOUNTING_BASIS,
        rows_received=sum(mapping.in_scope_by_pid.values()),
        pid_reports=pid_reports,
        region_mapping_status_totals=status_totals,
        facilities_by_sido=by_sido,
        unmatched_labels=sorted(mapping.unmatched_labels),
    )


def _differs(current: Any, value: Any) -> bool:
    if isinstance(current, Decimal) and isinstance(value, Decimal):
        return current != value
    if isinstance(current, Decimal) or isinstance(value, Decimal):
        return Decimal(str(current)) != Decimal(str(value))
    return bool(current != value)


__all__ = ["RcisFacilityReport", "run_rcis_facility_ingestion"]
