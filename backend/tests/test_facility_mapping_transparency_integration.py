"""Facility mapping-transparency endpoint integration tests against real PostGIS.

Runs only when TEST_DATABASE_URL is set. Seeds a synthetic data source, ingestion
run, region, and a handful of waste-treatment facilities in a rolled-back outer
transaction (remote synthetic geometry), so no real data is touched. Verifies the
coverage counts, the GROUP BY breakdowns, the paginated un-mapped list, and that a
missing map location surfaces the operator-recorded ``geocode_note`` only when
present (and None otherwise). Also asserts the migration head is unchanged at 0016.
"""

from __future__ import annotations

import datetime
import os
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from geoalchemy2 import WKTElement
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from waste_equity_backend.api.app import create_app
from waste_equity_backend.db import get_session
from waste_equity_backend.models import DataSource, IngestionRun, Region, WasteTreatmentFacility
from waste_equity_backend.models.facilities import ACCOUNTING_BASIS_FACILITY_THROUGHPUT

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
REFERENCE_YEAR = 1999
REFERENCE_PERIOD = "1999"
SOURCE_ID = "rcis_facility_transparency_test"
DATASET_NAME = "테스트 폐기물처리시설"
REGION_CODE = "99999"
REGION_NAME = "원격시험구"
ANNOTATED_NOTE = "행정구역 경계 밖 좌표로 판정되어 매핑 보류"


@pytest.fixture
def pg_session() -> Iterator[Session]:
    engine = create_engine(str(TEST_DATABASE_URL))
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        autoflush=False,
        expire_on_commit=False,
    )
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()


@pytest.fixture
def pg_client(pg_session: Session) -> Iterator[TestClient]:
    app = create_app()

    def override() -> Iterator[Session]:
        yield pg_session

    app.dependency_overrides[get_session] = override
    with TestClient(app) as test_client:
        yield test_client


