"""Capital-region Sudokwon Landfill inbound-flow ingestion (odcloud).

Idempotent production ingestion for the two official Sudokwon Landfill
Corporation datasets that share an exact 1:1 monthly grain — inbound quantity
(``15064381``) and inbound fee (``15064394``). The job:

1. discovers the latest published snapshot UUID for each dataset from the public
   odcloud OpenAPI document (never permanently hardcoding a snapshot);
2. fetches every page securely (``serviceKey`` query param, never printed/stored);
3. preserves the sanitized raw responses in ``raw_api_responses``;
4. normalizes metropolitan origins (서울시/인천시/경기도 → KR-SGIS-11/28/41),
   validates required fields, rejects unsupported origins / duplicates / nulls /
   negatives;
5. joins quantity and fee rows 1:1 (a non-1:1 join is a visible failure); and
6. upserts the canonical dataset into ``landfill_inbound_monthly`` idempotently.

Scope is strictly capital-region metropolitan → Sudokwon Landfill. No
nationwide coverage, no sub-metropolitan disaggregation, no KONEPS, no
current-rate scenario.
"""

from __future__ import annotations

import datetime
import json
import time
import urllib.error
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    LandfillInboundMonthly,
    RawApiResponse,
)

from .config import ProbeSettings
from .errors import IngestionError, MissingCredentialsError, SchemaValidationError
from .http import get_text_response
from .odcloud_contract import (
    ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
    DESTINATION_CODE,
    EVIDENCE_OFFICIAL_REPORTED,
    FEE_CURRENCY_KRW,
    FEE_DATASET_ID,
    INBOUND_DATASET_ID,
    ODCLOUD_API_BASE_URL,
    ODCLOUD_OAS_URL,
    ORIGIN_LEVEL_METROPOLITAN,
    QUANTITY_UNIT_KG,
    TRANSFORMATION_VERSION,
    LandfillInboundJoined,
    SnapshotRef,
    extract_rows,
    join_inbound_and_fees,
    parse_fee_rows,
    parse_inbound_rows,
    select_latest_snapshot,
)
from .rcis_waste_ingestion import _differs, _hash_payload, _utcnow
from .samples import sanitize

PER_PAGE = 1000
MAX_PAGES = 100  # 9,212 rows / 1,000 → far below this; a runaway-loop backstop.
NETWORK_RETRY_LIMIT = 2
NETWORK_RETRY_BACKOFF_SECONDS = 1.5
_HTTP_TIMEOUT_SECONDS = 30.0


@dataclass
class LandfillInboundReport:
    mode: str
    status: str
    transformation_version: str = TRANSFORMATION_VERSION
    inbound_dataset_id: str = INBOUND_DATASET_ID
    fee_dataset_id: str = FEE_DATASET_ID
    inbound_snapshot_uuid: str | None = None
    inbound_snapshot_date: str | None = None
    fee_snapshot_uuid: str | None = None
    fee_snapshot_date: str | None = None
    inbound_rows_received: int = 0
    fee_rows_received: int = 0
    joined_rows: int = 0
    inbound_only: int = 0
    fee_only: int = 0
    supported_origins: list[str] = field(default_factory=list)
    rows_by_origin: dict[str, int] = field(default_factory=dict)
    rows_by_year: dict[str, int] = field(default_factory=dict)
    reference_month_min: str | None = None
    reference_month_max: str | None = None
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_unchanged: int = 0
    rows_rejected: int = 0
    ingestion_run_id: int | None = None
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "transformation_version": self.transformation_version,
            "inbound_dataset_id": self.inbound_dataset_id,
            "fee_dataset_id": self.fee_dataset_id,
            "inbound_snapshot_uuid": self.inbound_snapshot_uuid,
            "inbound_snapshot_date": self.inbound_snapshot_date,
            "fee_snapshot_uuid": self.fee_snapshot_uuid,
            "fee_snapshot_date": self.fee_snapshot_date,
            "inbound_rows_received": self.inbound_rows_received,
            "fee_rows_received": self.fee_rows_received,
            "joined_rows": self.joined_rows,
            "inbound_only": self.inbound_only,
            "fee_only": self.fee_only,
            "supported_origins": self.supported_origins,
            "rows_by_origin": self.rows_by_origin,
            "rows_by_year": self.rows_by_year,
            "reference_month_min": self.reference_month_min,
            "reference_month_max": self.reference_month_max,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_unchanged": self.rows_unchanged,
            "rows_rejected": self.rows_rejected,
            "ingestion_run_id": self.ingestion_run_id,
            "message": self.message,
        }


