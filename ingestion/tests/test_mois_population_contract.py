"""Pure contract tests for the official MOIS resident-registration parser.

Fixtures are synthetic but shaped exactly like the real official CSV
(행정동별 주민등록 인구 및 세대현황): cp949 encoding, a ``행정구역`` column whose
value embeds the 10-digit MOIS code, and one six-column block per month. Nothing
here contacts the live site, so these tests never depend on government
availability.
"""

from __future__ import annotations

import pytest

from waste_equity_ingestion.mois_population_contract import (
    DEFINITION_VERSION_2010_10,
    DEFINITION_VERSION_2015_01,
    DEFINITION_VERSION_PRE_2010_10,
    EARLIEST_SUPPORTED_MONTH,
    MoisContractError,
    comparability_note,
    complete_months,
    definition_version,
    download_form_fields,
    incomplete_months,
    latest_month_from_page,
    month_end_date,
    month_range,
    parse_csv,
    sha256_of,
    validate_month,
)

MONTH_BLOCK = ["총인구수", "세대수", "세대당 인구", "남자 인구수", "여자 인구수", "남여 비율"]


def _header(months: list[str]) -> list[str]:
    columns = ["행정구역"]
    for month in months:
        year, mm = month.split("-")
        columns.extend(f"{year}년{mm}월_{suffix}" for suffix in MONTH_BLOCK)
    return columns


def _row(name: str, code: str, values: list[str]) -> list[str]:
    cells = [f"{name}  ({code})"]
    for value in values:
        cells.extend([value, "1,000", "          2.00", "500", "500", "          1.00"])
    return cells


def _csv(rows: list[list[str]], *, encoding: str = "cp949") -> bytes:
    lines = []
    for row in rows:
        lines.append(",".join(f'"{cell}"' for cell in row))
    return ("\r\n".join(lines) + "\r\n").encode(encoding)


def _capital_csv(months: list[str], values: dict[str, list[str]] | None = None) -> bytes:
    values = values or {}
    default = ["1,000,000"] * len(months)
    return _csv(
        [
            _header(months),
            _row("전국", "1000000000", ["50,000,000"] * len(months)),
            _row("서울특별시", "1100000000", values.get("1100000000", default)),
            _row("부산광역시", "2600000000", default),
            _row("인천광역시", "2800000000", values.get("2800000000", default)),
            _row("경기도", "4100000000", values.get("4100000000", default)),
        ]
    )


def test_parses_the_official_csv_shape_with_korean_headers_and_cp949() -> None:
    payload = _capital_csv(
        ["2024-01"],
        {"1100000000": ["9,384,275"], "2800000000": ["3,003,150"], "4100000000": ["13,652,437"]},
    )
    result = parse_csv(payload)
    assert result.rejected == []
    assert result.months_present == ["2024-01"]
    by_code = {o.mois_code: o for o in result.observations}
    # Comma-separated integers are normalized exactly, never through a float.
    assert by_code["1100000000"].population == 9_384_275
    assert by_code["2800000000"].population == 3_003_150
    assert by_code["4100000000"].population == 13_652_437


def test_seoul_incheon_gyeonggi_codes_names_and_crosswalks() -> None:
    result = parse_csv(_capital_csv(["2024-01"]))
    by_code = {o.mois_code: o for o in result.observations}
    assert set(by_code) == {"1100000000", "2800000000", "4100000000"}

    seoul = by_code["1100000000"]
    assert (seoul.official_name, seoul.canonical_region_code, seoul.landfill_origin_code) == (
        "서울특별시",
        "KR-SGIS-11",
        "KR-SGIS-11",
    )
    # Incheon: MOIS 28 -> canonical SGIS 23 -> landfill origin 28. The canonical
    # code deliberately differs; joining on the numeric part would be wrong.
    incheon = by_code["2800000000"]
    assert (incheon.official_name, incheon.canonical_region_code, incheon.landfill_origin_code) == (
        "인천광역시",
        "KR-SGIS-23",
        "KR-SGIS-28",
    )
    # Gyeonggi: MOIS 41 -> canonical SGIS 31 -> landfill origin 41.
    gyeonggi = by_code["4100000000"]
    assert (
        gyeonggi.official_name,
        gyeonggi.canonical_region_code,
        gyeonggi.landfill_origin_code,
    ) == ("경기도", "KR-SGIS-31", "KR-SGIS-41")