def _facility(
    run_id: int,
    *,
    source_pid: str,
    category: str,
    kind: str,
    ownership: str,
    status: str,
    geometry: WKTElement | None,
    geocode_status: str | None,
    geocode_note: str | None,
    region_id: int | None,
) -> WasteTreatmentFacility:
    return WasteTreatmentFacility(
        source_id=SOURCE_ID,
        source_pid=source_pid,
        official_dataset_name=DATASET_NAME,
        reference_year=REFERENCE_YEAR,
        reference_period=REFERENCE_PERIOD,
        facility_category=category,
        facility_kind=kind,
        ownership=ownership,
        facility_name=f"시설 {source_pid}",
        operator_name=None,
        address=f"원격시험구역 {source_pid}로 1",
        source_seq=None,
        source_row_index=0,
        region_id=region_id,
        rcis_sido_name="원격시험시",
        rcis_sigungu_name="원격구",
        source_geographic_level="SIGUNGU",
        region_mapping_status=status,
        geometry=geometry,
        geocode_status=geocode_status,
        geocode_note=geocode_note,
        accounting_basis=ACCOUNTING_BASIS_FACILITY_THROUGHPUT,
        source_fields={},
        retrieved_at=NOW,
        transformation_version="test-transform-v1",
        ingestion_run_id=run_id,
        created_at=NOW,
        updated_at=NOW,
    )


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, Any]:
    """Two mapped facilities and three un-mapped (annotated / blank / null note)."""
    pg_session.add(
        DataSource(
            source_id=SOURCE_ID,
            source_name="RCIS 시설 (테스트)",
            dataset_name=DATASET_NAME,
            endpoint="https://example.invalid/rcis",
            publication_frequency="ANNUAL",
        )
    )
    pg_session.flush()
    run = IngestionRun(source_id=SOURCE_ID, started_at=NOW, completed_at=NOW, status="SUCCEEDED")
    pg_session.add(run)
    pg_session.flush()
    region = Region(
        region_code=REGION_CODE,
        region_name=REGION_NAME,
        region_level="SIGUNGU",
        valid_from=datetime.date(REFERENCE_YEAR, 1, 1),
    )
    pg_session.add(region)
    pg_session.flush()

    def pt(x: float) -> WKTElement:
        return WKTElement(f"POINT({x} 20.0)", srid=4326)

    map1 = _facility(
        run.run_id,
        source_pid="NTN101",
        category="PUBLIC_INCINERATION",
        kind="PROCESSING",
        ownership="PUBLIC",
        status="EXACT_MATCH",
        geometry=pt(20.0),
        geocode_status="SUCCEEDED",
        geocode_note=None,
        region_id=region.id,
    )
    map2 = _facility(
        run.run_id,
        source_pid="NTN102",
        category="PRIVATE_RECYCLING",
        kind="PROCESSING",
        ownership="PRIVATE",
        status="GEOCODED_MATCH",
        geometry=pt(20.1),
        geocode_status="SUCCEEDED",
        geocode_note=None,
        region_id=region.id,
    )
    # Un-mapped, WITH a recorded geocode_note.
    un_annotated = _facility(
        run.run_id,
        source_pid="NTN901",
        category="PUBLIC_LANDFILL",
        kind="LANDFILL",
        ownership="PUBLIC",
        status="REQUIRES_GEOCODE",
        geometry=None,
        geocode_status="FAILED",
        geocode_note=ANNOTATED_NOTE,
        region_id=None,
    )
    # Un-mapped, blank (whitespace-only) note → collapses to None.
    un_blank = _facility(
        run.run_id,
        source_pid="NTN902",
        category="PRIVATE_FINAL_DISPOSAL",
        kind="LANDFILL",
        ownership="PRIVATE",
        status="UNMATCHED",
        geometry=None,
        geocode_status="FAILED",
        geocode_note="   ",
        region_id=None,
    )
    # Un-mapped, no note (NULL); an EXACT_MATCH keeps its region while geocoding failed.
    un_null = _facility(
        run.run_id,
        source_pid="NTN903",
        category="PRIVATE_INTERMEDIATE_INCINERATION",
        kind="PROCESSING",
        ownership="PRIVATE",
        status="EXACT_MATCH",
        geometry=None,
        geocode_status="FAILED",
        geocode_note=None,
        region_id=region.id,
    )
    pg_session.add_all([map1, map2, un_annotated, un_blank, un_null])
    pg_session.flush()
    return {
        "run": run.run_id,
        "region": region.id,
        "map1": map1.id,
        "map2": map2.id,
        "un_annotated": un_annotated.id,
        "un_blank": un_blank.id,
        "un_null": un_null.id,
    }


def _get(client: TestClient, **params: Any) -> Any:
    return client.get("/api/v1/facilities/mapping-transparency", params={"year": 1999, **params})


