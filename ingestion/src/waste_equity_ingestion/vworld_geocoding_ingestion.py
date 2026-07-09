"""One-shot VWorld facility geocoding job (Phase 2.4).

Geocodes ``waste_treatment_facilities`` addresses through the official VWorld
geocoder and, for multi-district-city facilities (``REQUIRES_GEOCODE``),
resolves the canonical region by point-in-polygon against SGIS geometry.

Integrity rules:

- Coordinates come only from successful geocoder responses; failures keep
  ``geometry`` NULL with ``geocode_status='FAILED'`` and an explicit note.
- Region resolution requires agreement between point-in-polygon, the RCIS
  sido name, the RCIS city name, and (when present) the ``level4AC``
  legal-dong sido prefix; disagreements are flagged, never guessed.
- ``EXACT_MATCH`` assignments are never changed by geocoding; a conflicting
  point-in-polygon result is recorded in ``geocode_note`` for review.
- Idempotent: a facility whose built request address already geocoded
  (succeeded, or failed without ``retry_failed``) is skipped without an API
  call, so an identical second run performs zero requests and zero writes.
"""

from __future__ import annotations

import datetime
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from geoalchemy2 import WKTElement
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    RawApiResponse,
    Region,
    WasteTreatmentFacility,
)

from .config import ProbeSettings
from .errors import IngestionError, MissingCredentialsError, ProbeError
from .http import get_json_response
from .rcis_region_crosswalk import SIDO_ALIASES, normalize_name
from .rcis_waste_ingestion import _hash_payload, _sanitize_error, _utcnow
from .samples import sanitize
from .vworld_geocoding_contract import (
    GEOCODER_ENDPOINT_IDENTIFIER,
    GEOCODER_URL,
    PROVIDER_NOT_FOUND,
    PROVIDER_OK,
    TARGET_CRS,
    TRANSFORMATION_VERSION,
    VWORLD_SOURCE_ID,
    ParsedGeocode,
    build_attempts,
    build_geocoder_params,
    build_request_address,
    canonical_sido,
    level4ac_matches_sido,
    parse_geocoder_response,
)

DEFAULT_REQUEST_DELAY_SECONDS = 0.15

# A geocoder fetch returns the raw JSON payload for one attempt. Injectable so
# persistence tests can exercise the full write path without network access.
GeocoderFetch = Callable[[dict[str, str]], dict[str, Any]]

_STATUS_SUCCEEDED = "SUCCEEDED"
_STATUS_FAILED = "FAILED"


@dataclass(frozen=True)
class GeocodeCallResult:
    status: str  # SUCCEEDED | FAILED
    # The built canonical request address (ladder input). This is the
    # idempotency key stored on the facility; it must stay stable across runs
    # even when a simplified ladder rung produced the hit.
    request_address: str
    # The address string of the attempt that actually succeeded (may be the
    # simplified form); preserved in the raw-response request metadata.
    attempt_address: str | None
    address_type: str | None
    parsed: ParsedGeocode | None
    final_payload: dict[str, Any]
    attempts: int
    error_detail: str | None


@dataclass
class GeocodeReport:
    mode: str
    status: str
    facilities_considered: int = 0
    skipped_already_geocoded: int = 0
    skipped_previously_failed: int = 0
    processed: int = 0
    api_calls: int = 0
    geocode_succeeded: int = 0
    geocode_failed: int = 0
    resolved_geocoded_match: int = 0
    pip_unresolved: int = 0
    exact_match_pip_mismatches: int = 0
    sido_prefix_mismatches: int = 0
    rows_updated: int = 0
    raw_responses_inserted: int = 0
    raw_responses_reused: int = 0
    ingestion_run_id: int | None = None
    failure_labels: list[str] = field(default_factory=list)
    unresolved_labels: list[str] = field(default_factory=list)
    message: str = ""

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "facilities_considered": self.facilities_considered,
            "skipped_already_geocoded": self.skipped_already_geocoded,
            "skipped_previously_failed": self.skipped_previously_failed,
            "processed": self.processed,
            "api_calls": self.api_calls,
            "geocode_succeeded": self.geocode_succeeded,
            "geocode_failed": self.geocode_failed,
            "resolved_geocoded_match": self.resolved_geocoded_match,
            "pip_unresolved": self.pip_unresolved,
            "exact_match_pip_mismatches": self.exact_match_pip_mismatches,
            "sido_prefix_mismatches": self.sido_prefix_mismatches,
            "rows_updated": self.rows_updated,
            "raw_responses_inserted": self.raw_responses_inserted,
            "raw_responses_reused": self.raw_responses_reused,
            "ingestion_run_id": self.ingestion_run_id,
            "failure_labels": self.failure_labels[:20],
            "unresolved_labels": self.unresolved_labels[:20],
            "message": self.message,
        }