def test_wrong_name_for_a_known_code_is_rejected() -> None:
    payload = _csv([_header(["2024-01"]), _row("서울직할시", "1100000000", ["9,000,000"])])
    result = parse_csv(payload)
    assert result.observations == []
    assert any(r.startswith("REGION_NAME_MISMATCH:1100000000") for r in result.rejected)


def test_unexpected_code_is_ignored_not_ingested() -> None:
    # 부산 is official but out of this project's scope: skipped silently, and it
    # can never become one of the three required regions.
    payload = _csv([_header(["2024-01"]), _row("부산광역시", "2600000000", ["3,300,000"])])
    result = parse_csv(payload)
    assert result.observations == []
    assert complete_months(result) == []


def test_unparseable_region_field_is_rejected() -> None:
    payload = _csv(
        [_header(["2024-01"]), ["서울특별시 (no code)", "9,000,000", "1", "2", "3", "4", "5"]]
    )
    result = parse_csv(payload)
    assert any(r.startswith("UNPARSEABLE_REGION_FIELD") for r in result.rejected)


def test_duplicate_region_month_is_rejected() -> None:
    payload = _csv(
        [
            _header(["2024-01"]),
            _row("서울특별시", "1100000000", ["9,000,000"]),
            _row("서울특별시", "1100000000", ["9,000,001"]),
        ]
    )
    result = parse_csv(payload)
    assert any(r.startswith("DUPLICATE_REGION_MONTH:1100000000:2024-01") for r in result.rejected)
    assert len([o for o in result.observations if o.mois_code == "1100000000"]) == 1


def test_missing_region_makes_the_month_incomplete() -> None:
    payload = _csv(
        [
            _header(["2024-01"]),
            _row("서울특별시", "1100000000", ["9,000,000"]),
            _row("인천광역시", "2800000000", ["3,000,000"]),
        ]
    )
    result = parse_csv(payload)
    assert complete_months(result) == []
    assert incomplete_months(result) == {"2024-01": ["경기도"]}


def test_incomplete_month_inside_a_range_is_reported_not_partially_accepted() -> None:
    payload = _csv(
        [
            _header(["2024-01", "2024-02"]),
            _row("서울특별시", "1100000000", ["9,000,000", "9,000,100"]),
            _row("인천광역시", "2800000000", ["3,000,000", "3,000,100"]),
            # Gyeonggi is absent for 2024-02 only (zero => not published).
            _row("경기도", "4100000000", ["13,000,000", "0"]),
        ]
    )
    result = parse_csv(payload)
    assert complete_months(result) == ["2024-01"]
    assert incomplete_months(result) == {"2024-02": ["경기도"]}


def test_zero_population_is_rejected_never_stored() -> None:
    # The official endpoint answers an unpublished month with a CSV of zeros;
    # a zero 시도 population is never a real observation.
    result = parse_csv(_capital_csv(["2026-07"], {"1100000000": ["0"]}))
    assert all(o.mois_code != "1100000000" for o in result.observations)
    assert any(
        r.startswith("NON_POSITIVE_POPULATION:1100000000:2026-07:0") for r in result.rejected
    )


def test_non_integer_population_is_rejected() -> None:
    result = parse_csv(_capital_csv(["2024-01"], {"1100000000": ["9,000,000.5"]}))
    assert any(r.startswith("INVALID_POPULATION:1100000000") for r in result.rejected)


def test_multi_month_parsing_across_the_wide_csv() -> None:
    months = ["2008-01", "2008-02", "2008-03"]
    result = parse_csv(_capital_csv(months))
    assert result.months_present == months
    assert complete_months(result) == months
    assert len(result.observations) == 9  # 3 months x 3 regions


def test_header_without_total_columns_is_refused() -> None:
    payload = _csv([["행정구역", "2024년01월_세대수"], ["서울특별시  (1100000000)", "1"]])
    with pytest.raises(MoisContractError, match="총인구수"):
        parse_csv(payload)


def test_non_official_header_is_refused() -> None:
    payload = _csv([["region", "population"], ["Seoul", "9000000"]])
    with pytest.raises(MoisContractError, match="행정구역"):
        parse_csv(payload)


