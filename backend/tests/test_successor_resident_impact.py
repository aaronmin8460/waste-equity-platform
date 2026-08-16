"""Successor component C — ``resident_impact``.

Covers distance weighting, the explicit distance floor, zero distance, zero and
invalid population, refusal of non-metre distance measurements, inclusion of the
candidate's own containing unit, the set-based SQL contract, and determinism.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability.successor import contract, resident_impact
from waste_equity_backend.analysis.suitability.successor.resident_impact import (
    DISTANCE_MEASUREMENT_GEOGRAPHY_METERS,
    DistanceFloor,
    PopulationUnit,
    RepresentativeGeometry,
    ResidentImpactConfigurationError,
    ResidentImpactInput,
)

# Explicit synthetic floors only. No production value is approved, and this module
# ships no default, so every test states its own.
SYNTHETIC_FLOOR = DistanceFloor(
    distance_floor_m=Decimal("100"),
    basis="synthetic test value; not an approved production distance floor",
)


def _unit(
    code: str,
    population: int | None,
    distance: str | None,
    measurement: str = DISTANCE_MEASUREMENT_GEOGRAPHY_METERS,
) -> PopulationUnit:
    return PopulationUnit(
        unit_code=code,
        population=population,
        distance_m=(Decimal(distance) if distance is not None else None),
        distance_measurement=measurement,
        representative_geometry="ST_PointOnSurface(regions.geometry)",
        population_source_id="sgis",
        population_reference_period="2024",
    )


def _candidate(key: str, *units: PopulationUnit) -> ResidentImpactInput:
    return ResidentImpactInput(candidate_key=key, units=tuple(units))


# --------------------------------------------------------------------------- #
# Distance weighting
# --------------------------------------------------------------------------- #


def test_nearer_population_produces_greater_raw_impact() -> None:
    near = resident_impact.observe(_candidate("NEAR", _unit("R1", 10_000, "500")), SYNTHETIC_FLOOR)
    far = resident_impact.observe(_candidate("FAR", _unit("R1", 10_000, "5000")), SYNTHETIC_FLOOR)
    assert near.raw_value is not None and far.raw_value is not None
    assert near.raw_value > far.raw_value


def test_farther_population_produces_lower_raw_impact_monotonically() -> None:
    raws = []
    for distance in ("200", "400", "800", "1600"):
        observation = resident_impact.observe(
            _candidate("C", _unit("R1", 1_000, distance)), SYNTHETIC_FLOOR
        )
        assert observation.raw_value is not None
        raws.append(observation.raw_value)
    assert raws == sorted(raws, reverse=True)


def test_raw_value_is_the_exact_inverse_distance_sum() -> None:
    observation = resident_impact.observe(
        _candidate("C", _unit("A", 1_000, "500"), _unit("B", 2_000, "1000")),
        SYNTHETIC_FLOOR,
    )
    expected = (Decimal("1000") / Decimal("500")) + (Decimal("2000") / Decimal("1000"))
    assert observation.raw_value == expected.quantize(Decimal("0.0000000001"))
    assert observation.inputs["total_population"] == 3_000


def test_more_nearby_population_produces_greater_raw_impact() -> None:
    small = resident_impact.observe(_candidate("S", _unit("R", 1_000, "500")), SYNTHETIC_FLOOR)
    large = resident_impact.observe(_candidate("L", _unit("R", 9_000, "500")), SYNTHETIC_FLOOR)
    assert small.raw_value is not None and large.raw_value is not None
    assert large.raw_value > small.raw_value


# --------------------------------------------------------------------------- #
# Distance floor
# --------------------------------------------------------------------------- #


def test_zero_distance_is_bounded_by_the_floor_not_a_division_by_zero() -> None:
    observation = resident_impact.observe(
        _candidate("EXACT", _unit("R", 1_000, "0")), SYNTHETIC_FLOOR
    )
    assert observation.available
    assert observation.raw_value == (Decimal("1000") / Decimal("100")).quantize(
        Decimal("0.0000000001")
    )
    assert observation.inputs["floored_unit_count"] == 1
    assert observation.inputs["floored_units"] == ("R",)


def test_a_distance_below_the_floor_is_raised_to_the_floor() -> None:
    observation = resident_impact.observe(
        _candidate("NEAR", _unit("R", 1_000, "10")), SYNTHETIC_FLOOR
    )
    assert observation.raw_value == (Decimal("1000") / Decimal("100")).quantize(
        Decimal("0.0000000001")
    )


def test_the_floor_changes_the_result_so_it_must_be_explicit() -> None:
    tight = DistanceFloor(distance_floor_m=Decimal("10"), basis="synthetic tight floor")
    loose = DistanceFloor(distance_floor_m=Decimal("1000"), basis="synthetic loose floor")
    candidate = _candidate("C", _unit("R", 1_000, "0"))
    tight_raw = resident_impact.observe(candidate, tight).raw_value
    loose_raw = resident_impact.observe(candidate, loose).raw_value
    assert tight_raw is not None and loose_raw is not None
    assert tight_raw > loose_raw


def test_a_non_positive_floor_is_rejected() -> None:
    with pytest.raises(ResidentImpactConfigurationError):
        DistanceFloor(distance_floor_m=Decimal("0"), basis="synthetic")
    with pytest.raises(ResidentImpactConfigurationError):
        DistanceFloor(distance_floor_m=Decimal("-1"), basis="synthetic")


def test_a_floor_without_a_stated_basis_is_rejected() -> None:
    with pytest.raises(ResidentImpactConfigurationError):
        DistanceFloor(distance_floor_m=Decimal("100"), basis="   ")


def test_a_binary_float_floor_is_rejected() -> None:
    with pytest.raises(ResidentImpactConfigurationError):
        DistanceFloor(distance_floor_m=100.0, basis="synthetic")  # type: ignore[arg-type]


def test_no_production_floor_is_shipped_by_the_module() -> None:
    exported = [name for name in dir(resident_impact) if "FLOOR" in name.upper()]
    # Only the reason-agnostic machinery is exported; no default value constant.
    assert "DEFAULT_DISTANCE_FLOOR_M" not in exported
    assert "PRODUCTION_DISTANCE_FLOOR_M" not in exported
    assert SYNTHETIC_FLOOR.approved is False


# --------------------------------------------------------------------------- #
# Population validity
# --------------------------------------------------------------------------- #


def test_zero_population_contributes_nothing_but_stays_available() -> None:
    observation = resident_impact.observe(
        _candidate("C", _unit("A", 0, "500"), _unit("B", 1_000, "1000")),
        SYNTHETIC_FLOOR,
    )
    assert observation.available
    assert observation.raw_value == (Decimal("1000") / Decimal("1000")).quantize(
        Decimal("0.0000000001")
    )
    assert observation.inputs["total_population"] == 1_000


def test_a_missing_population_makes_the_whole_candidate_unavailable() -> None:
    observation = resident_impact.observe(
        _candidate("C", _unit("A", None, "500"), _unit("B", 1_000, "1000")),
        SYNTHETIC_FLOOR,
    )
    assert not observation.available
    assert contract.REASON_INVALID_POPULATION in observation.unavailable_reasons
    assert observation.inputs["invalid_population_units"] == ("A",)


def test_a_negative_population_is_invalid() -> None:
    observation = resident_impact.observe(_candidate("C", _unit("A", -1, "500")), SYNTHETIC_FLOOR)
    assert not observation.available
    assert contract.REASON_INVALID_POPULATION in observation.unavailable_reasons


def test_no_population_units_is_unavailable_not_zero_impact() -> None:
    observation = resident_impact.observe(_candidate("C"), SYNTHETIC_FLOOR)
    assert not observation.available
    assert contract.REASON_NO_POPULATION_UNITS in observation.unavailable_reasons


# --------------------------------------------------------------------------- #
# Distance validity and measurement
# --------------------------------------------------------------------------- #


def test_a_missing_distance_makes_the_candidate_unavailable() -> None:
    observation = resident_impact.observe(_candidate("C", _unit("A", 1_000, None)), SYNTHETIC_FLOOR)
    assert not observation.available
    assert contract.REASON_MISSING_DISTANCE in observation.unavailable_reasons


def test_a_negative_distance_is_invalid() -> None:
    observation = resident_impact.observe(_candidate("C", _unit("A", 1_000, "-5")), SYNTHETIC_FLOOR)
    assert not observation.available
    assert contract.REASON_INVALID_DISTANCE in observation.unavailable_reasons


def test_screen_or_prototype_coordinates_are_refused() -> None:
    observation = resident_impact.observe(
        _candidate("C", _unit("A", 1_000, "12", measurement="SVG_SCREEN_UNITS")),
        SYNTHETIC_FLOOR,
    )
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_DISTANCE_MEASUREMENT in observation.unavailable_reasons
    assert observation.inputs["incompatible_distance_measurement_units"] == ("A",)


def test_degree_distances_are_refused() -> None:
    observation = resident_impact.observe(
        _candidate("C", _unit("A", 1_000, "0.05", measurement="DEGREES")),
        SYNTHETIC_FLOOR,
    )
    assert not observation.available
    assert contract.REASON_INCOMPATIBLE_DISTANCE_MEASUREMENT in observation.unavailable_reasons


def test_projected_metre_distances_are_accepted() -> None:
    observation = resident_impact.observe(
        _candidate(
            "C",
            _unit(
                "A", 1_000, "500", measurement=resident_impact.DISTANCE_MEASUREMENT_PROJECTED_METERS
            ),
        ),
        SYNTHETIC_FLOOR,
    )
    assert observation.available


# --------------------------------------------------------------------------- #
# Self-unit inclusion
# --------------------------------------------------------------------------- #


def test_the_containing_population_unit_is_not_excluded() -> None:
    assert resident_impact.SELF_UNIT_EXCLUSION is False
    containing = _unit("SELF", 50_000, "0")
    neighbour = _unit("NEIGHBOUR", 50_000, "5000")
    with_self = resident_impact.observe(_candidate("C", containing, neighbour), SYNTHETIC_FLOOR)
    without_self = resident_impact.observe(_candidate("C", neighbour), SYNTHETIC_FLOOR)
    assert with_self.raw_value is not None and without_self.raw_value is not None
    assert with_self.raw_value > without_self.raw_value
    assert with_self.inputs["total_population"] == 100_000


# --------------------------------------------------------------------------- #
# Normalization
# --------------------------------------------------------------------------- #


def test_lower_raw_impact_scores_higher() -> None:
    scores = resident_impact.normalized_scores(
        [
            _candidate("QUIET", _unit("R", 1_000, "5000")),
            _candidate("BUSY", _unit("R", 100_000, "500")),
        ],
        SYNTHETIC_FLOOR,
    )
    assert scores["QUIET"] == Decimal("100.0000")
    assert scores["BUSY"] == Decimal("0.0000")


def test_unavailable_candidates_are_absent_from_the_ranking() -> None:
    series = resident_impact.build_series(
        [
            _candidate("A", _unit("R", 1_000, "5000")),
            _candidate("B", _unit("R", 100_000, "500")),
            _candidate("BAD", _unit("R", None, "500")),
        ],
        SYNTHETIC_FLOOR,
    )
    assert set(series.normalized_scores()) == {"A", "B"}


# --------------------------------------------------------------------------- #
# Representative geometry and the set-based SQL
# --------------------------------------------------------------------------- #


def test_only_project_native_representative_conventions_are_accepted() -> None:
    assert set(resident_impact.REPRESENTATIVE_GEOMETRY_CONVENTIONS) == {
        "ST_PointOnSurface",
        "ST_Centroid",
    }
    with pytest.raises(ResidentImpactConfigurationError):
        RepresentativeGeometry(convention="prototype_xy")


def test_representative_geometry_builds_a_project_native_expression() -> None:
    representative = RepresentativeGeometry(convention="ST_PointOnSurface")
    assert representative.sql_expression("r") == "ST_PointOnSurface(r.geometry)"


def test_the_runtime_derivation_is_set_based_and_geodesic() -> None:
    sql = resident_impact.population_weighted_impact_sql(
        RepresentativeGeometry(convention="ST_PointOnSurface")
    )
    assert "GROUP BY c.candidate_key" in sql
    assert "::geography" in sql
    assert "GREATEST(" in sql
    assert ":distance_floor_m" in sql
    # No self-exclusion predicate: the containing unit participates.
    assert "r.id <>" not in sql
    assert "!=" not in sql


def test_the_audit_statement_records_both_conventions_rather_than_picking_one() -> None:
    sql = resident_impact.representative_point_audit_sql()
    assert "ST_Centroid" in sql
    assert "ST_PointOnSurface" in sql
    assert "ST_Contains" in sql
    assert "centroid_to_surface_point_m" in sql
    assert ":boundary_vintage_year" in sql


def test_a_centroid_outside_its_region_is_flagged() -> None:
    # The archipelago case: an area-weighted centroid of scattered islands can land
    # in open water, placing a county's whole population where nobody lives.
    flags = resident_impact.representative_point_divergence_flags(
        centroid_inside_region=False,
        centroid_to_surface_point_m=Decimal("42000"),
        equivalent_circle_radius_m=Decimal("9000"),
    )
    assert "CENTROID_OUTSIDE_REGION" in flags
    assert "REPRESENTATIVE_POINTS_DIVERGE_BEYOND_REGION_RADIUS" in flags


def test_a_well_behaved_region_raises_no_representative_point_flag() -> None:
    flags = resident_impact.representative_point_divergence_flags(
        centroid_inside_region=True,
        centroid_to_surface_point_m=Decimal("300"),
        equivalent_circle_radius_m=Decimal("2800"),
    )
    assert flags == ()


def test_the_single_point_mass_limitation_is_disclosed_not_implied() -> None:
    series = resident_impact.build_series(
        [_candidate("C", _unit("R", 1_000, "500"))], SYNTHETIC_FLOOR
    )
    assert series.disclaimer is not None
    assert "SIGUNGU resolution from a single representative point" in series.disclaimer
    assert (
        "single representative point"
        in series.observations[0].provenance["population_resolution_disclosure"]
    )


def test_the_sql_contract_summary_documents_the_missing_population_policy() -> None:
    summary = resident_impact.sql_contract_summary(RepresentativeGeometry(convention="ST_Centroid"))
    assert summary["self_unit_exclusion"] is False
    assert "run_id" in summary["bind_parameters"]
    assert "distance_floor_m" in summary["bind_parameters"]
    assert "zero-filled" in summary["missing_population_policy"]


# --------------------------------------------------------------------------- #
# Determinism
# --------------------------------------------------------------------------- #


def test_output_is_deterministic_regardless_of_unit_order() -> None:
    units = [_unit("A", 1_000, "500"), _unit("B", 2_000, "1500"), _unit("C", 3_000, "2500")]
    first = resident_impact.observe(ResidentImpactInput("C1", tuple(units)), SYNTHETIC_FLOOR)
    second = resident_impact.observe(
        ResidentImpactInput("C1", tuple(reversed(units))), SYNTHETIC_FLOOR
    )
    assert first.raw_value == second.raw_value
    assert first.sanitized_summary() == second.sanitized_summary()


def test_raw_value_is_an_exact_decimal() -> None:
    observation = resident_impact.observe(_candidate("C", _unit("A", 1_000, "3")), SYNTHETIC_FLOOR)
    assert isinstance(observation.raw_value, Decimal)
