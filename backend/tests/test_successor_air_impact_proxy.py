"""Successor component B — ``air_impact_proxy``.

Covers the exact four-stream sum, single and multiple missing streams, missing and
zero population, incompatible units / reference periods / aggregation grain, ties,
the inverse percentile, provenance preservation, and deterministic output.
"""

from __future__ import annotations

from decimal import Decimal

from waste_equity_backend.analysis.per_capita import (
    EXPECTED_QUANTITY_UNIT,
    per_capita_kg_per_year,
)
from waste_equity_backend.analysis.suitability.successor import air_impact_proxy, contract
from waste_equity_backend.analysis.suitability.successor.air_impact_proxy import (
    REQUIRED_WASTE_STREAMS,
    AirImpactProxyInput,
    StreamObservation,
)

PERIOD = "2024"


def _stream(
    name: str,
    tons: str | None,
    *,
    unit: str | None = EXPECTED_QUANTITY_UNIT,
    period: str | None = PERIOD,
    level: str | None = "SIGUNGU",
) -> StreamObservation:
    return StreamObservation(
        waste_stream=name,
        generation_quantity=(Decimal(tons) if tons is not None else None),
        quantity_unit=unit,
        reference_period=period,
        source_geographic_level=level,
        source_id="rcis",
        source_pid={"HOUSEHOLD": "NTN007"}.get(name),
        accounting_basis="ORIGIN_BASED_TREATMENT_OUTCOME",
    )


def _all_streams(
    household: str = "1000",
    business: str = "2000",
    industrial: str = "3000",
    construction: str = "4000",
) -> tuple[StreamObservation, ...]:
    return (
        _stream("HOUSEHOLD", household),
        _stream("BUSINESS_NON_FACILITY", business),
        _stream("INDUSTRIAL_FACILITY", industrial),
        _stream("CONSTRUCTION", construction),
    )


def _region(
    code: str, population: int | None, streams: tuple[StreamObservation, ...]
) -> AirImpactProxyInput:
    return AirImpactProxyInput(
        region_code=code,
        population=population,
        streams=streams,
        population_source_id="sgis",
        population_reference_period=PERIOD,
    )


# --------------------------------------------------------------------------- #
# The exact sum of four streams
# --------------------------------------------------------------------------- #


def test_required_streams_are_the_four_canonical_streams() -> None:
    assert REQUIRED_WASTE_STREAMS == (
        "HOUSEHOLD",
        "BUSINESS_NON_FACILITY",
        "INDUSTRIAL_FACILITY",
        "CONSTRUCTION",
    )


def test_total_is_the_exact_sum_of_the_four_streams() -> None:
    parts = ("1000.5", "2000.25", "3000.125", "4000.0625")
    observation = air_impact_proxy.observe(_region("R", 10_000, _all_streams(*parts)))
    assert observation.available
    # Exact Decimal addition — no binary float rounding anywhere in the sum.
    expected = sum((Decimal(p) for p in parts), start=Decimal("0"))
    assert expected == Decimal("10000.9375")
    assert observation.inputs["total_generation_tons_per_year"] == "10000.9375"


def test_per_capita_matches_the_production_derivation_exactly() -> None:
    observation = air_impact_proxy.observe(_region("R", 123_457, _all_streams()))
    expected = per_capita_kg_per_year(Decimal("10000"), EXPECTED_QUANTITY_UNIT, 123_457)
    assert observation.raw_value == expected
    assert observation.raw_unit == "kg/인/년"


# --------------------------------------------------------------------------- #
# Missing streams are never zero-filled
# --------------------------------------------------------------------------- #


def test_one_missing_stream_makes_the_component_unavailable() -> None:
    streams = tuple(s for s in _all_streams() if s.waste_stream != "CONSTRUCTION")
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_MISSING_WASTE_STREAM in observation.unavailable_reasons
    assert observation.inputs["missing_waste_streams"] == ["CONSTRUCTION"]
    assert observation.inputs["total_generation_tons_per_year"] is None


