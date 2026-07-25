"""Inland-wetland API integration tests against real PostGIS (Phase 1B-2).

Runs only when TEST_DATABASE_URL is set. A synthetic dataset version + three
wetland features are seeded with remote-ocean geometry inside a rolled-back outer
transaction, so the real 2,704-feature inventory (and everything else) is never
touched. The synthetic version is the most-recent active release, so the metadata
and list endpoints resolve to it deterministically.
"""

from __future__ import annotations

import datetime
import json
import math
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
from waste_equity_backend.models import (
    EnvironmentalDatasetVersion,
    EnvironmentalWetlandInventoryFeature,
    IngestionRun,
)

TEST_DATABASE_URL = os.getenv("TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(not TEST_DATABASE_URL, reason="TEST_DATABASE_URL is not configured")

NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
REF_DATE = datetime.date(2022, 7, 20)
PROVIDER = "국립생태원 (National Institute of Ecology)"
MVT_CONTENT_TYPE = "application/vnd.mapbox-vector-tile"
IMMUTABLE_CACHE = "public, max-age=31536000, immutable"
WETLANDS = "/api/v1/environment/wetlands"

# The seeded features sit around lon 20.0-20.7, lat 20.0-20.1 (remote ocean); a
# broad z3 tile envelops the whole cluster and never any real Korea feature.
_CLUSTER_LON, _CLUSTER_LAT = 20.35, 20.05


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


def _poly(x: float) -> WKTElement:
    return WKTElement(
        f"MULTIPOLYGON((({x} 20, {x + 0.1} 20, {x + 0.1} 20.1, {x} 20.1, {x} 20)))", srid=4326
    )


def _feature(
    version_id: int, i: int, x: float, **over: Any
) -> EnvironmentalWetlandInventoryFeature:
    base: dict[str, Any] = {
        "dataset_version_id": version_id,
        "source_feature_id": f"TEST-{i:04d}",
        "source_fid": i,
        "wetland_name": f"테스트 습지 {i}",
        "wetland_code": f"TEST-{i:04d}",
        "wetland_type": "하천습지",
        "wetland_type_korea": "L2",
        "wetland_type_ramsar": "Q",
        "reported_area_m2": 1000 * i,
        "source_longitude": x + 0.05,
        "source_latitude": 20.05,
        "source_address": "테스트 주소",
        "source_sido_name": "서울특별시",
        "source_sigungu_name": "종로구",
        "source_eupmyeondong_name": "청운동",
        "source_ri_name": None,
        "designation_note": None,
        "normalized_sido_code": "11",
        "normalized_sigungu_code": "11110",
        "geometry": _poly(x),
        "geometry_area_m2": 1234.5 * i,
        "source_crs": "EPSG:5186",
        "transformation_version": "wetland-inventory-v1",
        "source_reference_date": REF_DATE,
        "source_checksum": "deadbeef" * 8,
        "feature_fingerprint": f"fp-test-{i:03d}",
        "raw_attributes": {"CODE": f"TEST-{i:04d}", "AREA": 1000 * i, "EXP": None},
        "created_at": NOW,
    }
    base.update(over)
    return EnvironmentalWetlandInventoryFeature(**base)


@pytest.fixture
def seeded(pg_session: Session) -> dict[str, int]:
    run = IngestionRun(
        source_id="nie_wetland_inventory",
        started_at=NOW,
        completed_at=NOW,
        status="SUCCEEDED",
        rows_received=3,
        rows_inserted=3,
        rows_updated=0,
        rows_rejected=0,
        reference_period="2022-07-20",
        transformation_version="wetland-inventory-v1",
    )
    pg_session.add(run)
    pg_session.flush()
    version = EnvironmentalDatasetVersion(
        layer_name="wetland_inventory",
        source_id="nie_wetland_inventory",
        provider=PROVIDER,
        official_dataset_name="국립생태원_내륙습지 공간데이터 및 속성정보",
        provider_dataset_identifier="TEST-1B2-IDENTIFIER",
        official_source_url="https://www.data.go.kr/data/15086410/fileData.do",
        reference_period=REF_DATE.isoformat(),
        reference_date=REF_DATE,
        source_checksum="testchecksum-1b2",
        source_crs="EPSG:5186",
        target_crs="EPSG:4326",
        source_encoding="UTF-8",
        source_geometry_type="MultiPolygon/Polygon",
        normalized_geometry_type="MultiPolygon",
        declared_feature_count=2704,
        total_feature_count=3,
        accepted_feature_count=3,
        rejected_feature_count=0,
        transformation_version="wetland-inventory-v1",
        license_note="이용허락범위 제한 없음 (공공데이터포털, 확인일 2026-07-23)",
        ingestion_run_id=run.run_id,
        is_active=True,
        created_at=NOW,
    )
    pg_session.add(version)
    pg_session.flush()
    f1 = _feature(
        version.id,
        1,
        20.0,
        wetland_type="하천습지",
        designation_note="습지보호지역(환경부지정)",
        wetland_name="테스트 하천습지",
    )
    f2 = _feature(
        version.id,
        2,
        20.3,
        wetland_type="호수습지",
        normalized_sido_code="28",
        normalized_sigungu_code="28710",
        wetland_name="테스트 호수습지",
    )
    f3 = _feature(
        version.id,
        3,
        20.6,
        wetland_type="산지습지",
        normalized_sido_code=None,
        normalized_sigungu_code=None,
        source_sido_name="강원도",
        wetland_name="테스트 산지습지",
    )
    pg_session.add_all([f1, f2, f3])
    pg_session.flush()
    return {"version": version.id, "run": run.run_id, "f1": f1.id, "f2": f2.id, "f3": f3.id}


def _deg2tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return x, y


# --- Metadata ----------------------------------------------------------------


def test_metadata_provider_reference_served_and_lifecycle(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"{WETLANDS}/metadata").json()
    assert body["layer_name"] == "wetland_inventory"
    assert body["korean_label"] == "내륙습지 목록"
    assert body["provider"] == PROVIDER
    assert body["reference_date"] == "2022-07-20"
    assert body["source_crs"] == "EPSG:5186"
    assert body["storage_crs"] == "EPSG:4326"
    # declared (provider) vs served (live count) are kept distinct.
    assert body["declared_feature_count"] == 2704
    assert body["served_feature_count"] == 3
    assert body["geometry_type"] == "MultiPolygon"
    life = body["lifecycle"]
    assert life["contract_verification"] == "LIVE_VERIFIED"
    assert life["database_ingestion"] == "IMPLEMENTED_AND_LOCALLY_VERIFIED"
    assert life["api_exposure"] == "IMPLEMENTED"
    assert life["scoring_integration"] == "NOT_IMPLEMENTED"
    assert life["production_deployment"] == "NOT_RUN"


def test_metadata_um901_distinction_and_last_ingestion(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"{WETLANDS}/metadata").json()
    assert "법정 습지보호지역을 의미하지 않습니다" in body["statutory_status_statement"]
    assert "UM901" in body["um901_distinction_statement"]
    assert body["last_ingestion"]["run_id"] == seeded["run"]
    assert body["last_ingestion"]["status"] == "SUCCEEDED"
    assert body["last_ingestion"]["rows_inserted"] == 3
    # No legal-protection boolean / score field leaks into the metadata.
    blob = json.dumps(body, ensure_ascii=False).lower()
    for banned in ("is_protected", '"protected"', "exclusion", '"score"', "eligibility"):
        assert banned not in blob


# --- List / query ------------------------------------------------------------


def test_list_pagination_and_has_more(pg_client: TestClient, seeded: dict[str, int]) -> None:
    page1 = pg_client.get(f"{WETLANDS}?limit=2&offset=0").json()
    assert page1["total"] == 3
    assert page1["limit"] == 2
    assert page1["offset"] == 0
    assert len(page1["items"]) == 2
    assert page1["has_more"] is True
    page2 = pg_client.get(f"{WETLANDS}?limit=2&offset=2").json()
    assert len(page2["items"]) == 1
    assert page2["has_more"] is False


def test_list_max_limit_enforced(pg_client: TestClient, seeded: dict[str, int]) -> None:
    over = pg_client.get(f"{WETLANDS}?limit=201")
    assert over.status_code == 422
    at_max = pg_client.get(f"{WETLANDS}?limit=200")
    assert at_max.status_code == 200


def test_list_offset_must_be_non_negative(pg_client: TestClient, seeded: dict[str, int]) -> None:
    assert pg_client.get(f"{WETLANDS}?offset=-1").status_code == 422


def test_list_summary_never_carries_raw_attributes(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"{WETLANDS}?limit=3").json()
    for item in body["items"]:
        assert "raw_attributes" not in item
        assert "source_attributes" not in item
        assert "geometry" not in item  # geometry never travels in the list


def test_list_wetland_type_filter(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"{WETLANDS}", params={"wetland_type": "호수습지"}).json()
    assert body["total"] == 1
    assert body["items"][0]["wetland_type"] == "호수습지"
    assert body["items"][0]["wetland_name"] == "테스트 호수습지"


def test_list_designation_only_filter(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"{WETLANDS}", params={"designation_only": "true"}).json()
    assert body["total"] == 1
    assert body["items"][0]["designation_note"] == "습지보호지역(환경부지정)"


def test_list_sido_and_source_name_filters(pg_client: TestClient, seeded: dict[str, int]) -> None:
    by_sido = pg_client.get(f"{WETLANDS}", params={"sido_code": "28"}).json()
    assert by_sido["total"] == 1
    assert by_sido["items"][0]["normalized_sido_code"] == "28"
    by_source = pg_client.get(f"{WETLANDS}", params={"source_sido_name": "강원도"}).json()
    assert by_source["total"] == 1
    assert by_source["items"][0]["source_sido_name"] == "강원도"


def test_list_q_search_by_name_and_code(pg_client: TestClient, seeded: dict[str, int]) -> None:
    by_name = pg_client.get(f"{WETLANDS}", params={"q": "산지"}).json()
    assert by_name["total"] == 1
    assert by_name["items"][0]["wetland_name"] == "테스트 산지습지"
    by_code = pg_client.get(f"{WETLANDS}", params={"q": "TEST-0002"}).json()
    assert by_code["total"] == 1
    assert by_code["items"][0]["wetland_code"] == "TEST-0002"


def test_list_q_wildcards_are_escaped(pg_client: TestClient, seeded: dict[str, int]) -> None:
    # A literal % must not act as a wildcard: no seeded name contains it.
    body = pg_client.get(f"{WETLANDS}", params={"q": "%"}).json()
    assert body["total"] == 0


def test_list_bbox_filter_and_validation(pg_client: TestClient, seeded: dict[str, int]) -> None:
    # bbox around f1 only (lon ~20.0-20.1).
    around_f1 = pg_client.get(f"{WETLANDS}", params={"bbox": "19.95,19.95,20.15,20.2"}).json()
    assert around_f1["total"] == 1
    assert around_f1["items"][0]["id"] == seeded["f1"]
    # Out-of-range longitude -> 422.
    bad = pg_client.get(f"{WETLANDS}", params={"bbox": "0,0,300,10"})
    assert bad.status_code == 422
    assert bad.json()["detail"]["error"] == "INVALID_BBOX"


def test_list_deterministic_sort(pg_client: TestClient, seeded: dict[str, int]) -> None:
    asc = pg_client.get(f"{WETLANDS}", params={"sort": "reported_area_m2"}).json()
    areas = [i["reported_area_m2"] for i in asc["items"]]
    assert areas == sorted(areas)
    desc = pg_client.get(f"{WETLANDS}", params={"sort": "-reported_area_m2"}).json()
    areas_desc = [i["reported_area_m2"] for i in desc["items"]]
    assert areas_desc == sorted(areas_desc, reverse=True)


def test_list_rejects_unknown_sort_field(pg_client: TestClient, seeded: dict[str, int]) -> None:
    assert pg_client.get(f"{WETLANDS}", params={"sort": "drop table"}).status_code == 422


def test_list_empty_result_is_well_formed(pg_client: TestClient, seeded: dict[str, int]) -> None:
    body = pg_client.get(f"{WETLANDS}", params={"wetland_type": "존재하지않는유형"}).json()
    assert body["total"] == 0
    assert body["items"] == []
    assert body["has_more"] is False


# --- Detail ------------------------------------------------------------------


def test_detail_valid_feature_provenance_and_disclaimer(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    body = pg_client.get(f"{WETLANDS}/{seeded['f1']}").json()
    assert body["id"] == seeded["f1"]
    assert body["wetland_name"] == "테스트 하천습지"
    assert body["geometry"]["type"] == "MultiPolygon"
    assert body["provenance"]["provider"] == PROVIDER
    assert body["provenance"]["source_crs"] == "EPSG:5186"
    assert body["provenance"]["storage_crs"] == "EPSG:4326"
    assert "법정 습지보호지역을 뜻하지 않습니다" in body["statutory_status_statement"]
    assert "UM901" in body["um901_distinction_statement"]
    # designation note present, clearly labelled as source text.
    assert body["designation_note"] == "습지보호지역(환경부지정)"
    assert body["designation_note_label"] == "원자료 지정 메모"


def test_detail_raw_attributes_opt_in_only(pg_client: TestClient, seeded: dict[str, int]) -> None:
    default = pg_client.get(f"{WETLANDS}/{seeded['f1']}").json()
    assert default["source_attributes"] is None
    with_raw = pg_client.get(
        f"{WETLANDS}/{seeded['f1']}", params={"include_raw_attributes": "true"}
    ).json()
    assert with_raw["source_attributes"] is not None
    assert with_raw["source_attributes"]["CODE"] == "TEST-0001"


def test_detail_missing_feature_404(pg_client: TestClient, seeded: dict[str, int]) -> None:
    resp = pg_client.get(f"{WETLANDS}/999999999")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error"] == "WETLAND_FEATURE_NOT_FOUND"


# --- Tiles -------------------------------------------------------------------


def test_tile_returns_nonempty_mvt_with_cache_headers(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    resp = pg_client.get(f"{WETLANDS}/tiles/{z}/{x}/{y}.mvt")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == MVT_CONTENT_TYPE
    assert resp.headers["cache-control"] == IMMUTABLE_CACHE
    assert resp.headers["etag"]
    assert len(resp.content) > 0


def test_tile_empty_outside_cluster_is_valid_200(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    z = 3
    x, y = _deg2tile(-120.0, 10.0, z)  # nowhere near the seeded cluster
    resp = pg_client.get(f"{WETLANDS}/tiles/{z}/{x}/{y}.mvt")
    assert resp.status_code == 200
    assert resp.content == b""


def test_tile_invalid_coordinate_422(pg_client: TestClient, seeded: dict[str, int]) -> None:
    resp = pg_client.get(f"{WETLANDS}/tiles/2/99/0.mvt")
    assert resp.status_code == 422
    assert resp.json()["detail"]["error"] == "INVALID_TILE_COORDINATE"


def test_tile_conditional_request_304(pg_client: TestClient, seeded: dict[str, int]) -> None:
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    url = f"{WETLANDS}/tiles/{z}/{x}/{y}.mvt"
    first = pg_client.get(url)
    etag = first.headers["etag"]
    second = pg_client.get(url, headers={"If-None-Match": etag})
    assert second.status_code == 304


def test_tile_layer_name_and_light_properties(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    mvt = pytest.importorskip("mapbox_vector_tile")
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    resp = pg_client.get(f"{WETLANDS}/tiles/{z}/{x}/{y}.mvt")
    decoded = mvt.decode(resp.content)
    assert "wetlands" in decoded  # the source-layer name the frontend binds to
    feats = decoded["wetlands"]["features"]
    props = feats[0]["properties"]
    # Only the light attribute set travels in the tile.
    allowed = {
        "id",
        "wetland_code",
        "wetland_name",
        "wetland_type",
        "reported_area_m2",
        "designation_note",
        "normalized_sido_code",
        "normalized_sigungu_code",
    }
    assert set(props) <= allowed
    # Heavy / provenance fields never travel in a tile.
    for banned in ("raw_attributes", "source_attributes", "geometry_area_m2", "source_checksum"):
        assert banned not in props


# --- UM901 / suitability separation and no-write guarantees ------------------


def test_endpoints_do_not_mutate_um901_or_wetland_or_candidate_counts(
    pg_client: TestClient, pg_session: Session, seeded: dict[str, int]
) -> None:
    """Exercising every read endpoint changes no UM901, structural, wetland, or
    candidate row count (all handlers are read-only)."""

    def counts() -> dict[str, int]:
        return {
            "um901": pg_session.execute(
                text(
                    "SELECT count(*) FROM structural_protected_features "
                    "WHERE official_layer_code = 'UM901'"
                )
            ).scalar_one(),
            "protected_total": pg_session.execute(
                text("SELECT count(*) FROM structural_protected_features")
            ).scalar_one(),
            "candidates": pg_session.execute(
                text("SELECT count(*) FROM suitability_candidates")
            ).scalar_one(),
        }

    before = counts()
    z = 3
    x, y = _deg2tile(_CLUSTER_LON, _CLUSTER_LAT, z)
    pg_client.get(f"{WETLANDS}/metadata")
    pg_client.get(f"{WETLANDS}?limit=3")
    pg_client.get(f"{WETLANDS}/{seeded['f1']}")
    pg_client.get(f"{WETLANDS}/tiles/{z}/{x}/{y}.mvt")
    after = counts()
    assert before == after


def test_no_score_or_legal_field_anywhere_in_responses(
    pg_client: TestClient, seeded: dict[str, int]
) -> None:
    blobs = [
        pg_client.get(f"{WETLANDS}/metadata").text,
        pg_client.get(f"{WETLANDS}?limit=3").text,
        pg_client.get(f"{WETLANDS}/{seeded['f1']}").text,
    ]
    for blob in blobs:
        lower = blob.lower()
        # No inferred legal/score/exclusion status is ever emitted for the inventory.
        for banned in ("is_protected", "hard_exclusion", "suitability_score", "legally_eligible"):
            assert banned not in lower
