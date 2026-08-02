"""Candidate-cell land-cover statistics API tests (Phase 1B-LC4).

Runs on the shared in-memory SQLite tier: LC3 stores no geometry, so the release,
summary, list, detail, and class-distribution endpoints are fully exercisable here.
Only the bbox filter needs candidate geometry and lives in the PostGIS tier
(``test_land_cover_cell_routes_integration.py``).

The synthetic release below is deliberately small but covers all three coverage
statuses, both share denominators, an undefined ratio, and a boundary-clipped cell
whose area is not 250,000 m².
"""

from __future__ import annotations

import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session, sessionmaker

from waste_equity_backend.models import (
    EnvironmentalDatasetVersion,
    EnvironmentalLandCoverCellClassArea,
    EnvironmentalLandCoverCellStatistic,
    EnvironmentalLandCoverCellStatVersion,
)

BASE = "/api/v1/environment/land-cover/cell-statistics"
NOW = datetime.datetime(1999, 1, 1, tzinfo=datetime.UTC)
GRID = "test-grid-500m-v1"
DERIVATION = "land-cover-cell-stats-v1"
AREA_CRS = "EPSG:5186"

# Three cells: a fully covered one, a partially covered one, and an unevaluated one.
KEY_COMPLETE = f"{GRID}:10_10"
KEY_PARTIAL = f"{GRID}:11_11"
KEY_NO_COVERAGE = f"{GRID}:12_12"

# The PARTIAL cell is boundary-clipped: 200,000 m², not the nominal 250,000 m².
COMPLETE_CELL_AREA = 250_000.0
PARTIAL_CELL_AREA = 200_000.0
PARTIAL_EVALUATED = 150_000.0
NO_COVERAGE_CELL_AREA = 250_000.0


def _dataset_version(**overrides: Any) -> EnvironmentalDatasetVersion:
    values: dict[str, Any] = {
        "id": 900,
        "layer_name": "land_cover",
        "source_id": "egis_land_cover",
        "provider": "환경부 환경공간정보서비스 EGIS (test)",
        "official_dataset_name": "세분류 [2025] 전국 토지피복지도 (test)",
        "provider_dataset_identifier": "test-land-cover-l3",
        "official_source_url": "https://egis.me.go.kr",
        "reference_period": "2025",
        "source_crs": "EPSG:5186",
        "target_crs": "EPSG:4326",
        "source_encoding": "cp949",
        "transformation_version": "land-cover-v1",
        "declared_feature_count": 1234,
        "normalized_geometry_type": "MultiPolygon",
        "source_checksum": "a" * 64,
        "license_note": "테스트 라이선스 메모 — 서면 재확인 필요",
        "is_active": True,
        "created_at": NOW,
    }
    values.update(overrides)
    return EnvironmentalDatasetVersion(**values)


def _stat_version(**overrides: Any) -> EnvironmentalLandCoverCellStatVersion:
    values: dict[str, Any] = {
        "id": 500,
        "land_cover_dataset_version_id": 900,
        "candidate_grid_version": GRID,
        "candidate_grid_fingerprint": "b" * 64,
        "derivation_version": DERIVATION,
        "area_crs": AREA_CRS,
        "input_signature": "c" * 64,
        "status": "SUCCEEDED",
        "expected_cell_count": 3,
        "processed_cell_count": 3,
        "complete_exact_count": 1,
        "partial_count": 1,
        "no_coverage_count": 1,
        "failed_cell_count": 0,
        "candidate_row_count": 6,
        "duplicate_candidate_occurrence_count": 3,
        "representation_variant_cell_count": 1,
        "total_cell_area_m2": COMPLETE_CELL_AREA + PARTIAL_CELL_AREA + NO_COVERAGE_CELL_AREA,
        "total_evaluated_area_m2": COMPLETE_CELL_AREA + PARTIAL_EVALUATED,
        "total_uncovered_area_m2": (PARTIAL_CELL_AREA - PARTIAL_EVALUATED) + NO_COVERAGE_CELL_AREA,
        "aggregate_coverage_ratio": 0.5714285714285714,
        "total_intersection_area_m2": COMPLETE_CELL_AREA + PARTIAL_EVALUATED,
        "total_overlap_area_m2": 0.0,
        "cells_with_source_overlap": 0,
        "max_overlap_area_m2": 0.0,
        "max_overlap_ratio": 0.0,
        "guard_applied_cell_count": 1,
        "max_guard_adjustment_m2": 1e-6,
        "class_row_count": 5,
        "batch_size": 500,
        "derivation_metadata": {"coverage_semantics": "test semantics"},
        "is_active": True,
        "started_at": NOW,
        "completed_at": NOW,
        "created_at": NOW,
    }
    values.update(overrides)
    return EnvironmentalLandCoverCellStatVersion(**values)


