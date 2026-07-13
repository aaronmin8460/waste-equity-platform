"""Unit invariants for the RCIS reporting-geography declaration.

These assert the seven-city / twenty-child crosswalk is exact and unambiguous.
No official RCIS data values are represented; region names/codes are public
administrative facts.
"""

from __future__ import annotations

from waste_equity_ingestion.rcis_reporting_geography import (
    REPORTING_CITIES,
    _canonical,
)

EXPECTED_CITIES = {"고양시", "부천시", "성남시", "수원시", "안산시", "안양시", "용인시"}


def test_exactly_seven_reporting_cities() -> None:
    assert len(REPORTING_CITIES) == 7
    assert {spec.rcis_sigungu_name for spec in REPORTING_CITIES} == EXPECTED_CITIES


def test_exactly_twenty_child_districts_all_unique() -> None:
    children = [code for spec in REPORTING_CITIES for code in spec.child_region_codes]
    assert len(children) == 20
    # No child belongs to more than one reporting city.
    assert len(set(children)) == 20


def test_reporting_codes_are_namespaced_and_do_not_collide_with_children() -> None:
    reporting_codes = {spec.reporting_region_code for spec in REPORTING_CITIES}
    assert len(reporting_codes) == 7
    # The reporting namespace cannot be mistaken for an SGIS code (KR-SGIS-*).
    assert all(code.startswith("KR-RCISRG-") for code in reporting_codes)
    child_codes = {code for spec in REPORTING_CITIES for code in spec.child_region_codes}
    assert all(child.startswith("KR-SGIS-") for child in child_codes)
    assert reporting_codes.isdisjoint(child_codes)


def test_child_counts_match_known_sgis_structure() -> None:
    counts = {spec.rcis_sigungu_name: len(spec.child_region_codes) for spec in REPORTING_CITIES}
    assert counts == {
        "수원시": 4,
        "성남시": 3,
        "안양시": 2,
        "부천시": 3,
        "안산시": 2,
        "고양시": 3,
        "용인시": 3,
    }


def test_canonical_normalizes_short_sido_alias() -> None:
    # RCIS reports the short sido "경기"; it must map to the same key regardless.
    assert _canonical("경기", "안양시") == _canonical("경기도", "안양시")
    # Every declared city is reachable by its RCIS name pair.
    keys = {_canonical(spec.rcis_sido_name, spec.rcis_sigungu_name) for spec in REPORTING_CITIES}
    assert len(keys) == 7
