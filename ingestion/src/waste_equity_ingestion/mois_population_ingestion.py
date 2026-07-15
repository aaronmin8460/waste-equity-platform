"""Ingest official MOIS monthly resident-registration population (2008 →).

Fetches (or reads via ``--source-file``) the official
**행정동별 주민등록 인구 및 세대현황** CSV from https://jumin.mois.go.kr, validates
it against the source contract, and idempotently upserts one
``regional_population`` row per (시도 × month) with full provenance.

Scope is the capital region only: 서울특별시 / 인천광역시 / 경기도. Nothing before
2008-01 is fetched or written. Existing annual SGIS rows are never read, updated,
relabelled, or deleted — the monthly series lives beside them, distinguished by
``population_temporal_granularity``.

Fails closed: a month missing any of the three 시도, a duplicate, an unexpected
code or name, or a non-positive value rejects the **whole month** rather than
writing part of it. No value is ever estimated, interpolated, or carried across
months.
"""

from __future__ import annotations

import datetime
import hashlib
import json
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from sqlalchemy import select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    DataSource,
    IngestionRun,
    RawApiResponse,
    Region,
    RegionalPopulation,
)

from . import mois_population_contract as contract
from .config import ProbeSettings
from .errors import IngestionError

SCOPE_CAPITAL_REGION = "capital-region"
_TIMEOUT_SECONDS = 180
_USER_AGENT = "waste-equity-platform/1.0 (public-data research; contact via repository)"


@dataclass
class MoisPopulationReport:
    """Dry-run / write report. Serialized to JSON for the operator."""

    mode: str
    status: str
    scope: str = SCOPE_CAPITAL_REGION
    official_dataset_name: str = contract.OFFICIAL_DATASET_NAME
    source_id: str = contract.SOURCE_ID
    acquisition_method: str = ""
    documentation_url: str = contract.DOCUMENTATION_URL
    population_definition: str = contract.POPULATION_DEFINITION
    temporal_granularity: str = contract.POPULATION_TEMPORAL_GRANULARITY
    requested_start_month: str | None = None
    requested_end_month: str | None = None
    discovered_latest_month: str | None = None
    expected_month_count: int = 0
    found_month_count: int = 0
    missing_months: list[str] = field(default_factory=list)
    incomplete_months: dict[str, list[str]] = field(default_factory=dict)
    duplicate_records: list[str] = field(default_factory=list)
    rejected_records: list[str] = field(default_factory=list)
    regions: list[dict[str, str]] = field(default_factory=list)
    definition_eras: dict[str, int] = field(default_factory=dict)
    source_sha256: str | None = None
    source_bytes: int | None = None
    observations: int = 0
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_unchanged: int = 0
    ingestion_run_id: int | None = None
    error: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        """JSON-safe summary. Contains no credentials (this source needs none)."""
        return {
            "mode": self.mode,
            "status": self.status,
            "scope": self.scope,
            "official_dataset_name": self.official_dataset_name,
            "source_id": self.source_id,
            "acquisition_method": self.acquisition_method,
            "documentation_url": self.documentation_url,
            "population_definition": self.population_definition,
            "temporal_granularity": self.temporal_granularity,
            "requested_start_month": self.requested_start_month,
            "requested_end_month": self.requested_end_month,
            "discovered_latest_month": self.discovered_latest_month,
            "expected_month_count": self.expected_month_count,
            "found_month_count": self.found_month_count,
            "missing_months": self.missing_months,
            "incomplete_months": self.incomplete_months,
            "duplicate_records": self.duplicate_records,
            "rejected_records": self.rejected_records[:20],
            "rejected_record_count": len(self.rejected_records),
            "regions": self.regions,
            "definition_eras": self.definition_eras,
            "source_sha256": self.source_sha256,
            "source_bytes": self.source_bytes,
            "observations": self.observations,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_unchanged": self.rows_unchanged,
            "ingestion_run_id": self.ingestion_run_id,
            "error": self.error,
        }


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(tz=datetime.UTC)