def _cell(**overrides: Any) -> EnvironmentalLandCoverCellStatistic:
    values: dict[str, Any] = {
        "statistics_version_id": 500,
        "land_cover_dataset_version_id": 900,
        "candidate_grid_version": GRID,
        "candidate_geometry_fingerprint": "d" * 64,
        "sido_region_code": "KR-SGIS-11",
        "sido_region_name": "서울특별시",
        "sigungu_region_code": "KR-SGIS-11110",
        "sigungu_region_name": "종로구",
        "intersection_area_sum_m2": 0.0,
        "overlap_area_m2": 0.0,
        "topological_cover_predicate": False,
        "matched_feature_count": 0,
        "candidate_occurrence_count": 2,
        "representation_variant_count": 0,
        "guard_applied": False,
        "derivation_version": DERIVATION,
        "area_crs": AREA_CRS,
        "created_at": NOW,
    }
    values.update(overrides)
    return EnvironmentalLandCoverCellStatistic(**values)


def _class_row(**overrides: Any) -> EnvironmentalLandCoverCellClassArea:
    values: dict[str, Any] = {
        "statistics_version_id": 500,
        "created_at": NOW,
    }
    values.update(overrides)
    return EnvironmentalLandCoverCellClassArea(**values)


@pytest.fixture
def seeded(session: Session) -> Session:
    """One active release with three cells covering all three coverage statuses."""

    session.add(_dataset_version())
    session.add(_stat_version())
    session.flush()

    complete = _cell(
        id=1,
        candidate_key=KEY_COMPLETE,
        cell_area_m2=COMPLETE_CELL_AREA,
        evaluated_area_m2=COMPLETE_CELL_AREA,
        uncovered_area_m2=0.0,
        uncovered_residual_area_m2=0.0,
        coverage_ratio=1.0,
        coverage_status="COMPLETE_EXACT",
        intersection_area_sum_m2=COMPLETE_CELL_AREA,
        matched_feature_count=4,
        dominant_l1_code="300",
        dominant_l1_name="산림지역",
        dominant_l2_code="310",
        dominant_l2_name="활엽수림",
        dominant_l3_code="311",
        dominant_l3_name="활엽수림",
        l1_class_count=2,
        l2_class_count=1,
        l3_class_count=1,
        l1_class_area_sum_m2=COMPLETE_CELL_AREA,
        l2_class_area_sum_m2=COMPLETE_CELL_AREA,
        l3_class_area_sum_m2=COMPLETE_CELL_AREA,
    )
    partial = _cell(
        id=2,
        candidate_key=KEY_PARTIAL,
        sido_region_code="KR-SGIS-31",
        sido_region_name="경기도",
        sigungu_region_code="KR-SGIS-31010",
        sigungu_region_name="수원시",
        cell_area_m2=PARTIAL_CELL_AREA,
        evaluated_area_m2=PARTIAL_EVALUATED,
        uncovered_area_m2=PARTIAL_CELL_AREA - PARTIAL_EVALUATED,
        uncovered_residual_area_m2=PARTIAL_CELL_AREA - PARTIAL_EVALUATED,
        coverage_ratio=PARTIAL_EVALUATED / PARTIAL_CELL_AREA,
        coverage_status="PARTIAL",
        intersection_area_sum_m2=PARTIAL_EVALUATED,
        matched_feature_count=2,
        dominant_l1_code="100",
        dominant_l1_name="시가화건조지역",
        dominant_l2_code="110",
        dominant_l2_name="주거지역",
        dominant_l3_code="111",
        dominant_l3_name="단독주거시설",
        l1_class_count=1,
        l2_class_count=1,
        l3_class_count=1,
        l1_class_area_sum_m2=PARTIAL_EVALUATED,
        l2_class_area_sum_m2=PARTIAL_EVALUATED,
        l3_class_area_sum_m2=PARTIAL_EVALUATED,
        guard_applied=True,
    )
    # A NO_COVERAGE cell: every dominant class is NULL, every class-area sum is 0, and
    # it has no class rows at all.
    no_coverage = _cell(
        id=3,
        candidate_key=KEY_NO_COVERAGE,
        sido_region_code="KR-SGIS-23",
        sido_region_name="인천광역시",
        sigungu_region_code="KR-SGIS-23010",
        sigungu_region_name="중구",
        cell_area_m2=NO_COVERAGE_CELL_AREA,
        evaluated_area_m2=0.0,
        uncovered_area_m2=NO_COVERAGE_CELL_AREA,
        uncovered_residual_area_m2=NO_COVERAGE_CELL_AREA,
        coverage_ratio=0.0,
        coverage_status="NO_COVERAGE",
        matched_feature_count=0,
    )
    session.add_all([complete, partial, no_coverage])
    session.flush()

    session.add_all(
        [
            # COMPLETE cell: two L1 classes that partition the evaluated area.
            _class_row(
                cell_statistics_id=1,
                candidate_key=KEY_COMPLETE,
                class_level=1,
                class_code="300",
                class_name="산림지역",
                class_area_m2=200_000.0,
                share_of_evaluated_area=0.8,
                share_of_cell_area=0.8,
            ),
            _class_row(
                cell_statistics_id=1,
                candidate_key=KEY_COMPLETE,
                class_level=1,
                class_code="400",
                class_name="초지",
                class_area_m2=50_000.0,
                share_of_evaluated_area=0.2,
                share_of_cell_area=0.2,
            ),
            _class_row(
                cell_statistics_id=1,
                candidate_key=KEY_COMPLETE,
                class_level=2,
                class_code="310",
                class_name="활엽수림",
                class_area_m2=250_000.0,
                share_of_evaluated_area=1.0,
                share_of_cell_area=1.0,
            ),
            _class_row(
                cell_statistics_id=1,
                candidate_key=KEY_COMPLETE,
                class_level=3,
                class_code="311",
                class_name="활엽수림",
                class_area_m2=250_000.0,
                share_of_evaluated_area=1.0,
                share_of_cell_area=1.0,
            ),
            # PARTIAL cell: the two denominators genuinely differ (0.75 vs 1.0).
            _class_row(
                cell_statistics_id=2,
                candidate_key=KEY_PARTIAL,
                class_level=1,
                class_code="100",
                class_name="시가화건조지역",
                class_area_m2=PARTIAL_EVALUATED,
                share_of_evaluated_area=1.0,
                share_of_cell_area=PARTIAL_EVALUATED / PARTIAL_CELL_AREA,
            ),
        ]
    )
    session.commit()
    return session


