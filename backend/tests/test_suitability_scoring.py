"""Pure tests for the suitability scoring/status logic (Phase 5.4).

These exercise ``_score_candidates`` and ``_assign_ranks`` with synthetic
per-candidate facts (no DB), covering exclusion, review, eligibility, missing
components, coverage gaps, tie-breaking, and per-profile totals.
"""

from __future__ import annotations

import copy
from decimal import Decimal
from typing import Any

from waste_equity_backend.analysis.suitability import policy
from waste_equity_backend.analysis.suitability.engine import (
    RegionComponents,
    ResolvedInputs,
    _analysis_signature,
    _effective_coverage_gaps,
    _score_candidates,
)


def _inputs(year: int = 2024, ids: list[int] | None = None) -> ResolvedInputs:
    return ResolvedInputs(
        reference_year=year,
        boundary_vintage="2024",
        structural_version_ids=ids if ids is not None else [18, 77, 100, 62, 63],
        structural_versions=[],
        population_reference_period="2024",
        waste_reference_period="2024",
        facility_reference_period="2024",
    )


def test_analysis_signature_determinism_and_sensitivity() -> None:
    base = _analysis_signature(_inputs(), "baseline")
    assert len(base) == 64
    # deterministic
    assert _analysis_signature(_inputs(), "baseline") == base
    # version-id order independent (sorted internally)
    assert _analysis_signature(_inputs(ids=[100, 77, 18, 63, 62]), "baseline") == base
    # a different profile -> a distinct signature (a distinct run)
    assert _analysis_signature(_inputs(), "equal") != base
    # a different reference year / input -> a distinct signature
    assert _analysis_signature(_inputs(year=2023), "baseline") != base
    assert _analysis_signature(_inputs(ids=[18, 77, 100]), "baseline") != base
    # activating an additional dataset version changes the selected input set,
    # so the signature (and therefore the run) is distinct.
    assert _analysis_signature(_inputs(ids=[18, 77, 100, 62, 63, 121]), "baseline") != base


SIGUNGU = "28710"


def _region() -> RegionComponents:
    return RegionComponents(
        equity_scores={SIGUNGU: Decimal("100.0000")},
        demand_scores={SIGUNGU: Decimal("50.0000")},
        equity_raw={
            SIGUNGU: {
                "located_burden_kg_per_capita": "0",
                "accounting_basis": "FACILITY_LOCATION_BASED_THROUGHPUT",
            }
        },
        demand_raw={
            SIGUNGU: {
                "household_per_capita_kg_per_year": "300",
                "accounting_basis": "ORIGIN_BASED_TREATMENT_OUTCOME",
            }
        },
        equity_provenance={"source_id": "waste_statistics"},
        demand_provenance={"source_id": "waste_statistics"},
    )


def _fact(gid: int = 1, **over: Any) -> dict[str, Any]:
    base = {
        "gid": gid,
        "candidate_key": f"capital-grid-500m-v1:{gid}_{gid}",
        "sido_code": "28",
        "sido_name": "인천광역시",
        "sigungu_code": SIGUNGU,
        "sigungu_name": "강화군",
        "sigungu_count": 1,
        "original_area_m2": Decimal("250000.00"),
        "clipped_area_m2": Decimal("250000.00"),
        "hard_protected_hits": None,
        "zoning_hard_hit": False,
        "uo101_hit": False,
        "uo301_hit": False,
        "zoning_code": "UQ112",
        "dist_m": 100.0,
        "road_layer": "STDLINK",
        "road_version_id": 100,
    }
    base.update(over)
    return base


def _score(facts: list[dict[str, Any]], coverage: dict[str, set[str]] | None = None):
    return _score_candidates(facts, _region(), coverage or {}, "baseline")


def test_eligible_all_components() -> None:
    scored, excl, rev = _score([_fact()])
    s = scored[0]
    assert s["status"] == policy.STATUS_ELIGIBLE
    assert s["zoning_score"] == "55.0000"
    assert s["road_score"] == "100.0000"
    assert s["equity_score"] == "100.0000"
    assert s["demand_score"] == "50.0000"
    # baseline = 0.35*55 + 0.25*100 + 0.25*100 + 0.15*50
    assert s["profile_totals"]["baseline"] == "76.7500"
    assert s["total_score"] == "76.7500"
    assert s["rank"] == 1
    assert s["exclusion_reasons"] == []
    assert s["review_reasons"] == []
    assert excl == {} and rev == {}