def test_multiple_missing_streams_are_all_named() -> None:
    streams = (_stream("HOUSEHOLD", "1000"), _stream("CONSTRUCTION", "4000"))
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert observation.inputs["missing_waste_streams"] == [
        "BUSINESS_NON_FACILITY",
        "INDUSTRIAL_FACILITY",
    ]


def test_a_present_row_with_no_quantity_counts_as_missing_not_zero() -> None:
    streams = (
        _stream("HOUSEHOLD", "1000"),
        _stream("BUSINESS_NON_FACILITY", None),
        _stream("INDUSTRIAL_FACILITY", "3000"),
        _stream("CONSTRUCTION", "4000"),
    )
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert observation.inputs["missing_waste_streams"] == ["BUSINESS_NON_FACILITY"]
    # The null observation itself is preserved, not dropped.
    assert observation.inputs["streams"]["BUSINESS_NON_FACILITY"]["generation_quantity"] is None


def test_all_four_source_values_are_preserved_even_when_unavailable() -> None:
    streams = tuple(s for s in _all_streams() if s.waste_stream != "CONSTRUCTION")
    observation = air_impact_proxy.observe(_region("R", None, streams))
    preserved = observation.inputs["streams"]
    assert preserved["HOUSEHOLD"]["generation_quantity"] == "1000"
    assert preserved["BUSINESS_NON_FACILITY"]["generation_quantity"] == "2000"
    assert preserved["INDUSTRIAL_FACILITY"]["generation_quantity"] == "3000"
    assert preserved["HOUSEHOLD"]["quantity_unit"] == EXPECTED_QUANTITY_UNIT
    assert preserved["HOUSEHOLD"]["reference_period"] == PERIOD


# --------------------------------------------------------------------------- #
# Population denominator
# --------------------------------------------------------------------------- #


def test_missing_population_makes_the_component_unavailable() -> None:
    observation = air_impact_proxy.observe(_region("R", None, _all_streams()))
    assert not observation.available
    assert contract.REASON_MISSING_POPULATION in observation.unavailable_reasons
    # The numerator stays visible even though the ratio is undefined.
    assert observation.inputs["total_generation_tons_per_year"] == "10000"


def test_zero_population_makes_the_component_unavailable() -> None:
    observation = air_impact_proxy.observe(_region("R", 0, _all_streams()))
    assert not observation.available
    assert contract.REASON_NON_POSITIVE_POPULATION in observation.unavailable_reasons


def test_negative_population_makes_the_component_unavailable() -> None:
    observation = air_impact_proxy.observe(_region("R", -1, _all_streams()))
    assert not observation.available
    assert contract.REASON_NON_POSITIVE_POPULATION in observation.unavailable_reasons


# --------------------------------------------------------------------------- #
# Compatibility of unit, period, and aggregation grain
# --------------------------------------------------------------------------- #


def test_an_unexpected_quantity_unit_is_refused_not_converted() -> None:
    streams = (
        _stream("HOUSEHOLD", "1000", unit="kg/년"),
        _stream("BUSINESS_NON_FACILITY", "2000"),
        _stream("INDUSTRIAL_FACILITY", "3000"),
        _stream("CONSTRUCTION", "4000"),
    )
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_QUANTITY_UNIT in observation.unavailable_reasons
    assert observation.inputs["incompatible_quantity_unit_streams"] == ["HOUSEHOLD"]


def test_mixed_reference_periods_are_refused_not_summed() -> None:
    streams = (
        _stream("HOUSEHOLD", "1000", period="2023"),
        _stream("BUSINESS_NON_FACILITY", "2000"),
        _stream("INDUSTRIAL_FACILITY", "3000"),
        _stream("CONSTRUCTION", "4000"),
    )
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_REFERENCE_PERIOD in observation.unavailable_reasons
    assert observation.inputs["reference_periods"] == ["2023", "2024"]


def test_a_city_grain_stream_is_not_summed_into_a_sigungu_total() -> None:
    # Seven large Gyeonggi cities are reported at CITY level for some RCIS PIDs.
    streams = (
        _stream("HOUSEHOLD", "1000"),
        _stream("BUSINESS_NON_FACILITY", "2000", level="CITY"),
        _stream("INDUSTRIAL_FACILITY", "3000"),
        _stream("CONSTRUCTION", "4000"),
    )
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_GEOGRAPHIC_GRAIN in observation.unavailable_reasons
    assert observation.inputs["incompatible_grain_streams"] == ["BUSINESS_NON_FACILITY"]