def test_coverage_counts(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    body = _get(pg_client).json()
    assert body["reference_year"] == 1999
    assert body["reference_period"] == REFERENCE_PERIOD
    assert body["total"] == 5
    assert body["with_map_location"] == 2
    assert body["without_map_location"] == 3
    # address is NOT NULL in the schema and every seeded row has one → honestly 0.
    assert body["without_address"] == 0
    assert body["disclaimer"].startswith("지도 위치가 없는 시설")


def test_default_year_resolves_to_latest(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    # No year param: only the synthetic 1999 facilities exist, so latest == 1999.
    body = pg_client.get("/api/v1/facilities/mapping-transparency").json()
    assert body["reference_year"] == 1999
    assert body["total"] == 5


def test_category_breakdown_sums(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    rows = _get(pg_client).json()["category_breakdown"]
    by_cat = {r["category"]: r for r in rows}
    # sorted by category and covers exactly the five seeded categories
    assert [r["category"] for r in rows] == sorted(by_cat)
    assert by_cat["PUBLIC_INCINERATION"] == {
        "category": "PUBLIC_INCINERATION",
        "total": 1,
        "with_map_location": 1,
        "without_map_location": 0,
    }
    assert by_cat["PUBLIC_LANDFILL"]["without_map_location"] == 1
    assert by_cat["PUBLIC_LANDFILL"]["with_map_location"] == 0
    # category totals reconcile with the top-level coverage counts
    assert sum(r["total"] for r in rows) == 5
    assert sum(r["with_map_location"] for r in rows) == 2
    assert sum(r["without_map_location"] for r in rows) == 3


def test_ownership_and_region_mapping_breakdowns(
    pg_client: TestClient, seeded: dict[str, Any]
) -> None:
    body = _get(pg_client).json()
    assert body["ownership_breakdown"] == [
        {"ownership": "PRIVATE", "total": 3},
        {"ownership": "PUBLIC", "total": 2},
    ]
    assert body["region_mapping_breakdown"] == [
        {"region_mapping_status": "EXACT_MATCH", "total": 2},
        {"region_mapping_status": "GEOCODED_MATCH", "total": 1},
        {"region_mapping_status": "REQUIRES_GEOCODE", "total": 1},
        {"region_mapping_status": "UNMATCHED", "total": 1},
    ]


def test_source_breakdown(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    rows = _get(pg_client).json()["source_breakdown"]
    assert rows == [{"source_id": SOURCE_ID, "official_dataset_name": DATASET_NAME, "total": 5}]


def test_unmapped_pagination(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    page1 = _get(pg_client, page=1, page_size=2).json()["unmapped"]
    assert page1["page"] == 1
    assert page1["page_size"] == 2
    assert page1["total"] == 3  # all un-mapped, not just this page
    assert len(page1["items"]) == 2
    # ordered by (source_pid, id): NTN901, NTN902 on page 1
    assert [i["id"] for i in page1["items"]] == [seeded["un_annotated"], seeded["un_blank"]]

    page2 = _get(pg_client, page=2, page_size=2).json()["unmapped"]
    assert page2["total"] == 3
    assert [i["id"] for i in page2["items"]] == [seeded["un_null"]]


def test_unmapped_missing_location_reason(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    items = _get(pg_client, page_size=100).json()["unmapped"]["items"]
    by_id = {i["id"]: i for i in items}
    # annotated row surfaces the recorded geocode_note verbatim
    assert by_id[seeded["un_annotated"]]["missing_location_reason"] == ANNOTATED_NOTE
    # blank note collapses to None (UI renders "실패 사유 기록 없음")
    assert by_id[seeded["un_blank"]]["missing_location_reason"] is None
    # null note → None
    assert by_id[seeded["un_null"]]["missing_location_reason"] is None


def test_unmapped_region_join(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    items = _get(pg_client, page_size=100).json()["unmapped"]["items"]
    by_id = {i["id"]: i for i in items}
    # EXACT_MATCH un-mapped row carries its region assignment via the outer join
    assert by_id[seeded["un_null"]]["region_code"] == REGION_CODE
    assert by_id[seeded["un_null"]]["region_name"] == REGION_NAME
    assert by_id[seeded["un_null"]]["geocode_status"] == "FAILED"
    # review-status rows without a region assignment report None, never a code
    assert by_id[seeded["un_annotated"]]["region_code"] is None
    assert by_id[seeded["un_annotated"]]["region_name"] is None


def test_no_data_for_period(pg_client: TestClient, seeded: dict[str, Any]) -> None:
    resp = pg_client.get("/api/v1/facilities/mapping-transparency", params={"year": 2050})
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["error"] == "NO_DATA_FOR_PERIOD"
    assert 1999 in detail["available_years"]


def test_read_only_no_write(
    pg_client: TestClient, seeded: dict[str, Any], pg_session: Session
) -> None:
    before = pg_session.execute(
        text("SELECT count(*) FROM waste_treatment_facilities WHERE reference_year = 1999")
    ).scalar_one()
    _get(pg_client)
    _get(pg_client, page=2, page_size=2)
    after = pg_session.execute(
        text("SELECT count(*) FROM waste_treatment_facilities WHERE reference_year = 1999")
    ).scalar_one()
    assert before == after


def test_migration_head_is_0016(pg_session: Session) -> None:
    head = pg_session.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    assert head == "0016"
