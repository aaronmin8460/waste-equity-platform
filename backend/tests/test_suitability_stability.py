"""Engine-level tests for CRITIC integration + weight-sensitivity stability.

Exercises ``_apply_critic_and_stability`` and the stability helpers on synthetic
scored candidates (no DB): cutoff = ceil(N * 0.10) (min 1), the three stability
classes, review/excluded never classified, deterministic ranks, static-profile
regression (four profiles unchanged), and the analysis-signature sensitivity.
"""

from __future__ import annotations

import math
from decimal import Decimal
from typing import Any

import pytest

from waste_equity_backend.analysis.suitability import policy
from waste_equity_backend.analysis.suitability.critic import CriticUndefinedError
from waste_equity_backend.analysis.suitability.engine import (
    RegionComponents,
    ResolvedInputs,
    _analysis_signature,
    _apply_critic_and_stability,
    _score_candidates,
    _stability_top_cutoff_rank,
)

# --------------------------------------------------------------------------- #
# A synthetic region with many SIGUNGU so we get many distinct eligible cells.
# --------------------------------------------------------------------------- #


def _region(n: int) -> RegionComponents:
    equity = {str(1000 + i): Decimal(i * 100 // max(1, n - 1)) for i in range(n)}
    demand = {str(1000 + i): Decimal(100 - i * 100 // max(1, n - 1)) for i in range(n)}
    return RegionComponents(
        equity_scores=equity,
        demand_scores=demand,
        equity_raw={k: {} for k in equity},
        demand_raw={k: {} for k in demand},
        equity_provenance={"source_id": "x"},
        demand_provenance={"source_id": "x"},
    )


def _fact(i: int, **over: Any) -> dict[str, Any]:
    code = str(1000 + i)
    base = {
        "gid": i,
        "candidate_key": f"capital-grid-500m-v1:{i:04d}_{i:04d}",
        "sido_code": "28",
        "sido_name": "인천광역시",
        "sigungu_code": code,
        "sigungu_name": "x",
        "sigungu_count": 1,
        "original_area_m2": Decimal("250000.00"),
        "clipped_area_m2": Decimal("250000.00"),
        "hard_protected_hits": None,
        "zoning_hard_hit": False,
        "uo101_hit": False,
        "uo301_hit": False,
        "zoning_code": "UQ112" if i % 2 else "UQ113",
        "dist_m": float(100 + i * 137),
        "road_layer": "STDLINK",
        "road_version_id": 1,
    }
    base.update(over)
    return base


def _eligible_run(n: int, active_profile: str = "baseline"):
    region = _region(n)
    facts = [_fact(i) for i in range(n)]
    scored, excl, rev = _score_candidates(facts, region, {}, active_profile)
    cs = _apply_critic_and_stability(scored, active_profile, 2024)
    return scored, cs


# --------------------------------------------------------------------------- #
# Cutoff rule
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "n,expected",
    [(1, 1), (2, 1), (10, 1), (11, 2), (20, 2), (21, 3), (100, 10), (101, 11)],
)
def test_cutoff_is_ceil_ten_percent_min_one(n: int, expected: int) -> None:
    assert _stability_top_cutoff_rank(n) == expected
    assert _stability_top_cutoff_rank(n) == max(1, math.ceil(n * policy.STABILITY_TOP_FRACTION))


# --------------------------------------------------------------------------- #
# Stability classes
# --------------------------------------------------------------------------- #


def test_three_memberships_is_stable() -> None:
    scored, cs = _eligible_run(30)
    elig = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE]
    stable = [s for s in elig if s["stable_count"] == 3]
    assert stable, "expected at least one stable candidate"
    for s in stable:
        assert s["stability_class"] == "STABLE"
        assert all(s["stability_membership"][p] for p in policy.STABILITY_PROFILES)
    assert cs.candidate_count_stable == len(stable)


def test_classes_partition_eligible_and_counts_match() -> None:
    scored, cs = _eligible_run(50)
    elig = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE]
    by_class: dict[str, int] = {}
    for s in elig:
        assert s["stable_count"] in (0, 1, 2, 3)
        expected = {
            3: "STABLE",
            2: "CONDITIONALLY_STABLE",
            1: "WEIGHT_SENSITIVE",
            0: "WEIGHT_SENSITIVE",
        }
        assert s["stability_class"] == expected[s["stable_count"]]
        by_class[s["stability_class"]] = by_class.get(s["stability_class"], 0) + 1
    assert by_class.get("STABLE", 0) == cs.candidate_count_stable
    assert by_class.get("CONDITIONALLY_STABLE", 0) == cs.candidate_count_conditionally_stable
    assert by_class.get("WEIGHT_SENSITIVE", 0) == cs.candidate_count_weight_sensitive
    assert (
        cs.candidate_count_stable
        + cs.candidate_count_conditionally_stable
        + cs.candidate_count_weight_sensitive
        == len(elig)
    )


def test_conditionally_stable_when_two_of_three() -> None:
    scored, _cs = _eligible_run(50)
    cond = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE and s["stable_count"] == 2]
    for s in cond:
        assert s["stability_class"] == "CONDITIONALLY_STABLE"
        assert sum(1 for v in s["stability_membership"].values() if v) == 2