def test_duplicate_stream_rows_are_refused() -> None:
    streams = (*_all_streams(), _stream("HOUSEHOLD", "9999"))
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_DUPLICATE_WASTE_STREAM in observation.unavailable_reasons
    assert observation.inputs["duplicate_waste_streams"] == ["HOUSEHOLD"]


def test_an_unsupported_stream_is_refused() -> None:
    streams = (*_all_streams(), _stream("MEDICAL", "10"))
    observation = air_impact_proxy.observe(_region("R", 10_000, streams))
    assert not observation.available
    assert contract.REASON_UNSUPPORTED_WASTE_STREAM in observation.unavailable_reasons
    assert observation.inputs["unsupported_waste_streams"] == ["MEDICAL"]


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #


def test_lower_per_capita_generation_scores_higher() -> None:
    scores = air_impact_proxy.normalized_scores(
        [
            _region("LOW", 1_000_000, _all_streams()),
            _region("HIGH", 10_000, _all_streams()),
        ]
    )
    assert scores["LOW"] == Decimal("100.0000")
    assert scores["HIGH"] == Decimal("0.0000")


def test_ties_share_a_score_and_the_inverse_percentile_holds() -> None:
    scores = air_impact_proxy.normalized_scores(
        [
            _region("A", 100_000, _all_streams()),
            _region("B", 100_000, _all_streams()),
            _region("C", 10_000, _all_streams()),
        ]
    )
    assert scores["A"] == scores["B"] == Decimal("100.0000")
    assert scores["C"] == Decimal("0.0000")


def test_unavailable_regions_are_absent_from_the_ranking() -> None:
    series = air_impact_proxy.build_series(
        [
            _region("A", 100_000, _all_streams()),
            _region("B", 10_000, _all_streams()),
            _region("MISSING", 10_000, (_stream("HOUSEHOLD", "1000"),)),
        ]
    )
    assert set(series.normalized_scores()) == {"A", "B"}
    assert series.unavailable_reason_counts() == {contract.REASON_MISSING_WASTE_STREAM: 1}


# --------------------------------------------------------------------------- #
# Honesty, provenance, determinism
# --------------------------------------------------------------------------- #


def test_the_component_is_labelled_a_proxy_everywhere_it_is_reported() -> None:
    series = air_impact_proxy.build_series([_region("A", 10_000, _all_streams())])
    assert series.disclaimer is not None
    assert "PROXY ONLY" in series.disclaimer
    assert "NOT measured atmospheric emissions" in series.disclaimer
    observation = series.observations[0]
    assert "PROXY ONLY" in observation.provenance["disclaimer"]


def test_provenance_records_unit_period_grain_and_basis() -> None:
    observation = air_impact_proxy.observe(_region("R", 10_000, _all_streams()))
    assert observation.provenance["accounting_basis"] == "ORIGIN_BASED_TREATMENT_OUTCOME"
    assert observation.provenance["expected_quantity_unit"] == EXPECTED_QUANTITY_UNIT
    assert observation.provenance["geographic_grain"] == "SIGUNGU"
    assert observation.provenance["per_capita_derivation_version"] == "per-capita-v1"
    assert observation.inputs["reference_period"] == PERIOD
    assert observation.inputs["total_generation_unit"] == EXPECTED_QUANTITY_UNIT


def test_output_is_deterministic() -> None:
    inputs = [
        _region("A", 100_000, _all_streams()),
        _region("B", 50_000, _all_streams()),
        _region("C", 10_000, _all_streams()),
    ]
    first = air_impact_proxy.build_series(inputs)
    second = air_impact_proxy.build_series(list(reversed(inputs)))
    assert first.sanitized_summary() == second.sanitized_summary()
    assert all(o.raw_value is None or isinstance(o.raw_value, Decimal) for o in first.observations)