def _require_vworld_config(settings: ProbeSettings) -> str:
    if not settings.vworld_api_key:
        raise MissingCredentialsError(["VWORLD_API_KEY"])
    return settings.vworld_api_key


def skip_reason(
    facility: WasteTreatmentFacility, request_address: str, *, retry_failed: bool
) -> str | None:
    """Idempotency decision: why this facility needs no geocoder call.

    Returns ``"already_geocoded"``, ``"previously_failed"``, or None. An
    address change always re-geocodes; a prior failure re-geocodes only with
    ``retry_failed``.
    """
    if (
        facility.geocode_status == _STATUS_SUCCEEDED
        and facility.geocode_request_address == request_address
        and facility.geometry is not None
    ):
        return "already_geocoded"
    if (
        facility.geocode_status == _STATUS_FAILED
        and facility.geocode_request_address == request_address
        and not retry_failed
    ):
        return "previously_failed"
    return None


def _default_fetch(params: dict[str, str]) -> dict[str, Any]:
    return get_json_response(GEOCODER_URL, params).payload


def geocode_address(
    api_key: str,
    request_address: str,
    *,
    fetch: GeocoderFetch,
    request_delay: float,
    counter: GeocodeReport,
) -> GeocodeCallResult:
    """Run the deterministic attempt ladder for one request address."""
    attempts = build_attempts(request_address)
    last_payload: dict[str, Any] = {}
    last_detail: str | None = None
    for index, attempt in enumerate(attempts):
        if index > 0 and request_delay > 0:
            time.sleep(request_delay)
        try:
            payload = fetch(build_geocoder_params(api_key, attempt))
        except Exception as exc:  # noqa: BLE001 - classified, never re-raised raw
            counter.api_calls += 1
            last_payload = {"transport_error": _sanitize_error(str(exc))}
            last_detail = _sanitize_error(str(exc))
            continue
        counter.api_calls += 1
        last_payload = payload
        parsed = parse_geocoder_response(payload)
        if parsed.provider_status == PROVIDER_OK and parsed.x and parsed.y:
            return GeocodeCallResult(
                status=_STATUS_SUCCEEDED,
                request_address=request_address,
                attempt_address=attempt.address,
                address_type=attempt.address_type,
                parsed=parsed,
                final_payload=payload,
                attempts=index + 1,
                error_detail=None,
            )
        if parsed.provider_status not in (PROVIDER_OK, PROVIDER_NOT_FOUND):
            last_detail = parsed.error_detail or parsed.provider_status
        else:
            last_detail = parsed.error_detail or PROVIDER_NOT_FOUND
    return GeocodeCallResult(
        status=_STATUS_FAILED,
        request_address=request_address,
        attempt_address=None,
        address_type=None,
        parsed=None,
        final_payload=last_payload,
        attempts=len(attempts),
        error_detail=last_detail or "geocoder attempts exhausted",
    )


@dataclass(frozen=True)
class PipResolution:
    region_id: int | None
    region_code: str | None
    region_name: str | None
    containing_count: int
    detail: str


def _sido_names_by_code(session: Session) -> dict[str, str]:
    rows = session.execute(
        select(Region.region_code, Region.region_name).where(Region.region_level == "SIDO")
    ).all()
    return {code: name for code, name in rows}


