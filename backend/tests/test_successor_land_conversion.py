"""Successor component D — ``land_conversion``.

Uses an explicit synthetic class registry throughout: this repository ships no
official developed/artificial class list, and the module must never assume one.
Covers mixed classes, partial coverage, no coverage, missing values, unclassified
classes, the two denominators, and determinism.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability.successor import contract, land_conversion
from waste_equity_backend.analysis.suitability.successor.land_conversion import (
    ClassArea,
    LandConversionConfigurationError,
    LandConversionInput,
    LandCoverClassRegistry,
)

# A deliberately fake registry. The codes are invented for this test file and are
# NOT official land-cover class codes; the production registry is unavailable and
# is under audit by a separate research lane.
SYNTHETIC_REGISTRY = LandCoverClassRegistry(
    registry_id="synthetic-test-registry-v0",
    class_level=1,
    developed_class_codes=frozenset({"TESTDEV1", "TESTDEV2"}),
    known_class_codes=frozenset({"TESTDEV1", "TESTDEV2", "TESTNAT1", "TESTNAT2"}),
    source="synthetic fixture; not an official classification",
    note="fabricated codes for unit tests only",
)


def _area(code: str, m2: str | None, level: int = 1) -> ClassArea:
    return ClassArea(
        class_level=level,
        class_code=code,
        class_name=f"name-{code}",
        class_area_m2=(Decimal(m2) if m2 is not None else None),
    )


def _cell(
    key: str,
    *areas: ClassArea,
    coverage_status: str = land_conversion.COVERAGE_COMPLETE_EXACT,
    evaluated: str | None = "250000",
    cell: str | None = "250000",
    coverage_ratio: str | None = "1.0",
) -> LandConversionInput:
    return LandConversionInput(
        candidate_key=key,
        coverage_status=coverage_status,
        cell_area_m2=(Decimal(cell) if cell is not None else None),
        evaluated_area_m2=(Decimal(evaluated) if evaluated is not None else None),
        class_areas=tuple(areas),
        coverage_ratio=(Decimal(coverage_ratio) if coverage_ratio is not None else None),
        statistics_version_id=7,
        land_cover_dataset_version_id=3,
        land_cover_derivation_version="land-cover-cell-stats-v1",
        area_crs="EPSG:5186",
        source_reference_period="2025",
    )


# --------------------------------------------------------------------------- #
# The registry is external and never guessed
# --------------------------------------------------------------------------- #


def test_no_production_registry_is_shipped() -> None:
    assert land_conversion.PRODUCTION_REGISTRY is None


def test_a_registry_must_classify_every_code_it_calls_developed() -> None:
    with pytest.raises(LandConversionConfigurationError):
        LandCoverClassRegistry(
            registry_id="bad",
            class_level=1,
            developed_class_codes=frozenset({"X"}),
            known_class_codes=frozenset({"Y"}),
            source="synthetic",
        )


def test_a_registry_requires_a_stated_source_and_a_valid_level() -> None:
    with pytest.raises(LandConversionConfigurationError):
        LandCoverClassRegistry(
            registry_id="bad",
            class_level=1,
            developed_class_codes=frozenset(),
            known_class_codes=frozenset({"Y"}),
            source="  ",
        )
    with pytest.raises(LandConversionConfigurationError):
        LandCoverClassRegistry(
            registry_id="bad",
            class_level=9,
            developed_class_codes=frozenset(),
            known_class_codes=frozenset({"Y"}),
            source="synthetic",
        )


def test_the_synthetic_registry_is_not_approved() -> None:
    assert SYNTHETIC_REGISTRY.approved is False


# --------------------------------------------------------------------------- #
# Mixed classes
# --------------------------------------------------------------------------- #


def test_mixed_classes_aggregate_by_registry_membership() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            _area("TESTDEV1", "100000"),
            _area("TESTNAT1", "150000"),
        ),
        SYNTHETIC_REGISTRY,
    )
    assert observation.available
    assert observation.inputs["developed_area_m2"] == "100000.00"
    assert observation.inputs["non_developed_area_m2"] == "150000.00"
    # conversion-exposed share = 150000 / 250000
    assert observation.raw_value == Decimal("0.6000000000")
    assert observation.inputs["developed_share"] == "0.4000000000"


def test_several_classes_on_each_side_are_summed() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            _area("TESTDEV1", "50000"),
            _area("TESTDEV2", "50000"),
            _area("TESTNAT1", "100000"),
            _area("TESTNAT2", "50000"),
        ),
        SYNTHETIC_REGISTRY,
    )
    assert observation.inputs["developed_area_m2"] == "100000.00"
    assert observation.inputs["non_developed_area_m2"] == "150000.00"
    assert observation.inputs["developed_class_codes_observed"] == ("TESTDEV1", "TESTDEV2")
    assert observation.inputs["non_developed_class_codes_observed"] == ("TESTNAT1", "TESTNAT2")


def test_a_fully_developed_cell_has_zero_conversion_exposure() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "250000")), SYNTHETIC_REGISTRY
    )
    assert observation.raw_value == Decimal("0E-10")
    assert observation.inputs["developed_share"] == "1.0000000000"


def test_classes_at_other_levels_are_ignored_by_a_level_scoped_registry() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            _area("TESTDEV1", "100000"),
            _area("TESTNAT1", "150000"),
            _area("IGNORED-L2", "999999", level=2),
        ),
        SYNTHETIC_REGISTRY,
    )
    assert observation.available
    assert observation.inputs["class_row_count"] == 2


# --------------------------------------------------------------------------- #
# Coverage
# --------------------------------------------------------------------------- #


def test_no_coverage_is_unavailable_not_zero_developed() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            coverage_status=land_conversion.COVERAGE_NO_COVERAGE,
            evaluated="0",
            coverage_ratio="0",
        ),
        SYNTHETIC_REGISTRY,
    )
    assert not observation.available
    assert contract.REASON_NO_LAND_COVER_COVERAGE in observation.unavailable_reasons
    assert observation.raw_value is None


def test_partial_coverage_stays_available_but_flagged() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            _area("TESTDEV1", "40000"),
            _area("TESTNAT1", "60000"),
            coverage_status=land_conversion.COVERAGE_PARTIAL,
            evaluated="100000",
            coverage_ratio="0.4",
        ),
        SYNTHETIC_REGISTRY,
    )
    assert observation.available
    assert observation.is_partial is True
    assert contract.PARTIAL_LAND_COVER_COVERAGE in observation.partial_reasons
    assert observation.raw_value == Decimal("0.6000000000")
    assert observation.inputs["coverage_ratio"] == "0.4"


def test_a_missing_evaluated_area_is_unavailable() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "1000"), evaluated=None), SYNTHETIC_REGISTRY
    )
    assert not observation.available
    assert contract.REASON_MISSING_EVALUATED_AREA in observation.unavailable_reasons


def test_a_zero_evaluated_area_is_unavailable_never_a_divide_by_zero() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "0"), evaluated="0"), SYNTHETIC_REGISTRY
    )
    assert not observation.available
    assert contract.REASON_NO_EVALUATED_AREA in observation.unavailable_reasons


def test_a_covered_cell_with_no_class_rows_is_unavailable() -> None:
    observation = land_conversion.observe(_cell("C"), SYNTHETIC_REGISTRY)
    assert not observation.available
    assert contract.REASON_MISSING_CLASS_COMPOSITION in observation.unavailable_reasons


# --------------------------------------------------------------------------- #
# Missing is never zero
# --------------------------------------------------------------------------- #


def test_an_unclassified_class_makes_the_cell_unavailable() -> None:
    observation = land_conversion.observe(
        _cell(
            "C",
            _area("TESTDEV1", "100000"),
            _area("MYSTERY", "150000"),
        ),
        SYNTHETIC_REGISTRY,
    )
    assert not observation.available
    assert contract.REASON_UNCLASSIFIED_LAND_COVER_CLASS in observation.unavailable_reasons
    assert observation.inputs["unclassified_class_codes"] == ("MYSTERY",)


def test_a_missing_class_area_makes_the_cell_unavailable() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "100000"), _area("TESTNAT1", None)),
        SYNTHETIC_REGISTRY,
    )
    assert not observation.available
    assert contract.REASON_INVALID_CLASS_AREA in observation.unavailable_reasons
    assert observation.inputs["missing_class_area_codes"] == ("TESTNAT1",)


def test_a_negative_class_area_makes_the_cell_unavailable() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "-1"), _area("TESTNAT1", "10")),
        SYNTHETIC_REGISTRY,
    )
    assert not observation.available
    assert contract.REASON_INVALID_CLASS_AREA in observation.unavailable_reasons


def test_class_areas_exceeding_the_denominator_are_reported_not_clamped() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "200000"), _area("TESTNAT1", "200000"), evaluated="250000"),
        SYNTHETIC_REGISTRY,
    )
    assert not observation.available
    assert contract.REASON_CLASS_AREA_EXCEEDS_DENOMINATOR in observation.unavailable_reasons
    assert observation.inputs["class_area_sum_m2"] == "400000.00"


def test_the_helper_refuses_to_bucket_an_unknown_class() -> None:
    with pytest.raises(LandConversionConfigurationError):
        land_conversion.aggregate_class_areas([_area("MYSTERY", "1000")], SYNTHETIC_REGISTRY)


# --------------------------------------------------------------------------- #
# Denominators
# --------------------------------------------------------------------------- #


def test_the_two_denominators_are_distinct_and_never_conflated() -> None:
    cell = _cell(
        "C",
        _area("TESTDEV1", "40000"),
        _area("TESTNAT1", "60000"),
        coverage_status=land_conversion.COVERAGE_PARTIAL,
        evaluated="100000",
        cell="250000",
        coverage_ratio="0.4",
    )
    over_evaluated = land_conversion.observe(
        cell, SYNTHETIC_REGISTRY, denominator=land_conversion.DENOMINATOR_EVALUATED_AREA
    )
    over_cell = land_conversion.observe(
        cell, SYNTHETIC_REGISTRY, denominator=land_conversion.DENOMINATOR_CELL_AREA
    )
    assert over_evaluated.raw_value == Decimal("0.6000000000")
    assert over_cell.raw_value == Decimal("0.2400000000")
    assert over_evaluated.inputs["denominator"] == "EVALUATED_AREA"
    assert over_cell.inputs["denominator"] == "CELL_AREA"


def test_an_unknown_denominator_is_rejected() -> None:
    with pytest.raises(LandConversionConfigurationError):
        land_conversion.observe(
            _cell("C", _area("TESTDEV1", "1000")), SYNTHETIC_REGISTRY, denominator="GUESS"
        )


# --------------------------------------------------------------------------- #
# Normalization and determinism
# --------------------------------------------------------------------------- #


def test_lower_conversion_exposure_scores_higher() -> None:
    scores = land_conversion.normalized_scores(
        [
            _cell("DEVELOPED", _area("TESTDEV1", "250000")),
            _cell("NATURAL", _area("TESTNAT1", "250000")),
        ],
        SYNTHETIC_REGISTRY,
    )
    assert scores["DEVELOPED"] == Decimal("100.0000")
    assert scores["NATURAL"] == Decimal("0.0000")


def test_unavailable_cells_are_absent_from_the_ranking() -> None:
    series = land_conversion.build_series(
        [
            _cell("A", _area("TESTDEV1", "250000")),
            _cell("B", _area("TESTNAT1", "250000")),
            _cell(
                "NOCOV",
                coverage_status=land_conversion.COVERAGE_NO_COVERAGE,
                evaluated="0",
            ),
        ],
        SYNTHETIC_REGISTRY,
    )
    assert set(series.normalized_scores()) == {"A", "B"}
    assert series.unavailable_reason_counts()[contract.REASON_NO_LAND_COVER_COVERAGE] == 1


def test_output_is_deterministic() -> None:
    cells = [
        _cell("A", _area("TESTDEV1", "250000")),
        _cell("B", _area("TESTDEV1", "100000"), _area("TESTNAT1", "150000")),
        _cell("C", _area("TESTNAT1", "250000")),
    ]
    first = land_conversion.build_series(cells, SYNTHETIC_REGISTRY)
    second = land_conversion.build_series(list(reversed(cells)), SYNTHETIC_REGISTRY)
    assert first.sanitized_summary() == second.sanitized_summary()
    assert all(o.raw_value is None or isinstance(o.raw_value, Decimal) for o in first.observations)


# --------------------------------------------------------------------------- #
# Excluded and ambiguous classes
# --------------------------------------------------------------------------- #

# A registry that pulls one class out of both numerator and denominator (the
# natural treatment for water under a "share of the *land* that is developed"
# reading) and flags one contested classification.
EXCLUDING_REGISTRY = LandCoverClassRegistry(
    registry_id="synthetic-excluding-registry-v0",
    class_level=1,
    developed_class_codes=frozenset({"TESTDEV1"}),
    known_class_codes=frozenset({"TESTDEV1", "TESTNAT1", "TESTWATER"}),
    excluded_class_codes=frozenset({"TESTWATER"}),
    ambiguous_class_codes=frozenset({"TESTWATER"}),
    source="synthetic fixture; not an official classification",
)


def test_a_class_cannot_be_both_developed_and_excluded() -> None:
    with pytest.raises(LandConversionConfigurationError):
        LandCoverClassRegistry(
            registry_id="bad",
            class_level=1,
            developed_class_codes=frozenset({"X"}),
            known_class_codes=frozenset({"X"}),
            excluded_class_codes=frozenset({"X"}),
            source="synthetic",
        )


def test_an_excluded_class_must_still_be_known() -> None:
    with pytest.raises(LandConversionConfigurationError):
        LandCoverClassRegistry(
            registry_id="bad",
            class_level=1,
            developed_class_codes=frozenset(),
            known_class_codes=frozenset({"X"}),
            excluded_class_codes=frozenset({"UNLISTED"}),
            source="synthetic",
        )


def test_the_excluding_denominator_removes_the_class_from_both_sides() -> None:
    cell = _cell(
        "C",
        _area("TESTDEV1", "50000"),
        _area("TESTNAT1", "50000"),
        _area("TESTWATER", "150000"),
    )
    observation = land_conversion.observe(
        cell,
        EXCLUDING_REGISTRY,
        denominator=land_conversion.DENOMINATOR_EVALUATED_AREA_EXCLUDING_EXCLUDED,
    )
    assert observation.available
    # denominator = 250000 - 150000 = 100000; conversion share = 50000 / 100000
    assert observation.inputs["denominator_area_m2"] == "100000"
    assert observation.inputs["excluded_area_m2"] == "150000.00"
    assert observation.raw_value == Decimal("0.5000000000")


def test_the_excluding_denominator_is_never_silently_substituted() -> None:
    cell = _cell(
        "C",
        _area("TESTDEV1", "50000"),
        _area("TESTNAT1", "50000"),
        _area("TESTWATER", "150000"),
    )
    over_evaluated = land_conversion.observe(cell, EXCLUDING_REGISTRY)
    assert over_evaluated.inputs["denominator"] == "EVALUATED_AREA"
    assert over_evaluated.inputs["denominator_area_m2"] == "250000"
    # Without the excluding denominator the excluded class leaves the numerator but
    # stays in the denominator, so the two conventions genuinely differ.
    assert over_evaluated.raw_value == Decimal("0.2000000000")


def test_contested_classifications_travel_with_the_observation() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "100000"), _area("TESTWATER", "150000")),
        EXCLUDING_REGISTRY,
    )
    assert observation.inputs["ambiguous_class_codes_observed"] == ("TESTWATER",)
    assert observation.provenance["class_registry"]["ambiguous_class_codes"] == ["TESTWATER"]
    assert observation.provenance["class_registry"]["excluded_class_codes"] == ["TESTWATER"]


# --------------------------------------------------------------------------- #
# Normalization strategy
# --------------------------------------------------------------------------- #


def test_the_default_strategy_is_the_run_independent_bounded_ratio() -> None:
    assert land_conversion.DEFAULT_NORMALIZATION_STRATEGY == contract.NORMALIZATION_BOUNDED_RATIO


def test_bounded_ratio_scores_depend_only_on_the_cells_own_measurement() -> None:
    half = _cell("HALF", _area("TESTDEV1", "125000"), _area("TESTNAT1", "125000"))
    alone = land_conversion.normalized_scores([half], SYNTHETIC_REGISTRY)
    with_others = land_conversion.normalized_scores(
        [half, _cell("A", _area("TESTDEV1", "250000")), _cell("B", _area("TESTNAT1", "250000"))],
        SYNTHETIC_REGISTRY,
    )
    # A 50%-developed cell scores 50 either way: the score is a physical statement
    # about the cell, not its position among whichever other cells were scored.
    assert alone["HALF"] == Decimal("50.0000")
    assert with_others["HALF"] == Decimal("50.0000")


def test_percentile_ranking_is_still_selectable_and_is_run_relative() -> None:
    half = _cell("HALF", _area("TESTDEV1", "125000"), _area("TESTNAT1", "125000"))
    scores = land_conversion.normalized_scores(
        [half, _cell("A", _area("TESTDEV1", "250000")), _cell("B", _area("TESTNAT1", "250000"))],
        SYNTHETIC_REGISTRY,
        normalization_strategy=contract.NORMALIZATION_PERCENTILE_RANK,
    )
    assert scores["A"] == Decimal("100.0000")
    assert scores["HALF"] == Decimal("50.0000")
    assert scores["B"] == Decimal("0.0000")
    # And the same cell alone would rank at the neutral midpoint, not at 50% built.
    alone = land_conversion.normalized_scores(
        [_cell("A", _area("TESTDEV1", "250000"))],
        SYNTHETIC_REGISTRY,
        normalization_strategy=contract.NORMALIZATION_PERCENTILE_RANK,
    )
    assert alone["A"] == Decimal("50.0000")


# --------------------------------------------------------------------------- #
# Cross-level registry integrity
# --------------------------------------------------------------------------- #


def test_a_finer_registry_may_not_report_less_developed_area_than_a_coarser_one() -> None:
    coarse = LandCoverClassRegistry(
        registry_id="synthetic-coarse-v0",
        class_level=1,
        developed_class_codes=frozenset({"TESTDEV1"}),
        known_class_codes=frozenset({"TESTDEV1", "TESTNAT1"}),
        source="synthetic",
    )
    fine = LandCoverClassRegistry(
        registry_id="synthetic-fine-v0",
        class_level=1,
        developed_class_codes=frozenset({"TESTDEV1", "TESTNAT1"}),
        known_class_codes=frozenset({"TESTDEV1", "TESTNAT1"}),
        source="synthetic",
    )
    cell = _cell("C", _area("TESTDEV1", "100000"), _area("TESTNAT1", "150000"))
    coarse_obs = land_conversion.observe(cell, coarse)
    fine_obs = land_conversion.observe(cell, fine)
    # Widening the developed set can only raise the developed share.
    land_conversion.assert_developed_share_monotone_across_levels(coarse_obs, fine_obs)
    with pytest.raises(LandConversionConfigurationError):
        land_conversion.assert_developed_share_monotone_across_levels(fine_obs, coarse_obs)


def test_the_monotonicity_check_refuses_to_compare_different_cells() -> None:
    a = land_conversion.observe(_cell("A", _area("TESTDEV1", "250000")), SYNTHETIC_REGISTRY)
    b = land_conversion.observe(_cell("B", _area("TESTDEV1", "250000")), SYNTHETIC_REGISTRY)
    with pytest.raises(LandConversionConfigurationError):
        land_conversion.assert_developed_share_monotone_across_levels(a, b)


def test_provenance_records_the_registry_and_the_source_derivation() -> None:
    observation = land_conversion.observe(
        _cell("C", _area("TESTDEV1", "250000")), SYNTHETIC_REGISTRY
    )
    registry = observation.provenance["class_registry"]
    assert registry["registry_id"] == "synthetic-test-registry-v0"
    assert registry["approved"] is False
    assert observation.provenance["land_cover_derivation_version"] == "land-cover-cell-stats-v1"
    assert observation.provenance["area_crs"] == "EPSG:5186"
    assert observation.provenance["source_reference_period"] == "2025"
