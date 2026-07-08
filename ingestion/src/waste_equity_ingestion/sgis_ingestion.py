"""One-shot SGIS canonical geography and population ingestion job."""

from __future__ import annotations

import datetime
import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

from geoalchemy2 import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session
from waste_equity_backend.db import get_sessionmaker
from waste_equity_backend.models import (
    DatasetFreshness,
    IngestionRun,
    RawApiResponse,
    Region,
    RegionalPopulation,
    RegionCodeMap,
)

from .config import ProbeSettings
from .errors import IngestionError, ProbeError
from .probes.sgis import SgisClient, authenticate, sanitized_auth_summary
from .samples import sanitize
from .sgis_contract import (
    CAPITAL_REGION_SIDOS,
    POPULATION_DEFINITION,
    POPULATION_UNIT,
    SGIS_SOURCE_CRS,
    SGIS_SOURCE_ID,
    TARGET_CRS,
    TRANSFORMATION_VERSION,
    BoundaryRecord,
    PopulationRecord,
    RegionLevel,
    canonical_region_code,
    parse_boundary_response,
    parse_population_response,
)


@dataclass(frozen=True)
class RawSgisResponse:
    endpoint_identifier: str
    endpoint: str
    request_metadata: dict[str, Any]
    payload: dict[str, Any]
    retrieved_at: datetime.datetime
    parsed_count: int


@dataclass(frozen=True)
class SgisFetchBundle:
    auth_summary: dict[str, Any]
    population_records: list[PopulationRecord]
    boundary_records: list[BoundaryRecord]
    raw_responses: list[RawSgisResponse]
    repair_methods: dict[str, int]


@dataclass
class SgisIngestionReport:
    mode: str
    status: str
    reference_year: int
    rows_received: int
    rows_inserted: int = 0
    rows_updated: int = 0
    rows_rejected: int = 0
    region_count: int = 0
    population_count: int = 0
    raw_responses_inserted: int = 0
    raw_responses_reused: int = 0
    ingestion_run_id: int | None = None
    unmatched_sgis_codes: list[str] = field(default_factory=list)
    repair_methods: dict[str, int] = field(default_factory=dict)
    message: str | None = None

    def sanitized_summary(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "status": self.status,
            "reference_year": self.reference_year,
            "rows_received": self.rows_received,
            "rows_inserted": self.rows_inserted,
            "rows_updated": self.rows_updated,
            "rows_rejected": self.rows_rejected,
            "region_count": self.region_count,
            "population_count": self.population_count,
            "raw_responses_inserted": self.raw_responses_inserted,
            "raw_responses_reused": self.raw_responses_reused,
            "ingestion_run_id": self.ingestion_run_id,
            "unmatched_sgis_codes": self.unmatched_sgis_codes,
            "geometry_repair_methods": self.repair_methods,
            "message": self.message,
        }


def fetch_sgis_capital_region(settings: ProbeSettings, *, year: int) -> SgisFetchBundle:
    auth = authenticate(settings)
    client = SgisClient(access_token=auth.access_token)
    population_records: list[PopulationRecord] = []
    boundary_records: list[BoundaryRecord] = []
    raw_responses: list[RawSgisResponse] = []
    repair_methods: dict[str, int] = {}

    for sido in CAPITAL_REGION_SIDOS:
        for low_search, expected_level in ((0, "SIDO"), (1, "SIGUNGU")):
            population_response = client.population(
                year=year, adm_cd=sido.code, low_search=low_search
            )
            population_retrieved_at = _utcnow()
            parsed_population = parse_population_response(
                population_response.payload,
                reference_year=year,
                parent_administrative_code=None if low_search == 0 else sido.code,
                expected_level=_expected_level(expected_level),
            )
            population_records.extend(parsed_population)
            raw_responses.append(
                RawSgisResponse(
                    endpoint_identifier=_endpoint_identifier(
                        "OpenAPI3/stats/population.json", year, sido.code, low_search
                    ),
                    endpoint="OpenAPI3/stats/population.json",
                    request_metadata={
                        "year": str(year),
                        "adm_cd": sido.code,
                        "low_search": str(low_search),
                    },
                    payload=population_response.payload,
                    retrieved_at=population_retrieved_at,
                    parsed_count=len(parsed_population),
                )
            )

            boundary_response = client.boundary(year=year, adm_cd=sido.code, low_search=low_search)
            boundary_retrieved_at = _utcnow()
            parsed_boundary = parse_boundary_response(
                boundary_response.payload,
                reference_year=year,
                parent_administrative_code=None if low_search == 0 else sido.code,
                expected_level=_expected_level(expected_level),
            )
            boundary_records.extend(parsed_boundary)
            for record in parsed_boundary:
                repair_methods[record.repair_method] = (
                    repair_methods.get(record.repair_method, 0) + 1
                )
            raw_responses.append(
                RawSgisResponse(
                    endpoint_identifier=_endpoint_identifier(
                        "OpenAPI3/boundary/hadmarea.geojson", year, sido.code, low_search
                    ),
                    endpoint="OpenAPI3/boundary/hadmarea.geojson",
                    request_metadata={
                        "year": str(year),
                        "adm_cd": sido.code,
                        "low_search": str(low_search),
                        "source_crs": SGIS_SOURCE_CRS,
                        "target_crs": TARGET_CRS,
                    },
                    payload=boundary_response.payload,
                    retrieved_at=boundary_retrieved_at,
                    parsed_count=len(parsed_boundary),
                )
            )

    unmatched = unmatched_codes(population_records, boundary_records)
    if unmatched:
        raise IngestionError("SGIS population/boundary code mismatch: " + ", ".join(unmatched))
    return SgisFetchBundle(
        auth_summary=sanitized_auth_summary(auth),
        population_records=population_records,
        boundary_records=boundary_records,
        raw_responses=raw_responses,
        repair_methods=repair_methods,
    )