def resolve_point_region(
    session: Session,
    *,
    x: str,
    y: str,
    rcis_sido_name: str,
    rcis_sigungu_name: str,
    level4ac: str | None,
    sido_names: dict[str, str],
) -> PipResolution:
    """Resolve a geocoded point to one SGIS SIGUNGU region with cross-checks."""
    point = func.ST_SetSRID(func.ST_MakePoint(float(x), float(y)), 4326)
    rows = session.execute(
        select(Region.id, Region.region_code, Region.region_name, Region.parent_region_code)
        .where(
            Region.region_level == "SIGUNGU",
            Region.geometry.isnot(None),
            func.ST_Contains(Region.geometry, point),
        )
        .order_by(Region.region_code)
    ).all()

    if len(rows) != 1:
        return PipResolution(
            region_id=None,
            region_code=None,
            region_name=None,
            containing_count=len(rows),
            detail=f"point is contained by {len(rows)} SIGUNGU regions; expected exactly 1",
        )

    region_id, region_code, region_name, parent_code = rows[0]
    parent_name = sido_names.get(parent_code or "", "")
    parent_canonical = SIDO_ALIASES.get(normalize_name(parent_name), normalize_name(parent_name))
    expected_canonical = canonical_sido(rcis_sido_name)
    if expected_canonical is None or parent_canonical != expected_canonical:
        return PipResolution(
            region_id=None,
            region_code=None,
            region_name=None,
            containing_count=1,
            detail=(
                f"point falls in {region_name}, whose sido {parent_canonical!r} does not match "
                f"the RCIS sido {rcis_sido_name!r}"
            ),
        )

    local_name = normalize_name(region_name)
    if local_name.startswith(normalize_name(parent_name)):
        local_name = local_name[len(normalize_name(parent_name)) :].strip()
    if not local_name.startswith(normalize_name(rcis_sigungu_name)):
        return PipResolution(
            region_id=None,
            region_code=None,
            region_name=None,
            containing_count=1,
            detail=(
                f"point falls in {region_name}, which is not a district of the RCIS city "
                f"{rcis_sigungu_name!r}"
            ),
        )

    prefix_check = level4ac_matches_sido(level4ac, rcis_sido_name)
    if prefix_check is False:
        return PipResolution(
            region_id=None,
            region_code=None,
            region_name=None,
            containing_count=1,
            detail=(
                f"refined legal-dong code {level4ac!r} does not carry the expected sido prefix "
                f"for {rcis_sido_name!r}"
            ),
        )

    return PipResolution(
        region_id=int(region_id),
        region_code=str(region_code),
        region_name=str(region_name),
        containing_count=1,
        detail=f"resolved via point-in-polygon to {region_code} ({region_name})",
    )


