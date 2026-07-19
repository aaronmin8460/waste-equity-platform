"""Focused unit tests for the user-weight scenario domain module (Phase 6).

Pure Decimal math + SHA-256 hashing, no DB. Covers weight parsing/validation,
canonicalization, exact scoring/provisional semantics, deterministic hashing, and
the rank-delta convention. The SQL scoring paths are covered by the PostGIS
integration tests; this file pins the single documented formula the SQL mirrors.
See ``docs/SUITABILITY_USER_WEIGHT_SCENARIOS.md``.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from waste_equity_backend.analysis.suitability import policy, scenario

BASELINE = {"zoning": "0.35", "road": "0.25", "equity": "0.25", "demand": "0.15"}
EQUAL = {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25"}


def _comp(z: str, r: str, e: str, d: str) -> dict[str, Decimal]:
    return {"zoning": Decimal(z), "road": Decimal(r), "equity": Decimal(e), "demand": Decimal(d)}


# --- method version independence ---------------------------------------------


def test_method_version_is_separate_and_does_not_touch_stored_versions() -> None:
    assert scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION == "user-weight-scenario-v1"
    # It must NOT collide with or shadow any stored-run derivation version.
    assert scenario.USER_WEIGHT_SCENARIO_METHOD_VERSION not in {
        policy.POLICY_VERSION,
        policy.DERIVATION_VERSION,
        policy.CANDIDATE_GRID_VERSION,
        policy.CRITIC_METHOD_VERSION,
        policy.STABILITY_METHOD_VERSION,
    }


# --- weight validation / canonicalization ------------------------------------


def test_baseline_weights_canonicalize_to_8dp() -> None:
    canonical = scenario.parse_and_validate_weights(BASELINE)
    assert scenario.canonical_weight_strings(canonical) == {
        "zoning": "0.35000000",
        "road": "0.25000000",
        "equity": "0.25000000",
        "demand": "0.15000000",
    }


def test_equal_weights_canonicalize() -> None:
    canonical = scenario.canonical_weight_strings(scenario.parse_and_validate_weights(EQUAL))
    assert canonical == {c: "0.25000000" for c in ("zoning", "road", "equity", "demand")}


def test_sum_exactly_one_passes() -> None:
    scenario.parse_and_validate_weights(
        {
            "zoning": "0.10000000",
            "road": "0.20000000",
            "equity": "0.30000000",
            "demand": "0.40000000",
        }
    )


def test_sum_below_one_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError) as exc:
        scenario.parse_and_validate_weights(
            {"zoning": "0.35", "road": "0.25", "equity": "0.25", "demand": "0.14"}
        )
    assert exc.value.fields["sum"] == "0.99000000"


def test_sum_above_one_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError) as exc:
        scenario.parse_and_validate_weights(
            {"zoning": "0.35", "road": "0.25", "equity": "0.25", "demand": "0.16"}
        )
    assert exc.value.fields["sum"] == "1.01000000"


def test_negative_value_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": "-0.10", "road": "0.40", "equity": "0.35", "demand": "0.35"}
        )


def test_value_above_one_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": "1.50", "road": "0.00", "equity": "0.00", "demand": "0.00"}
        )


def test_nan_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": "NaN", "road": "0.25", "equity": "0.25", "demand": "0.15"}
        )


def test_infinity_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": "Infinity", "road": "0.25", "equity": "0.25", "demand": "0.15"}
        )


def test_missing_component_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError) as exc:
        scenario.parse_and_validate_weights({"zoning": "0.5", "road": "0.5", "equity": "0.0"})
    assert exc.value.error == "INVALID_SCENARIO_WEIGHTS"
    assert "demand" in exc.value.fields["missing"]


def test_unknown_component_fails() -> None:
    with pytest.raises(scenario.ScenarioWeightError) as exc:
        scenario.parse_and_validate_weights(
            {"zoning": "0.25", "road": "0.25", "equity": "0.25", "demand": "0.25", "extra": "0.0"}
        )
    assert "extra" in exc.value.fields["unknown"]


def test_all_zero_weights_fail() -> None:
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": "0", "road": "0", "equity": "0", "demand": "0"}
        )


def test_one_component_one_others_zero_passes() -> None:
    canonical = scenario.canonical_weight_strings(
        scenario.parse_and_validate_weights(
            {"zoning": "1", "road": "0", "equity": "0", "demand": "0"}
        )
    )
    assert canonical == {
        "zoning": "1.00000000",
        "road": "0.00000000",
        "equity": "0.00000000",
        "demand": "0.00000000",
    }


def test_float_input_rejected() -> None:
    # Binary floats must not silently enter canonical weight math.
    with pytest.raises(scenario.ScenarioWeightError):
        scenario.parse_and_validate_weights(
            {"zoning": 0.35, "road": "0.25", "equity": "0.25", "demand": "0.15"}
        )


# --- deterministic scenario hash ---------------------------------------------


def test_identical_input_same_hash() -> None:
    w = scenario.parse_and_validate_weights(BASELINE)
    assert scenario.scenario_hash(48, w) == scenario.scenario_hash(48, w)


def test_criterion_input_ordering_does_not_change_hash() -> None:
    reordered = {"demand": "0.15", "equity": "0.25", "road": "0.25", "zoning": "0.35"}
    a = scenario.scenario_hash(48, scenario.parse_and_validate_weights(BASELINE))
    b = scenario.scenario_hash(48, scenario.parse_and_validate_weights(reordered))
    assert a == b


def test_different_run_ids_change_hash() -> None:
    w = scenario.parse_and_validate_weights(BASELINE)
    assert scenario.scenario_hash(48, w) != scenario.scenario_hash(47, w)


def test_different_weights_change_hash() -> None:
    a = scenario.scenario_hash(48, scenario.parse_and_validate_weights(BASELINE))
    b = scenario.scenario_hash(48, scenario.parse_and_validate_weights(EQUAL))
    assert a != b


def test_hash_is_full_sha256_hex() -> None:
    h = scenario.scenario_hash(48, scenario.parse_and_validate_weights(BASELINE))
    assert len(h) == 64
    int(h, 16)  # valid hex
    assert scenario.short_scenario_hash(h) == h[:12]


def test_hash_payload_is_canonical_and_excludes_extras() -> None:
    w = scenario.parse_and_validate_weights(BASELINE)
    payload = scenario.canonical_hash_payload(48, w)
    assert payload == (
        '{"method_version":"user-weight-scenario-v1","run_id":48,'
        '"weights":{"zoning":"0.35000000","road":"0.25000000",'
        '"equity":"0.25000000","demand":"0.15000000"}}'
    )
    # comparison profile / top_n / candidate are not part of the identity
    assert "compare" not in payload and "top_n" not in payload and "candidate" not in payload


# --- exact ELIGIBLE scoring (mirrors the SQL) --------------------------------


def test_exact_eligible_score_matches_expected_decimal() -> None:
    w = scenario.parse_and_validate_weights(BASELINE)
    components = _comp("55.0000", "100.0000", "100.0000", "50.0000")
    # 55*.35 + 100*.25 + 100*.25 + 50*.15 = 19.25 + 25 + 25 + 7.5 = 76.75
    assert scenario.scenario_score(components, w) == Decimal("76.7500")


def test_score_quantization_matches_policy_composite() -> None:
    w = scenario.parse_and_validate_weights(EQUAL)
    components = _comp("33.3333", "66.6667", "10.0001", "99.9999")
    # scenario scoring is exactly policy.composite (0-100, 4dp, ROUND_HALF_EVEN)
    assert scenario.scenario_score(components, w) == policy.composite(components, dict(w))


def test_one_weight_one_selects_single_component() -> None:
    w = scenario.parse_and_validate_weights(
        {"zoning": "0", "road": "1", "equity": "0", "demand": "0"}
    )
    components = _comp("10.0000", "88.0000", "20.0000", "30.0000")
    assert scenario.scenario_score(components, w) == Decimal("88.0000")


# --- provisional score semantics ---------------------------------------------


def test_provisional_normalizes_available_weights() -> None:
    w = scenario.parse_and_validate_weights(BASELINE)
    # demand missing → renormalize over zoning/road/equity (weights 0.35/0.25/0.25)
    components = {"zoning": Decimal("40"), "road": Decimal("80"), "equity": Decimal("60")}
    # (40*.35 + 80*.25 + 60*.25) / (.35+.25+.25) = (14+20+15)/0.85 = 49/0.85 = 57.647...
    prov = scenario.scenario_provisional_score(components, w)
    assert prov == Decimal("57.6471")


def test_missing_components_never_zero_filled() -> None:
    w = scenario.parse_and_validate_weights(EQUAL)
    partial = {"zoning": Decimal("50"), "road": Decimal("50")}
    prov = scenario.scenario_provisional_score(partial, w)
    # renormalized over the two present (each 0.25): (50*.25+50*.25)/0.5 = 50, not 25
    assert prov == Decimal("50.0000")
    # a zero-fill would have produced (50+50+0+0)/... = 25
    assert prov != Decimal("25.0000")


def test_zero_available_weight_denominator_returns_unavailable() -> None:
    # only components with weight 0 are present → denominator 0 → unavailable
    w = scenario.parse_and_validate_weights(
        {"zoning": "0", "road": "0", "equity": "0.5", "demand": "0.5"}
    )
    present = {"zoning": Decimal("40"), "road": Decimal("80")}
    assert scenario.scenario_provisional_score(present, w) is None


def test_no_present_components_returns_none() -> None:
    w = scenario.parse_and_validate_weights(EQUAL)
    assert scenario.scenario_provisional_score({}, w) is None


# --- rank-delta convention ---------------------------------------------------


def test_rank_delta_direction() -> None:
    # comparison rank 42, custom rank 18 → moved up 24
    assert scenario.rank_delta(42, 18) == 24
    assert scenario.rank_change_direction(24) == scenario.RANK_UP
    # comparison 18, custom 42 → moved down
    assert scenario.rank_delta(18, 42) == -24
    assert scenario.rank_change_direction(-24) == scenario.RANK_DOWN
    # unchanged
    assert scenario.rank_delta(10, 10) == 0
    assert scenario.rank_change_direction(0) == scenario.RANK_SAME
    # unavailable when either rank is None
    assert scenario.rank_delta(None, 5) is None
    assert scenario.rank_change_direction(None) is None