def test_excluded_multiple_reasons_no_scores() -> None:
    scored, excl, rev = _score(
        [_fact(hard_protected_hits=["UD801", "UF151"], zoning_hard_hit=True)]
    )
    s = scored[0]
    assert s["status"] == policy.STATUS_EXCLUDED
    assert set(s["exclusion_reasons"]) == {
        "PROJECT_SCREENING_EXCLUSION:UD801",
        "PROJECT_SCREENING_EXCLUSION:UF151",
        "PROJECT_SCREENING_EXCLUSION:UQ114",
    }
    # Excluded: no scores, no rank, no review reasons.
    assert s["review_reasons"] == []
    assert s["total_score"] is None and s["provisional_score"] is None
    assert s["zoning_score"] is None and s["road_score"] is None
    assert s["rank"] is None
    assert s["profile_totals"] == {}
    assert rev == {}  # excluded contributes no review reasons
    assert excl["PROJECT_SCREENING_EXCLUSION:UD801"] == 1


def test_review_urban_zoning() -> None:
    scored, _e, rev = _score([_fact(zoning_code="UQ111")])
    s = scored[0]
    assert s["status"] == policy.STATUS_REVIEW
    assert "UNRESOLVED_URBAN_ZONING_SUBCLASS" in s["review_reasons"]
    assert s["zoning_score"] is None
    assert s["rank"] is None
    assert s["provisional_score"] is not None  # provisional from present components
    assert rev["UNRESOLVED_URBAN_ZONING_SUBCLASS"] == 1


def test_review_education_and_heritage() -> None:
    scored, _e, _r = _score([_fact(uo101_hit=True, uo301_hit=True)])
    reasons = scored[0]["review_reasons"]
    assert "EDUCATION_PROTECTION_UO101" in reasons
    assert "HERITAGE_PROTECTION_UO301" in reasons
    assert scored[0]["status"] == policy.STATUS_REVIEW


def test_review_coverage_gap() -> None:
    scored, _e, _r = _score(
        [_fact(sido_name="서울특별시")],
        coverage={"서울특별시": {"UM901", "UF151"}},
    )
    reasons = scored[0]["review_reasons"]
    assert "COVERAGE_GAP_UM901" in reasons
    assert "COVERAGE_GAP_UF151" in reasons


def test_review_missing_demand() -> None:
    # sigungu present for equity but not demand.
    region = RegionComponents(
        equity_scores={SIGUNGU: Decimal("100")},
        demand_scores={},
        equity_raw={SIGUNGU: {}},
        demand_raw={},
        equity_provenance={},
        demand_provenance={},
    )
    scored, _e, _r = _score_candidates([_fact()], region, {}, "baseline")
    assert scored[0]["status"] == policy.STATUS_REVIEW
    assert "MISSING_DEMAND_COMPONENT" in scored[0]["review_reasons"]
    assert scored[0]["demand_score"] is None


def test_review_ambiguous_sigungu() -> None:
    scored, _e, _r = _score([_fact(sigungu_count=0, sigungu_code=None)])
    reasons = scored[0]["review_reasons"]
    assert "AMBIGUOUS_OR_MISSING_SIGUNGU" in reasons
    assert "MISSING_EQUITY_COMPONENT" in reasons
    assert "MISSING_DEMAND_COMPONENT" in reasons


def test_review_no_zoning_coverage() -> None:
    scored, _e, _r = _score([_fact(zoning_code=None)])
    assert "NO_ZONING_COVERAGE" in scored[0]["review_reasons"]


def test_unmapped_zoning_never_eligible() -> None:
    scored, _e, _r = _score([_fact(zoning_code="UQXYZ")])
    assert scored[0]["status"] == policy.STATUS_REVIEW
    assert "UNMAPPED_ZONING" in scored[0]["review_reasons"]


def test_road_score_from_curve() -> None:
    scored, _e, _r = _score([_fact(dist_m=2000.0)])
    assert scored[0]["road_score"] == "45.0000"
    assert scored[0]["nearest_road_distance_m"] == 2000.0


def test_ranking_tie_break_by_candidate_key() -> None:
    # Two identical eligible candidates -> lower candidate_key ranks first.
    a = _fact(gid=2, candidate_key="capital-grid-500m-v1:2_2")
    b = _fact(gid=1, candidate_key="capital-grid-500m-v1:1_1")
    scored, _e, _r = _score([a, b])
    by_key = {s["candidate_key"]: s for s in scored}
    assert by_key["capital-grid-500m-v1:1_1"]["rank"] == 1
    assert by_key["capital-grid-500m-v1:2_2"]["rank"] == 2
    # Ranks assigned per profile.
    for prof in policy.WEIGHT_PROFILES:
        assert by_key["capital-grid-500m-v1:1_1"]["profile_ranks"][prof] == 1