def run_vworld_geocoding(
    settings: ProbeSettings,
    *,
    write: bool,
    request_delay: float = DEFAULT_REQUEST_DELAY_SECONDS,
    limit: int | None = None,
    retry_failed: bool = False,
    fetch: GeocoderFetch | None = None,
) -> GeocodeReport:
    api_key = _require_vworld_config(settings)
    fetch_fn = fetch if fetch is not None else _default_fetch
    report = GeocodeReport(mode="write" if write else "dry-run", status="RUNNING")
    now = _utcnow()

    session = get_sessionmaker()()
    run: IngestionRun | None = None
    run_id: int | None = None
    try:
        facilities = list(
            session.scalars(
                select(WasteTreatmentFacility)
                .where(WasteTreatmentFacility.address.isnot(None))
                .order_by(WasteTreatmentFacility.id)
            )
        )
        report.facilities_considered = len(facilities)
        sido_names = _sido_names_by_code(session)
        reference_periods = _reference_periods(facilities)

        to_process: list[tuple[WasteTreatmentFacility, str]] = []
        for facility in facilities:
            request_address = build_request_address(
                facility.rcis_sido_name, facility.rcis_sigungu_name, facility.address
            )
            reason = skip_reason(facility, request_address, retry_failed=retry_failed)
            if reason == "already_geocoded":
                report.skipped_already_geocoded += 1
                continue
            if reason == "previously_failed":
                report.skipped_previously_failed += 1
                continue
            to_process.append((facility, request_address))
        if limit is not None:
            to_process = to_process[:limit]

        if write:
            run = IngestionRun(
                source_id=VWORLD_SOURCE_ID,
                started_at=now,
                status="RUNNING",
                rows_received=len(to_process),
                rows_inserted=0,
                rows_updated=0,
                rows_rejected=0,
                reference_period=reference_periods,
                transformation_version=TRANSFORMATION_VERSION,
            )
            session.add(run)
            session.flush()
            run_id = run.run_id
            report.ingestion_run_id = run_id
        for index, (facility, request_address) in enumerate(to_process):
            if index > 0 and request_delay > 0:
                time.sleep(request_delay)
            report.processed += 1
            result = geocode_address(
                api_key,
                request_address,
                fetch=fetch_fn,
                request_delay=request_delay,
                counter=report,
            )
            label = (
                f"{facility.rcis_sido_name} {facility.rcis_sigungu_name} {facility.facility_name}"
            )

            if result.status == _STATUS_FAILED:
                report.geocode_failed += 1
                report.failure_labels.append(label)
                if write and run is not None:
                    raw = _get_or_create_raw_response(
                        session,
                        payload=result.final_payload,
                        request_address=result.attempt_address or result.request_address,
                        address_type=result.address_type,
                        reference_period=str(facility.reference_year),
                        run_id=run.run_id,
                        now=now,
                        report=report,
                    )
                    _apply_failure(facility, result, raw, now)
                    report.rows_updated += 1
                continue

            parsed = result.parsed
            if parsed is None or parsed.x is None or parsed.y is None:
                raise IngestionError("geocoder returned success without a parsed coordinate")
            report.geocode_succeeded += 1

            prefix_check = level4ac_matches_sido(parsed.level4ac, facility.rcis_sido_name)
            if prefix_check is False:
                report.sido_prefix_mismatches += 1

            resolution: PipResolution | None = None
            if facility.region_mapping_status in ("REQUIRES_GEOCODE", "GEOCODED_MATCH"):
                resolution = resolve_point_region(
                    session,
                    x=parsed.x,
                    y=parsed.y,
                    rcis_sido_name=facility.rcis_sido_name,
                    rcis_sigungu_name=facility.rcis_sigungu_name,
                    level4ac=parsed.level4ac,
                    sido_names=sido_names,
                )
                if resolution.region_id is not None:
                    report.resolved_geocoded_match += 1
                else:
                    report.pip_unresolved += 1
                    report.unresolved_labels.append(f"{label}: {resolution.detail}")
            elif facility.region_mapping_status == "EXACT_MATCH":
                resolution = resolve_point_region(
                    session,
                    x=parsed.x,
                    y=parsed.y,
                    rcis_sido_name=facility.rcis_sido_name,
                    rcis_sigungu_name=facility.rcis_sigungu_name,
                    level4ac=parsed.level4ac,
                    sido_names=sido_names,
                )
                if (
                    resolution.region_id is not None
                    and facility.region_id is not None
                    and resolution.region_id != facility.region_id
                ):
                    report.exact_match_pip_mismatches += 1

            if write and run is not None:
                raw = _get_or_create_raw_response(
                    session,
                    payload=result.final_payload,
                    request_address=result.attempt_address or result.request_address,
                    address_type=result.address_type,
                    reference_period=str(facility.reference_year),
                    run_id=run.run_id,
                    now=now,
                    report=report,
                )
                _apply_success(facility, result, parsed, resolution, raw, now)
                report.rows_updated += 1

        if write and run is not None:
            run.status = "SUCCEEDED"
            run.completed_at = _utcnow()
            run.rows_updated = report.rows_updated
            run.rows_rejected = report.geocode_failed
            _update_freshness(session, reference_periods=reference_periods, now=_utcnow())
            session.commit()
        else:
            session.rollback()

        report.status = "SUCCEEDED" if write else "VALIDATED"
        report.message = (
            "VWorld geocoding written with provenance."
            if write
            else "VWorld geocoding validated; no writes performed."
        )
        return report
    except ProbeError as exc:
        session.rollback()
        _mark_run_failed(session, run_id, exc)
        raise
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run_id, exc)
        raise IngestionError("VWorld geocoding failed; normalized writes were rolled back") from exc
    finally:
        session.close()


def _reference_periods(facilities: list[WasteTreatmentFacility]) -> str:
    years = sorted({str(facility.reference_year) for facility in facilities})
    return ",".join(years) if years else "NONE"


def _apply_common(
    facility: WasteTreatmentFacility,
    result: GeocodeCallResult,
    raw: RawApiResponse,
    now: datetime.datetime,
) -> None:
    facility.geocode_request_address = result.request_address
    facility.geocode_address_type = result.address_type
    facility.geocoded_at = now
    facility.geocode_raw_response_id = raw.id
    facility.updated_at = now


def _apply_failure(
    facility: WasteTreatmentFacility,
    result: GeocodeCallResult,
    raw: RawApiResponse,
    now: datetime.datetime,
) -> None:
    facility.geocode_status = _STATUS_FAILED
    facility.geocode_refined_address = None
    facility.geocode_level4ac = None
    facility.geocode_crs = None
    facility.geocode_note = (result.error_detail or "geocode failed")[:1000]
    _apply_common(facility, result, raw, now)


