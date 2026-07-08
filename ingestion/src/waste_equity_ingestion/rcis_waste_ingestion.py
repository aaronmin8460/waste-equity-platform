"""One-shot RCIS regional waste generation/treatment production ingestion.

Phase 2.2. Reuses the Phase 2.0/2.1 production ingestion framework:
``ingestion_runs``, ``raw_api_responses``, ``dataset_freshness``,
``data_sources``, the backend SQLAlchemy models and session, the existing RCIS
client/request builder, response sanitization, and the CLI/Docker one-shot
pattern. It does not create a second ingestion-run framework and does not add a
scheduler.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import re
import time
import urllib.error
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    RawApiResponse,
    Region,
    RegionalWasteStatistics,
    RegionCodeMap,
)

from .config import ProbeSettings
from .errors import (
    IngestionError,
    MissingConfigurationError,
    MissingCredentialsError,
    ProbeError,
    QuotaExceededError,
    RegionMappingError,
)
from .http import JsonResponse, get_json_response
from .probes.waste_statistics import OPERATION_PATH, build_request_params
from .rcis_region_crosswalk import (
    CAPITAL_REGION_SIDO_NAMES,
    EXACT_MATCH,
    OUT_OF_SCOPE,
    RegionCrosswalk,
    SgisRegion,
)
from .rcis_waste_contract import (
    ACCOUNTING_BASIS,
    PID_SPECS,
    RCIS_SOURCE_ID,
    TARGET_PIDS,
    TRANSFORMATION_VERSION,
    PidParseResult,
    WasteRecord,
    parse_pid_response,
    require_supported_year,
)
from .samples import sanitize

DEFAULT_REQUEST_DELAY_SECONDS = 0.7  # documented provider limit: 100 calls/minute
NETWORK_RETRY_LIMIT = 2  # transient network failures only; never provider quota
NETWORK_RETRY_BACKOFF_SECONDS = 1.5


@dataclass(frozen=True)
class RawRcisResponse:
    pid: str
    endpoint_identifier: str
    reference_period: str
    request_metadata: dict[str, Any]
    payload: dict[str, Any]
    retrieved_at: datetime.datetime
    record_count: int


@dataclass(frozen=True)
class MappedRecord:
    record: WasteRecord
    region_id: int
    region_code: str
    valid_from: datetime.date


@dataclass
class PidReport:
    pid: str
    provider_code: str
    official_dataset_name: str
    source_record_count: int
    in_scope_records: int
    exact_matches: int
    rejected: int
    parse_rejected: int
    excluded_pseudo_rows: int
    excluded_detail_rows: int
    reconciliation_mismatches: int


@dataclass
class RcisWasteReport:
    mode: str
    status: str
    reference_year: int
    schema_era: str
    quantity_unit: str
    accounting_basis: str
    rows_received: int
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_rejected: int = 0
    normalized_row_total: int | None = None
    raw_responses_inserted: int = 0
    raw_responses_reused: int = 0
    ingestion_run_id: int | None = None
    pid_reports: list[PidReport] = field(default_factory=list)
    exact_match_regions: list[str] = field(default_factory=list)
    unmatched_rcis_labels: list[str] = field(default_factory=list)
    ambiguous_rcis_labels: list[str] = field(default_factory=list)
    requires_aggregation_labels: list[str] = field(default_factory=list)
    missing_sgis_regions: list[str] = field(default_factory=list)
    reconciliation_mismatch_count: int = 0
    seoul_coverage: dict[str, int] = field(default_factory=dict)
    incheon_coverage: dict[str, int] = field(default_factory=dict)
    gyeonggi_coverage: dict[str, int] = field(default_factory=dict)
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "reference_year": self.reference_year,
            "schema_era": self.schema_era,
            "quantity_unit": self.quantity_unit,
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
                    "pid": report.pid,
                    "provider_code": report.provider_code,
                    "official_dataset_name": report.official_dataset_name,
                    "source_record_count": report.source_record_count,
                    "in_scope_records": report.in_scope_records,
                    "exact_matches": report.exact_matches,
                    "rejected": report.rejected,
                    "parse_rejected_nationwide": report.parse_rejected,
                    "excluded_pseudo_rows": report.excluded_pseudo_rows,
                    "excluded_detail_rows": report.excluded_detail_rows,
                    "reconciliation_mismatches": report.reconciliation_mismatches,
                }
                for report in self.pid_reports
            ],
            "exact_match_region_count": len(self.exact_match_regions),
            "unmatched_rcis_labels": self.unmatched_rcis_labels,
            "ambiguous_rcis_labels": self.ambiguous_rcis_labels,
            "requires_aggregation_labels": self.requires_aggregation_labels,
            "missing_sgis_regions": self.missing_sgis_regions,
            "reconciliation_mismatch_count": self.reconciliation_mismatch_count,
            "seoul_coverage": self.seoul_coverage,
            "incheon_coverage": self.incheon_coverage,
            "gyeonggi_coverage": self.gyeonggi_coverage,
            "message": self.message,
        }


@dataclass(frozen=True)
class RcisFetchBundle:
    raw_responses: list[RawRcisResponse]
    parse_results: dict[str, PidParseResult]


def fetch_pid(
    settings: ProbeSettings,
    endpoint: str,
    pid: str,
    year: int,
) -> tuple[JsonResponse, datetime.datetime]:
    """Live read-only request for one PID with bounded transient-network retries.

    Provider quota and provider error codes are never retried; only transient
    network failures (timeouts, connection resets) get bounded retries.
    """
    params = build_request_params(
        api_key=settings.rcis_api_key,
        user_id=settings.rcis_user_id,
        pid=pid,
        year=str(year),
    )
    last_error: Exception | None = None
    for attempt in range(NETWORK_RETRY_LIMIT + 1):
        try:
            response = get_json_response(endpoint, params)
            return response, _utcnow()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_error = exc
            if attempt < NETWORK_RETRY_LIMIT:
                time.sleep(NETWORK_RETRY_BACKOFF_SECONDS * (attempt + 1))
    raise IngestionError(
        f"RCIS request for PID {pid} failed after {NETWORK_RETRY_LIMIT + 1} attempts: "
        f"{_sanitize_error(str(last_error))}"
    )


def fetch_all_pids(
    settings: ProbeSettings,
    *,
    year: int,
    pids: tuple[str, ...],
    request_delay: float,
) -> RcisFetchBundle:
    _require_rcis_config(settings)
    require_supported_year(year)
    endpoint = settings.rcis_api_base_url.rstrip("/") + OPERATION_PATH
    raw_responses: list[RawRcisResponse] = []
    parse_results: dict[str, PidParseResult] = {}
    for index, pid in enumerate(pids):
        if index > 0 and request_delay > 0:
            time.sleep(request_delay)
        response, retrieved_at = fetch_pid(settings, endpoint, pid, year)
        parsed = parse_pid_response(response.payload, pid=pid, year=year)
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
    return RcisFetchBundle(raw_responses=raw_responses, parse_results=parse_results)


def run_rcis_waste_ingestion(
    settings: ProbeSettings,
    *,
    year: int,
    scope: str,
    write: bool,
    pids: tuple[str, ...] = TARGET_PIDS,
    request_delay: float = DEFAULT_REQUEST_DELAY_SECONDS,
    fail_on_unmatched: bool = False,
) -> RcisWasteReport:
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented in Phase 2.2")
    for pid in pids:
        if pid not in PID_SPECS:
            raise IngestionError(f"Unsupported RCIS waste PID {pid!r}")
    require_supported_year(year)

    session_factory = get_sessionmaker()
    # Region mapping is required in both dry-run and write; load canonical
    # geography read-only.
    read_session = session_factory()
    try:
        crosswalk, sgis_regions = _load_crosswalk(read_session, year)
    finally:
        read_session.close()

    bundle = fetch_all_pids(settings, year=year, pids=pids, request_delay=request_delay)
    mapping = _map_bundle(bundle, crosswalk, sgis_regions, pids)

    if fail_on_unmatched and (mapping.unmatched_labels or mapping.ambiguous_labels):
        raise RegionMappingError(
            "RCIS records remain unmatched or ambiguous and --fail-on-unmatched is set: "
            + ", ".join(sorted(mapping.unmatched_labels | mapping.ambiguous_labels))
        )

    if not write:
        report = _build_report("dry-run", "VALIDATED", year, bundle, mapping)
        report.message = "Live RCIS responses validated and mapped; no database writes performed."
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
            "RCIS waste ingestion failed; normalized writes were rolled back"
        ) from exc
    finally:
        session.close()


@dataclass
class _MappingOutcome:
    mapped_by_pid: dict[str, list[MappedRecord]]
    in_scope_by_pid: dict[str, int]
    exact_regions: dict[str, str]  # region_code -> region_name
    unmatched_labels: set[str]
    ambiguous_labels: set[str]
    requires_aggregation_labels: set[str]
    # In-scope (capital-region) records excluded from normalized writes.
    rejected_by_pid: dict[str, int]
    # Nationwide structural parse rejects (blank/negative/duplicate); diagnostic.
    parse_rejected_by_pid: dict[str, int]
    reconciliation_by_pid: dict[str, int]
    sgis_regions: list[SgisRegion]


def _map_bundle(
    bundle: RcisFetchBundle,
    crosswalk: RegionCrosswalk,
    sgis_regions: list[SgisRegion],
    pids: tuple[str, ...],
) -> _MappingOutcome:
    mapped_by_pid: dict[str, list[MappedRecord]] = {}
    in_scope_by_pid: dict[str, int] = {}
    rejected_by_pid: dict[str, int] = {}
    parse_rejected_by_pid: dict[str, int] = {}
    reconciliation_by_pid: dict[str, int] = {}
    exact_regions: dict[str, str] = {}
    unmatched_labels: set[str] = set()
    ambiguous_labels: set[str] = set()
    requires_aggregation_labels: set[str] = set()

    for pid in pids:
        parsed = bundle.parse_results[pid]
        mapped: list[MappedRecord] = []
        in_scope = 0
        # rows_rejected is scoped to the capital region so it is comparable to
        # rows_received; nationwide structural parse rejects are tracked apart.
        rejected = 0
        parse_rejected_by_pid[pid] = len(parsed.rejected_rows)
        reconciliation_by_pid[pid] = len(parsed.reconciliation_mismatches)
        for record in parsed.records:
            resolution = crosswalk.resolve(record.rcis_sido_name, record.rcis_sigungu_name)
            if resolution.status == OUT_OF_SCOPE:
                continue
            in_scope += 1
            label = f"{record.rcis_sido_name} {record.rcis_sigungu_name}"
            if resolution.status == EXACT_MATCH and resolution.region is not None:
                region = resolution.region
                exact_regions[region.region_code] = region.region_name
                mapped.append(
                    MappedRecord(
                        record=record,
                        region_id=region.region_id,
                        region_code=region.region_code,
                        valid_from=region.valid_from,
                    )
                )
            elif resolution.status == "REQUIRES_AGGREGATION":
                requires_aggregation_labels.add(label)
                rejected += 1
            elif resolution.status == "AMBIGUOUS":
                ambiguous_labels.add(label)
                rejected += 1
            else:  # UNMATCHED
                unmatched_labels.add(label)
                rejected += 1
        mapped_by_pid[pid] = mapped
        in_scope_by_pid[pid] = in_scope
        rejected_by_pid[pid] = rejected

    return _MappingOutcome(
        mapped_by_pid=mapped_by_pid,
        in_scope_by_pid=in_scope_by_pid,
        exact_regions=exact_regions,
        unmatched_labels=unmatched_labels,
        ambiguous_labels=ambiguous_labels,
        requires_aggregation_labels=requires_aggregation_labels,
        rejected_by_pid=rejected_by_pid,
        parse_rejected_by_pid=parse_rejected_by_pid,
        reconciliation_by_pid=reconciliation_by_pid,
        sgis_regions=sgis_regions,
    )


def _write_bundle(
    session: Session,
    year: int,
    bundle: RcisFetchBundle,
    mapping: _MappingOutcome,
    run: IngestionRun,
) -> RcisWasteReport:
    now = _utcnow()
    valid_to = datetime.date(year, 12, 31)

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
        for mapped in mapping.mapped_by_pid.get(pid, []):
            created, changed = _upsert_waste_row(
                session,
                mapped=mapped,
                year=year,
                raw_response_id=raw_id,
                run_id=run.run_id,
                now=now,
            )
            inserted += int(created)
            updated += int(changed and not created)
            _upsert_region_code_map(
                session,
                region_code=mapped.region_code,
                valid_from=mapped.valid_from,
                valid_to=valid_to,
                rcis_sido_name=mapped.record.rcis_sido_name,
                rcis_sigungu_name=mapped.record.rcis_sigungu_name,
                reference_period=str(year),
            )

    _update_freshness(session, year=year, now=now)

    rows_received = sum(mapping.in_scope_by_pid.values())
    rows_rejected = sum(mapping.rejected_by_pid.values())
    run.status = "SUCCEEDED"
    run.completed_at = now
    run.rows_received = rows_received
    run.rows_inserted = inserted
    run.rows_updated = updated
    run.rows_rejected = rows_rejected
    run.reference_period = str(year)
    run.transformation_version = TRANSFORMATION_VERSION

    session.flush()
    normalized_count = len(
        session.scalars(
            select(RegionalWasteStatistics.id).where(RegionalWasteStatistics.reference_year == year)
        ).all()
    )

    report = _build_report("write", "SUCCEEDED", year, bundle, mapping)
    report.rows_inserted = inserted
    report.rows_updated = updated
    report.raw_responses_inserted = raw_inserted
    report.raw_responses_reused = raw_reused
    report.ingestion_run_id = run.run_id
    report.normalized_row_total = normalized_count
    report.message = "RCIS capital-region waste generation/treatment ingestion succeeded."
    return report


def _upsert_waste_row(
    session: Session,
    *,
    mapped: MappedRecord,
    year: int,
    raw_response_id: int,
    run_id: int,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    record = mapped.record
    existing = session.scalar(
        select(RegionalWasteStatistics).where(
            RegionalWasteStatistics.region_id == mapped.region_id,
            RegionalWasteStatistics.reference_year == year,
            RegionalWasteStatistics.source_pid == record.source_pid,
            RegionalWasteStatistics.waste_category_name == record.waste_category_name,
        )
    )
    # Material data fields decide whether a row genuinely changed. A re-run with
    # identical official values must not count as an update just because the
    # retrieval timestamp or run id differs; those provenance fields are only
    # refreshed when the data itself changes.
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
        "source_geographic_level": "SIGUNGU",
        "transformation_version": TRANSFORMATION_VERSION,
    }
    provenance_values: dict[str, Any] = {
        "retrieved_at": now,
        "raw_response_id": raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            RegionalWasteStatistics(
                region_id=mapped.region_id,
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


def _upsert_region_code_map(
    session: Session,
    *,
    region_code: str,
    valid_from: datetime.date,
    valid_to: datetime.date,
    rcis_sido_name: str,
    rcis_sigungu_name: str,
    reference_period: str,
) -> None:
    """Attach the RCIS name pair to the shared crosswalk row for this region.

    The crosswalk row is one-per-canonical-region and already carries SGIS
    provenance (Phase 2.1). This only fills the RCIS name-pair columns and marks
    the cross-source review status; SGIS provenance is preserved.
    """
    existing = session.scalar(
        select(RegionCodeMap).where(
            RegionCodeMap.canonical_region_code == region_code,
            RegionCodeMap.valid_from == valid_from,
        )
    )
    if existing is None:
        session.add(
            RegionCodeMap(
                canonical_region_code=region_code,
                valid_from=valid_from,
                valid_to=valid_to,
                rcis_sido_name=rcis_sido_name,
                rcis_sigungu_name=rcis_sigungu_name,
                mapping_status="NEEDS_REVIEW",
                cross_source_review_status="RCIS_NAME_MATCHED",
                mapping_source="RCIS_WASTE_NAME_CROSSWALK",
                source_reference_period=reference_period,
            )
        )
        return
    if (
        existing.rcis_sido_name != rcis_sido_name
        or existing.rcis_sigungu_name != rcis_sigungu_name
        or existing.cross_source_review_status != "RCIS_NAME_MATCHED"
    ):
        existing.rcis_sido_name = rcis_sido_name
        existing.rcis_sigungu_name = rcis_sigungu_name
        existing.cross_source_review_status = "RCIS_NAME_MATCHED"


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
    if freshness.latest_reference_period != str(year) or freshness.freshness_status != "FRESH":
        freshness.last_changed_at = now
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


def _load_crosswalk(session: Session, year: int) -> tuple[RegionCrosswalk, list[SgisRegion]]:
    year_start = datetime.date(year, 1, 1)
    rows = session.scalars(
        select(Region).where(
            Region.valid_from <= year_start,
            (Region.valid_to.is_(None)) | (Region.valid_to >= year_start),
        )
    ).all()
    regions = [
        SgisRegion(
            region_id=row.id,
            region_code=row.region_code,
            region_name=row.region_name,
            region_level=row.region_level or "",
            valid_from=row.valid_from,
            parent_region_code=row.parent_region_code,
        )
        for row in rows
    ]
    sigungu = [region for region in regions if region.region_level == "SIGUNGU"]
    if not sigungu:
        raise RegionMappingError(
            f"No SGIS canonical SIGUNGU regions are loaded for reference year {year}; "
            "run SGIS ingestion (Phase 2.1) before RCIS waste ingestion"
        )
    return RegionCrosswalk(regions), regions


def _build_report(
    mode: str,
    status: str,
    year: int,
    bundle: RcisFetchBundle,
    mapping: _MappingOutcome,
) -> RcisWasteReport:
    pid_reports: list[PidReport] = []
    total_reconciliation = 0
    for pid, parsed in bundle.parse_results.items():
        total_reconciliation += len(parsed.reconciliation_mismatches)
        pid_reports.append(
            PidReport(
                pid=pid,
                provider_code=parsed.provider_code,
                official_dataset_name=parsed.official_dataset_name,
                source_record_count=parsed.source_record_count,
                in_scope_records=mapping.in_scope_by_pid.get(pid, 0),
                exact_matches=len(mapping.mapped_by_pid.get(pid, [])),
                rejected=mapping.rejected_by_pid.get(pid, 0),
                parse_rejected=mapping.parse_rejected_by_pid.get(pid, 0),
                excluded_pseudo_rows=parsed.excluded_pseudo_rows,
                excluded_detail_rows=parsed.excluded_detail_rows,
                reconciliation_mismatches=len(parsed.reconciliation_mismatches),
            )
        )

    exact_codes = set(mapping.exact_regions)
    missing = sorted(
        f"{region.region_code} ({region.region_name})"
        for region in mapping.sgis_regions
        if region.region_level == "SIGUNGU" and region.region_code not in exact_codes
    )

    quantity_unit = next(
        (parsed.quantity_unit for parsed in bundle.parse_results.values() if parsed.records),
        "톤/년",
    )

    report = RcisWasteReport(
        mode=mode,
        status=status,
        reference_year=year,
        schema_era="2020_ONWARD",
        quantity_unit=quantity_unit,
        accounting_basis=ACCOUNTING_BASIS,
        rows_received=sum(mapping.in_scope_by_pid.values()),
        rows_rejected=sum(mapping.rejected_by_pid.values()),
        pid_reports=pid_reports,
        exact_match_regions=sorted(
            f"{code} ({name})" for code, name in mapping.exact_regions.items()
        ),
        unmatched_rcis_labels=sorted(mapping.unmatched_labels),
        ambiguous_rcis_labels=sorted(mapping.ambiguous_labels),
        requires_aggregation_labels=sorted(mapping.requires_aggregation_labels),
        missing_sgis_regions=missing,
        reconciliation_mismatch_count=total_reconciliation,
    )
    report.seoul_coverage = _coverage(mapping, "서울특별시")
    report.incheon_coverage = _coverage(mapping, "인천광역시")
    report.gyeonggi_coverage = _coverage(mapping, "경기도")
    return report


def _coverage(mapping: _MappingOutcome, sido_name: str) -> dict[str, int]:
    sgis_total = sum(
        1
        for region in mapping.sgis_regions
        if region.region_level == "SIGUNGU" and region.region_name.startswith(sido_name)
    )
    exact_codes = set(mapping.exact_regions)
    matched = sum(
        1
        for region in mapping.sgis_regions
        if region.region_level == "SIGUNGU"
        and region.region_name.startswith(sido_name)
        and region.region_code in exact_codes
    )
    return {"sgis_regions": sgis_total, "exact_matched": matched, "missing": sgis_total - matched}


def _require_rcis_config(settings: ProbeSettings) -> None:
    if not settings.rcis_api_key:
        raise MissingCredentialsError(["RCIS_API_KEY"])
    if not settings.rcis_user_id:
        raise MissingConfigurationError(["RCIS_USER_ID"])


def _differs(current: Any, value: Any) -> bool:
    if isinstance(current, Decimal) and isinstance(value, Decimal):
        return current != value
    if isinstance(current, Decimal) or isinstance(value, Decimal):
        return Decimal(str(current)) != Decimal(str(value))
    return bool(current != value)


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _sanitize_error(message: str) -> str:
    # Redact the credential values, not just their parameter names.
    redacted = re.sub(r"(?i)(KEY=)[^&\s]+", r"\1[REDACTED]", message)
    redacted = re.sub(r"(?i)(USRID=)[^&\s]+", r"\1[REDACTED]", redacted)
    redacted = redacted.replace("accessToken", "[REDACTED]")
    return redacted[:1000]


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


__all__ = [
    "CAPITAL_REGION_SIDO_NAMES",
    "QuotaExceededError",
    "RcisWasteReport",
    "run_rcis_waste_ingestion",
]