def test_raw_hash_is_recorded_and_stable() -> None:
    payload = _capital_csv(["2024-01"])
    result = parse_csv(payload)
    assert result.source_sha256 == sha256_of(payload)
    assert len(result.source_sha256) == 64
    # A different payload yields a different digest.
    assert parse_csv(_capital_csv(["2024-02"])).source_sha256 != result.source_sha256


def test_definition_eras_are_assigned_at_the_confirmed_boundaries() -> None:
    # Boundaries confirmed against the official source (see the module docstring):
    # 거주불명자 from 2010-10, 재외국민 from 2015-01.
    assert definition_version("2008-01") == DEFINITION_VERSION_PRE_2010_10
    assert definition_version("2010-09") == DEFINITION_VERSION_PRE_2010_10
    assert definition_version("2010-10") == DEFINITION_VERSION_2010_10
    assert definition_version("2014-12") == DEFINITION_VERSION_2010_10
    assert definition_version("2015-01") == DEFINITION_VERSION_2015_01
    assert definition_version("2026-06") == DEFINITION_VERSION_2015_01


def test_definition_era_travels_with_each_observation() -> None:
    result = parse_csv(_capital_csv(["2010-09", "2010-10", "2015-01"]))
    by_month = {o.reference_month: o for o in result.observations if o.mois_code == "1100000000"}
    assert by_month["2010-09"].population_definition_version == DEFINITION_VERSION_PRE_2010_10
    assert by_month["2010-10"].population_definition_version == DEFINITION_VERSION_2010_10
    assert by_month["2015-01"].population_definition_version == DEFINITION_VERSION_2015_01
    # Every observation carries a human-readable comparability caveat.
    assert "거주불명자" in by_month["2010-10"].population_comparability_note
    assert "재외국민" in by_month["2015-01"].population_comparability_note
    assert (
        "외국인"
        in by_month["2008-01" if "2008-01" in by_month else "2010-09"].population_comparability_note
    )


def test_comparability_notes_never_claim_a_uniform_series() -> None:
    for month in ["2008-01", "2010-10", "2015-01"]:
        note = comparability_note(month)
        assert "비교할 수 없습니다" in note


def test_download_form_fields_mirror_the_official_form() -> None:
    fields = download_form_fields("2008-01", "2026-06")
    # sltUndefType="" is 전체 = 거주자 + 거주불명자 + 재외국민.
    assert fields["sltUndefType"] == ""
    assert fields["category"] == "month"
    assert fields["sltOrgType"] == "1"
    assert fields["sltOrgLvl1"] == "A"
    assert (fields["searchYearStart"], fields["searchMonthStart"]) == ("2008", "01")
    assert (fields["searchYearEnd"], fields["searchMonthEnd"]) == ("2026", "06")


def test_download_form_rejects_a_reversed_range() -> None:
    with pytest.raises(MoisContractError, match="after"):
        download_form_fields("2026-06", "2008-01")


def test_month_validation_and_range() -> None:
    validate_month("2008-01")
    for bad in ["2008-13", "2008-00", "200801", "2008-1", ""]:
        with pytest.raises(MoisContractError):
            validate_month(bad)
    assert month_range("2008-11", "2009-02") == ["2008-11", "2008-12", "2009-01", "2009-02"]
    assert len(month_range("2008-01", "2026-06")) == 222


def test_earliest_supported_month_is_2008_01() -> None:
    # This project is not authorized to ingest population before 2008.
    assert EARLIEST_SUPPORTED_MONTH == "2008-01"


def test_latest_month_is_read_from_the_official_pages_own_default() -> None:
    html = """
      <select name="searchYearEnd"><option value="2026" selected>2026년</option></select>
      <select name="searchMonthEnd"><option value="05">05월</option>
      <option value="06" selected>06월</option></select>
    """
    assert latest_month_from_page(html) == "2026-06"
    assert latest_month_from_page("<html></html>") is None


def test_month_end_convention() -> None:
    assert month_end_date("2024-02").isoformat() == "2024-02-29"  # leap year
    assert month_end_date("2023-02").isoformat() == "2023-02-28"
    assert month_end_date("2024-12").isoformat() == "2024-12-31"
    assert month_end_date("2024-04").isoformat() == "2024-04-30"