def run_sgis_ingestion(
    settings: ProbeSettings,
    *,
    year: int,
    scope: str,
    write: bool,
) -> SgisIngestionReport:
    if scope != "capital-region":
        raise IngestionError("Only --scope capital-region is implemented in Phase 2.1")
    bundle = fetch_sgis_capital_region(settings, year=year)
    rows_received = len(bundle.population_records) + len(bundle.boundary_records)
    if not write:
        return SgisIngestionReport(
            mode="dry-run",
            status="VALIDATED",
            reference_year=year,
            rows_received=rows_received,
            region_count=len(bundle.boundary_records),
            population_count=len(bundle.population_records),
            repair_methods=bundle.repair_methods,
            message="Live SGIS responses validated; no database writes performed.",
        )

    session_factory = get_sessionmaker()
    session = session_factory()
    run = IngestionRun(
        source_id=SGIS_SOURCE_ID,
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
        report = _write_bundle(session, bundle, year=year, run=run)
        session.commit()
        return report
    except Exception as exc:
        session.rollback()
        _mark_run_failed(session, run.run_id, year, exc)
        if isinstance(exc, ProbeError):
            raise
        raise IngestionError("SGIS ingestion failed; normalized writes were rolled back") from exc
    finally:
        session.close()


def unmatched_codes(
    population_records: list[PopulationRecord], boundary_records: list[BoundaryRecord]
) -> list[str]:
    population_codes = {record.source_administrative_code for record in population_records}
    boundary_codes = {record.source_administrative_code for record in boundary_records}
    return sorted(population_codes.symmetric_difference(boundary_codes))


def _write_bundle(
    session: Session,
    bundle: SgisFetchBundle,
    *,
    year: int,
    run: IngestionRun,
) -> SgisIngestionReport:
    inserted = 0
    updated = 0
    raw_inserted = 0
    raw_reused = 0
    raw_ids_by_endpoint: dict[str, int] = {}
    now = _utcnow()
    valid_from = datetime.date(year, 1, 1)
    valid_to = datetime.date(year, 12, 31)

    for response in bundle.raw_responses:
        raw_response, was_inserted = _get_or_create_raw_response(session, response, run.run_id)
        raw_ids_by_endpoint[response.endpoint_identifier] = raw_response.id
        if was_inserted:
            raw_inserted += 1
        else:
            raw_reused += 1

    boundary_by_code = {
        record.source_administrative_code: record for record in bundle.boundary_records
    }
    population_by_code = {
        record.source_administrative_code: record for record in bundle.population_records
    }
    region_ids_by_code: dict[str, int] = {}

    for code in sorted(boundary_by_code):
        boundary = boundary_by_code[code]
        population = population_by_code[code]
        raw_id = raw_ids_by_endpoint[
            _endpoint_identifier(
                "OpenAPI3/boundary/hadmarea.geojson",
                year,
                boundary.source_parent_administrative_code or code,
                0 if boundary.source_geographic_level == "SIDO" else 1,
            )
        ]
        region, changed, created = _upsert_region(
            session,
            boundary=boundary,
            valid_from=valid_from,
            valid_to=valid_to,
            retrieved_at=_raw_request_timestamp(session, raw_id),
        )
        session.flush()
        region_ids_by_code[code] = region.id
        inserted += int(created)
        updated += int(changed and not created)
        map_created, map_changed = _upsert_region_code_map(
            session,
            canonical_code=region.region_code,
            sgis_code=boundary.source_administrative_code,
            valid_from=valid_from,
            valid_to=valid_to,
            reference_period=str(year),
        )
        inserted += int(map_created)
        updated += int(map_changed and not map_created)
        population_raw_id = raw_ids_by_endpoint[
            _endpoint_identifier(
                "OpenAPI3/stats/population.json",
                year,
                population.source_parent_administrative_code or code,
                0 if population.source_geographic_level == "SIDO" else 1,
            )
        ]
        pop_created, pop_changed = _upsert_population(
            session,
            population=population,
            region_id=region.id,
            raw_response_id=population_raw_id,
            run_id=run.run_id,
            retrieved_at=_raw_request_timestamp(session, population_raw_id),
            now=now,
        )
        inserted += int(pop_created)
        updated += int(pop_changed and not pop_created)

    _update_freshness(session, year=year, now=now)
    run.status = "SUCCEEDED"
    run.completed_at = now
    run.rows_received = len(bundle.population_records) + len(bundle.boundary_records)
    run.rows_inserted = inserted
    run.rows_updated = updated
    run.rows_rejected = 0
    run.reference_period = str(year)
    run.transformation_version = TRANSFORMATION_VERSION

    return SgisIngestionReport(
        mode="write",
        status="SUCCEEDED",
        reference_year=year,
        rows_received=run.rows_received,
        rows_inserted=inserted,
        rows_updated=updated,
        rows_rejected=0,
        region_count=len(region_ids_by_code),
        population_count=len(bundle.population_records),
        raw_responses_inserted=raw_inserted,
        raw_responses_reused=raw_reused,
        ingestion_run_id=run.run_id,
        repair_methods=bundle.repair_methods,
        message="SGIS capital-region geography and population ingestion succeeded.",
    )


def _get_or_create_raw_response(
    session: Session,
    response: RawSgisResponse,
    run_id: int,
) -> tuple[RawApiResponse, bool]:
    sanitized_payload = {
        "source": SGIS_SOURCE_ID,
        "endpoint": response.endpoint,
        "request_metadata": response.request_metadata,
        "parsed_record_count": response.parsed_count,
        "payload": response.payload,
    }
    clean_payload = sanitize(sanitized_payload)
    response_hash = _hash_payload(clean_payload)
    existing = session.scalar(
        select(RawApiResponse).where(
            RawApiResponse.source_id == SGIS_SOURCE_ID,
            RawApiResponse.endpoint_identifier == response.endpoint_identifier,
            RawApiResponse.reference_period == response.request_metadata["year"],
            RawApiResponse.response_hash == response_hash,
            RawApiResponse.transformation_version == TRANSFORMATION_VERSION,
        )
    )
    if existing is not None:
        return existing, False
    raw_response = RawApiResponse(
        source_id=SGIS_SOURCE_ID,
        endpoint_identifier=response.endpoint_identifier,
        reference_period=str(response.request_metadata["year"]),
        request_timestamp=response.retrieved_at,
        response_hash=response_hash,
        transformation_version=TRANSFORMATION_VERSION,
        sanitized_response=clean_payload,
        ingestion_run_id=run_id,
    )
    session.add(raw_response)
    session.flush()
    return raw_response, True


def _upsert_region(
    session: Session,
    *,
    boundary: BoundaryRecord,
    valid_from: datetime.date,
    valid_to: datetime.date,
    retrieved_at: datetime.datetime,
) -> tuple[Region, bool, bool]:
    code = canonical_region_code(boundary.source_administrative_code)
    parent_code = (
        canonical_region_code(boundary.source_parent_administrative_code)
        if boundary.source_parent_administrative_code
        else None
    )
    existing = session.scalar(
        select(Region).where(Region.region_code == code, Region.valid_from == valid_from)
    )
    values: dict[str, Any] = {
        "region_name": boundary.source_administrative_name,
        "region_level": boundary.source_geographic_level,
        "parent_region_code": parent_code,
        "source_id": SGIS_SOURCE_ID,
        "source_administrative_code": boundary.source_administrative_code,
        "source_geographic_level": boundary.source_geographic_level,
        "boundary_reference_period": str(boundary.reference_year),
        "boundary_source_crs": SGIS_SOURCE_CRS,
        "boundary_target_crs": TARGET_CRS,
        "boundary_geometry_hash": boundary.geometry_hash,
        "boundary_retrieved_at": retrieved_at,
        "valid_to": valid_to,
    }
    geometry_value = WKTElement(boundary.geometry.wkt, srid=4326)
    if existing is None:
        region = Region(
            region_code=code,
            geometry=geometry_value,
            valid_from=valid_from,
            **values,
        )
        session.add(region)
        return region, True, True

    changed = False
    old_geometry_hash = existing.boundary_geometry_hash
    for attr, value in values.items():
        if getattr(existing, attr) != value:
            setattr(existing, attr, value)
            changed = True
    if old_geometry_hash != boundary.geometry_hash:
        existing.geometry = geometry_value
        changed = True
    return existing, changed, False


def _upsert_region_code_map(
    session: Session,
    *,
    canonical_code: str,
    sgis_code: str,
    valid_from: datetime.date,
    valid_to: datetime.date,
    reference_period: str,
) -> tuple[bool, bool]:
    existing = session.scalar(
        select(RegionCodeMap).where(
            RegionCodeMap.canonical_region_code == canonical_code,
            RegionCodeMap.valid_from == valid_from,
        )
    )
    values: dict[str, Any] = {
        "sgis_code": sgis_code,
        "mapping_status": "SGIS_CONFIRMED",
        "cross_source_review_status": "NEEDS_REVIEW",
        "mapping_source": "SGIS_BOUNDARY_POPULATION_INGESTION",
        "source_reference_period": reference_period,
        "valid_to": valid_to,
    }
    if existing is None:
        session.add(
            RegionCodeMap(
                canonical_region_code=canonical_code,
                valid_from=valid_from,
                **values,
            )
        )
        return True, True
    changed = False
    for attr, value in values.items():
        if getattr(existing, attr) != value:
            setattr(existing, attr, value)
            changed = True
    return False, changed


def _upsert_population(
    session: Session,
    *,
    population: PopulationRecord,
    region_id: int,
    raw_response_id: int,
    run_id: int,
    retrieved_at: datetime.datetime,
    now: datetime.datetime,
) -> tuple[bool, bool]:
    existing = session.scalar(
        select(RegionalPopulation).where(
            RegionalPopulation.region_id == region_id,
            RegionalPopulation.reference_year == population.reference_year,
            RegionalPopulation.source_id == SGIS_SOURCE_ID,
            RegionalPopulation.population_definition == POPULATION_DEFINITION,
        )
    )
    values: dict[str, Any] = {
        "reference_period": str(population.reference_year),
        "population": population.population,
        "unit": POPULATION_UNIT,
        "source_administrative_code": population.source_administrative_code,
        "source_geographic_level": population.source_geographic_level,
        "retrieved_at": retrieved_at,
        "transformation_version": TRANSFORMATION_VERSION,
        "raw_response_id": raw_response_id,
        "ingestion_run_id": run_id,
    }
    if existing is None:
        session.add(
            RegionalPopulation(
                region_id=region_id,
                reference_year=population.reference_year,
                source_id=SGIS_SOURCE_ID,
                population_definition=POPULATION_DEFINITION,
                created_at=now,
                updated_at=now,
                **values,
            )
        )
        return True, True
    changed = False
    for attr, value in values.items():
        if getattr(existing, attr) != value:
            setattr(existing, attr, value)
            changed = True
    if changed:
        existing.updated_at = now
    return False, changed


def _update_freshness(session: Session, *, year: int, now: datetime.datetime) -> None:
    freshness = session.get(DatasetFreshness, SGIS_SOURCE_ID)
    if freshness is None:
        session.add(
            DatasetFreshness(
                source_id=SGIS_SOURCE_ID,
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


def _raw_request_timestamp(session: Session, raw_response_id: int) -> datetime.datetime:
    raw = session.get(RawApiResponse, raw_response_id)
    if raw is None:
        raise IngestionError(f"Raw response not found for id {raw_response_id}")
    return raw.request_timestamp


def _hash_payload(payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _endpoint_identifier(endpoint: str, year: int, adm_cd: str, low_search: int) -> str:
    return f"{endpoint}:year={year}:adm_cd={adm_cd}:low_search={low_search}"


def _expected_level(value: str) -> RegionLevel:
    if value == "SIDO":
        return "SIDO"
    if value == "SIGUNGU":
        return "SIGUNGU"
    raise AssertionError(value)


def _sanitize_error(message: str) -> str:
    redacted = message.replace("accessToken", "access_token")
    if len(redacted) > 1000:
        return redacted[:1000]
    return redacted


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)