def _fetch_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    """GET a JSON body tolerant of odcloud's occasional non-JSON content types."""
    last_error: Exception | None = None
    for attempt in range(NETWORK_RETRY_LIMIT + 1):
        try:
            response = get_text_response(url, params, timeout=_HTTP_TIMEOUT_SECONDS)
            payload = json.loads(response.text)
            if not isinstance(payload, dict):
                raise SchemaValidationError("odcloud response is not a JSON object")
            return payload
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            last_error = exc
            if attempt < NETWORK_RETRY_LIMIT:
                time.sleep(NETWORK_RETRY_BACKOFF_SECONDS * (attempt + 1))
                continue
            raise IngestionError(f"odcloud request failed after retries: {exc}") from exc
    raise IngestionError(f"odcloud request failed: {last_error}")


def discover_snapshot(dataset_id: str) -> SnapshotRef:
    """Discover the latest published snapshot for a dataset from the public OAS."""
    oas = _fetch_json(ODCLOUD_OAS_URL, {"namespace": f"{dataset_id}/v1"})
    return select_latest_snapshot(oas, dataset_id)


def _require_service_key(settings: ProbeSettings) -> str:
    key = settings.odcloud_key()
    if not key:
        raise MissingCredentialsError(["DATA_GO_KR_SERVICE_KEY"])
    return key


