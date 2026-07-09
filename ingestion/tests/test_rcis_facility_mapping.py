"""Pure-Python facility region-mapping tests (no DB, no network)."""

from __future__ import annotations

import datetime

from waste_equity_ingestion.rcis_facility_contract import FacilityParseResult, FacilityRecord
from waste_equity_ingestion.rcis_facility_ingestion import FacilityFetchBundle, _map_bundle
from waste_equity_ingestion.rcis_region_crosswalk import RegionCrosswalk, SgisRegion

VALID_FROM = datetime.date(2024, 1, 1)


def _regions() -> list[SgisRegion]:
    return [
        SgisRegion(1, "KR-SGIS-11", "서울특별시", "SIDO", VALID_FROM, None),
        SgisRegion(3, "KR-SGIS-31", "경기도", "SIDO", VALID_FROM, None),
        SgisRegion(11, "KR-SGIS-11010", "서울특별시 종로구", "SIGUNGU", VALID_FROM, "KR-SGIS-11"),
        SgisRegion(31, "KR-SGIS-31110", "경기도 과천시", "SIGUNGU", VALID_FROM, "KR-SGIS-31"),
        SgisRegion(
            32, "KR-SGIS-31012", "경기도 수원시 권선구", "SIGUNGU", VALID_FROM, "KR-SGIS-31"
        ),
    ]


def _record(sido: str, sigungu: str, name: str = "시설") -> FacilityRecord:
    return FacilityRecord(
        source_pid="NTN031",
        official_dataset_name="1-가. 공공소각",
        reference_year=2024,
        facility_category="PUBLIC_INCINERATION",
        facility_kind="PROCESSING",
        ownership="PUBLIC",
        facility_name=name,
        operator_name=None,
        address="주소 1",
        source_seq="1",
        source_row_index=0,
        rcis_sido_name=sido,
        rcis_sigungu_name=sigungu,
        capacity_quantity=None,
        capacity_unit=None,
        throughput_quantity=None,
        throughput_unit=None,
        residue_total=None,
        residue_recycling=None,
        residue_incineration=None,
        residue_landfill=None,
        residue_other=None,
        fill_area_m2=None,
        total_fill_capacity_m3=None,
        remaining_fill_capacity_m3=None,
        fill_quantity_m3=None,
        fill_use_period=None,
        permit_date=None,
        return_date=None,
        source_fields={},
    )


def _bundle(records: list[FacilityRecord]) -> FacilityFetchBundle:
    parsed = FacilityParseResult(
        pid="NTN031",
        reference_year=2024,
        provider_code="E000",
        provider_message="ok",
        official_dataset_name="1-가. 공공소각",
        records=records,
        source_record_count=len(records),
        excluded_aggregate_rows=0,
        rejected_rows=[],
    )
    return FacilityFetchBundle(raw_responses=[], parse_results={"NTN031": parsed})


def test_exact_match_sets_region_id() -> None:
    mapping = _map_bundle(
        _bundle([_record("서울", "종로구")]), RegionCrosswalk(_regions()), ("NTN031",)
    )
    m = mapping.mapped_by_pid["NTN031"][0]
    assert m.region_mapping_status == "EXACT_MATCH"
    assert m.region_id == 11


def test_multi_district_city_facility_kept_with_geocode_status() -> None:
    mapping = _map_bundle(
        _bundle([_record("경기", "수원시")]), RegionCrosswalk(_regions()), ("NTN031",)
    )
    m = mapping.mapped_by_pid["NTN031"][0]
    # RCIS reports 수원시 at city level; SGIS splits into 구 -> keep, geocode later.
    assert m.region_mapping_status == "REQUIRES_GEOCODE"
    assert m.region_id is None


def test_unmatched_facility_kept_with_status() -> None:
    mapping = _map_bundle(
        _bundle([_record("서울", "없는구")]), RegionCrosswalk(_regions()), ("NTN031",)
    )
    m = mapping.mapped_by_pid["NTN031"][0]
    assert m.region_mapping_status == "UNMATCHED"
    assert m.region_id is None
    assert "서울 없는구" in mapping.unmatched_labels


def test_out_of_scope_facility_is_skipped() -> None:
    mapping = _map_bundle(
        _bundle([_record("부산", "해운대구")]), RegionCrosswalk(_regions()), ("NTN031",)
    )
    assert mapping.mapped_by_pid["NTN031"] == []
    assert mapping.in_scope_by_pid["NTN031"] == 0


def test_in_scope_count_and_status_breakdown() -> None:
    records = [
        _record("서울", "종로구", "A"),
        _record("경기", "수원시", "B"),
        _record("경기", "과천시", "C"),
        _record("부산", "해운대구", "D"),
    ]
    mapping = _map_bundle(_bundle(records), RegionCrosswalk(_regions()), ("NTN031",))
    assert mapping.in_scope_by_pid["NTN031"] == 3  # 부산 excluded
    counts = mapping.status_by_pid["NTN031"]
    assert counts["EXACT_MATCH"] == 2
    assert counts["REQUIRES_GEOCODE"] == 1
