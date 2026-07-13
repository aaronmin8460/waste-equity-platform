"""Deterministic RCIS->SGIS region crosswalk tests.

Region names are public administrative facts. These fixtures are synthetic
region sets; no official RCIS data values are represented.
"""

from __future__ import annotations

import datetime

from waste_equity_ingestion.rcis_region_crosswalk import (
    AMBIGUOUS,
    COARSER_REPORTING_GEOGRAPHY,
    EXACT_MATCH,
    OUT_OF_SCOPE,
    UNMATCHED,
    RegionCrosswalk,
    SgisRegion,
)

VALID_FROM = datetime.date(2024, 1, 1)


def _region(region_id: int, code: str, name: str, level: str, parent: str | None) -> SgisRegion:
    return SgisRegion(
        region_id=region_id,
        region_code=code,
        region_name=name,
        region_level=level,
        valid_from=VALID_FROM,
        parent_region_code=parent,
    )


def _capital_region_regions() -> list[SgisRegion]:
    return [
        _region(1, "KR-SGIS-11", "서울특별시", "SIDO", None),
        _region(2, "KR-SGIS-23", "인천광역시", "SIDO", None),
        _region(3, "KR-SGIS-31", "경기도", "SIDO", None),
        # Seoul autonomous districts
        _region(11, "KR-SGIS-11010", "서울특별시 종로구", "SIGUNGU", "KR-SGIS-11"),
        _region(12, "KR-SGIS-11020", "서울특별시 중구", "SIGUNGU", "KR-SGIS-11"),
        # Incheon 2024 structure (미추홀구, not the 2026 reorganization)
        _region(23, "KR-SGIS-23090", "인천광역시 미추홀구", "SIGUNGU", "KR-SGIS-23"),
        _region(24, "KR-SGIS-23010", "인천광역시 중구", "SIGUNGU", "KR-SGIS-23"),
        _region(25, "KR-SGIS-23510", "인천광역시 강화군", "SIGUNGU", "KR-SGIS-23"),
        # Gyeonggi single-name city (direct 1:1)
        _region(31, "KR-SGIS-31110", "경기도 과천시", "SIGUNGU", "KR-SGIS-31"),
        # Gyeonggi multi-district city 수원시 -> districts
        _region(32, "KR-SGIS-31012", "경기도 수원시 권선구", "SIGUNGU", "KR-SGIS-31"),
        _region(33, "KR-SGIS-31014", "경기도 수원시 영통구", "SIGUNGU", "KR-SGIS-31"),
    ]


def _crosswalk() -> RegionCrosswalk:
    return RegionCrosswalk(_capital_region_regions())


def test_seoul_district_exact_match() -> None:
    resolution = _crosswalk().resolve("서울특별시", "종로구")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-11010"


def test_seoul_short_sido_alias_matches() -> None:
    # RCIS may use the short sido form "서울".
    resolution = _crosswalk().resolve("서울", "종로구")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-11010"


def test_incheon_2024_michuhol_exact_match() -> None:
    resolution = _crosswalk().resolve("인천", "미추홀구")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-23090"


def test_incheon_2026_only_district_is_unmatched() -> None:
    # 제물포구 is a 2026 Incheon district; it must not force onto 2024 data.
    resolution = _crosswalk().resolve("인천", "제물포구")
    assert resolution.status == UNMATCHED


def test_same_bare_name_different_sido_disambiguates() -> None:
    seoul = _crosswalk().resolve("서울", "중구")
    incheon = _crosswalk().resolve("인천", "중구")
    assert seoul.region is not None and seoul.region.region_code == "KR-SGIS-11020"
    assert incheon.region is not None and incheon.region.region_code == "KR-SGIS-23010"


def test_gyeonggi_single_city_exact_match() -> None:
    resolution = _crosswalk().resolve("경기", "과천시")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-31110"


def test_gyeonggi_city_with_districts_is_coarser_reporting_geography() -> None:
    # RCIS reports 수원시 at city level; SGIS splits it into 구 districts. The
    # record is a coarser reporting geography, served via the reporting geometry;
    # its value is never split across the districts.
    resolution = _crosswalk().resolve("경기", "수원시")
    assert resolution.status == COARSER_REPORTING_GEOGRAPHY
    assert resolution.region is None


def test_gyeonggi_city_district_two_token_exact_match() -> None:
    # If RCIS ever reports the full "수원시 권선구" it maps directly.
    resolution = _crosswalk().resolve("경기", "수원시 권선구")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-31012"


def test_gyeonggi_bare_district_maps_when_unambiguous() -> None:
    resolution = _crosswalk().resolve("경기", "권선구")
    assert resolution.status == EXACT_MATCH
    assert resolution.region is not None
    assert resolution.region.region_code == "KR-SGIS-31012"


def test_excluded_pseudo_region_labels_do_not_match() -> None:
    for label in ("전국", "합계", "소계"):
        resolution = _crosswalk().resolve("서울특별시", label)
        assert resolution.status == UNMATCHED


def test_out_of_scope_sido_is_flagged() -> None:
    resolution = _crosswalk().resolve("부산", "해운대구")
    assert resolution.status == OUT_OF_SCOPE


def test_unmatched_region_is_reported_not_guessed() -> None:
    resolution = _crosswalk().resolve("서울특별시", "없는구")
    assert resolution.status == UNMATCHED
    assert resolution.region is None


def test_ambiguous_bare_district_is_not_silently_selected() -> None:
    regions = _capital_region_regions() + [
        _region(90, "KR-SGIS-31021", "경기도 성남시 수정구", "SIGUNGU", "KR-SGIS-31"),
        _region(91, "KR-SGIS-31999", "경기도 용인시 수정구", "SIGUNGU", "KR-SGIS-31"),
    ]
    resolution = RegionCrosswalk(regions).resolve("경기", "수정구")
    assert resolution.status == AMBIGUOUS
    assert resolution.region is None


def test_no_fuzzy_match_fallback() -> None:
    # A near-miss name must not fuzzy-match to 종로구.
    resolution = _crosswalk().resolve("서울특별시", "종로")
    assert resolution.status == UNMATCHED


def test_original_korean_names_are_preserved() -> None:
    resolution = _crosswalk().resolve("서울", "종로구")
    assert resolution.rcis_sido_name == "서울"
    assert resolution.rcis_sigungu_name == "종로구"