def fetch_all_rows(
    settings: ProbeSettings, snapshot: SnapshotRef
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Fetch every page for a snapshot; fail safely on a partial/short read."""
    service_key = _require_service_key(settings)
    url = f"{ODCLOUD_API_BASE_URL}/{snapshot.dataset_id}/v1/{snapshot.path_segment}"
    rows: list[dict[str, Any]] = []
    total_count: int | None = None
    page = 1
    while page <= MAX_PAGES:
        payload = _fetch_json(
            url,
            {
                "page": str(page),
                "perPage": str(PER_PAGE),
                "returnType": "JSON",
                "serviceKey": service_key,
            },
        )
        page_rows, page_total = extract_rows(payload)
        if page_total is not None:
            total_count = page_total
        rows.extend(page_rows)
        if not page_rows:
            break
        if total_count is not None and len(rows) >= total_count:
            break
        page += 1
    if total_count is None:
        raise SchemaValidationError(
            f"odcloud {snapshot.dataset_id} response omitted totalCount; cannot verify completeness"
        )
    if len(rows) != total_count:
        raise IngestionError(
            f"odcloud {snapshot.dataset_id} fetched {len(rows)} rows but totalCount is "
            f"{total_count}; refusing a partial snapshot"
        )
    request_metadata = {
        "dataset_id": snapshot.dataset_id,
        "snapshot_uuid": snapshot.snapshot_uuid,
        "snapshot_publication_date": snapshot.publication_date,
        "endpoint": f"{snapshot.dataset_id}/v1/{snapshot.path_segment}",
        "per_page": PER_PAGE,
        "pages_fetched": page,
        "total_count": total_count,
    }
    return rows, request_metadata


def _snapshot_date(snapshot: SnapshotRef) -> datetime.date | None:
    if snapshot.publication_date is None:
        return None
    try:
        return datetime.date.fromisoformat(snapshot.publication_date)
    except ValueError:
        return None


def _get_or_create_raw_response(
    session: Any,
    *,
    dataset_id: str,
    snapshot: SnapshotRef,
    rows: list[dict[str, Any]],
    request_metadata: dict[str, Any],
    run_id: int,
    now: datetime.datetime,
) -> int:
    """Store (or reuse) the sanitized raw response; return its id."""
    endpoint_identifier = f"{dataset_id}/v1/{snapshot.path_segment}"
    reference_period = snapshot.publication_date
    sanitized_payload = sanitize(
        {
            "source": dataset_id,
            "endpoint_identifier": endpoint_identifier,
            "request_metadata": request_metadata,
            "record_count": len(rows),
            "payload": {"data": rows},
        }
    )
    response_hash = _hash_payload(sanitized_payload)
    existing = session.scalar(
        select(RawApiResponse).where(
            RawApiResponse.source_id == dataset_id,
            RawApiResponse.endpoint_identifier == endpoint_identifier,
            RawApiResponse.reference_period == reference_period,
            RawApiResponse.response_hash == response_hash,
            RawApiResponse.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return int(existing.id)
    raw = RawApiResponse(
        source_id=dataset_id,
        endpoint_identifier=endpoint_identifier,
        reference_period=reference_period,
        request_timestamp=now,
        response_hash=response_hash,
        transformation_version=TRANSFORMATION_VERSION,
        sanitized_response=sanitized_payload,
        ingestion_run_id=run_id,
    )
    session.add(raw)
    session.flush()
    return int(raw.id)


def _upsert_landfill_row(
    session: Any,
    *,
    joined: LandfillInboundJoined,
    inbound_snapshot: SnapshotRef,
    fee_snapshot: SnapshotRef,
    quantity_raw_response_id: int | None,
    fee_raw_response_id: int | None,
    run_id: int,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    """Upsert one canonical row. Returns ``(created, changed)``."""
    existing = session.scalar(
        select(LandfillInboundMonthly).where(
            LandfillInboundMonthly.reference_month == joined.reference_month,
            LandfillInboundMonthly.origin_region_code == joined.origin_region_code,
            LandfillInboundMonthly.destination_code == DESTINATION_CODE,
            LandfillInboundMonthly.waste_name == joined.waste_name,
        )
    )
    data_values: dict[str, Any] = {
        "reference_year": joined.reference_year,
        "origin_source_name": joined.origin_source_name,
        "origin_region_level": ORIGIN_LEVEL_METROPOLITAN,
        "quantity_kg": joined.quantity_kg,
        "inbound_fee_krw": joined.inbound_fee_krw,
        "quantity_unit": QUANTITY_UNIT_KG,
        "fee_currency": FEE_CURRENCY_KRW,
        "accounting_basis": ACCOUNTING_BASIS_LANDFILL_INBOUND_FLOW,
        "quantity_source_dataset_id": INBOUND_DATASET_ID,
        "quantity_source_snapshot_uuid": inbound_snapshot.snapshot_uuid,
        "quantity_source_snapshot_date": _snapshot_date(inbound_snapshot),
        "fee_source_dataset_id": FEE_DATASET_ID,
        "fee_source_snapshot_uuid": fee_snapshot.snapshot_uuid,
        "fee_source_snapshot_date": _snapshot_date(fee_snapshot),
        "quantity_evidence_status": EVIDENCE_OFFICIAL_REPORTED,
        "fee_evidence_status": EVIDENCE_OFFICIAL_REPORTED,
        "transformation_version": TRANSFORMATION_VERSION,
    }
    provenance_values: dict[str, Any] = {
        "retrieved_at": now,
        "quantity_raw_response_id": quantity_raw_response_id,
        "fee_raw_response_id": fee_raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            LandfillInboundMonthly(
                reference_month=joined.reference_month,
                origin_region_code=joined.origin_region_code,
                destination_code=DESTINATION_CODE,
                waste_name=joined.waste_name,
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


def _update_freshness(
    session: Any, dataset_id: str, latest_period: str | None, now: datetime.datetime
) -> None:
    freshness = session.get(DatasetFreshness, dataset_id)
    if freshness is None:
        session.add(
            DatasetFreshness(
                source_id=dataset_id,
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


def _summarize(report: LandfillInboundReport, joined: list[LandfillInboundJoined]) -> None:
    months = sorted({row.reference_month for row in joined})
    report.reference_month_min = months[0] if months else None
    report.reference_month_max = months[-1] if months else None
    by_origin: dict[str, int] = {}
    by_year: dict[str, int] = {}
    for row in joined:
        by_origin[row.origin_region_code] = by_origin.get(row.origin_region_code, 0) + 1
        by_year[str(row.reference_year)] = by_year.get(str(row.reference_year), 0) + 1
    report.rows_by_origin = dict(sorted(by_origin.items()))
    report.rows_by_year = dict(sorted(by_year.items()))
    report.supported_origins = sorted(by_origin)


def run_landfill_inbound(
    settings: ProbeSettings, *, scope: str, write: bool
) -> LandfillInboundReport:
    """Fetch, validate, join 1:1, and (if ``write``) upsert the canonical dataset."""
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is supported for landfill-inbound")

    report = LandfillInboundReport(mode="write" if write else "dry-run", status="RUNNING")

    # 1) Discover the latest snapshot for each dataset (fail safely if none).
    inbound_snapshot = discover_snapshot(INBOUND_DATASET_ID)
    fee_snapshot = discover_snapshot(FEE_DATASET_ID)
    report.inbound_snapshot_uuid = inbound_snapshot.snapshot_uuid
    report.inbound_snapshot_date = inbound_snapshot.publication_date
    report.fee_snapshot_uuid = fee_snapshot.snapshot_uuid
    report.fee_snapshot_date = fee_snapshot.publication_date

    # 2) Fetch every page securely.
    inbound_rows, inbound_meta = fetch_all_rows(settings, inbound_snapshot)
    fee_rows, fee_meta = fetch_all_rows(settings, fee_snapshot)
    report.inbound_rows_received = len(inbound_rows)
    report.fee_rows_received = len(fee_rows)

    # 3) Normalize + validate (origins, required fields, nulls, negatives, dupes).
    inbound_records = parse_inbound_rows(inbound_rows)
    fee_records = parse_fee_rows(fee_rows)

    # 4) Join quantity ↔ fee 1:1; a breach is a visible failure.
    joined, join_report = join_inbound_and_fees(inbound_records, fee_records)
    report.joined_rows = join_report.joined
    report.inbound_only = len(join_report.inbound_only_keys)
    report.fee_only = len(join_report.fee_only_keys)
    if join_report.inbound_only_keys or join_report.fee_only_keys:
        raise IngestionError(
            "landfill inbound↔fee join is not 1:1: "
            f"{len(join_report.inbound_only_keys)} inbound-only, "
            f"{len(join_report.fee_only_keys)} fee-only keys "
            f"(e.g. {(join_report.inbound_only_keys + join_report.fee_only_keys)[:3]})"
        )
    _summarize(report, joined)

    if not write:
        report.status = "VALIDATED"
        report.message = (
            f"Validated {report.joined_rows} canonical rows "
            f"({report.inbound_rows_received} inbound × {report.fee_rows_received} fee, 1:1); "
            "no database writes performed."
        )
        return report

    # 5) Write: run row, raw responses, idempotent upsert, freshness.
    session = get_sessionmaker()()
    now = _utcnow()
    latest_period = report.reference_month_max
    run: IngestionRun | None = None
    try:
        run = IngestionRun(
            source_id=INBOUND_DATASET_ID,
            started_at=now,
            status="RUNNING",
            rows_received=report.inbound_rows_received + report.fee_rows_received,
            rows_inserted=0,
            rows_updated=0,
            rows_rejected=0,
            reference_period=latest_period,
            transformation_version=TRANSFORMATION_VERSION,
        )
        session.add(run)
        session.commit()
        session.refresh(run)
        report.ingestion_run_id = run.run_id

        quantity_raw_id = _get_or_create_raw_response(
            session,
            dataset_id=INBOUND_DATASET_ID,
            snapshot=inbound_snapshot,
            rows=inbound_rows,
            request_metadata=inbound_meta,
            run_id=run.run_id,
            now=now,
        )
        fee_raw_id = _get_or_create_raw_response(
            session,
            dataset_id=FEE_DATASET_ID,
            snapshot=fee_snapshot,
            rows=fee_rows,
            request_metadata=fee_meta,
            run_id=run.run_id,
            now=now,
        )

        for joined_row in joined:
            created, changed = _upsert_landfill_row(
                session,
                joined=joined_row,
                inbound_snapshot=inbound_snapshot,
                fee_snapshot=fee_snapshot,
                quantity_raw_response_id=quantity_raw_id,
                fee_raw_response_id=fee_raw_id,
                run_id=run.run_id,
                now=now,
            )
            if created:
                report.rows_inserted += 1
            elif changed:
                report.rows_updated += 1
            else:
                report.rows_unchanged += 1

        _update_freshness(session, INBOUND_DATASET_ID, latest_period, now)
        _update_freshness(session, FEE_DATASET_ID, latest_period, now)

        run.status = "SUCCEEDED"
        run.completed_at = _utcnow()
        run.rows_inserted = report.rows_inserted
        run.rows_updated = report.rows_updated
        run.rows_rejected = report.rows_rejected
        session.commit()

        report.status = "SUCCEEDED"
        report.message = (
            f"Wrote {report.joined_rows} canonical rows "
            f"({report.rows_inserted} inserted, {report.rows_updated} updated, "
            f"{report.rows_unchanged} unchanged)."
        )
        return report
    except Exception as exc:
        session.rollback()
        if run is not None:
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
    "LandfillInboundReport",
    "discover_snapshot",
    "fetch_all_rows",
    "run_landfill_inbound",
]