def test_review_and_excluded_have_no_stability() -> None:
    region = _region(20)
    facts = [_fact(i) for i in range(20)]
    # one review (urban zoning) + one excluded (hard exclusion)
    facts[0] = _fact(0, zoning_code="UQ111")  # review
    facts[1] = _fact(1, hard_protected_hits=["UD801"])  # excluded
    scored, _e, _r = _score_candidates(facts, region, {}, "baseline")
    _apply_critic_and_stability(scored, "baseline", 2024)
    by_key = {s["candidate_key"]: s for s in scored}
    review = by_key["capital-grid-500m-v1:0000_0000"]
    excluded = by_key["capital-grid-500m-v1:0001_0001"]
    assert review["status"] == policy.STATUS_REVIEW
    assert excluded["status"] == policy.STATUS_EXCLUDED
    for s in (review, excluded):
        assert s["stable_count"] is None
        assert s["stability_class"] is None
        assert s["stability_membership"] == {}
    # review may still carry a provisional critic total; excluded never does
    assert "critic" in review["profile_totals"]
    assert excluded["profile_totals"] == {}


def test_deterministic_repeated_execution() -> None:
    a_scored, a_cs = _eligible_run(40)
    b_scored, b_cs = _eligible_run(40)
    assert a_cs.weight_derivation == b_cs.weight_derivation
    assert a_cs.stability_definition == b_cs.stability_definition
    a_by = {s["candidate_key"]: (s["stable_count"], s["stability_class"]) for s in a_scored}
    b_by = {s["candidate_key"]: (s["stable_count"], s["stability_class"]) for s in b_scored}
    assert a_by == b_by


# --------------------------------------------------------------------------- #
# Static-profile regression + critic presence
# --------------------------------------------------------------------------- #


def test_static_profiles_unchanged_and_critic_added() -> None:
    scored, cs = _eligible_run(30)
    elig = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE][0]
    # all five profiles present in totals and ranks for an eligible candidate
    assert set(elig["profile_totals"]) == set(policy.SUPPORTED_PROFILES)
    assert set(elig["profile_ranks"]) == set(policy.SUPPORTED_PROFILES)
    # the four static profiles are exactly the fixed policy weights in the run
    for p in policy.STATIC_WEIGHT_PROFILES:
        assert cs.run_weight_profiles[p] == {
            c: str(w) for c, w in policy.STATIC_WEIGHT_PROFILES[p].items()
        }
    # critic weights sum to 1 and are stored as the run-specific vector
    assert sum(Decimal(v) for v in cs.run_weight_profiles["critic"].values()) == Decimal("1")


def test_static_profile_totals_match_composite() -> None:
    # The four static totals equal policy.composite over the exact component scores,
    # unaffected by the CRITIC/stability stage.
    scored, _cs = _eligible_run(20)
    for s in scored:
        if s["status"] != policy.STATUS_ELIGIBLE:
            continue
        comps = {
            "zoning": Decimal(s["zoning_score"]),
            "road": Decimal(s["road_score"]),
            "equity": Decimal(s["equity_score"]),
            "demand": Decimal(s["demand_score"]),
        }
        for p in policy.STATIC_WEIGHT_PROFILES:
            assert s["profile_totals"][p] == str(policy.composite(comps, p))


def test_critic_undefined_with_single_eligible() -> None:
    # One eligible candidate -> CRITIC population N=1 -> structured undefined error.
    region = _region(2)
    facts = [_fact(0), _fact(1, hard_protected_hits=["UD801"])]  # 1 eligible, 1 excluded
    scored, _e, _r = _score_candidates(facts, region, {}, "baseline")
    with pytest.raises(CriticUndefinedError) as exc:
        _apply_critic_and_stability(scored, "baseline", 2024)
    assert exc.value.category == "CRITIC_UNDEFINED"


def test_critic_active_profile_sets_first_class_fields() -> None:
    scored, _cs = _eligible_run(30, active_profile="critic")
    elig = [s for s in scored if s["status"] == policy.STATUS_ELIGIBLE]
    for s in elig:
        assert s["rank"] == s["profile_ranks"]["critic"]
        assert s["total_score"] == s["profile_totals"]["critic"]


# --------------------------------------------------------------------------- #
# Analysis-signature sensitivity to the new versioned inputs
# --------------------------------------------------------------------------- #


def _inputs() -> ResolvedInputs:
    return ResolvedInputs(
        reference_year=2024,
        boundary_vintage="2024",
        structural_version_ids=[18, 77, 100],
        structural_versions=[],
        population_reference_period="2024",
        waste_reference_period="2024",
        facility_reference_period="2024",
    )


def test_signature_includes_method_versions_and_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    base = _analysis_signature(_inputs(), "baseline")
    monkeypatch.setattr(policy, "CRITIC_METHOD_VERSION", "critic-weights-v2")
    assert _analysis_signature(_inputs(), "baseline") != base
    monkeypatch.setattr(policy, "CRITIC_METHOD_VERSION", "critic-weights-v1")
    monkeypatch.setattr(policy, "STABILITY_METHOD_VERSION", "suitability-stability-v2")
    assert _analysis_signature(_inputs(), "baseline") != base
    monkeypatch.setattr(policy, "STABILITY_METHOD_VERSION", "suitability-stability-v1")
    monkeypatch.setattr(policy, "STABILITY_TOP_FRACTION", Decimal("0.05"))
    assert _analysis_signature(_inputs(), "baseline") != base


def test_signature_reuse_identical_inputs() -> None:
    assert _analysis_signature(_inputs(), "baseline") == _analysis_signature(_inputs(), "baseline")