def test_excluded_takes_precedence_over_review() -> None:
    # Hard exclusion + would-be review (urban zoning) -> EXCLUDED, no review reasons.
    scored, _e, _r = _score([_fact(zoning_code="UQ111", hard_protected_hits=["UD801"])])
    assert scored[0]["status"] == policy.STATUS_EXCLUDED
    assert scored[0]["review_reasons"] == []


def test_all_profiles_totals_present_for_eligible() -> None:
    scored, _e, _r = _score([_fact()])
    assert set(scored[0]["profile_totals"]) == set(policy.WEIGHT_PROFILES)
    for v in scored[0]["profile_totals"].values():
        assert Decimal("0") <= Decimal(v) <= Decimal("100")


# --------------------------------------------------------------------------- #
# Effective-coverage gap rule (_effective_coverage_gaps)
# --------------------------------------------------------------------------- #

_UNAVAILABLE = "OFFICIAL_SOURCE_UNAVAILABLE"
_WITH_FEATURES = "COMPLETE_WITH_FEATURES"
_ZERO_FEATURES = "COMPLETE_ZERO_FEATURES"
_MISSING = "SOURCE_MISSING"


def _matrix(cells: dict[str, dict[str, str]]) -> dict[str, Any]:
    """Build a stored-shape coverage matrix: {region_dir: {code: {status}}}."""
    return {
        region_dir: {
            code: {"status": status, "feature_count": 0} for code, status in layers.items()
        }
        for region_dir, layers in cells.items()
    }


def test_effective_coverage_old_unavailable_plus_alternate_clears_gap() -> None:
    # The immutable old release records Gyeonggi UM901 unavailable; an active
    # approved alternate evaluates it -> the Gyeonggi gap is cleared, Seoul stays.
    old = _matrix({"gyeonggi": {"UM901": _UNAVAILABLE}, "seoul": {"UM901": _UNAVAILABLE}})
    alternate = _matrix(
        {
            "gyeonggi": {"UM901": _WITH_FEATURES},
            "seoul": {"UM901": _MISSING},
            "incheon": {"UM901": _MISSING},
        }
    )
    gaps = _effective_coverage_gaps([old, alternate])
    assert "UM901" not in gaps.get("경기도", set())
    assert gaps.get("서울특별시") == {"UM901"}


def test_effective_coverage_old_unavailable_without_alternate_stays_gap() -> None:
    old = _matrix({"gyeonggi": {"UM901": _UNAVAILABLE}, "seoul": {"UM901": _UNAVAILABLE}})
    gaps = _effective_coverage_gaps([old])
    assert gaps["경기도"] == {"UM901"}
    assert gaps["서울특별시"] == {"UM901"}


def test_effective_coverage_seoul_um901_and_uf151_remain_gaps() -> None:
    old = _matrix(
        {
            "gyeonggi": {"UM901": _UNAVAILABLE, "UF151": _WITH_FEATURES},
            "seoul": {"UM901": _UNAVAILABLE, "UF151": _UNAVAILABLE},
        }
    )
    alternate = _matrix({"gyeonggi": {"UM901": _WITH_FEATURES}})
    gaps = _effective_coverage_gaps([old, alternate])
    assert gaps.get("서울특별시") == {"UM901", "UF151"}
    # Both Gyeonggi cells are now covered -> Gyeonggi has no gaps.
    assert "경기도" not in gaps


def test_effective_coverage_zero_features_counts_as_covered() -> None:
    # An evaluated-but-empty official source is coverage, not a gap.
    unavailable = _matrix({"seoul": {"UM901": _UNAVAILABLE}})
    evaluated_empty = _matrix({"seoul": {"UM901": _ZERO_FEATURES}})
    assert "서울특별시" not in _effective_coverage_gaps([unavailable, evaluated_empty])


def test_effective_coverage_ignores_non_sensitive_codes() -> None:
    # A code that is not a coverage-sensitive hard code never produces a gap.
    assert "ZZZ999" not in policy.COVERAGE_SENSITIVE_HARD_CODES
    matrix = _matrix({"seoul": {"ZZZ999": _UNAVAILABLE}})
    assert _effective_coverage_gaps([matrix]) == {}


def test_effective_coverage_does_not_mutate_input() -> None:
    old = _matrix({"gyeonggi": {"UM901": _UNAVAILABLE}})
    snapshot = copy.deepcopy(old)
    _effective_coverage_gaps([old])
    assert old == snapshot  # historical coverage matrices are read-only