# --------------------------------------------------------------------------- #
# 1. Active release
# --------------------------------------------------------------------------- #
def test_release_returns_full_identity_and_disclosures(seeded: Session, client: TestClient) -> None:
    response = client.get(f"{BASE}/release")
    assert response.status_code == 200
    body = response.json()

    assert body["statistics_version_id"] == 500
    assert body["status"] == "SUCCEEDED"
    assert body["is_active"] is True
    assert body["derivation_version"] == DERIVATION
    assert body["area_crs"] == AREA_CRS
    assert body["candidate_grid_version"] == GRID
    assert body["candidate_grid_fingerprint"] == "b" * 64
    assert body["expected_cell_count"] == body["processed_cell_count"] == 3
    assert body["failed_cell_count"] == 0
    assert body["coverage_status_counts"] == {
        "COMPLETE_EXACT": 1,
        "PARTIAL": 1,
        "NO_COVERAGE": 1,
    }
    assert body["class_row_count"] == 5
    assert body["overlap_audit"]["cells_with_source_overlap"] == 0
    assert body["numerical_guard_audit"]["guard_applied_cell_count"] == 1
    assert body["canonicalization_audit"]["representation_variant_cell_count"] == 1
    assert "lowest (analysis_run_id, id)" in body["canonicalization_audit"]["rule"]

    source = body["source_release"]
    assert source["dataset_version_id"] == 900
    assert source["reference_period"] == "2025"
    assert source["source_crs"] == "EPSG:5186"
    assert source["storage_crs"] == "EPSG:4326"
    assert source["source_checksum"] == "a" * 64


def test_release_disclosures_state_pending_licence_and_no_scoring(
    seeded: Session, client: TestClient
) -> None:
    disclosures = client.get(f"{BASE}/release").json()["disclosures"]

    assert disclosures["reference_period"] == "2025"
    assert disclosures["license_status"] == "LOCAL_USE_ONLY_PENDING_CLARIFICATION"
    assert disclosures["used_in_suitability_scoring"] is False
    assert disclosures["lifecycle"]["scoring_integration"] == "NOT_IMPLEMENTED"
    # Phase 1B-LC5A showed these statistics in the candidate-detail panel; Phase
    # 1B-LC5B added the version-pinned vector tiles and the map-wide layer, legend and
    # filters that consume them. Both states are therefore
    # IMPLEMENTED_AND_LOCALLY_VERIFIED — "locally", because every phase so far was
    # verified against a local development database only.
    assert disclosures["lifecycle"]["frontend_exposure"] == "IMPLEMENTED_AND_LOCALLY_VERIFIED"
    assert disclosures["lifecycle"]["vector_tiles"] == "IMPLEMENTED_AND_LOCALLY_VERIFIED"
    # Local verification is NOT production availability, and scoring is untouched.
    assert disclosures["lifecycle"]["production_deployment"] == "NOT_RUN"
    assert disclosures["lifecycle"]["api_exposure"] == "IMPLEMENTED"
    # KOGL Type 1 and commercial use must never be claimed.
    statement = disclosures["license_statement"]
    assert "KOGL Type 1 is NOT claimed" in statement
    assert "commercial-use permission is NOT claimed" in statement
    # NO_COVERAGE must never be describable as empty/unused/suitable land.
    no_coverage = disclosures["coverage_status_semantics"]["NO_COVERAGE"]
    assert "does not evaluate this cell" in no_coverage
    assert "does NOT mean" in no_coverage
    assert disclosures["no_coverage_warning_ko"].startswith("‘미평가(NO_COVERAGE)’")
    assert "never a land-cover class" in disclosures["uncovered_area_statement"]


def test_release_404_when_no_active_release(session: Session, client: TestClient) -> None:
    session.add(_dataset_version())
    session.add(_stat_version(is_active=False))
    session.commit()

    response = client.get(f"{BASE}/release")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_ACTIVE_STATISTICS_RELEASE"


def test_release_409_when_multiple_active_releases(session: Session, client: TestClient) -> None:
    """Ambiguity is surfaced, never resolved by silently picking one."""

    session.add(_dataset_version())
    session.add(_stat_version(id=500))
    session.add(_stat_version(id=501, input_signature="e" * 64, candidate_grid_version="other-v1"))
    session.commit()

    response = client.get(f"{BASE}/release")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "MULTIPLE_ACTIVE_STATISTICS_RELEASES"
    assert "500" in detail["detail"] and "501" in detail["detail"]