def _http_get(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:  # noqa: S310
            return bytes(response.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        raise IngestionError(f"Official MOIS page request failed: {exc}") from exc


def fetch_latest_month() -> str | None:
    """Ask the official page which month it has most recently published."""
    html = _http_get(contract.DOCUMENTATION_URL).decode("utf-8", errors="replace")
    return contract.latest_month_from_page(html)


def download_csv(start_month: str, end_month: str) -> bytes:
    """POST the official CSV download form for a ``YYYY-MM`` range."""
    fields = contract.download_form_fields(start_month, end_month)
    url = f"{contract.DOWNLOAD_URL}?{urlencode(contract.DOWNLOAD_QUERY)}"
    request = urllib.request.Request(
        url,
        data=urlencode(fields).encode("utf-8"),
        headers={
            "User-Agent": _USER_AGENT,
            "Referer": contract.DOCUMENTATION_URL,
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:  # noqa: S310
            return bytes(response.read())
    except (urllib.error.URLError, TimeoutError) as exc:
        raise IngestionError(f"Official MOIS CSV download failed: {exc}") from exc


def _request_metadata(start_month: str, end_month: str, method: str) -> dict[str, Any]:
    """Sanitized request metadata. This official source requires no credentials."""
    return {
        "acquisition_method": method,
        "url": contract.DOWNLOAD_URL,
        "query": contract.DOWNLOAD_QUERY,
        "form_fields": contract.download_form_fields(start_month, end_month),
        "encoding": contract.SOURCE_ENCODING,
        "official_dataset_name": contract.OFFICIAL_DATASET_NAME,
        "documentation_url": contract.DOCUMENTATION_URL,
    }


def _hash_payload(payload: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    ).hexdigest()


def _ensure_data_source(session: Session, now: datetime.datetime) -> None:
    """Register the official source (documented endpoint only, no credentials)."""
    existing = session.get(DataSource, contract.SOURCE_ID)
    if existing is not None:
        return
    session.add(
        DataSource(
            source_id=contract.SOURCE_ID,
            source_name=contract.SOURCE_NAME,
            dataset_name=contract.OFFICIAL_DATASET_NAME,
            endpoint=contract.DOWNLOAD_URL,
            publication_frequency=contract.PUBLICATION_FREQUENCY,
            enabled=True,
            documentation_url=contract.DOCUMENTATION_URL,
        )
    )
    session.flush()


def _get_or_create_raw_response(
    session: Session,
    *,
    payload: bytes,
    request_metadata: dict[str, Any],
    reference_period: str,
    run_id: int,
    now: datetime.datetime,
) -> int:
    """Persist the sanitized raw response envelope; reuse an identical one."""
    endpoint_identifier = f"{contract.SOURCE_ID}/downloadCsv/{reference_period}"
    sanitized_payload: dict[str, Any] = {
        "source": contract.SOURCE_ID,
        "endpoint_identifier": endpoint_identifier,
        "request_metadata": request_metadata,
        # The official CSV itself is retained out of the database (Git-ignored
        # raw directory); the envelope records its exact digest so any stored row
        # can be traced back to the byte-for-byte official file.
        "payload": {
            "source_sha256": contract.sha256_of(payload),
            "source_bytes": len(payload),
            "encoding": contract.SOURCE_ENCODING,
        },
    }
    response_hash = _hash_payload(sanitized_payload)
    existing = session.scalar(
        select(RawApiResponse).where(
            RawApiResponse.source_id == contract.SOURCE_ID,
            RawApiResponse.endpoint_identifier == endpoint_identifier,
            RawApiResponse.reference_period == reference_period,
            RawApiResponse.response_hash == response_hash,
            RawApiResponse.transformation_version == contract.TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return int(existing.id)
    raw = RawApiResponse(
        source_id=contract.SOURCE_ID,
        endpoint_identifier=endpoint_identifier,
        reference_period=reference_period,
        request_timestamp=now,
        response_hash=response_hash,
        transformation_version=contract.TRANSFORMATION_VERSION,
        sanitized_response=sanitized_payload,
        ingestion_run_id=run_id,
    )
    session.add(raw)
    session.flush()
    return int(raw.id)


def _resolve_region_ids(session: Session) -> dict[str, int]:
    """Canonical SIDO region id per MOIS code, validated by official name.

    The crosswalk is never trusted on code resemblance alone: the canonical
    region's own ``region_name`` must equal the official MOIS name.
    """
    wanted = {r.canonical_region_code: r for r in contract.CAPITAL_REGION}
    rows = session.execute(
        select(Region.id, Region.region_code, Region.region_name, Region.region_level).where(
            Region.region_code.in_(wanted.keys()),
            Region.region_level == contract.SOURCE_GEOGRAPHIC_LEVEL,
        )
    ).all()
    resolved: dict[str, int] = {}
    for row in rows:
        region = wanted[row.region_code]
        if row.region_name != region.official_name:
            raise IngestionError(
                f"Canonical region {row.region_code} is named {row.region_name!r} but the "
                f"official MOIS name is {region.official_name!r}; refusing to attach "
                "population to a region that may not be the same place."
            )
        if region.mois_code in resolved:
            raise IngestionError(
                f"More than one canonical SIDO region matches {row.region_code}; ambiguous."
            )
        resolved[region.mois_code] = int(row.id)
    missing = [r.official_name for r in contract.CAPITAL_REGION if r.mois_code not in resolved]
    if missing:
        raise IngestionError(
            f"No canonical SIDO region row for: {', '.join(missing)}. "
            "Run the SGIS boundary ingestion first; MOIS population is not written "
            "without a canonical region to attach it to."
        )
    return resolved


def _upsert_observation(
    session: Session,
    observation: contract.MoisObservation,
    *,
    region_id: int,
    raw_response_id: int,
    run_id: int,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    """Idempotent upsert of one monthly observation. Returns (created, changed)."""
    existing = session.scalar(
        select(RegionalPopulation).where(
            RegionalPopulation.region_id == region_id,
            RegionalPopulation.reference_month == observation.reference_month,
            RegionalPopulation.source_id == contract.SOURCE_ID,
            RegionalPopulation.population_definition == contract.POPULATION_DEFINITION,
        )
    )
    values: dict[str, Any] = {
        "reference_year": int(observation.reference_month[:4]),
        "reference_period": observation.reference_month,
        "population": observation.population,
        "unit": contract.POPULATION_UNIT,
        "population_temporal_granularity": contract.POPULATION_TEMPORAL_GRANULARITY,
        "population_definition_version": observation.population_definition_version,
        "population_comparability_note": observation.population_comparability_note,
        "source_administrative_code": observation.mois_code,
        "source_geographic_level": contract.SOURCE_GEOGRAPHIC_LEVEL,
        "retrieved_at": now,
        "transformation_version": contract.TRANSFORMATION_VERSION,
        "raw_response_id": raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            RegionalPopulation(
                region_id=region_id,
                reference_month=observation.reference_month,
                source_id=contract.SOURCE_ID,
                population_definition=contract.POPULATION_DEFINITION,
                created_at=now,
                updated_at=now,
                **values,
            )
        )
        return True, True
    changed = False
    for attr, value in values.items():
        # Provenance-only fields are refreshed solely when material data changed,
        # so a no-op re-run stays a true no-op.
        if attr in {"retrieved_at", "raw_response_id", "ingestion_run_id"}:
            continue
        if getattr(existing, attr) != value:
            setattr(existing, attr, value)
            changed = True
    if changed:
        existing.retrieved_at = now
        existing.raw_response_id = raw_response_id
        existing.ingestion_run_id = run_id
        existing.updated_at = now
    return False, changed


def _update_freshness(session: Session, latest_period: str | None, now: datetime.datetime) -> None:
    freshness = session.get(DatasetFreshness, contract.SOURCE_ID)
    if freshness is None:
        session.add(
            DatasetFreshness(
                source_id=contract.SOURCE_ID,
                latest_reference_period=latest_period,
                last_checked_at=now,
                last_success_at=now,
                freshness_status="FRESH",
            )
        )
        return
    freshness.latest_reference_period = latest_period
    freshness.last_checked_at = now
    freshness.last_success_at = now
    freshness.freshness_status = "FRESH"


def _acquire(
    *, start_month: str, end_month: str, source_file: str | None, report: MoisPopulationReport
) -> bytes:
    if source_file is not None:
        path = Path(source_file)
        if not path.is_file():
            raise IngestionError(f"--source-file not found: {source_file}")
        report.acquisition_method = f"OFFICIAL_FILE:{path.name}"
        return path.read_bytes()
    report.acquisition_method = "OFFICIAL_CSV_DOWNLOAD_ENDPOINT"
    return download_csv(start_month, end_month)


def run_mois_population_ingestion(
    settings: ProbeSettings,
    *,
    scope: str,
    start_month: str,
    end_month: str | None,
    write: bool,
    source_file: str | None = None,
) -> MoisPopulationReport:
    """Validate and (if ``write``) upsert the official MOIS monthly population."""
    del settings  # This official source needs no credentials.
    if scope != SCOPE_CAPITAL_REGION:
        raise IngestionError(
            f"Only --scope {SCOPE_CAPITAL_REGION} is supported for mois-population-ingest"
        )
    contract.validate_month(start_month)
    if start_month < contract.EARLIEST_SUPPORTED_MONTH:
        raise IngestionError(
            f"start_month {start_month} precedes {contract.EARLIEST_SUPPORTED_MONTH}; "
            "this project is not authorized to ingest population before 2008-01."
        )

    report = MoisPopulationReport(mode="write" if write else "dry-run", status="RUNNING")
    report.requested_start_month = start_month

    # Discover the latest officially published month unless one was pinned. With
    # --source-file the file itself is authoritative for coverage.
    if end_month is None:
        if source_file is None:
            discovered = fetch_latest_month()
            if discovered is None:
                raise IngestionError(
                    "Could not determine the latest officially published MOIS month from "
                    f"{contract.DOCUMENTATION_URL}; refusing to guess a range."
                )
            report.discovered_latest_month = discovered
            end_month = discovered
        else:
            end_month = start_month
    contract.validate_month(end_month)
    report.requested_end_month = end_month
    report.regions = [
        {
            "mois_code": r.mois_code,
            "official_name": r.official_name,
            "canonical_region_code": r.canonical_region_code,
            "landfill_origin_code": r.landfill_origin_code,
        }
        for r in contract.CAPITAL_REGION
    ]

    payload = _acquire(
        start_month=start_month, end_month=end_month, source_file=source_file, report=report
    )
    report.source_sha256 = contract.sha256_of(payload)
    report.source_bytes = len(payload)

    parsed = contract.parse_csv(payload)
    report.rejected_records = list(parsed.rejected)
    report.duplicate_records = [r for r in parsed.rejected if r.startswith("DUPLICATE_")]
    report.observations = len(parsed.observations)

    complete = contract.complete_months(parsed)
    report.incomplete_months = contract.incomplete_months(parsed)
    report.found_month_count = len(complete)

    expected = contract.month_range(start_month, end_month)
    report.expected_month_count = len(expected)
    report.missing_months = sorted(set(expected) - set(complete))

    eras: dict[str, int] = {}
    for observation in parsed.observations:
        eras[observation.population_definition_version] = (
            eras.get(observation.population_definition_version, 0) + 1
        )
    report.definition_eras = eras

    # Fail closed before any write.
    if report.missing_months:
        report.status = "FAILED"
        report.error = (
            f"{len(report.missing_months)} requested month(s) are not fully available with all "
            f"three 시도: {report.missing_months[:12]}"
        )
        return report
    if report.incomplete_months:
        report.status = "FAILED"
        report.error = f"Months missing a required 시도: {report.incomplete_months}"
        return report
    if report.duplicate_records:
        report.status = "FAILED"
        report.error = f"Duplicate/ambiguous records: {report.duplicate_records[:8]}"
        return report

    keep = set(expected)
    observations = [o for o in parsed.observations if o.reference_month in keep]

    if not write:
        report.status = "DRY_RUN_OK"
        return report

    session = get_sessionmaker()()
    now = _utcnow()
    run: IngestionRun | None = None
    try:
        _ensure_data_source(session, now)
        run = IngestionRun(
            source_id=contract.SOURCE_ID,
            started_at=now,
            status="RUNNING",
            rows_received=len(observations),
            rows_inserted=0,
            rows_updated=0,
            rows_rejected=len(parsed.rejected),
            reference_period=end_month,
            transformation_version=contract.TRANSFORMATION_VERSION,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        report.ingestion_run_id = run.run_id

        raw_id = _get_or_create_raw_response(
            session,
            payload=payload,
            request_metadata=_request_metadata(start_month, end_month, report.acquisition_method),
            reference_period=f"{start_month}..{end_month}",
            run_id=run.run_id,
            now=now,
        )
        region_ids = _resolve_region_ids(session)

        inserted = updated = unchanged = 0
        for observation in observations:
            created, changed = _upsert_observation(
                session,
                observation,
                region_id=region_ids[observation.mois_code],
                raw_response_id=raw_id,
                run_id=run.run_id,
                now=now,
            )
            if created:
                inserted += 1
            elif changed:
                updated += 1
            else:
                unchanged += 1

        report.rows_inserted = inserted
        report.rows_updated = updated
        report.rows_unchanged = unchanged
        _update_freshness(session, end_month, now)

        run.status = "SUCCESS"
        run.completed_at = _utcnow()
        run.rows_inserted = inserted
        run.rows_updated = updated
        session.commit()
        report.status = "SUCCESS"
        return report
    except Exception as exc:  # noqa: BLE001 - recorded, sanitized, re-raised
        session.rollback()
        if run is not None and run.run_id is not None:
            failed = session.get(IngestionRun, run.run_id)
            if failed is not None:
                failed.status = "FAILED"
                failed.completed_at = _utcnow()
                failed.error_message = str(exc)[:500]
                session.commit()
        report.status = "FAILED"
        report.error = str(exc)[:500]
        raise
    finally:
        session.close()


__all__ = [
    "SCOPE_CAPITAL_REGION",
    "MoisPopulationReport",
    "download_csv",
    "fetch_latest_month",
    "run_mois_population_ingestion",
]