def _apply_success(
    facility: WasteTreatmentFacility,
    result: GeocodeCallResult,
    parsed: ParsedGeocode,
    resolution: PipResolution | None,
    raw: RawApiResponse,
    now: datetime.datetime,
) -> None:
    facility.geocode_status = _STATUS_SUCCEEDED
    facility.geometry = WKTElement(f"POINT({parsed.x} {parsed.y})", srid=4326)
    facility.geocode_refined_address = parsed.refined_address
    facility.geocode_level4ac = parsed.level4ac
    facility.geocode_crs = parsed.crs or TARGET_CRS
    notes: list[str] = []
    if facility.region_mapping_status in ("REQUIRES_GEOCODE", "GEOCODED_MATCH"):
        if resolution is not None and resolution.region_id is not None:
            facility.region_id = resolution.region_id
            facility.region_mapping_status = "GEOCODED_MATCH"
            notes.append(resolution.detail)
        else:
            facility.region_id = None
            facility.region_mapping_status = "REQUIRES_GEOCODE"
            if resolution is not None:
                notes.append(resolution.detail)
    elif facility.region_mapping_status == "EXACT_MATCH" and resolution is not None:
        if (
            resolution.region_id is not None
            and facility.region_id is not None
            and resolution.region_id != facility.region_id
        ):
            notes.append(
                "point-in-polygon disagrees with the exact name match: "
                + resolution.detail
                + "; name-based assignment retained pending review"
            )
        elif resolution.region_id is None:
            notes.append("point-in-polygon could not confirm the exact match: " + resolution.detail)
    facility.geocode_note = ("; ".join(notes))[:1000] if notes else None
    _apply_common(facility, result, raw, now)


def _get_or_create_raw_response(
    session: Session,
    *,
    payload: dict[str, Any],
    request_address: str,
    address_type: str | None,
    reference_period: str,
    run_id: int,
    now: datetime.datetime,
    report: GeocodeReport,
) -> RawApiResponse:
    sanitized_payload = sanitize(
        {
            "source": VWORLD_SOURCE_ID,
            "endpoint_identifier": GEOCODER_ENDPOINT_IDENTIFIER,
            "request_metadata": {
                "address": request_address,
                "type": address_type,
                "crs": TARGET_CRS,
            },
            "payload": payload,
        }
    )
    response_hash = _hash_payload(sanitized_payload)
    existing = session.scalar(
        select(RawApiResponse).where(
            RawApiResponse.source_id == VWORLD_SOURCE_ID,
            RawApiResponse.endpoint_identifier == GEOCODER_ENDPOINT_IDENTIFIER,
            RawApiResponse.reference_period == reference_period,
            RawApiResponse.response_hash == response_hash,
            RawApiResponse.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        report.raw_responses_reused += 1
        return existing
    raw = RawApiResponse(
        source_id=VWORLD_SOURCE_ID,
        endpoint_identifier=GEOCODER_ENDPOINT_IDENTIFIER,
        reference_period=reference_period,
        request_timestamp=now,
        response_hash=response_hash,
        transformation_version=TRANSFORMATION_VERSION,
        sanitized_response=sanitized_payload,
        ingestion_run_id=run_id,
    )
    session.add(raw)
    session.flush()
    report.raw_responses_inserted += 1
    return raw


def _update_freshness(session: Session, *, reference_periods: str, now: datetime.datetime) -> None:
    freshness = session.get(DatasetFreshness, VWORLD_SOURCE_ID)
    if freshness is None:
        freshness = DatasetFreshness(source_id=VWORLD_SOURCE_ID)
        session.add(freshness)
    freshness.latest_reference_period = reference_periods
    freshness.last_checked_at = now
    freshness.last_changed_at = now
    freshness.last_success_at = now
    freshness.freshness_status = "FRESH"


def _mark_run_failed(session: Session, run_id: int | None, exc: Exception) -> None:
    if run_id is None:
        return
    run = session.get(IngestionRun, run_id)
    if run is None:
        # The RUNNING row was part of the rolled-back transaction; nothing to
        # mark (2.3 semantics).
        return
    run.status = "FAILED"
    run.completed_at = _utcnow()
    run.error_category = exc.__class__.__name__[:50]
    run.error_message = _sanitize_error(str(exc))
    session.commit()


__all__ = [
    "DEFAULT_REQUEST_DELAY_SECONDS",
    "GeocodeReport",
    "geocode_address",
    "resolve_point_region",
    "run_vworld_geocoding",
]