@pytest.mark.parametrize(
    "overrides",
    [
        {"status": "RUNNING"},
        {"status": "FAILED"},
        {"processed_cell_count": 2},
        {"failed_cell_count": 1},
    ],
)
def test_release_409_when_active_release_is_not_verifiably_complete(
    session: Session, client: TestClient, overrides: dict[str, Any]
) -> None:
    """A partial, running, or failed release is never served as complete."""

    session.add(_dataset_version())
    session.add(_stat_version(**overrides))
    session.commit()

    response = client.get(f"{BASE}/release")
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "INCOMPLETE_ACTIVE_STATISTICS_RELEASE"


@pytest.mark.parametrize(
    "path",
    ["/release", "/summary", "/cells", f"/cells/{KEY_COMPLETE}", f"/cells/{KEY_COMPLETE}/classes"],
)
def test_every_endpoint_fails_honestly_without_an_active_release(
    session: Session, client: TestClient, path: str
) -> None:
    """No endpoint degrades an unavailable release into a 200 with empty data."""

    response = client.get(f"{BASE}{path}")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "NO_ACTIVE_STATISTICS_RELEASE"


# --------------------------------------------------------------------------- #
# 2. Aggregate summary
# --------------------------------------------------------------------------- #
def test_summary_overall_uses_area_weighted_ratio(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/summary").json()

    assert body["cell_count"] == 3
    assert body["coverage_status_counts"] == {
        "COMPLETE_EXACT": 1,
        "PARTIAL": 1,
        "NO_COVERAGE": 1,
    }
    total_cell = COMPLETE_CELL_AREA + PARTIAL_CELL_AREA + NO_COVERAGE_CELL_AREA
    total_evaluated = COMPLETE_CELL_AREA + PARTIAL_EVALUATED
    assert body["total_cell_area_m2"] == pytest.approx(total_cell)
    assert body["total_evaluated_area_m2"] == pytest.approx(total_evaluated)
    assert body["total_uncovered_area_m2"] == pytest.approx(total_cell - total_evaluated)
    # Area-weighted, NOT the mean of per-cell ratios (which would be 0.583…).
    assert body["aggregate_coverage_ratio"] == pytest.approx(total_evaluated / total_cell)
    mean_of_ratios = (1.0 + PARTIAL_EVALUATED / PARTIAL_CELL_AREA + 0.0) / 3
    assert body["aggregate_coverage_ratio"] != pytest.approx(mean_of_ratios)


def test_summary_reports_cells_without_dominant_class_separately(
    seeded: Session, client: TestClient
) -> None:
    """The NO_COVERAGE cell is counted, never emitted as a null-coded pseudo-class."""

    body = client.get(f"{BASE}/summary").json()

    assert body["cells_without_dominant_class"] == 1
    codes = [row["class_code"] for row in body["dominant_l1_distribution"]]
    assert codes == ["100", "300"]
    assert None not in codes
    assert all(row["class_code"] for row in body["dominant_l1_distribution"])
    assert not any(
        row["class_code"] in {"UNKNOWN", "UNCLASSIFIED", ""} for row in body["l1_area_distribution"]
    )


def test_summary_l1_area_distribution_shares_sum_to_one(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/summary").json()

    rows = {row["class_code"]: row for row in body["l1_area_distribution"]}
    assert set(rows) == {"100", "300", "400"}
    assert rows["300"]["class_name"] == "산림지역"
    assert rows["300"]["total_area_m2"] == pytest.approx(200_000.0)
    expected_total = COMPLETE_CELL_AREA + PARTIAL_EVALUATED
    assert body["total_l1_class_area_m2"] == pytest.approx(expected_total)
    assert sum(row["share_of_l1_class_area"] for row in rows.values()) == pytest.approx(1.0)


def test_summary_filtered_by_sido(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/summary", params={"sido_code": "KR-SGIS-11"}).json()

    assert body["scope"]["sido_code"] == "KR-SGIS-11"
    assert body["cell_count"] == 1
    assert body["coverage_status_counts"] == {
        "COMPLETE_EXACT": 1,
        "PARTIAL": 0,
        "NO_COVERAGE": 0,
    }
    assert body["aggregate_coverage_ratio"] == pytest.approx(1.0)
    assert {row["class_code"] for row in body["l1_area_distribution"]} == {"300", "400"}


def test_summary_filtered_by_coverage_status(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/summary", params={"coverage_status": "NO_COVERAGE"}).json()

    assert body["cell_count"] == 1
    assert body["total_evaluated_area_m2"] == pytest.approx(0.0)
    assert body["aggregate_coverage_ratio"] == pytest.approx(0.0)
    assert body["cells_without_dominant_class"] == 1
    # A NO_COVERAGE selection has no class rows, so no class distribution at all.
    assert body["dominant_l1_distribution"] == []
    assert body["l1_area_distribution"] == []
    assert body["total_l1_class_area_m2"] == pytest.approx(0.0)


def test_summary_ratio_is_null_not_zero_when_undefined(seeded: Session, client: TestClient) -> None:
    """An empty selection has an undefined ratio, which must serialize as null."""

    body = client.get(f"{BASE}/summary", params={"sido_code": "KR-SGIS-99"}).json()

    assert body["cell_count"] == 0
    assert body["total_cell_area_m2"] == pytest.approx(0.0)
    assert body["aggregate_coverage_ratio"] is None


def test_summary_rejects_invalid_coverage_status(seeded: Session, client: TestClient) -> None:
    response = client.get(f"{BASE}/summary", params={"coverage_status": "MOSTLY_COVERED"})
    assert response.status_code == 422


# --------------------------------------------------------------------------- #
# 3. Paginated cell listing
# --------------------------------------------------------------------------- #
def test_list_default_page_is_deterministic_and_bounded(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/cells").json()

    assert body["total"] == 3
    assert body["limit"] == 50
    assert body["offset"] == 0
    assert body["has_more"] is False
    assert body["sort"] == "candidate_key"
    assert [item["candidate_key"] for item in body["items"]] == [
        KEY_COMPLETE,
        KEY_PARTIAL,
        KEY_NO_COVERAGE,
    ]


def test_list_rows_always_carry_coverage_beside_dominant_class(
    seeded: Session, client: TestClient
) -> None:
    """A consumer cannot read composition off a row without its coverage context."""

    items = client.get(f"{BASE}/cells").json()["items"]

    for item in items:
        assert "coverage_status" in item
        assert "coverage_ratio" in item
        assert "uncovered_area_m2" in item
    by_key = {item["candidate_key"]: item for item in items}
    assert by_key[KEY_NO_COVERAGE]["dominant_l1_code"] is None
    assert by_key[KEY_NO_COVERAGE]["dominant_l1_name"] is None
    assert by_key[KEY_NO_COVERAGE]["coverage_status"] == "NO_COVERAGE"
    assert by_key[KEY_PARTIAL]["cell_area_m2"] == pytest.approx(PARTIAL_CELL_AREA)


def test_list_envelope_carries_metadata_once_not_per_row(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/cells").json()

    assert body["release"]["statistics_version_id"] == 500
    assert body["release"]["reference_period"] == "2025"
    assert body["disclosures"]["used_in_suitability_scoring"] is False
    for item in body["items"]:
        assert "disclosures" not in item
        assert "release" not in item


def test_list_pagination_boundaries(seeded: Session, client: TestClient) -> None:
    first = client.get(f"{BASE}/cells", params={"limit": 2, "offset": 0}).json()
    assert [i["candidate_key"] for i in first["items"]] == [KEY_COMPLETE, KEY_PARTIAL]
    assert first["has_more"] is True

    second = client.get(f"{BASE}/cells", params={"limit": 2, "offset": 2}).json()
    assert [i["candidate_key"] for i in second["items"]] == [KEY_NO_COVERAGE]
    assert second["has_more"] is False

    past_end = client.get(f"{BASE}/cells", params={"limit": 2, "offset": 99}).json()
    assert past_end["items"] == []
    assert past_end["total"] == 3
    assert past_end["has_more"] is False


@pytest.mark.parametrize("limit", [501, 1000, 0, -1])
def test_list_rejects_out_of_range_page_size(
    seeded: Session, client: TestClient, limit: int
) -> None:
    assert client.get(f"{BASE}/cells", params={"limit": limit}).status_code == 422


def test_list_max_page_size_is_accepted(seeded: Session, client: TestClient) -> None:
    response = client.get(f"{BASE}/cells", params={"limit": 500})
    assert response.status_code == 200
    assert response.json()["limit"] == 500


def test_list_rejects_negative_offset(seeded: Session, client: TestClient) -> None:
    assert client.get(f"{BASE}/cells", params={"offset": -1}).status_code == 422


@pytest.mark.parametrize(
    ("sort", "expected"),
    [
        ("candidate_key", [KEY_COMPLETE, KEY_PARTIAL, KEY_NO_COVERAGE]),
        ("-candidate_key", [KEY_NO_COVERAGE, KEY_PARTIAL, KEY_COMPLETE]),
        ("coverage_ratio", [KEY_NO_COVERAGE, KEY_PARTIAL, KEY_COMPLETE]),
        ("-coverage_ratio", [KEY_COMPLETE, KEY_PARTIAL, KEY_NO_COVERAGE]),
        ("-uncovered_area_m2", [KEY_NO_COVERAGE, KEY_PARTIAL, KEY_COMPLETE]),
    ],
)
def test_list_sort_orders_are_deterministic(
    seeded: Session, client: TestClient, sort: str, expected: list[str]
) -> None:
    body = client.get(f"{BASE}/cells", params={"sort": sort}).json()
    assert [item["candidate_key"] for item in body["items"]] == expected


def test_list_rejects_unknown_sort_key(seeded: Session, client: TestClient) -> None:
    assert client.get(f"{BASE}/cells", params={"sort": "total_score"}).status_code == 422


def test_list_coverage_status_filter(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/cells", params={"coverage_status": "PARTIAL"}).json()
    assert body["total"] == 1
    assert body["items"][0]["candidate_key"] == KEY_PARTIAL
    assert body["applied_filters"]["coverage_status"] == "PARTIAL"


def test_list_dominant_l1_filter(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/cells", params={"dominant_l1_code": "300"}).json()
    assert body["total"] == 1
    assert body["items"][0]["candidate_key"] == KEY_COMPLETE

    unknown = client.get(f"{BASE}/cells", params={"dominant_l1_code": "999"}).json()
    assert unknown["total"] == 0
    assert unknown["items"] == []


def test_list_region_filters(seeded: Session, client: TestClient) -> None:
    assert client.get(f"{BASE}/cells", params={"sido_code": "KR-SGIS-31"}).json()["total"] == 1
    body = client.get(f"{BASE}/cells", params={"sigungu_code": "KR-SGIS-11110"}).json()
    assert body["total"] == 1
    assert body["items"][0]["candidate_key"] == KEY_COMPLETE


def test_list_coverage_ratio_range_filter(seeded: Session, client: TestClient) -> None:
    body = client.get(
        f"{BASE}/cells", params={"min_coverage_ratio": 0.5, "max_coverage_ratio": 0.9}
    ).json()
    assert [item["candidate_key"] for item in body["items"]] == [KEY_PARTIAL]


def test_list_rejects_inverted_coverage_ratio_range(seeded: Session, client: TestClient) -> None:
    response = client.get(
        f"{BASE}/cells", params={"min_coverage_ratio": 0.9, "max_coverage_ratio": 0.1}
    )
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "INVALID_COVERAGE_RATIO_RANGE"


@pytest.mark.parametrize("ratio", [-0.1, 1.1])
def test_list_rejects_out_of_range_coverage_ratio(
    seeded: Session, client: TestClient, ratio: float
) -> None:
    assert client.get(f"{BASE}/cells", params={"min_coverage_ratio": ratio}).status_code == 422


@pytest.mark.parametrize(
    ("bbox", "reason"),
    [
        ("1,2,3", "too few parts"),
        ("1,2,3,4,5", "too many parts"),
        ("a,b,c,d", "non-numeric"),
        ("10,10,5,20", "reversed longitude"),
        ("10,20,20,10", "reversed latitude"),
        ("10,10,10,20", "degenerate longitude"),
        ("-181,10,-179,20", "longitude below range"),
        ("179,10,181,20", "longitude above range"),
        ("10,-91,20,-89", "latitude below range"),
        ("10,89,20,91", "latitude above range"),
        ("nan,10,20,20", "not finite"),
        ("-inf,10,20,20", "infinite"),
    ],
)
def test_list_rejects_malformed_bbox(
    seeded: Session, client: TestClient, bbox: str, reason: str
) -> None:
    response = client.get(f"{BASE}/cells", params={"bbox": bbox})
    assert response.status_code == 422, reason
    assert response.json()["detail"]["error"] == "INVALID_BBOX"


# --------------------------------------------------------------------------- #
# 4. Candidate-cell detail
# --------------------------------------------------------------------------- #
def test_detail_complete_exact_cell(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/cells/{KEY_COMPLETE}").json()

    assert body["candidate_key"] == KEY_COMPLETE
    assert body["candidate_grid_version"] == GRID
    assert body["candidate_geometry_fingerprint"] == "d" * 64
    assert body["coverage_status"] == "COMPLETE_EXACT"
    assert "exact set-theoretic emptiness" in body["coverage_status_meaning"]
    assert body["cell_area_m2"] == pytest.approx(COMPLETE_CELL_AREA)
    assert body["evaluated_area_m2"] == pytest.approx(COMPLETE_CELL_AREA)
    assert body["uncovered_area_m2"] == pytest.approx(0.0)
    assert body["uncovered_residual_area_m2"] == pytest.approx(0.0)
    assert body["coverage_ratio"] == pytest.approx(1.0)
    # The ST_Covers evidence field is exposed separately from the status rule.
    assert body["topological_cover_predicate"] is False
    assert body["dominant_class"]["l1_code"] == "300"
    assert body["dominant_class"]["l3_name"] == "활엽수림"
    assert body["class_counts"]["l1_class_count"] == 2
    assert body["candidate_occurrence_count"] == 2
    assert body["used_in_suitability_scoring"] is False
    assert body["area_crs"] == AREA_CRS
    assert body["derivation_version"] == DERIVATION


def test_detail_coverage_fields_reconcile(seeded: Session, client: TestClient) -> None:
    for key in (KEY_COMPLETE, KEY_PARTIAL, KEY_NO_COVERAGE):
        body = client.get(f"{BASE}/cells/{key}").json()
        assert body["cell_area_m2"] == pytest.approx(
            body["evaluated_area_m2"] + body["uncovered_area_m2"]
        )
        assert body["coverage_ratio"] == pytest.approx(
            body["evaluated_area_m2"] / body["cell_area_m2"]
        )
        assert body["uncovered_residual_area_m2"] == pytest.approx(body["uncovered_area_m2"])


def test_detail_partial_cell_is_clipped_and_not_promoted(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/cells/{KEY_PARTIAL}").json()

    assert body["coverage_status"] == "PARTIAL"
    assert "non-empty uncovered residual" in body["coverage_status_meaning"]
    # Boundary-clipped: the measured area is genuinely not 250,000 m².
    assert body["cell_area_m2"] == pytest.approx(PARTIAL_CELL_AREA)
    assert body["cell_area_m2"] != pytest.approx(250_000.0)
    assert body["guard_applied"] is True


def test_detail_no_coverage_cell_has_null_dominant_class(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/cells/{KEY_NO_COVERAGE}").json()

    assert body["coverage_status"] == "NO_COVERAGE"
    assert body["matched_feature_count"] == 0
    assert body["evaluated_area_m2"] == pytest.approx(0.0)
    assert body["uncovered_area_m2"] == pytest.approx(NO_COVERAGE_CELL_AREA)
    # Undefined dominant class is null at every level, never an invented code.
    assert body["dominant_class"] == {
        "l1_code": None,
        "l1_name": None,
        "l2_code": None,
        "l2_name": None,
        "l3_code": None,
        "l3_name": None,
    }
    assert body["class_counts"]["l1_class_count"] == 0
    meaning = body["coverage_status_meaning"]
    assert "does not evaluate this cell" in meaning
    assert "does NOT mean" in meaning


def test_detail_exposes_no_land_cover_feature_geometry(seeded: Session, client: TestClient) -> None:
    """Neither raw feature geometry nor a duplicated candidate geometry is returned.

    ``candidate_geometry_fingerprint`` is a sha-256 digest, not geometry: it identifies
    which geometry the areas were measured on without reproducing any coordinate.
    """

    body = client.get(f"{BASE}/cells/{KEY_COMPLETE}").json()

    for forbidden in ("geometry", "geojson", "centroid", "wkb", "wkt", "coordinates", "bbox"):
        assert forbidden not in body
    # The only geometry-adjacent field is the digest, and it is a 64-hex-char string.
    fingerprint = body["candidate_geometry_fingerprint"]
    assert isinstance(fingerprint, str)
    assert len(fingerprint) == 64

    # No nested value anywhere in the response is a GeoJSON object.
    def _assert_no_geojson(value: object) -> None:
        if isinstance(value, dict):
            assert "coordinates" not in value
            assert value.get("type") not in {
                "Polygon",
                "MultiPolygon",
                "Point",
                "Feature",
                "FeatureCollection",
            }
            for nested in value.values():
                _assert_no_geojson(nested)
        elif isinstance(value, list):
            for nested in value:
                _assert_no_geojson(nested)

    _assert_no_geojson(body)


def test_detail_404_for_unknown_candidate_key(seeded: Session, client: TestClient) -> None:
    response = client.get(f"{BASE}/cells/{GRID}:999_999")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "CANDIDATE_CELL_NOT_FOUND"
    # No SQL, path, or internal identifier leaks.
    assert "SELECT" not in detail["detail"].upper()
    assert "/Users" not in detail["detail"]


def test_detail_404_distinguishes_a_key_from_another_grid_version(
    seeded: Session, client: TestClient
) -> None:
    """A key that exists only outside the active release gets its own error code."""

    other_key = "other-grid-v1:5_5"
    seeded.add(
        _cell(
            id=99,
            statistics_version_id=501,
            candidate_grid_version="other-grid-v1",
            candidate_key=other_key,
            cell_area_m2=250_000.0,
            evaluated_area_m2=250_000.0,
            uncovered_area_m2=0.0,
            uncovered_residual_area_m2=0.0,
            coverage_ratio=1.0,
            coverage_status="COMPLETE_EXACT",
        )
    )
    seeded.commit()

    response = client.get(f"{BASE}/cells/{other_key}")
    assert response.status_code == 404
    detail = response.json()["detail"]
    assert detail["error"] == "CANDIDATE_KEY_NOT_IN_ACTIVE_RELEASE"
    assert "other-grid-v1" in detail["detail"]


def test_detail_rejects_oversized_candidate_key(seeded: Session, client: TestClient) -> None:
    assert client.get(f"{BASE}/cells/{'x' * 51}").status_code == 422


# --------------------------------------------------------------------------- #
# 5. Candidate-cell class distribution
# --------------------------------------------------------------------------- #
def test_classes_returns_all_three_levels_in_deterministic_order(
    seeded: Session, client: TestClient
) -> None:
    body = client.get(f"{BASE}/cells/{KEY_COMPLETE}/classes").json()

    assert body["total"] == 4
    assert body["class_level_filter"] is None
    # level ascending, then area descending, then code ascending.
    assert [(row["class_level"], row["class_code"]) for row in body["items"]] == [
        (1, "300"),
        (1, "400"),
        (2, "310"),
        (3, "311"),
    ]
    assert body["coverage_status"] == "COMPLETE_EXACT"
    assert body["used_in_suitability_scoring"] is False


def test_classes_preserve_official_korean_labels_verbatim(
    seeded: Session, client: TestClient
) -> None:
    rows = client.get(f"{BASE}/cells/{KEY_COMPLETE}/classes").json()["items"]
    labels = {(row["class_level"], row["class_code"]): row["class_name"] for row in rows}

    assert labels[(1, "300")] == "산림지역"
    assert labels[(1, "400")] == "초지"
    assert labels[(2, "310")] == "활엽수림"


def test_classes_expose_both_share_denominators(seeded: Session, client: TestClient) -> None:
    """The evaluated-area and cell-area denominators genuinely differ on a PARTIAL cell."""

    body = client.get(f"{BASE}/cells/{KEY_PARTIAL}/classes").json()
    row = body["items"][0]

    assert row["class_area_m2"] == pytest.approx(PARTIAL_EVALUATED)
    assert row["share_of_evaluated_area"] == pytest.approx(1.0)
    assert row["share_of_cell_area"] == pytest.approx(PARTIAL_EVALUATED / PARTIAL_CELL_AREA)
    assert row["share_of_evaluated_area"] != pytest.approx(row["share_of_cell_area"])
    # The class share reconciles against the stored per-level sum.
    assert row["class_area_m2"] == pytest.approx(body["class_counts"]["l1_class_area_sum_m2"])


def test_classes_shares_reconcile_within_each_level(seeded: Session, client: TestClient) -> None:
    body = client.get(f"{BASE}/cells/{KEY_COMPLETE}/classes").json()

    for level in (1, 2, 3):
        rows = [row for row in body["items"] if row["class_level"] == level]
        assert sum(row["share_of_evaluated_area"] for row in rows) == pytest.approx(1.0)
        assert sum(row["class_area_m2"] for row in rows) == pytest.approx(body["evaluated_area_m2"])


def test_classes_no_coverage_cell_returns_empty_list_not_a_pseudo_class(
    seeded: Session, client: TestClient
) -> None:
    """Uncovered area is never modelled as an UNKNOWN/UNCLASSIFIED land-cover class."""

    body = client.get(f"{BASE}/cells/{KEY_NO_COVERAGE}/classes").json()

    assert body["items"] == []
    assert body["total"] == 0
    assert body["coverage_status"] == "NO_COVERAGE"
    # The uncovered area is still reported — as a coverage field on the cell.
    assert body["uncovered_area_m2"] == pytest.approx(NO_COVERAGE_CELL_AREA)
    assert body["evaluated_area_m2"] == pytest.approx(0.0)
    assert body["class_counts"]["l1_class_area_sum_m2"] == pytest.approx(0.0)


@pytest.mark.parametrize(("level", "expected"), [(1, ["300", "400"]), (2, ["310"]), (3, ["311"])])
def test_classes_level_filter(
    seeded: Session, client: TestClient, level: int, expected: list[str]
) -> None:
    body = client.get(f"{BASE}/cells/{KEY_COMPLETE}/classes", params={"class_level": level}).json()

    assert body["class_level_filter"] == level
    assert [row["class_code"] for row in body["items"]] == expected
    assert all(row["class_level"] == level for row in body["items"])


@pytest.mark.parametrize("level", [0, 4, -1, "L1"])
def test_classes_rejects_invalid_class_level(
    seeded: Session, client: TestClient, level: object
) -> None:
    response = client.get(
        f"{BASE}/cells/{KEY_COMPLETE}/classes", params={"class_level": str(level)}
    )
    assert response.status_code == 422


def test_classes_404_for_unknown_candidate_key(seeded: Session, client: TestClient) -> None:
    response = client.get(f"{BASE}/cells/{GRID}:999_999/classes")
    assert response.status_code == 404
    assert response.json()["detail"]["error"] == "CANDIDATE_CELL_NOT_FOUND"


# --------------------------------------------------------------------------- #
# Cross-cutting contract
# --------------------------------------------------------------------------- #
def test_routes_are_registered_under_the_environment_namespace() -> None:
    """The router lives in its own namespace and never shadows a suitability route."""

    from waste_equity_backend.api.app import create_app

    paths = set(create_app().openapi()["paths"])
    expected = {
        f"{BASE}/release",
        f"{BASE}/summary",
        f"{BASE}/cells",
        BASE + "/cells/{candidate_key}",
        BASE + "/cells/{candidate_key}/classes",
    }
    assert expected <= paths
    assert not any(
        path.startswith("/api/v1/suitability") and "land-cover" in path for path in paths
    )


def test_all_endpoints_are_read_only_get_verbs() -> None:
    from waste_equity_backend.api.app import create_app

    spec = create_app().openapi()["paths"]
    for path, operations in spec.items():
        if path.startswith(BASE):
            assert set(operations) == {"get"}, path


def test_no_endpoint_mutates_the_database(
    seeded: Session, client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    """Every endpoint leaves the statistics, class, and version rows untouched."""

    def snapshot() -> tuple[int, int, int]:
        with session_factory() as check:
            return (
                len(check.query(EnvironmentalLandCoverCellStatVersion).all()),
                len(check.query(EnvironmentalLandCoverCellStatistic).all()),
                len(check.query(EnvironmentalLandCoverCellClassArea).all()),
            )

    before = snapshot()
    for path in (
        "/release",
        "/summary",
        "/summary?sido_code=KR-SGIS-11",
        "/cells",
        "/cells?coverage_status=PARTIAL",
        f"/cells/{KEY_COMPLETE}",
        f"/cells/{KEY_NO_COVERAGE}",
        f"/cells/{KEY_COMPLETE}/classes",
        f"/cells/{KEY_COMPLETE}/classes?class_level=1",
    ):
        assert client.get(f"{BASE}{path}").status_code == 200
    assert snapshot() == before
